"""Chat with the WhatsApp bot agent from the terminal, typing as the Guardian.

Each line you type is one inbound WhatsApp message: it goes through `webhook_service.handle_inbound`
the way Twilio's webhook delivers it, and then one agent turn runs (`bot_turn.take_turn`, the
real model, system prompt and tools), the debounce skipped as `bot_eval` skips it. Every message
the bot sends is printed, fixed confirmations and notices included, with the turn's latency,
tokens and estimated cost on a dim line below. Twilio is faked; nothing leaves this machine but
the model calls. It costs money and needs a key, so it is never part of CI;
`tests/test_bot_chat.py` drives it with a fake model.

From `api/`, with the test Postgres (or any local server the URL's user may create databases on):

    UV_SYSTEM_CERTS=1 ANTHROPIC_API_KEY=sk-ant-... \\
    DATABASE_URL=postgresql+psycopg://test:test@localhost:5432/postgres \\
    SECRET_KEY=$(openssl rand -hex 32) \\
    uv run python scripts/bot_chat.py --scenario new --show-tools

**Scenarios.** `new` (the default): a number nobody has written from, so the chat starts an
Intake. `existing`: the number belongs to `bot_eval`'s seeded family (`--lang es` for the Spanish
one): a Guardian with a Home and an Evaluated Child whose Assigned Tutor teaches Math and Reading
(not Science), two confirmed home Sessions the week after next, and weekly reminders on.

**Commands.** `/help` lists them: `/saved`, `/burst`, `/gap HOURS`, `/takeover`, `/handback`,
`/reminder`, `/quit`. Ctrl-D or Ctrl-C ends the chat; Ctrl-C during a turn rolls it back first.

**The database.** As in `bot_eval`: `DATABASE_URL` only names the server. The chat creates its
own `bot_chat_<timestamp>_<hex>` database there, migrates and seeds it, and drops it when the
chat ends, however it ends (`--keep-db` keeps it). Only a server on this machine is used unless
`--allow-remote-db` is passed.

`--transcript PATH` writes the session as Markdown in `bot_eval`'s transcript format.
"""

import argparse
import dataclasses
import datetime
import json
import pathlib
import secrets
import subprocess
import sys
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass, field
from typing import Literal, NoReturn
from unittest import mock

API_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))

# First: `bot_eval` sets the environment `app.config` needs before anything imports it.
from scripts import bot_eval  # noqa: E402

