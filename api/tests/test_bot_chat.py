"""`scripts/bot_chat.py`, the interactive terminal chat with the bot agent.

The real chat calls Anthropic and is never run here. These tests drive `main()` with a scripted
stdin and a fake agent model: a throwaway database is created, migrated and seeded, every line
goes through the real webhook path and `take_turn`, and the database is dropped at the end.
"""

import pathlib
import re
from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.services import twilio_service
from app.services.bot_model import ModelResponse, ModelUsage, ToolCall
from scripts import bot_chat

GUARDIAN_NAME = "Karen Mitchell"
EXISTING_GUARDIAN = "Karen Mitchell"
EXISTING_CHILD = "Ethan Mitchell"
# Per model call; on Sonnet 5.5 ($2 / $10 per MTok) that is $0.003 a call.
FAKE_USAGE = ModelUsage(
    input_tokens=1000, output_tokens=100, cache_read_input_tokens=0, cache_creation_input_tokens=0
)


class FakeAgentModel:
    """Saves the Guardian on its first turn when asked to, then replies `Reply <turn>`. Keeps
    each turn's input. `interrupt_on_turn` raises Ctrl-C inside that turn's model call."""

    def __init__(self, *, saves_guardian: bool, interrupt_on_turn: int | None = None) -> None:
        self.turn_inputs: list[str] = []
        self._saves_guardian = saves_guardian
        self._interrupt_on_turn = interrupt_on_turn
        self._calls = 0

    def create(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        timeout_s: float,
    ) -> ModelResponse:
        self._calls += 1
        last = messages[-1]["content"]
        is_after_tool = isinstance(last, list)
        if not is_after_tool:
            self.turn_inputs.append(last)
        if len(self.turn_inputs) == self._interrupt_on_turn:
            raise KeyboardInterrupt
        reply = ToolCall(
            id=f"r{self._calls}",
            name="reply",
            input={"text": f"Reply {len(self.turn_inputs)}", "language": "en"},
        )
        should_save = self._saves_guardian and not is_after_tool and len(self.turn_inputs) == 1
        call = (
            ToolCall(id=f"g{self._calls}", name="create_guardian", input={"name": GUARDIAN_NAME})
            if should_save
            else reply
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

    def warm_up(self, *, system: str, tools: list[dict[str, Any]]) -> float | None:
        return None


def scripted(lines: list[str]) -> Callable[[str], str]:
    """`input()` reading `lines`, then end of input (Ctrl-D)."""
    pending = list(lines)

    def read_line(prompt: str) -> str:
        if not pending:
            raise EOFError
        return pending.pop(0)

    return read_line


def never_read(prompt: str) -> str:
    raise AssertionError("the chat must not start")


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


def _database_named_in(output: str) -> str:
    match = re.search(r"(bot_chat_\d+_[0-9a-f]+)", output)
    assert match is not None
    return match.group(1)


def test_a_new_guardian_chats_through_every_command_and_the_database_is_dropped(
    tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    model = FakeAgentModel(saves_guardian=True)
    transcript = tmp_path / "chat.md"

    status = bot_chat.main(
        ["--scenario", "new", "--show-tools", "--transcript", str(transcript)],
        model_factory=lambda _model, _effort: model,
        read_line=scripted(
            [
                "hi, I'm Karen Mitchell",
                "/saved",
                "/burst",
                "my son is Ethan",
                "he is in grade 5",
                "",
                "/gap 30",
                "/takeover",
                "sorry, back again",
                "/takeover",
                "is anyone there?",
                "/handback",
                "/quit",
            ]
        ),
    )

    output = capsys.readouterr().out
    assert status == 0
    # One turn per typed line, the bot's reply printed with its cost on the line below.
    assert "Reply 1" in output
    assert "$0.0060" in output
    # --show-tools prints the call and its result.
    assert "create_guardian: ok" in output
    assert '"guardian_id": "' in output
    # /saved shows what the agent stored.
    assert f"Name: {GUARDIAN_NAME}" in output
    # A burst is one turn that sees every line of it.
    assert "my son is Ethan" in model.turn_inputs[1]
    assert "he is in grade 5" in model.turn_inputs[1]
    assert "Reply 2" in output
    # 30 hours later the Guardian's 24-hour window has closed, so Staff can't take over...
    assert "window" in output.lower()
    # ...until the Guardian writes again.
    assert "Reply 3" in output
    assert "Olivia Office from M's Helping Hands has joined this chat" in output
    # While the office holds the chat the bot stays quiet.
    assert "Reply 4" not in output
    assert len(model.turn_inputs) == 3
    assert "You're back with the M's Helping Hands booking assistant" in output
    report = transcript.read_text()
    assert "hi, I'm Karen Mitchell" in report
    assert "Reply 3" in report
    assert "1. `create_guardian`: ok" in report
    assert not _database_exists(_database_named_in(report))


def test_an_existing_family_has_sessions_and_can_answer_the_weekly_reminder(
    capsys: pytest.CaptureFixture[str],
) -> None:
    model = FakeAgentModel(saves_guardian=False)

    status = bot_chat.main(
        ["--scenario", "existing"],
        model_factory=lambda _model, _effort: model,
        read_line=scripted(["/saved", "/reminder", "Book a session"]),
    )

    output = capsys.readouterr().out
    assert status == 0
    assert f"Name: {EXISTING_GUARDIAN}" in output
    assert f"- {EXISTING_CHILD}: grade 5" in output
    assert len(re.findall(r"with Laura Rivera at home; confirmed", output)) == 2
    assert f"no tutoring session booked yet for {EXISTING_CHILD}" in output
    # The reminder sits in the agent's history: the reply to it is a normal turn.
    assert f"Booking reminder sent: {EXISTING_CHILD}" in model.turn_inputs[0]
    assert "Reply 1" in output
    assert not _database_exists(_database_named_in(output))


def test_ctrl_c_mid_turn_rolls_back_and_drops_the_database(
    capsys: pytest.CaptureFixture[str],
) -> None:
    model = FakeAgentModel(saves_guardian=False, interrupt_on_turn=1)

    status = bot_chat.main(
        ["--scenario", "new"],
        model_factory=lambda _model, _effort: model,
        read_line=scripted(["hello", "never sent"]),
    )

    output = capsys.readouterr().out
    assert status == bot_chat.EXIT_INTERRUPTED
    assert len(model.turn_inputs) == 1
    assert not _database_exists(_database_named_in(output))


def test_it_refuses_to_start_without_an_api_key(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    try:
        status = bot_chat.main([], read_line=never_read)
    finally:
        get_settings.cache_clear()

    assert status == bot_chat.EXIT_NO_KEY
    assert "ANTHROPIC_API_KEY" in capsys.readouterr().err


def test_it_refuses_a_postgres_server_that_is_not_local(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://app:secret@db.example.com:5432/app")
    get_settings.cache_clear()
    try:
        status = bot_chat.main(
            [],
            model_factory=lambda _model, _effort: FakeAgentModel(saves_guardian=False),
            read_line=never_read,
        )
    finally:
        get_settings.cache_clear()

    assert status == bot_chat.EXIT_REMOTE_DB
    assert "db.example.com" in capsys.readouterr().err


def test_an_error_in_a_command_is_reported_and_the_chat_goes_on(
    tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    model = FakeAgentModel(saves_guardian=False)
    transcript = tmp_path / "chat.md"

    status = bot_chat.main(
        ["--transcript", str(transcript)],
        model_factory=lambda _model, _effort: model,
        # A gap far past any date Postgres can store.
        read_line=scripted(["hello", "/gap 100000000", "still there?"]),
    )

    output = capsys.readouterr().out
    assert status == 0
    assert "(error, rolled back:" in output
    assert "Reply 2" in output
    report = transcript.read_text()
    assert "still there?" in report
    assert not _database_exists(_database_named_in(report))


def test_lang_applies_to_a_reminder_sent_before_anything_is_typed(
    capsys: pytest.CaptureFixture[str],
) -> None:
    model = FakeAgentModel(saves_guardian=False)

    status = bot_chat.main(
        ["--scenario", "existing", "--lang", "es"],
        model_factory=lambda _model, _effort: model,
        read_line=scripted(["/reminder"]),
    )

    output = capsys.readouterr().out
    assert status == 0
    assert "Hola, este es su recordatorio semanal" in output
    assert "Sofía González" in output


def test_a_send_path_left_unfaked_fails_instead_of_reaching_twilio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC" + "0" * 32)
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "a-real-looking-token")
    monkeypatch.setenv("TWILIO_WHATSAPP_NUMBER", "+13055550199")
    get_settings.cache_clear()
    try:
        # An unbound session factory: nothing here touches the database.
        with bot_chat.chat_patches(sessionmaker()), pytest.raises(bot_chat.RealTwilioRefused):
            twilio_service.send_whatsapp_message(to="+13055550001", body="hi")
    finally:
        get_settings.cache_clear()
