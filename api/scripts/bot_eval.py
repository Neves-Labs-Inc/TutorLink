"""Hand-run evaluation of the WhatsApp bot agent (docs/specs/whatsapp-bot-agent.md §10).

A second model plays the Guardian from a persona and a goal, against the real agent: the real
system prompt, tools and `bot_turn.take_turn`, on a seeded throwaway database. Twilio is faked
and the debounce is skipped: each simulated message is recorded the way the webhook records it,
and its turn runs straight away. Nothing is scored; Franklin reads the transcripts.

**When to run it:** before launch, to sign off every persona in both languages on the chosen
model, and by hand before merging any change to the system prompt (`bot_prompt`), the model or
its settings (`bot_model`, `BOT_MODEL`, `BOT_EFFORT`) or the tool definitions
(`bot_tools_profile`, `bot_tools_booking`, `bot_turn.REPLY_TOOL`). It costs money and needs a
key, so it is never part of CI; `tests/test_bot_eval.py` runs it with fake models instead.

From `api/`, with the test Postgres (or any server the URL's user may create databases on):

    UV_NATIVE_TLS=1 ANTHROPIC_API_KEY=sk-ant-... \\
    DATABASE_URL=postgresql+psycopg://test:test@localhost:5432/postgres \\
    SECRET_KEY=$(openssl rand -hex 32) \\
    uv run python scripts/bot_eval.py --models sonnet,haiku --personas all --langs en,es \\
        --out ../.scratch/bot-eval/$(date +%Y%m%d-%H%M)

**The database.** `DATABASE_URL` only names the server: the script creates
its own `bot_eval_<timestamp>_<hex>` database there, migrates it, seeds it, runs every persona
against it and drops it at the end (`--keep-db` keeps it for a look). Every session it opens is
bound to that database, and it refuses to seed one it did not just create. It only uses a
server on this machine (localhost or a unix socket) unless `--allow-remote-db` is passed.

**Output**, in `--out`: one Markdown file per persona × language × model (the transcript with
fixed messages and handoff notes, what got saved, per-turn latency, tokens and estimated cost,
and every tool call the agent made with its input and result) and `summary.md`, which is also
printed. The tool calls show values, unlike the app log: the family is made up.

To rerun only some conversations, filter: `--personas booking --langs en --models haiku`.
"""

import argparse
import dataclasses
import datetime
import json
import os
import pathlib
import secrets
import statistics
import subprocess
import sys
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol
from unittest import mock

API_DIR = pathlib.Path(__file__).resolve().parents[1]

# `app.config` refuses to load without these, and `app.db` reads them on import. The app's own
# engine is never used: every session here is bound to the throwaway database. A missing
# DATABASE_URL is reported by `main`, not as an import error.
UNSET_DATABASE_URL = "postgresql+psycopg://unset@localhost/unset"
os.environ.setdefault("DATABASE_URL", UNSET_DATABASE_URL)
os.environ.setdefault("SECRET_KEY", secrets.token_urlsafe(48))
sys.path.insert(0, str(API_DIR))