import anthropic  # noqa: E402
from sqlalchemy import Engine, create_engine, make_url, select, text, update  # noqa: E402
from sqlalchemy.engine import URL  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.models.availability import TutorAvailability  # noqa: E402
from app.models.booking import Booking  # noqa: E402
from app.models.child_assigned_tutor import ChildAssignedTutor  # noqa: E402
from app.models.conversation import Conversation  # noqa: E402
from app.models.enums import (  # noqa: E402
    BookingKind,
    BookingLocation,
    BookingStatus,
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    Language,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian  # noqa: E402
from app.models.home import GuardianHome  # noqa: E402
from app.models.message import Message  # noqa: E402
from app.models.reminder_consent import ReminderConsent  # noqa: E402
from app.models.system_setting import SETTING_VALUE_TYPE_STRING, SystemSetting  # noqa: E402
from app.models.tutor import Tutor  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import (  # noqa: E402
    bot_agent,
    bot_turn,
    clock,
    conversation_service,
    notice_service,
    reminder_service,
    twilio_service,
    webhook_service,
)
from app.services.bot_context import STAFF_ONLY_KINDS  # noqa: E402
from app.services.bot_model import (  # noqa: E402
    SDK_RETRIES,
    AnthropicModelClient,
    Effort,
    ModelClient,
)
from app.services.settings_service import (  # noqa: E402
    REMINDER_TEMPLATE_SID_EN_SETTING,
    REMINDER_TEMPLATE_SID_ES_SETTING,
)

EXIT_NO_KEY = bot_eval.EXIT_NO_KEY
EXIT_REMOTE_DB = bot_eval.EXIT_REMOTE_DB
EXIT_FAILED = bot_eval.EXIT_FAILED
# The shell's code for a run ended by Ctrl-C (128 + SIGINT).
EXIT_INTERRUPTED = 130

DATABASE_PREFIX = "bot_chat_"
# `bot_eval.seed_world` numbers each run's phone numbers and Tutors; the chat is one run.
RUN_INDEX = 1
STAFF_NAME = "Olivia Office"
STAFF_EMAIL = "olivia.office@chat.example"
# Any non-blank ContentSid marks the reminder template approved; the send is faked.
FAKE_TEMPLATE_SIDS = {
    REMINDER_TEMPLATE_SID_EN_SETTING: "HXchat00000000000000000000000000en",
    REMINDER_TEMPLATE_SID_ES_SETTING: "HXchat00000000000000000000000000es",
}
# The existing family's Sessions: Monday Math and Wednesday Reading, the week after next, so
# next week's reminder still finds the Child with nothing booked.
WEEKS_AHEAD = 1
SESSION_START = datetime.time(16, 0)
SESSION_END = datetime.time(17, 0)
MONDAY = 0
WEDNESDAY = 2

PROMPT = "you> "
BURST_PROMPT = "...> "
DIM = "\033[2m"
RESET = "\033[0m"

Scenario = Literal["new", "existing"]
Ending = Literal["quit", "eof", "interrupted"]
ModelFactory = Callable[[str, Effort], ModelClient]
LineReader = Callable[[str], str]

HELP = """\
Type a line to send it as the Guardian; the bot answers in one turn.
  /saved        what is saved: Guardian, Homes, Children, Bookings, flag
  /burst        the next lines, up to a blank one, go as one burst: one turn
  /gap HOURS    move the chat HOURS into the past, as if the Guardian went quiet
  /takeover     the office takes the chat over (the fixed notice is sent)
  /handback     the office hands it back to the bot
  /reminder     send the weekly Booking reminder, so you can reply to it
  /help         this list
  /quit         end the chat (so do Ctrl-D and Ctrl-C)"""


# --- the terminal -----------------------------------------------------------------------------


class Console:
    """Prints to stdout; dim lines are dimmed only on a terminal."""

    def __init__(self) -> None:
        self._is_tty = sys.stdout.isatty()

    def say(self, line: str) -> None:
        print(line, flush=True)

    def dim(self, line: str) -> None:
        print(f"{DIM}{line}{RESET}" if self._is_tty else line, flush=True)


# --- the throwaway database -------------------------------------------------------------------
# `bot_eval`'s two helpers with this script's prefix; dedupe once that prefix is a parameter.


@contextmanager
def throwaway_database(server_url: str, *, keep: bool) -> Iterator[URL]:
    """Create a fresh `bot_chat_*` database on the server `server_url` names, and drop it
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
            print(f"dropped database {name}", file=sys.stderr)
        admin.dispose()


def check_throwaway(engine: Engine, *, name: str) -> None:
    """Refuse a database this run didn't create: the wrong name, or one with data in it."""
    with engine.connect() as connection:
        current = connection.execute(text("SELECT current_database()")).scalar_one()
        guardians = connection.execute(text("SELECT count(*) FROM guardians")).scalar_one()
    if current != name or not current.startswith(DATABASE_PREFIX) or guardians:
        raise RuntimeError(f"refusing to seed {current}: not this run's empty throwaway database")


# --- seeding ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Seeded:
    phone_number: str
    staff_user_id: uuid.UUID


def chat_persona(scenario: Scenario) -> bot_eval.Persona:
    """The chat as a `bot_eval` persona: what `seed_world` seeds and the transcript header."""
    return bot_eval.Persona(
        key="chat",
        title=f"Interactive chat ({scenario} Guardian)",
        is_known_guardian=scenario == "existing",
        brief=lambda _family: "Franklin, typing as the Guardian in `scripts/bot_chat.py`.",
        goal=lambda _family: "None: a hand-driven session.",
    )


def seed_chat(db: Session, *, scenario: Scenario, family: bot_eval.Family) -> Seeded:
    """`bot_eval`'s catalog and world, plus a Staff member to take over, approved reminder
    templates and, for an existing family, upcoming Sessions and reminder consent."""
    catalog = bot_eval.seed_catalog(db)
    phone_number = bot_eval.seed_world(
        db, persona=chat_persona(scenario), family=family, catalog=catalog, run_index=RUN_INDEX
    )
    staff = User(email=STAFF_EMAIL, name=STAFF_NAME, name_is_default=False, role=UserRole.ADMIN)
    db.add(staff)
    for key, value in FAKE_TEMPLATE_SIDS.items():
        _set_setting(db, key, value)
    db.flush()
    if scenario == "existing":
        _seed_existing_family(db, phone_number=phone_number, catalog=catalog)
    db.commit()
    return Seeded(phone_number=phone_number, staff_user_id=staff.id)


def _set_setting(db: Session, key: str, value: str) -> None:
    # Copied from `bot_eval._set_setting` (private there).
    row = db.scalars(select(SystemSetting).where(SystemSetting.key == key)).one_or_none()
    if row is None:
        db.add(
            SystemSetting(
                key=key, value=value, value_type=SETTING_VALUE_TYPE_STRING, is_developer_only=False
            )
        )
    else:
        row.value = value
    db.flush()


def _seed_existing_family(db: Session, *, phone_number: str, catalog: bot_eval.Catalog) -> None:
    guardian = db.scalars(select(Guardian).where(Guardian.phone_number == phone_number)).one()
    home_id = db.scalars(
        select(GuardianHome.home_id).where(GuardianHome.guardian_id == guardian.id)
    ).one()
    child_id = db.scalars(
        select(ChildGuardian.child_id).where(ChildGuardian.guardian_id == guardian.id)
    ).one()
    tutor_user_id = db.scalars(
        select(ChildAssignedTutor.user_id).where(ChildAssignedTutor.child_id == child_id)
    ).one()
    tutor_id = db.scalars(select(Tutor.id).where(Tutor.user_id == tutor_user_id)).one()
    monday = reminder_service.week_start_after(clock.business_today()) + datetime.timedelta(
        weeks=WEEKS_AHEAD
    )
    sessions = ((MONDAY, catalog.math_id), (WEDNESDAY, catalog.reading_id))
    for weekday, subject_id in sessions:
        availability_id = db.scalars(
            select(TutorAvailability.id).where(
                TutorAvailability.tutor_id == tutor_id, TutorAvailability.day_of_week == weekday
            )
        ).one()
        db.add(
            Booking(
                child_id=child_id,
                user_id=tutor_user_id,
                kind=BookingKind.REGULAR,
                location=BookingLocation.HOME,
                subject_id=subject_id,
                availability_id=availability_id,
                home_id=home_id,
                booked_by_guardian_id=guardian.id,
                scheduled_date=monday + datetime.timedelta(days=weekday),
                start_time=SESSION_START,
                end_time=SESSION_END,
                status=BookingStatus.CONFIRMED,
            )
        )
    db.add(
        ReminderConsent(
            guardian_id=guardian.id, action=ConsentAction.OPT_IN, source=ConsentSource.STAFF
        )
    )
    db.flush()


# --- the chat ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class ChatOptions:
    scenario: Scenario
    model_id: str
    language: Language | None
    show_tools: bool


@dataclass
class ChatLog:
    """What the transcript needs, kept as the chat goes."""

    turns: list[bot_eval.TurnRecord] = field(default_factory=list)
    guardian_messages: int = 0


class Chat:
    """One Guardian's chat on the throwaway database, driven a line at a time."""

    def __init__(
        self,
        db: Session,
        *,
        seeded: Seeded,
        model: bot_eval.MeteredModel,
        options: ChatOptions,
        console: Console,
    ) -> None:
        self._db = db
        self._seeded = seeded
        self._model = model
        self._recorder = bot_eval.ToolRecorder()
        production = bot_agent.default_deps()
        self._deps = dataclasses.replace(
            production, model=model, tools=self._recorder.wrap(production.tools)
        )
        self._options = options
        self._console = console
        self._printed: set[uuid.UUID] = set()
        self.log = ChatLog()

    @property
    def phone_number(self) -> str:
        return self._seeded.phone_number

    def open_in_language(self) -> None:
        """With `--lang`, open the chat in that language before anything is typed, so a
        `/reminder` sent first already goes out in it."""
        if self._options.language is None:
            return
        conversation = conversation_service.resolve_or_create(
            self._db, phone_number=self.phone_number
        )
        conversation_service.link_to_holder(self._db, conversation=conversation)
        conversation.language = self._options.language
        self._db.commit()

    def warm_up(self) -> None:
        self._console.dim("warming the model up...")
        seconds = bot_agent.warm_up(self._deps)
        self._console.dim(
            "warm-up skipped or failed" if seconds is None else f"warm: {seconds:.1f} s"
        )

    def send(self, bodies: list[str]) -> None:
        """Deliver `bodies` as one burst of inbound messages, then run the turn they schedule."""
        for body in bodies:
            inbound = webhook_service.handle_inbound(
                self._db,
                twilio_from=f"{webhook_service.WHATSAPP_PREFIX}{self.phone_number}",
                body=body,
                twilio_sid=f"SMin{uuid.uuid4().hex}",
            )
            self._db.commit()
            # A STOP/START keyword's confirmation, sent after the commit as the router does.
            if inbound.notice is not None:
                webhook_service.send_notice(self._db, notice=inbound.notice)
                self._db.commit()
            self.log.guardian_messages += 1

        conversation = self._conversation()
        if conversation is None:
            return
        self._print_new_messages(conversation.id)
        if conversation.turn_due_at is None:
            reason = (
                "the office holds this chat"
                if conversation.status is ConversationStatus.HUMAN
                else "a keyword was answered"
            )
            self._console.dim(f"(no bot turn: {reason})")
        else:
            self._run_turn(conversation.id)

    def show_saved(self) -> None:
        result = self._describe()
        for line in [*result.saved, f"Flag: {result.flag}"]:
            self._console.say(line)

    def back_date(self, hours: int) -> None:
        conversation = self._conversation()
        if conversation is None:
            self._console.dim("(no chat yet: send a message first)")
            return
        bot_eval.back_date(self._db, conversation_id=conversation.id, hours=hours)
        self._console.dim(f"(moved the chat {hours} hours into the past)")

    def take_over(self) -> None:
        self._change_holder(notice_service.take_over, "takeover")

    def hand_back(self) -> None:
        self._change_holder(notice_service.hand_back, "hand-back")

    def send_reminder(self) -> None:
        now = clock.business_now()
        week_start = reminder_service.week_start_after(now.date())
        due = [
            candidate
            for candidate in reminder_service.due_guardians(self._db, now=now)
            if candidate.phone_number == self.phone_number
        ]
        if not due:
            self._console.dim(
                "(no reminder: this number's Guardian isn't due. It needs reminder consent and"
                f" an active Evaluated Child with nothing booked the week of {week_start})"
            )
        elif due[0].skip_reason is not None:
            self._console.dim(f"(no reminder: it would be skipped, {due[0].skip_reason.value})")
        else:
            result = reminder_service.run_week(self._db, now=now)
            self._db.commit()
            if not result.sent:
                self._console.dim(f"(no reminder: already reminded for the week of {week_start})")
            conversation = self._conversation()
            if conversation is not None:
                self._print_new_messages(conversation.id)

    def transcript(self, *, ending: Ending, database: str) -> str:
        result = self._describe()
        result.turns = self.log.turns
        result.guardian_messages = self.log.guardian_messages
        result.ended = ending
        return bot_eval.render_run(result, database=database)

    def rollback(self) -> None:
        self._db.rollback()

    def recover(self) -> None:
        """After a command that crashed: drop its transaction and whatever the model and the
        tools recorded for a turn that never finished, so the next turn starts clean."""
        self._db.rollback()
        self._model.drain()
        self._model.drain_tool_calls()
        self._recorder.drain()

    def _describe(self) -> bot_eval.RunResult:
        conversation = self._conversation()
        result = bot_eval.RunResult(spec=self._spec())
        bot_eval.describe_saved(
            self._db,
            result,
            phone_number=self.phone_number,
            conversation_id=None if conversation is None else conversation.id,
        )
        return result

    def _spec(self) -> bot_eval.RunSpec:
        language = (self._options.language or Language.EN).value
        alias = next(
            (a for a, m in bot_eval.MODEL_ALIASES.items() if m == self._options.model_id),
            self._options.model_id,
        )
        persona = chat_persona(self._options.scenario)
        return bot_eval.RunSpec(persona, language, alias, self._options.model_id)

    def _conversation(self) -> Conversation | None:
        return self._db.scalars(
            select(Conversation)
            .where(Conversation.phone_number == self.phone_number)
            .order_by(Conversation.created_at.desc())
            .execution_options(populate_existing=True)
        ).first()

    def _run_turn(self, conversation_id: uuid.UUID) -> None:
        # The worker clears the due time before it runs the turn.
        self._db.execute(
            update(Conversation).where(Conversation.id == conversation_id).values(turn_due_at=None)
        )
        self._db.commit()
        started = time.monotonic()
        outcome = bot_turn.take_turn(self._db, conversation_id=conversation_id, deps=self._deps)
        turn = bot_eval.TurnRecord(
            index=len(self.log.turns) + 1,
            outcome=outcome.kind,
            latency_s=time.monotonic() - started,
            calls=self._model.drain(),
            model_id=self._options.model_id,
            tool_calls=bot_eval.merge_tool_calls(
                self._model.drain_tool_calls(), self._recorder.drain()
            ),
        )
        self.log.turns.append(turn)
        self._print_new_messages(conversation_id)
        if self._options.show_tools:
            self._print_tool_calls(turn)
        self._console.dim(_turn_line(turn))

    def _change_holder(
        self,
        change: Callable[..., notice_service.NoticeOutcome],
        label: str,
    ) -> None:
        conversation = self._conversation()
        if conversation is None:
            self._console.dim("(no chat yet: send a message first)")
            return
        try:
            change(self._db, conversation_id=conversation.id, user_id=self._seeded.staff_user_id)
        except conversation_service.ConversationServiceError as exc:
            self._db.rollback()
            self._console.dim(f"({label} refused: {type(exc).__name__}: {exc})")
            return
        self._console.dim(f"({label} done)")
        self._print_new_messages(conversation.id)

    def _print_new_messages(self, conversation_id: uuid.UUID) -> None:
        messages = self._db.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at, Message.id)
            .execution_options(populate_existing=True)
        ).all()
        for message in messages:
            if message.id in self._printed:
                continue
            self._printed.add(message.id)
            if message.author_kind is MessageAuthor.CLIENT:
                continue
            self._print_message(message)

    def _print_message(self, message: Message) -> None:
        failed = (
            f" (failed: {message.error_code})" if message.status is MessageStatus.FAILED else ""
        )
        if message.system_kind in STAFF_ONLY_KINDS:
            self._console.dim(f"[office only, {message.system_kind.value}] {message.body}")
        elif message.system_kind is not None:
            self._console.say(f"bot [{message.system_kind.value}]{failed}> {message.body}")
        elif message.author_kind is MessageAuthor.BOT:
            self._console.say(f"bot{failed}> {message.body}")
        else:
            self._console.say(f"{message.author_kind.value}{failed}> {message.body}")

    def _print_tool_calls(self, turn: bot_eval.TurnRecord) -> None:
        for record in turn.tool_calls:
            self._console.dim(f"  - {record.tool}: {record.outcome}")
            self._console.dim(f"    input: {_json(record.input)}")
            if record.detail is not None:
                self._console.dim(f"    result: {_json(record.detail)}")


