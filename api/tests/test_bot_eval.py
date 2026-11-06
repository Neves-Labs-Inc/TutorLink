"""`scripts/bot_eval.py`, the hand-run agent evaluation (ticket 14, spec §10).

The real run calls Anthropic and is never run here. The smoke test drives `main()` end to end
with a fake agent model and a fake Guardian simulator: a throwaway database is created and
migrated, one persona runs through the real `take_turn`, prompt-free tools and all, and the
report is written, so the script can't rot unnoticed.
"""

import pathlib
import re
from typing import Any

import pytest
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.services.bot_model import ModelResponse, ModelUsage, ToolCall
from app.services.bot_tool_contract import ToolResult, ToolSpec
from scripts import bot_eval

GUARDIAN_NAME = "Karen Mitchell"
FIRST_MESSAGE = "hi! I'm Karen Mitchell, I'd like tutoring for my son"
SECOND_MESSAGE = "great, thanks"
BOT_REPLY = "Thanks Karen! What's your son's name?"
WARM_UP_SECONDS = 7.5
# Per model call; on Sonnet 5.5 ($2 / $10 per MTok) that is $0.003 a call.
FAKE_USAGE = ModelUsage(
    input_tokens=1000, output_tokens=100, cache_read_input_tokens=0, cache_creation_input_tokens=0
)


class FakeAgentModel:
    """Saves the Guardian on the first call of a turn, then replies."""

    def __init__(self) -> None:
        self.calls = 0
        self.first_inputs: list[str] = []
        self.warm_up_tools: list[list[str]] = []

    def warm_up(self, *, system: str, tools: list[dict[str, Any]]) -> float | None:
        self.warm_up_tools.append([tool["name"] for tool in tools])
        return WARM_UP_SECONDS

    def create(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        timeout_s: float,
    ) -> ModelResponse:
        self.calls += 1
        if not isinstance(messages[0]["content"], list):
            self.first_inputs.append(str(messages[0]["content"]))
        is_after_tool = isinstance(messages[-1]["content"], list)
        call = (
            ToolCall(id=f"r{self.calls}", name="reply", input={"text": BOT_REPLY, "language": "en"})
            if is_after_tool
            else ToolCall(
                id=f"g{self.calls}", name="create_guardian", input={"name": GUARDIAN_NAME}
            )
        )
        return ModelResponse(
            text="",
            tool_calls=(call,),
            stop_reason="tool_use",
            usage=FAKE_USAGE,
            assistant_content=(
                {"type": "tool_use", "id": call.id, "name": call.name, "input": call.input},
            ),
        )


class FakeGuardian:
    """Sends the scripted messages, then says the goal is met. Keeps every thread it saw."""

    def __init__(self, messages: list[str]) -> None:
        self._messages = list(messages)
        self.threads: list[str] = []
        self.systems: list[str] = []

    def next_move(self, *, system: str, thread: str) -> bot_eval.GuardianMove:
        self.threads.append(thread)
        self.systems.append(system)
        message = self._messages.pop(0) if self._messages else ""
        return bot_eval.GuardianMove(
            message=message,
            stop="no" if message else "goal_met",
            note="" if message else "saved",
            usage=None,
            latency_s=0.0,
        )


def _database_exists(name: str) -> bool:
    engine = create_engine(get_settings().database_url, poolclass=NullPool)
    try:
        with engine.connect() as connection:
            found = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
            ).scalar()
    finally:
        engine.dispose()
    return found is not None


def _database_named_in(report: str) -> str:
    match = re.search(r"Database: `(bot_eval_\w+)`", report)
    assert match is not None
    return match.group(1)


def test_one_persona_runs_end_to_end_and_its_database_is_dropped(tmp_path: pathlib.Path) -> None:
    guardian = FakeGuardian([FIRST_MESSAGE, SECOND_MESSAGE])
    agent = FakeAgentModel()
    clients = bot_eval.Clients(agent_model=lambda _model, _effort: agent, guardian=guardian)

    status = bot_eval.main(
        # Two runs on one model: the Spanish one finds the scripted messages spent and ends at once.
        ["--models", "sonnet", "--personas", "intake", "--langs", "en,es", "--out", str(tmp_path)],
        clients=clients,
    )

    assert status == 0
    report = (tmp_path / "intake-en-sonnet.md").read_text()
    assert FIRST_MESSAGE in report
    assert BOT_REPLY in report
    assert f"Name: {GUARDIAN_NAME}" in report
    # Two turns of two calls each, at $0.003 a call.
    assert re.search(
        r"\| 1 \| replied \| [\d.]+ \| 2 \| 2000 \| 200 \| 0 \| 0 \| 0\.0060 \|", report
    )
    assert "goal_met" in report
    # Every tool call, with its input and result, under its turn.
    tool_calls = report[report.index("## Tool calls") :]
    assert "### Turn 1" in tool_calls
    assert "1. `create_guardian`: ok" in tool_calls
    assert f'input: `{{"name": "{GUARDIAN_NAME}"}}`' in tool_calls
    assert '"guardian_id": "' in tool_calls
    assert "2. `reply`" in tool_calls
    # The simulator sees the bot's WhatsApp reply, and only from its second move on.
    assert BOT_REPLY not in guardian.threads[0]
    assert BOT_REPLY in guardian.threads[1]
    summary = (tmp_path / "summary.md").read_text()
    assert "| intake | en | sonnet |" in summary
    # Warmed up once for both runs, with the production tools.
    [warm_up_tools] = agent.warm_up_tools
    assert "create_guardian" in warm_up_tools
    assert "reply" in warm_up_tools
    assert "- sonnet: 7.5 s" in summary
    assert not _database_exists(_database_named_in(report))