import anthropic  # noqa: E402
from sqlalchemy import Engine, create_engine, make_url, select, text, update  # noqa: E402
from sqlalchemy.engine import URL  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.models.availability import TutorAvailability  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.child import Child  # noqa: E402
from app.models.child_assigned_tutor import ChildAssignedTutor  # noqa: E402
from app.models.child_subject_level import ChildSubjectLevel  # noqa: E402
from app.models.conversation import Conversation  # noqa: E402
from app.models.enums import (  # noqa: E402
    AvailabilityMode,
    BookingLocation,
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian  # noqa: E402
from app.models.home import GuardianHome, Home  # noqa: E402
from app.models.message import Message  # noqa: E402
from app.models.subject import Subject  # noqa: E402
from app.models.system_setting import (  # noqa: E402
    SETTING_VALUE_TYPE_INTEGER,
    SETTING_VALUE_TYPE_STRING,
    SystemSetting,
)
from app.models.tutor import Tutor, TutorSubject  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import bot_agent, bot_turn, clock, webhook_service  # noqa: E402
from app.services.bot_context import STAFF_ONLY_KINDS  # noqa: E402
from app.services.bot_model import (  # noqa: E402
    SDK_RETRIES,
    AnthropicModelClient,
    Effort,
    ModelClient,
    ModelResponse,
    ModelUnavailable,
    ModelUsage,
)
from app.services.bot_tool_contract import ToolResult, ToolSpec  # noqa: E402

EXIT_FAILED = 1
EXIT_NO_KEY = 2
EXIT_REMOTE_DB = 3

# A server on this machine (a unix socket has no host, or a path for one). Anything else needs
# `--allow-remote-db`: a shell with a deployed DATABASE_URL still exported must not create and
# drop databases on that server.
LOCAL_DATABASE_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

DATABASE_PREFIX = "bot_eval_"
MODEL_ALIASES = {"sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5"}
SIMULATOR_MODEL = "claude-sonnet-5-5"
SIMULATOR_EFFORT = "low"
SIMULATOR_MAX_TOKENS = 4096
SIMULATOR_TIMEOUT_SECONDS = 60.0
SIMULATOR_RETRIES = 2
DEFAULT_MAX_TURNS = 14
TOKENS_PER_MILLION = 1_000_000
LANGUAGE_NAMES = {"en": "English", "es": "Spanish"}
ALL = "all"

BUSINESS_TIMEZONE = "America/New_York"
OFFICE_ADDRESS = "200 Biscayne Blvd, Suite 410, Miami, FL 33131"
OFFICE_PHONE = "+13055550100"
CUTOFF_HOURS = 24
# Weekday afternoons, Monday to Friday (`day_of_week` 0-4).
WEEKDAYS = range(5)
AFTERNOON_START = datetime.time(15, 0)
AFTERNOON_END = datetime.time(19, 0)
MAX_GRADE = 12
# 305-555-01xx and 786-555-01xx: fictional, but valid to libphonenumber.
GUARDIAN_PHONE = "+1305555{index:04d}"
TUTOR_PHONE = "+1786555{index:04d}"

# Conversation instants a gap moves back along with the messages.
BACK_DATED_COLUMNS = (
    "created_at",
    "last_message_at",
    "proposed_at",
    "flagged_at",
    "outage_apology_sent_at",
)


# --- prices -----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Price:
    """US dollars per million tokens. The cache write is the 5-minute one `bot_model` uses."""

    input: float
    output: float
    cache_write: float
    cache_read: float


# https://platform.claude.com/docs/en/about-claude/pricing, read 2026-10-20: Sonnet 5.5 cache
# hits are 0.05x input ($0.10, not the 0.1x most models have). Haiku 5.5 prices are for prompts
# of 100K tokens or fewer; a WhatsApp turn stays far below that.
PRICES = {
    "claude-sonnet-5-5": Price(input=2.00, output=10.00, cache_write=2.50, cache_read=0.10),
    "claude-haiku-5-5": Price(input=0.10, output=0.50, cache_write=0.125, cache_read=0.01),
}


def estimate_cost(model_id: str, usage: ModelUsage) -> float | None:
    """The call's cost in dollars; `None` for a model with no price here."""
    price = PRICES.get(model_id)
    if price is None:
        return None

    return (
        usage.input_tokens * price.input
        + usage.output_tokens * price.output
        + usage.cache_creation_input_tokens * price.cache_write
        + usage.cache_read_input_tokens * price.cache_read
    ) / TOKENS_PER_MILLION


# --- personas ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Family:
    guardian: str
    child: str
    grade: int
    school: str
    address: str
    directions: str


FAMILIES = {
    "en": Family(
        guardian="Karen Mitchell",
        child="Ethan Mitchell",
        grade=5,
        school="Lincoln Elementary",
        address="48 Oak Street, Apt 3B, Coral Gables, FL 33134",
        directions="gate code 4412",
    ),
    "es": Family(
        guardian="María González",
        child="Sofía González",
        grade=4,
        school="Escuela Primaria Roosevelt",
        address="1520 SW 8th Street, Miami, FL 33135",
        directions="toque el timbre del apartamento 2",
    ),
}


@dataclass(frozen=True)
class Gap:
    """The Guardian goes quiet after `after_messages` messages and comes back `hours` later."""

    after_messages: int
    hours: int


@dataclass(frozen=True)
class Persona:
    key: str
    title: str
    # `False`: a number nobody has written from. `True`: a Guardian with a Home and an
    # Evaluated Child whose Assigned Tutor teaches Math and Reading, but not Science.
    is_known_guardian: bool
    brief: Callable[[Family], str]
    goal: Callable[[Family], str]
    gap: Gap | None = None


PERSONAS = (
    Persona(
        key="intake",
        title="New Guardian Intake",
        is_known_guardian=False,
        brief=lambda f: (
            "A busy parent writing to the tutoring company for the first time. You like to put"
            " several details in one message (your name, your child's name, grade and school"
            " together, for example) instead of answering one question at a time."
        ),
        goal=lambda f: (
            f"Get registered. Your name is {f.guardian}. Your child is {f.child}, grade"
            f" {f.grade} at {f.school}. Your home is {f.address} ({f.directions}). You want"
            " tutoring for your child and you're fine with weekly reminders. The goal is met"
            " once the assistant says your child is registered (or that the office will be in"
            " touch to arrange the evaluation)."
        ),
    ),
    Persona(
        key="booking",
        title="Booking with a change of mind",
        is_known_guardian=True,
        brief=lambda f: (
            f"{f.guardian}, an existing client. Your child {f.child} is already evaluated and"
            " has a tutor. You're friendly but you change your mind once."
        ),
        goal=lambda f: (
            f"Book a Math session for {f.child} at home next week. When the assistant offers"
            " a day, change your mind and ask for a different weekday BEFORE saying yes; then"
            " confirm that one. Once it is booked, ask to move (reschedule) that same session"
            " to another afternoon, and confirm the new time. The goal is met once the"
            " reschedule is confirmed."
        ),
    ),
    Persona(
        key="off_script",
        title="Off-script plus no Tutor",
        is_known_guardian=True,
        brief=lambda f: (
            f"{f.guardian}, an existing client; {f.child} is already evaluated. You're chatty"
            " and ask things the assistant may not handle."
        ),
        goal=lambda f: (
            "First ask how much the sessions cost and whether you can pay by Zelle. Then ask"
            f" to book a Science session for {f.child}. The goal is met once the assistant has"
            " told you the office will follow up on both. Give up if it keeps asking you the"
            " same thing."
        ),
    ),
    Persona(
        key="curt",
        title="Typos, curt, confused",
        is_known_guardian=True,
        brief=lambda f: (
            f"{f.guardian}, an existing client; {f.child} is already evaluated. You type on"
            " your phone in a hurry: lots of typos, no punctuation, mostly one- or two-word"
            ' replies ("ok", "yes", "tuesday?"). You get a bit confused about which'
            " day was offered."
        ),
        goal=lambda f: (
            f"Book a Reading session for {f.child} sometime next week, at home. After your"
            " third message you go quiet; when you come back you have half forgotten where"
            " the chat was. The goal is met once a session is booked."
        ),
        gap=Gap(after_messages=3, hours=26),
    ),
)


# --- the Guardian simulator -------------------------------------------------------------------

StopReason = Literal["no", "goal_met", "gave_up"]

GUARDIAN_MOVE_SCHEMA = {
    "type": "object",
    "properties": {
        "message": {"type": "string"},
        "stop": {"type": "string", "enum": ["no", "goal_met", "gave_up"]},
        "note": {"type": "string"},
    },
    "required": ["message", "stop", "note"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class GuardianMove:
    """The simulated Guardian's next WhatsApp message, or why it stops (`stop` not "no")."""

    message: str
    stop: StopReason
    note: str
    usage: ModelUsage | None
    latency_s: float


class GuardianSimulator(Protocol):
    def next_move(self, *, system: str, thread: str) -> GuardianMove:
        """The next move, given the persona prompt and the WhatsApp-visible thread."""
        ...


class SimulatorFailed(Exception):
    """The Guardian simulator gave nothing usable."""


class AnthropicGuardian:
    """The simulated Guardian on Sonnet 5.5, one stateless call per move."""

    def __init__(self, client: anthropic.Anthropic) -> None:
        self._client = client

    def next_move(self, *, system: str, thread: str) -> GuardianMove:
        started = time.monotonic()
        message = self._client.messages.create(
            model=SIMULATOR_MODEL,
            max_tokens=SIMULATOR_MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": thread}],
            output_config={
                "effort": SIMULATOR_EFFORT,
                "format": {"type": "json_schema", "schema": GUARDIAN_MOVE_SCHEMA},
            },
        )
        latency_s = time.monotonic() - started
        if message.stop_reason != "end_turn":
            raise SimulatorFailed(f"the simulator stopped with {message.stop_reason}")

        move = json.loads(next(block.text for block in message.content if block.type == "text"))
        usage = message.usage
        return GuardianMove(
            message=move["message"],
            stop=move["stop"],
            note=move["note"],
            usage=ModelUsage(
                input_tokens=usage.input_tokens,
                output_tokens=usage.output_tokens,
                cache_read_input_tokens=usage.cache_read_input_tokens or 0,
                cache_creation_input_tokens=usage.cache_creation_input_tokens or 0,
            ),
            latency_s=latency_s,
        )


def simulator_prompt(persona: Persona, language: str) -> str:
    family = FAMILIES[language]
    return (
        "You are role-playing a parent (a Guardian) texting a tutoring company's WhatsApp"
        " assistant, to test that assistant. Stay in character the whole time and never say"
        " you are an AI, a test or a simulation.\n\n"
        f"Write every message in {LANGUAGE_NAMES[language]} only.\n\n"
        f"Who you are: {persona.brief(family)}\n\n"
        f"Your goal: {persona.goal(family)}\n\n"
        "Each time, you get the WhatsApp chat so far and decide your next move. Write"
        " `message` the way a real parent texts on WhatsApp. Set `stop` to `no` to send it."
        " Set `stop` to `goal_met` (with an empty message) once the goal is met, or to"
        " `gave_up` if the assistant is stuck, going in circles or has stopped replying. Use"
        " `note` for one line on why you stopped; leave it empty otherwise. Only share a"
        " detail when it fits; never invent details beyond the ones above."
    )


# --- the agent model under test, metered ------------------------------------------------------


@dataclass(frozen=True)
class CallRecord:
    latency_s: float
    usage: ModelUsage | None


class MeteredModel:
    """The model under test, with each call's wall time and usage kept for the report."""

    def __init__(self, inner: ModelClient) -> None:
        self._inner = inner
        self._calls: list[CallRecord] = []
        self._tool_calls: list[tuple[str, dict[str, Any]]] = []

    def create(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        timeout_s: float,
    ) -> ModelResponse:
        started = time.monotonic()
        try:
            response = self._inner.create(
                system=system, tools=tools, messages=messages, timeout_s=timeout_s
            )
        except ModelUnavailable:
            self._calls.append(CallRecord(time.monotonic() - started, None))
            raise
        self._calls.append(CallRecord(time.monotonic() - started, response.usage))
        self._tool_calls += [(call.name, call.input) for call in response.tool_calls]
        return response

    def drain(self) -> list[CallRecord]:
        """The calls since the last drain."""
        calls, self._calls = self._calls, []
        return calls

    def drain_tool_calls(self) -> list[tuple[str, dict[str, Any]]]:
        """Every tool call the model asked for since the last drain, `reply` included."""
        tool_calls, self._tool_calls = self._tool_calls, []
        return tool_calls


@dataclass(frozen=True)
class ToolCallRecord:
    """One tool call for the report. Eval-only: inputs and results carry the made-up family's
    data, which the app log never does."""

    tool: str
    input: dict[str, Any]
    # `ok`, `refused: <reason>`, `error: <type>: <message>`, `reply`, or why it never ran.
    outcome: str
    # The result the model got back.
    detail: dict[str, Any] | None = None


class ToolRecorder:
    """Wraps the agent's tools to keep each call's input and result, or the error it raised."""

    def __init__(self) -> None:
        self._records: list[ToolCallRecord] = []

    def wrap(self, tools: tuple[ToolSpec, ...]) -> tuple[ToolSpec, ...]:
        return tuple(dataclasses.replace(spec, run=self._recorded(spec)) for spec in tools)

    def drain(self) -> list[ToolCallRecord]:
        records, self._records = self._records, []
        return records

    def _recorded(self, spec: ToolSpec) -> Callable[[Any, dict[str, Any]], ToolResult]:
        def run(ctx: Any, tool_input: dict[str, Any]) -> ToolResult:
            try:
                result = spec.run(ctx, tool_input)
            except Exception as exc:
                self._records.append(
                    ToolCallRecord(spec.name, tool_input, f"error: {type(exc).__name__}: {exc}")
                )
                raise
            outcome = "ok" if result.status == "ok" else f"refused: {result.content.get('reason')}"
            self._records.append(ToolCallRecord(spec.name, tool_input, outcome, result.content))
            return result

        return run


def merge_tool_calls(
    asked: list[tuple[str, dict[str, Any]]], ran: list[ToolCallRecord]
) -> list[ToolCallRecord]:
    """The model's calls in order, each with what running it gave. The turn runs the calls
    other than `reply` in order, so `ran` lines up with them; a call with no record had an
    unknown name or came after a tool that raised."""
    pending = list(ran)
    merged = []
    for name, tool_input in asked:
        if name == bot_turn.REPLY_TOOL_NAME:
            merged.append(ToolCallRecord(name, tool_input, "reply"))
        elif pending and pending[0].tool == name:
            merged.append(pending.pop(0))
        else:
            merged.append(
                ToolCallRecord(name, tool_input, "not run (unknown tool or an earlier error)")
            )
    return merged


@dataclass(frozen=True)
class Clients:
    """The models the run talks to; the smoke test passes fakes."""

    agent_model: Callable[[str, Effort], ModelClient]
    guardian: GuardianSimulator


def anthropic_clients(api_key: str) -> Clients:
    agent_client = anthropic.Anthropic(api_key=api_key, max_retries=SDK_RETRIES)
    simulator_client = anthropic.Anthropic(
        api_key=api_key, max_retries=SIMULATOR_RETRIES, timeout=SIMULATOR_TIMEOUT_SECONDS
    )
    return Clients(
        agent_model=lambda model_id, effort: AnthropicModelClient(
            client=agent_client, model=model_id, effort=effort
        ),
        guardian=AnthropicGuardian(simulator_client),
    )


# --- Twilio, faked ----------------------------------------------------------------------------


class FakeTwilio:
    """Accepts every send with a made-up SID; nothing reaches Twilio."""

    def __init__(self) -> None:
        self._count = 0

    def send_whatsapp_message(self, *, to: str, body: str) -> str:
        self._count += 1
        return f"SMeval{self._count:026d}"

    def send_typing_indicator(self, *, message_sid: str) -> None:
        return None


@contextmanager
def harness_patches(session_factory: Callable[[], Session], twilio: FakeTwilio) -> Iterator[None]:
    """Point the business clock's own session at the throwaway database, and fake Twilio on
    every module the turn and the inbound path send from."""
    with ExitStack() as stack:
        stack.enter_context(mock.patch.object(clock, "SessionLocal", session_factory))
        stack.enter_context(mock.patch.object(clock, "_cached_zone", None))
        stack.enter_context(
            mock.patch.object(bot_turn, "send_whatsapp_message", twilio.send_whatsapp_message)
        )
        stack.enter_context(
            mock.patch.object(bot_turn, "send_typing_indicator", twilio.send_typing_indicator)
        )
        stack.enter_context(
            mock.patch.object(
                webhook_service, "send_whatsapp_message", twilio.send_whatsapp_message
            )
        )
        yield


# --- the throwaway database -------------------------------------------------------------------


@contextmanager
def throwaway_database(server_url: str, *, keep: bool) -> Iterator[URL]:
    """Create a fresh `bot_eval_*` database on the server `server_url` names, and drop it
    afterwards unless `keep`."""
    server = make_url(server_url)
    stamp = datetime.datetime.now(tz=datetime.UTC).strftime("%Y%m%d%H%M%S")
    name = f"{DATABASE_PREFIX}{stamp}_{secrets.token_hex(3)}"
    admin = create_engine(server, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield server.set(database=name)
    finally:
        if keep:
            print(f"kept database {name}", file=sys.stderr)
        else:
            with admin.connect() as connection:
                connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def migrate(url: URL) -> None:
    """`alembic upgrade head` on `url`, in a subprocess: `alembic/env.py` reads the URL from
    the environment, and its logging setup stays out of this process."""
    environment = {**os.environ, "DATABASE_URL": url.render_as_string(hide_password=False)}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_DIR,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


def check_throwaway(engine: Engine, *, name: str) -> None:
    """Refuse a database this run didn't create: the wrong name, or one with data in it."""
    with engine.connect() as connection:
        current = connection.execute(text("SELECT current_database()")).scalar_one()
        guardians = connection.execute(text("SELECT count(*) FROM guardians")).scalar_one()
    if current != name or not current.startswith(DATABASE_PREFIX) or guardians:
        raise RuntimeError(f"refusing to seed {current}: not this run's empty throwaway database")


# --- seeding ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Catalog:
    math_id: uuid.UUID
    reading_id: uuid.UUID
    science_id: uuid.UUID


def seed_catalog(db: Session) -> Catalog:
    """The Subjects and the settings every run shares."""
    subjects = {
        "Math": "Matemáticas",
        "Reading": "Lectura",
        "Science": "Ciencias",
    }
    rows = {name: Subject(name=name, name_es=name_es) for name, name_es in subjects.items()}
    db.add_all(rows.values())
    _set_setting(db, "business_timezone", BUSINESS_TIMEZONE, SETTING_VALUE_TYPE_STRING)
    _set_setting(db, "office_address", OFFICE_ADDRESS, SETTING_VALUE_TYPE_STRING)
    _set_setting(db, "office_phone", OFFICE_PHONE, SETTING_VALUE_TYPE_STRING)
    _set_setting(db, "cancellation_cutoff_hours", str(CUTOFF_HOURS), SETTING_VALUE_TYPE_INTEGER)
    db.commit()
    return Catalog(
        math_id=rows["Math"].id, reading_id=rows["Reading"].id, science_id=rows["Science"].id
    )


def _set_setting(db: Session, key: str, value: str, value_type: str) -> None:
    row = db.scalars(select(SystemSetting).where(SystemSetting.key == key)).one_or_none()
    if row is None:
        db.add(SystemSetting(key=key, value=value, value_type=value_type, is_developer_only=False))
    else:
        row.value = value
    db.flush()


def seed_world(
    db: Session, *, persona: Persona, family: Family, catalog: Catalog, run_index: int
) -> str:
    """One run's Tutors and, for a known Guardian, their Home and Evaluated Child. Each run has
    its own, so no run takes another's slots. Returns the Guardian's phone number."""
    phone_number = GUARDIAN_PHONE.format(index=run_index)
    assigned = _make_tutor(
        db,
        name="Laura Rivera",
        email=f"laura.rivera.{run_index}@eval.example",
        phone_number=TUTOR_PHONE.format(index=run_index * 2),
        subject_ids=(catalog.math_id, catalog.reading_id),
    )
    science = _make_tutor(
        db,
        name="David Chen",
        email=f"david.chen.{run_index}@eval.example",
        phone_number=TUTOR_PHONE.format(index=run_index * 2 + 1),
        subject_ids=(catalog.science_id,),
    )
    if persona.is_known_guardian:
        _make_family(
            db,
            family=family,
            phone_number=phone_number,
            assigned_user_id=assigned.user_id,
            evaluator_id=science.user_id,
            subject_ids=(catalog.math_id, catalog.reading_id),
        )
    db.commit()
    return phone_number


def _make_tutor(
    db: Session, *, name: str, email: str, phone_number: str, subject_ids: Sequence[uuid.UUID]
) -> Tutor:
    tutor = Tutor(
        user=User(email=email, name=name, name_is_default=False, role=UserRole.TUTOR),
        phone_number=phone_number,
    )
    db.add(tutor)
    db.flush()
    db.add_all(
        TutorSubject(tutor_id=tutor.id, subject_id=subject_id, max_grade_level=MAX_GRADE)
        for subject_id in subject_ids
    )
    db.add_all(
        TutorAvailability(
            tutor_id=tutor.id,
            day_of_week=day,
            start_time=AFTERNOON_START,
            end_time=AFTERNOON_END,
            mode=AvailabilityMode.ANYWHERE,
        )
        for day in WEEKDAYS
    )
    db.flush()
    return tutor


def _make_family(
    db: Session,
    *,
    family: Family,
    phone_number: str,
    assigned_user_id: uuid.UUID,
    evaluator_id: uuid.UUID,
    subject_ids: Sequence[uuid.UUID],
) -> None:
    guardian = Guardian(phone_number=phone_number, name=family.guardian)
    home = Home(address=family.address, directions=family.directions)
    child = Child(
        name=family.child,
        grade_level=family.grade,
        school_name=family.school,
        evaluated_at=datetime.datetime.now(tz=datetime.UTC),
        evaluated_by_user_id=evaluator_id,
    )
    db.add_all([guardian, home, child])
    db.flush()
    db.add_all(
        [
            GuardianHome(guardian_id=guardian.id, home_id=home.id),
            ChildGuardian(child_id=child.id, guardian_id=guardian.id),
            ChildAssignedTutor(child_id=child.id, user_id=assigned_user_id),
            *(
                ChildSubjectLevel(
                    child_id=child.id,
                    subject_id=subject_id,
                    level=family.grade,
                    set_by_user_id=evaluator_id,
                )
                for subject_id in subject_ids
            ),
        ]
    )
    db.flush()


# --- one run ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class RunSpec:
    persona: Persona
    language: str
    model_alias: str
    model_id: str

    @property
    def file_name(self) -> str:
        return f"{self.persona.key}-{self.language}-{self.model_alias}.md"


@dataclass(frozen=True)
class TurnRecord:
    index: int
    outcome: str
    latency_s: float
    calls: list[CallRecord]
    model_id: str
    tool_calls: list[ToolCallRecord] = field(default_factory=list)

    def total(self, field_name: str) -> int:
        return sum(getattr(call.usage, field_name) for call in self.calls if call.usage)

    @property
    def cost(self) -> float | None:
        costs = [estimate_cost(self.model_id, call.usage) for call in self.calls if call.usage]
        return None if any(cost is None for cost in costs) else sum(c or 0.0 for c in costs)


@dataclass
class RunResult:
    spec: RunSpec
    turns: list[TurnRecord] = field(default_factory=list)
    guardian_messages: int = 0
    ended: str = "turn cap"
    end_note: str = ""
    simulator_usage: list[ModelUsage] = field(default_factory=list)
    transcript: list[str] = field(default_factory=list)
    saved: list[str] = field(default_factory=list)
    flag: str = "none"
    counts: str = ""

    @property
    def cost(self) -> float | None:
        costs = [turn.cost for turn in self.turns]
        return None if any(cost is None for cost in costs) else sum(c or 0.0 for c in costs)

    @property
    def simulator_cost(self) -> float:
        return sum(estimate_cost(SIMULATOR_MODEL, usage) or 0.0 for usage in self.simulator_usage)


@dataclass(frozen=True)
class RunContext:
    session_factory: Callable[[], Session]
    catalog: Catalog
    clients: Clients
    effort: Effort
    max_turns: int


def run_one(spec: RunSpec, *, run_index: int, context: RunContext) -> RunResult:
    """One simulated conversation, start to finish."""
    family = FAMILIES[spec.language]
    model = MeteredModel(context.clients.agent_model(spec.model_id, context.effort))
    recorder = ToolRecorder()
    production = bot_agent.default_deps()
    # The production prompt, tools and context builder, with the model under test and every
    # tool call kept for the report.
    deps = dataclasses.replace(production, model=model, tools=recorder.wrap(production.tools))
    result = RunResult(spec=spec)
    system = simulator_prompt(spec.persona, spec.language)

    with context.session_factory() as db:
        phone_number = seed_world(
            db, persona=spec.persona, family=family, catalog=context.catalog, run_index=run_index
        )
        conversation_id: uuid.UUID | None = None
        for index in range(context.max_turns):
            note = _gap_note(db, spec.persona, conversation_id, index)
            thread = guardian_thread(db, conversation_id) + note
            move = context.clients.guardian.next_move(system=system, thread=thread)
            if move.usage is not None:
                result.simulator_usage.append(move.usage)
            if move.stop != "no":
                result.ended, result.end_note = move.stop, move.note
                break

            conversation_id = record_inbound(db, phone_number=phone_number, body=move.message)
            result.guardian_messages += 1
            started = time.monotonic()
            outcome = bot_turn.take_turn(db, conversation_id=conversation_id, deps=deps)
            result.turns.append(
                TurnRecord(
                    index=index + 1,
                    outcome=outcome.kind,
                    latency_s=time.monotonic() - started,
                    calls=model.drain(),
                    model_id=spec.model_id,
                    tool_calls=merge_tool_calls(model.drain_tool_calls(), recorder.drain()),
                )
            )

        describe_saved(db, result, phone_number=phone_number, conversation_id=conversation_id)
    return result


def record_inbound(db: Session, *, phone_number: str, body: str) -> uuid.UUID:
    """The Guardian's message, recorded as the webhook records it; the debounce is skipped."""
    inbound = webhook_service.handle_inbound(
        db,
        twilio_from=f"{webhook_service.WHATSAPP_PREFIX}{phone_number}",
        body=body,
        twilio_sid=f"SMin{uuid.uuid4().hex}",
    )
    db.commit()
    return inbound.recorded[0].conversation_id


def _gap_note(db: Session, persona: Persona, conversation_id: uuid.UUID | None, index: int) -> str:
    """At the persona's gap, move the whole chat back in time and tell the simulator."""
    gap = persona.gap
    if gap is None or conversation_id is None or index != gap.after_messages:
        return ""

    back_date(db, conversation_id=conversation_id, hours=gap.hours)
    return (
        f"\n\n(About {gap.hours} hours have passed since your last message. You went quiet;"
        " now you come back to the chat.)"
    )


def back_date(db: Session, *, conversation_id: uuid.UUID, hours: int) -> None:
    """Shift the chat's messages and instants `hours` into the past: the same as the next
    message arriving that much later."""
    shift = datetime.timedelta(hours=hours)
    db.execute(
        update(Message)
        .where(Message.conversation_id == conversation_id)
        .values(created_at=Message.created_at - shift)
    )
    conversation = db.get_one(Conversation, conversation_id)
    for column in BACK_DATED_COLUMNS:
        instant = getattr(conversation, column)
        if instant is not None:
            setattr(conversation, column, instant - shift)
    db.commit()


def _messages(db: Session, conversation_id: uuid.UUID | None) -> list[Message]:
    if conversation_id is None:
        return []
    return list(
        db.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at, Message.id)
        )
    )


def guardian_thread(db: Session, conversation_id: uuid.UUID | None) -> str:
    """The chat as the Guardian sees it on WhatsApp: no staff-only notes, nothing unsent."""
    lines = [
        f"[{'You' if message.author_kind is MessageAuthor.CLIENT else 'Tutoring company'}]"
        f" {message.body}"
        for message in _messages(db, conversation_id)
        if message.system_kind not in STAFF_ONLY_KINDS
        and message.status is not MessageStatus.FAILED
    ]
    return "WhatsApp chat so far:\n" + ("\n".join(lines) if lines else "(empty: you write first)")


def _speaker(message: Message) -> str:
    if message.system_kind is SystemMessageKind.HANDOFF_NOTE:
        speaker = "Handoff note (office only)"
    elif message.system_kind is not None:
        speaker = f"System ({message.system_kind.value})"
    elif message.author_kind is MessageAuthor.CLIENT:
        speaker = "Guardian"
    elif message.author_kind is MessageAuthor.BOT:
        speaker = "Bot"
    else:
        speaker = message.author_kind.value.capitalize()
    return speaker


def describe_saved(
    db: Session, result: RunResult, *, phone_number: str, conversation_id: uuid.UUID | None
) -> None:
    """Fill in the transcript and what got saved for the Guardian at `phone_number`."""
    db.rollback()
    zone = clock.business_zone()
    result.transcript = [
        f"- `{clock.to_business_wall_clock(message.created_at, zone):%a %b %d %H:%M}`"
        f" **{_speaker(message)}**{' (failed)' if message.status is MessageStatus.FAILED else ''}:"
        f" {_quote(message.body)}"
        for message in _messages(db, conversation_id)
    ]

    guardian = db.scalars(select(Guardian).where(Guardian.phone_number == phone_number)).first()
    homes = _homes(db, guardian)
    children = _children(db, guardian)
    bookings = _bookings(db, children)
    conversation = None if conversation_id is None else db.get(Conversation, conversation_id)

    result.saved = [
        "### Guardian",
        f"- Name: {guardian.name}" if guardian else "- none",
        "### Homes",
        *(_home_line(home) for home in homes),
        *([] if homes else ["- none"]),
        "### Children",
        *(_child_line(child) for child in children),
        *([] if children else ["- none"]),
        "### Bookings",
        *(_booking_line(db, booking) for booking in bookings),
        *([] if bookings else ["- none"]),
    ]
    if conversation is not None and conversation.flag_reason is not None:
        result.flag = conversation.flag_reason.value
    result.counts = f"{int(guardian is not None)}/{len(homes)}/{len(children)}/{len(bookings)}"


def _homes(db: Session, guardian: Guardian | None) -> list[Home]:
    if guardian is None:
        return []
    return list(
        db.scalars(
            select(Home)
            .join(GuardianHome, GuardianHome.home_id == Home.id)
            .where(GuardianHome.guardian_id == guardian.id)
            .order_by(Home.created_at)
        )
    )


def _children(db: Session, guardian: Guardian | None) -> list[Child]:
    if guardian is None:
        return []
    return list(
        db.scalars(
            select(Child)
            .join(ChildGuardian, ChildGuardian.child_id == Child.id)
            .where(ChildGuardian.guardian_id == guardian.id)
            .order_by(Child.created_at)
        )
    )


def _bookings(db: Session, children: list[Child]) -> list[Booking]:
    if not children:
        return []
    return list(
        db.scalars(
            select(Booking)
            .where(Booking.child_id.in_([child.id for child in children]))
            .order_by(Booking.created_at)
        )
    )


def _home_line(home: Home) -> str:
    return f"- {home.label or '(no label)'}: {home.address}; directions: {home.directions}"


def _child_line(child: Child) -> str:
    evaluated = "Evaluated" if child.evaluated_at else "not Evaluated"
    return (
        f"- {child.name}: grade {child.grade_level}, {child.school_name}; born"
        f" {child.date_of_birth}; notes: {child.notes}; {evaluated}"
    )


def _booking_line(db: Session, booking: Booking) -> str:
    subject = db.get(Subject, booking.subject_id) if booking.subject_id else None
    staff = db.get_one(User, booking.user_id)
    place = "office" if booking.location is BookingLocation.IN_OFFICE else "home"
    return (
        f"- {booking.scheduled_date:%a %b %d} {booking.start_time:%H:%M}-"
        f"{booking.end_time:%H:%M}: {subject.name if subject else '(no subject)'} with"
        f" {staff.name} at {place}; {booking.status.value}"
    )


def _quote(body: str) -> str:
    return body.replace("\n", " / ")


# --- reports ----------------------------------------------------------------------------------


def _money(cost: float | None) -> str:
    return "n/a" if cost is None else f"{cost:.4f}"


def render_run(result: RunResult, *, database: str) -> str:
    spec = result.spec
    family = FAMILIES[spec.language]
    turn_rows = [
        f"| {turn.index} | {turn.outcome} | {turn.latency_s:.1f} | {len(turn.calls)} |"
        f" {turn.total('input_tokens')} | {turn.total('output_tokens')} |"
        f" {turn.total('cache_read_input_tokens')} | {turn.total('cache_creation_input_tokens')} |"
        f" {_money(turn.cost)} |"
        for turn in result.turns
    ]
    lines = [
        f"# {spec.persona.title}: {LANGUAGE_NAMES[spec.language]}, {spec.model_id}",
        "",
        f"Database: `{database}`",
        "",
        f"**Persona:** {spec.persona.brief(family)}",
        "",
        f"**Goal:** {spec.persona.goal(family)}",
        "",
        f"**Ended:** {result.ended}{f' ({result.end_note})' if result.end_note else ''}",
        "",
        "## Transcript",
        "",
        *(result.transcript or ["(no messages)"]),
        "",
        "## Saved",
        "",
        *result.saved,
        "",
        f"Flag: {result.flag}",
        "",
        "## Turns",
        "",
        "| # | outcome | latency s | calls | input | output | cache read | cache write | cost $ |",
        "|---|---|---|---|---|---|---|---|---|",
        *turn_rows,
        "",
        f"Agent cost: ${_money(result.cost)}; simulator cost: ${result.simulator_cost:.4f}",
        "",
        "## Tool calls",
        "",
        *(line for turn in result.turns for line in _tool_call_lines(turn)),
    ]
    return "\n".join(lines)


def _tool_call_lines(turn: TurnRecord) -> list[str]:
    calls = [
        line
        for number, record in enumerate(turn.tool_calls, start=1)
        for line in (
            f"{number}. `{record.tool}`: {record.outcome}",
            f"   - input: `{_json(record.input)}`",
            *([] if record.detail is None else [f"   - result: `{_json(record.detail)}`"]),
        )
    ]
    return [f"### Turn {turn.index} ({turn.outcome})", "", *(calls or ["(no tool calls)"]), ""]


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def render_summary(results: list[RunResult], failures: list[str]) -> str:
    rows = [
        f"| {r.spec.persona.key} | {r.spec.language} | {r.spec.model_alias} |"
        f" {r.guardian_messages} | {sum(t.outcome != 'replied' for t in r.turns)} |"
        f" {r.ended} | {r.flag} | {r.counts} | {_money(r.cost)} |"
        f" {_latency(r, statistics.median)} | {_latency(r, max)} |"
        for r in results
    ]
    by_model = {
        alias: [r.cost for r in results if r.spec.model_alias == alias]
        for alias in dict.fromkeys(r.spec.model_alias for r in results)
    }
    totals = [
        f"- {alias}: ${_money(None if None in costs else sum(c or 0.0 for c in costs))}"
        for alias, costs in by_model.items()
    ]
    lines = [
        "# Bot agent evaluation",
        "",
        "Saved is Guardian/Homes/Children/Bookings. Not-replied counts outage and skipped turns.",
        "",
        "| persona | lang | model | Guardian msgs | not replied | ended | flag | saved |"
        " cost $ | p50 turn s | max turn s |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
        *rows,
        "",
        "## Agent cost by model",
        "",
        *totals,
        f"- Guardian simulator: ${sum(r.simulator_cost for r in results):.4f}",
        "",
        *(
            ["## Failed runs", "", *(f"- {failure}" for failure in failures), ""]
            if failures
            else []
        ),
    ]
    return "\n".join(lines)


def _latency(result: RunResult, statistic: Callable[[list[float]], float]) -> str:
    latencies = [turn.latency_s for turn in result.turns]
    return f"{statistic(latencies):.1f}" if latencies else "-"


# --- CLI --------------------------------------------------------------------------------------


def _split(raw: str, choices: Sequence[str]) -> list[str]:
    values = [value.strip() for value in raw.split(",") if value.strip()]
    return list(choices) if values == [ALL] else values


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    persona_keys = [persona.key for persona in PERSONAS]
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--models", default="sonnet,haiku", help="sonnet, haiku or model ids, comma-separated."
    )
    parser.add_argument(
        "--personas", default=ALL, help=f"{ALL} or some of: {', '.join(persona_keys)}."
    )
    parser.add_argument("--langs", default="en,es", help="en, es or both.")
    parser.add_argument("--out", required=True, type=pathlib.Path, help="Report directory.")
    parser.add_argument(
        "--effort",
        choices=["low", "medium", "high", "xhigh", "max"],
        help="The agent's effort; else BOT_EFFORT.",
    )
    parser.add_argument("--max-turns", type=int, default=DEFAULT_MAX_TURNS)
    parser.add_argument("--keep-db", action="store_true", help="Keep the throwaway database.")
    parser.add_argument(
        "--allow-remote-db",
        action="store_true",
        help="Use a Postgres server that isn't on this machine.",
    )
    args = parser.parse_args(argv)

    args.personas = _split(args.personas, persona_keys)
    args.langs = _split(args.langs, list(LANGUAGE_NAMES))
    args.models = _split(args.models, list(MODEL_ALIASES))
    unknown = [p for p in args.personas if p not in persona_keys] + [
        lang for lang in args.langs if lang not in LANGUAGE_NAMES
    ]
    if unknown:
        parser.error(f"unknown persona or language: {', '.join(unknown)}")
    return args


def is_local_host(host: str | None) -> bool:
    """Whether the URL's host is this machine: a loopback name or a unix socket."""
    return host is None or host.startswith("/") or host in LOCAL_DATABASE_HOSTS


def main(argv: list[str] | None = None, *, clients: Clients | None = None) -> int:
    """Run the evaluation. `clients` replaces the Anthropic models (the smoke test's fakes)."""
    args = parse_args(argv)
    settings = get_settings()
    if clients is None and not settings.anthropic_api_key:
        print("ANTHROPIC_API_KEY is not set; the evaluation calls Anthropic.", file=sys.stderr)
        return EXIT_NO_KEY
    if settings.database_url == UNSET_DATABASE_URL:
        print("DATABASE_URL is not set; it names the Postgres server to use.", file=sys.stderr)
        return EXIT_FAILED
    host = make_url(settings.database_url).host
    if not args.allow_remote_db and not is_local_host(host):
        print(
            f"refusing the Postgres server at {host}: it isn't on this machine."
            " Pass --allow-remote-db to use it anyway.",
            file=sys.stderr,
        )
        return EXIT_REMOTE_DB

    run_clients = clients or anthropic_clients(settings.anthropic_api_key or "")
    specs = [
        RunSpec(persona, language, alias, MODEL_ALIASES.get(alias, alias))
        for persona in PERSONAS
        if persona.key in args.personas
        for language in args.langs
        for alias in args.models
    ]
    args.out.mkdir(parents=True, exist_ok=True)

    with throwaway_database(settings.database_url, keep=args.keep_db) as url:
        try:
            migrate(url)
        except subprocess.CalledProcessError as exc:
            print(f"migrating {url.database} failed:\n{exc.stderr}", file=sys.stderr)
            return EXIT_FAILED
        engine = create_engine(url, pool_pre_ping=True, hide_parameters=True)
        try:
            check_throwaway(engine, name=url.database or "")
            session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
            with harness_patches(session_factory, FakeTwilio()):
                with session_factory() as db:
                    catalog = seed_catalog(db)
                context = RunContext(
                    session_factory=session_factory,
                    catalog=catalog,
                    clients=run_clients,
                    effort=args.effort or settings.bot_effort,
                    max_turns=args.max_turns,
                )
                results, failures = _run_all(specs, context, out=args.out, database=url.database)
        finally:
            engine.dispose()

    summary = render_summary(results, failures)
    (args.out / "summary.md").write_text(summary)
    print(summary)
    return EXIT_FAILED if failures else 0


def _run_all(
    specs: list[RunSpec], context: RunContext, *, out: pathlib.Path, database: str | None
) -> tuple[list[RunResult], list[str]]:
    results: list[RunResult] = []
    failures: list[str] = []
    for run_index, spec in enumerate(specs, start=1):
        print(f"[{run_index}/{len(specs)}] {spec.file_name}", file=sys.stderr)
        try:
            result = run_one(spec, run_index=run_index, context=context)
        except (anthropic.APIError, SimulatorFailed) as exc:
            # The simulator's own failure; the agent's are outages inside the turn.
            print(f"  failed: {exc}", file=sys.stderr)
            failures.append(f"{spec.file_name}: {exc}")
            continue
        (out / spec.file_name).write_text(render_run(result, database=database or ""))
        results.append(result)
    return results, failures


if __name__ == "__main__":
    sys.exit(main())