def _turn_line(turn: bot_eval.TurnRecord) -> str:
    cost = "n/a" if turn.cost is None else f"${turn.cost:.4f}"
    return (
        f"  [{turn.outcome} | {turn.latency_s:.1f} s | {len(turn.calls)} calls |"
        f" in {turn.total('input_tokens')} out {turn.total('output_tokens')}"
        f" cache read {turn.total('cache_read_input_tokens')}"
        f" write {turn.total('cache_creation_input_tokens')} | {cost}]"
    )


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


# --- the command loop -------------------------------------------------------------------------


def run_chat(chat: Chat, *, read_line: LineReader, console: Console) -> Ending:
    """Read lines and act on them until the chat ends; how it ended."""
    ending: Ending | None = None
    while ending is None:
        try:
            line = read_line(PROMPT).strip()
            if line.startswith("/"):
                ending = _run_command(chat, line, read_line=read_line, console=console)
            elif line:
                chat.send([line])
        except EOFError:
            ending = "eof"
        except KeyboardInterrupt:
            # Mid-turn, the turn's open transaction goes; whatever it had committed stays.
            chat.rollback()
            console.dim("\n(interrupted)")
            ending = "interrupted"
        except Exception as exc:
            # As the worker does with a crashed turn: say so, and carry on with the chat.
            chat.recover()
            console.say(f"(error, rolled back: {type(exc).__name__}: {exc})")
    return ending