def _availability_modes(database: str) -> set[str]:
    url = make_url(get_settings().database_url).set(database=database)
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.connect() as connection:
            modes = connection.execute(
                text(
                    "SELECT DISTINCT a.mode FROM tutor_availability a"
                    " JOIN tutors t ON t.id = a.tutor_id"
                    " JOIN child_assigned_tutors c ON c.user_id = t.user_id"
                )
            ).scalars()
            return set(modes)
    finally:
        engine.dispose()


def _drop_database(name: str) -> None:
    engine = create_engine(get_settings().database_url, poolclass=NullPool)
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            connection.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
    finally:
        engine.dispose()


def test_the_reminder_persona_starts_from_a_reminder_tap_with_an_office_only_tutor(
    tmp_path: pathlib.Path,
) -> None:
    guardian = FakeGuardian(["Book a session"])
    agent = FakeAgentModel()
    clients = bot_eval.Clients(agent_model=lambda _model, _effort: agent, guardian=guardian)

    status = bot_eval.main(
        [
            "--models",
            "sonnet",
            "--personas",
            "reminder",
            "--langs",
            "en",
            "--keep-db",
            "--out",
            str(tmp_path),
        ],
        clients=clients,
    )

    database = _database_named_in((tmp_path / "reminder-en-sonnet.md").read_text())
    try:
        modes = _availability_modes(database)
    finally:
        _drop_database(database)
    assert status == 0
    assert modes == {"only_office"}
    assert 'exactly the button text, "Book a session"' in guardian.systems[0]
    # The reminder is in the chat before the Guardian's first message, and the agent sees it.
    [first_input, *_] = agent.first_inputs
    assert "Booking reminder sent: Ethan Mitchell" in first_input
    assert first_input.index("Booking reminder sent") < first_input.index("Book a session")


def test_the_other_personas_are_unchanged_and_all_includes_the_reminder_persona() -> None:
    assert "reminder" in bot_eval.parse_args(["--out", "x"]).personas
    others = [persona for persona in bot_eval.PERSONAS if persona.key != "reminder"]
    assert all(not persona.has_reminder for persona in others)
    assert all(persona.assigned_tutor_mode.value == "anywhere" for persona in others)


def test_it_refuses_to_start_without_an_api_key(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    try:
        status = bot_eval.main(["--out", str(tmp_path)])
    finally:
        get_settings.cache_clear()

    assert status == bot_eval.EXIT_NO_KEY
    assert "ANTHROPIC_API_KEY" in capsys.readouterr().err
    assert list(tmp_path.iterdir()) == []


def test_it_refuses_a_postgres_server_that_is_not_local(
    monkeypatch: pytest.MonkeyPatch, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://app:secret@db.example.com:5432/app")
    get_settings.cache_clear()
    clients = bot_eval.Clients(
        agent_model=lambda _model, _effort: FakeAgentModel(), guardian=FakeGuardian([])
    )
    try:
        status = bot_eval.main(["--out", str(tmp_path)], clients=clients)
    finally:
        get_settings.cache_clear()

    assert status == bot_eval.EXIT_REMOTE_DB
    assert "db.example.com" in capsys.readouterr().err
    assert list(tmp_path.iterdir()) == []


def test_the_tool_recorder_keeps_a_refusal_and_an_error_and_reraises() -> None:
    def refuse(ctx: Any, tool_input: dict[str, Any]) -> ToolResult:
        return ToolResult(status="refused", content={"reason": "invalid_input", "field": "date"})

    def explode(ctx: Any, tool_input: dict[str, Any]) -> ToolResult:
        raise TypeError("string indices must be integers, not 'str'")

    recorder = bot_eval.ToolRecorder()
    refusing, exploding = recorder.wrap(
        (_spec("propose", refuse), _spec("commit_proposal", explode))
    )
    refusing.run(None, {"book": ["oops"]})
    with pytest.raises(TypeError):
        exploding.run(None, {})

    [refused, failed] = recorder.drain()
    assert refused.tool == "propose"
    assert refused.input == {"book": ["oops"]}
    assert refused.outcome == "refused: invalid_input"
    assert refused.detail == {"reason": "invalid_input", "field": "date"}
    assert failed.outcome == "error: TypeError: string indices must be integers, not 'str'"
    assert recorder.drain() == []


def _spec(name: str, run: Any) -> ToolSpec:
    return ToolSpec(name=name, description=name, input_schema={}, run=run)