def _run_command(
    chat: Chat, line: str, *, read_line: LineReader, console: Console
) -> Ending | None:
    """Run one slash command; `quit` when it ends the chat."""
    command, _, argument = line.partition(" ")
    ending: Ending | None = None
    if command == "/quit":
        ending = "quit"
    elif command == "/help":
        console.say(HELP)
    elif command == "/saved":
        chat.show_saved()
    elif command == "/burst":
        _send_burst(chat, read_line=read_line, console=console)
    elif command == "/gap":
        _gap(chat, argument, console=console)
    elif command == "/takeover":
        chat.take_over()
    elif command == "/handback":
        chat.hand_back()
    elif command == "/reminder":
        chat.send_reminder()
    else:
        console.dim(f"(unknown command {command}; /help lists them)")
    return ending


def _send_burst(chat: Chat, *, read_line: LineReader, console: Console) -> None:
    console.dim("(burst: one message per line, a blank line sends them)")
    bodies: list[str] = []
    line = read_line(BURST_PROMPT).strip()
    while line:
        bodies.append(line)
        line = read_line(BURST_PROMPT).strip()
    if bodies:
        chat.send(bodies)


def _gap(chat: Chat, argument: str, *, console: Console) -> None:
    try:
        hours = int(argument)
    except ValueError:
        console.dim("(usage: /gap HOURS, a whole number)")
        return
    chat.back_date(hours)


# --- CLI --------------------------------------------------------------------------------------


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--model", choices=list(bot_eval.MODEL_ALIASES), help="The agent's model; else BOT_MODEL."
    )
    parser.add_argument("--scenario", choices=["new", "existing"], default="new")
    parser.add_argument(
        "--lang",
        choices=[language.value for language in Language],
        help="The chat's language from the start, and which seeded family (default English).",
    )
    parser.add_argument(
        "--show-tools", action="store_true", help="Print each tool call under the reply."
    )
    parser.add_argument(
        "--transcript", type=pathlib.Path, help="Write the session here as Markdown."
    )
    parser.add_argument("--keep-db", action="store_true", help="Keep the throwaway database.")
    parser.add_argument(
        "--allow-remote-db",
        action="store_true",
        help="Use a Postgres server that isn't on this machine.",
    )
    return parser.parse_args(argv)


def anthropic_model_factory(api_key: str) -> ModelFactory:
    client = anthropic.Anthropic(api_key=api_key, max_retries=SDK_RETRIES)
    return lambda model_id, effort: AnthropicModelClient(
        client=client, model=model_id, effort=effort
    )


def main(
    argv: list[str] | None = None,
    *,
    model_factory: ModelFactory | None = None,
    read_line: LineReader = input,
) -> int:
    """Run the chat. `model_factory` and `read_line` replace Anthropic and the keyboard (the
    tests' fakes)."""
    args = parse_args(argv)
    settings = get_settings()
    if model_factory is None and not settings.anthropic_api_key:
        print("ANTHROPIC_API_KEY is not set; the chat calls Anthropic.", file=sys.stderr)
        return EXIT_NO_KEY
    if settings.database_url == bot_eval.UNSET_DATABASE_URL:
        print("DATABASE_URL is not set; it names the Postgres server to use.", file=sys.stderr)
        return EXIT_FAILED
    host = make_url(settings.database_url).host
    if not args.allow_remote_db and not bot_eval.is_local_host(host):
        print(
            f"refusing the Postgres server at {host}: it isn't on this machine."
            " Pass --allow-remote-db to use it anyway.",
            file=sys.stderr,
        )
        return EXIT_REMOTE_DB

    factory = model_factory or anthropic_model_factory(settings.anthropic_api_key or "")
    model_id = bot_eval.MODEL_ALIASES[args.model] if args.model else settings.bot_model
    options = ChatOptions(
        scenario=args.scenario,
        model_id=model_id,
        language=Language(args.lang) if args.lang else None,
        show_tools=args.show_tools,
    )
    model = bot_eval.MeteredModel(factory(model_id, settings.bot_effort))
    family = bot_eval.FAMILIES[args.lang or Language.EN.value]
    console = Console()

    try:
        ending = _chat_on_throwaway_database(
            settings.database_url,
            args=args,
            model=model,
            options=options,
            family=family,
            read_line=read_line,
            console=console,
        )
    except subprocess.CalledProcessError as exc:
        print(f"migrating the chat database failed:\n{exc.stderr}", file=sys.stderr)
        ending = None
    except KeyboardInterrupt:
        # During set-up: the database is already dropped.
        ending = "interrupted"

    if ending is None:
        status = EXIT_FAILED
    elif ending == "interrupted":
        status = EXIT_INTERRUPTED
    else:
        status = 0
    return status


def _chat_on_throwaway_database(
    server_url: str,
    *,
    args: argparse.Namespace,
    model: bot_eval.MeteredModel,
    options: ChatOptions,
    family: bot_eval.Family,
    read_line: LineReader,
    console: Console,
) -> Ending:
    with throwaway_database(server_url, keep=args.keep_db) as url:
        database = url.database or ""
        console.dim(f"creating and migrating database {database}...")
        bot_eval.migrate(url)
        engine = create_engine(url, pool_pre_ping=True, hide_parameters=True)
        try:
            check_throwaway(engine, name=database)
            session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
            with chat_patches(session_factory), session_factory() as db:
                seeded = seed_chat(db, scenario=args.scenario, family=family)
                chat = Chat(db, seeded=seeded, model=model, options=options, console=console)
                console.dim(
                    f"{args.scenario} Guardian at {seeded.phone_number}, model"
                    f" {options.model_id}. /help lists the commands."
                )
                chat.open_in_language()
                chat.warm_up()
                ending = run_chat(chat, read_line=read_line, console=console)
                if args.transcript is not None:
                    chat.rollback()
                    args.transcript.write_text(chat.transcript(ending=ending, database=database))
                    console.dim(f"transcript written to {args.transcript}")
        finally:
            engine.dispose()
    return ending


@contextmanager
def chat_patches(session_factory: Callable[[], Session]) -> Iterator[None]:
    """`bot_eval`'s patches (clock on the throwaway database, Twilio faked on the turn and the
    webhook), plus the fake on the notices and the reminder template the chat also sends.

    Underneath them, Twilio's client itself refuses: a send path these patches miss fails
    loudly instead of texting a real number with whatever credentials the shell holds."""
    twilio = bot_eval.FakeTwilio()
    with ExitStack() as stack:
        stack.enter_context(mock.patch.object(twilio_service, "_client", _refuse_real_twilio))
        stack.enter_context(bot_eval.harness_patches(session_factory, twilio))
        stack.enter_context(
            mock.patch.object(notice_service, "send_whatsapp_message", twilio.send_whatsapp_message)
        )
        stack.enter_context(
            mock.patch.object(reminder_service, "send_whatsapp_template", _fake_template_send)
        )
        yield


class RealTwilioRefused(RuntimeError):
    """A send reached Twilio's real client: a send path `chat_patches` doesn't fake yet."""


def _refuse_real_twilio(settings: object) -> NoReturn:
    raise RealTwilioRefused("bot_chat reached the real Twilio client; fake this send path")


def _fake_template_send(*, to: str, content_sid: str, content_variables: dict[str, str]) -> str:
    return f"SMchat{uuid.uuid4().hex[:26]}"


if __name__ == "__main__":
    if sys.stdin.isatty():
        # Line editing and history for `input()`.
        import readline  # noqa: F401

    sys.exit(main())
