"""`bot_service` — the flow machine, driven one WhatsApp message at a time.

**No test here calls Anthropic** (P7-I). `parser_service.parse_intent` is replaced for every
test in this module by an autouse fixture, and the replacement raises on a call nothing
scripted — so a flow that reaches the parser without a scripted answer fails loudly rather
than quietly spending money.

Most failures this module has are silent, so the tests are named for the mistake each one
catches rather than for the branch it covers. Four are load-bearing beyond their assertion:

- `test_a_child_already_registered_elsewhere_writes_nothing_and_flags_a_link_request` is
  **P7-F**, the most security-relevant line in the phase. It asserts **row counts**, not the
  reply: a bot that says the right thing and writes the link anyway discloses the other
  guardian's home address and door access code, and only the counts can see that.
- `test_the_booking_request_pairs_the_tutor_with_the_availability_it_owns` and
  `test_a_mismatched_tutor_and_availability_pair_is_refused_by_rule_one` are **P7-T**'s two
  criteria. The second is the one that matters: it proves the backstop is real rather than
  assumed, and it is the reason no ORM-layer assertion was added to compensate for a
  `do_orm_execute` guard the webhook never arms.
- `test_bot_service_issues_no_query_filtered_by_a_bare_tutor_id` is P7-T's first leg, checked
  against the actual `WHERE` columns of every statement this module's own frames emit.
- `test_reply_for_never_reads_or_writes_the_conversation_tables` is **P7-C**, and it is what
  keeps this task off task D's back rather than merely claiming to be.

`cancellation_cutoff_hours` is seeded **here** rather than in `conftest.py`: migration 0004
writes the row in a real database, the harness reproduces the schema and none of the data, and
`conftest.py` belongs to another task's file set.
"""

import ast
import datetime
import logging
import os
import pathlib
import traceback
import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass, field

import pytest
from sqlalchemy import Column, delete, event, func, select, update
from sqlalchemy.orm import ORMExecuteState, Session
from sqlalchemy.sql import visitors

from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.bot_flow_state import BotFlowState
from app.models.child import NOTES_MAX_LENGTH, Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    ExceptionStatus,
    FlagReason,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.subject import Subject
from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.schemas.bot import AnswerKind, BotIntent, BotTurn, GuardianLanguage, ParsedIntent
from app.services import (
    booking_status_service,
    bot_service,
    booking_write_service,
    bot_messages,
    client_service,
    clock,
    conversation_service,
    parser_service,
)
from app.services.bot_messages import render
from app.services.bot_state import FlowState, load_state, save_state
from app.services.scheduling_service import MAX_SLOTS_OFFERED_SETTING
from tests.support import user_id_of

type SetIntSetting = Callable[[str, int], None]

NINE = datetime.time(9, 0)
TWELVE = datetime.time(12, 0)

INBOUND_NUMBER = "+1 (202) 555-0123"
CANONICAL_NUMBER = "+12025550123"

DATE_OF_BIRTH = datetime.date(2016, 4, 23)

# The fixture Child's Subject level in the world's subject; every world tutor's ceiling is 12.
CHILD_LEVEL = 7


# The reminder question's re-prompt is named for the question rather than its step.
_NUDGE_IDS = {bot_service.STEP_REMINDERS_OPT_IN: "NUDGE_reminders"}


def _nudge(step: str) -> str:
    # `name` fills the grade nudge's child, which is the parked `child_name`; the rest ignore it.
    return render(_NUDGE_IDS.get(step, f"NUDGE_{step}"), "en", name="Sam")


def _text_before_placeholder(message_id: str) -> str:
    """The fixed opening of a message that ends in values this test does not pin."""
    return bot_messages.MESSAGES[message_id]["en"].split("{")[0]


def _today() -> datetime.date:
    """The business clock the bot reads, unfrozen; under the default `UTC` zone this is the
    UTC date, since every scheduling column is naive business wall-clock."""
    return clock.business_today()


def _upcoming(weekday: int) -> datetime.date:
    """The next `weekday` at least a week out. Derived rather than hardcoded, so this module
    does not fall out of `booking_lookahead_days` some months after it was written."""
    today = _today()

    return today + datetime.timedelta(days=(weekday - today.weekday()) % 7 + 7)


DATE = _upcoming(2)
# The US wording written out by hand, so the pinned tests below do not share the formatter's logic.
US_DATE = f"{DATE:%A}, {DATE:%B} {DATE.day}"
TOMORROW = _today() + datetime.timedelta(days=1)

# Midday, so that a 09:00 session tomorrow is 21 hours away and therefore *inside* the seeded
# 24-hour cancellation cutoff, while a session a week out is comfortably outside it. Both
# arithmetic facts are what the cutoff tests below turn on.
NOW = datetime.datetime.combine(_today(), TWELVE)

_SERVICE_DIRECTORY = os.path.dirname(bot_service.__file__)


# --- the harness ------------------------------------------------------------------------------


def _expire_flow_state(db: Session, *, phone_number: str) -> None:
    """Stand in for the wall clock passing the TTL, without a `sleep`. Against the database's
    own clock, not Python's, which the test's transaction can be seconds behind."""
    db.execute(
        update(BotFlowState)
        .where(BotFlowState.phone_number == phone_number)
        .values(expires_at=func.now() - func.make_interval(0, 0, 0, 0, 1))
    )


class ScriptedParser:
    """`parse_intent`'s stand-in. One scripted answer at a time, recorded as it is consumed.

    An unscripted call raises: a flow that reaches the parser without a test having said what
    the model returns is a test that would have made a network call (P7-I).
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self._answer: ParsedIntent | Exception | None = None

    def script(self, answer: ParsedIntent | Exception) -> None:
        self._answer = answer

    def __call__(
        self,
        *,
        step: str,
        question: str,
        body: str,
        context: dict[str, str],
        answer_kind: AnswerKind,
        today: datetime.date,
    ) -> ParsedIntent:
        self.calls.append(
            {
                "step": step,
                "question": question,
                "body": body,
                "context": context,
                "answer_kind": answer_kind,
                "today": today,
            }
        )
        answer, self._answer = self._answer, None

        if answer is None:
            raise AssertionError(f"unscripted parse at step {step!r}: no test said what to return")

        if isinstance(answer, Exception):
            raise answer

        return answer


@dataclass(slots=True)
class Chat:
    """One WhatsApp thread, driven message by message.

    `say(value=...)` answers whatever question the flow is currently on: the parser returns
    the answer to the pending question in its fixed `answer` slot, whatever the step, so no
    test has to spell the step out. `fields=` supplies any extras, such as `child_name`.
    """

    db: Session
    parser: ScriptedParser
    phone_number: str = INBOUND_NUMBER
    guardian_id: uuid.UUID | None = None
    reactivation_pending: bool = False
    # `conversations.language` as the webhook would pass it, updated from each turn the way
    # the webhook's `_apply` stores it.
    language: GuardianLanguage | None = None
    replies: list[BotTurn] = field(default_factory=list)

    def say(
        self,
        body: str = "a message",
        *,
        value: object = None,
        fields: dict[str, str] | None = None,
        intent: BotIntent = BotIntent.UNKNOWN,
        confidence_is_low: bool = False,
        fails: bool = False,
        language: GuardianLanguage | None = None,
    ) -> BotTurn:
        """`value` is scripted as the parser's `answer`; `fields` as its named extras;
        `language` as the language the parser read the message in."""
        self.parser.script(
            parser_service.ParseFailed("scripted outage")
            if fails
            else ParsedIntent(
                intent=intent,
                answer=None if value is None else str(value),
                fields=fields or {},
                confidence_is_low=confidence_is_low,
                language=language,
            )
        )
        turn = bot_service.reply_for(
            self.db,
            phone_number=self.phone_number,
            body=body,
            guardian_id=self.guardian_id,
            reactivation_pending=self.reactivation_pending,
            language=self.language,
        )
        self.replies.append(turn)
        if turn.language is not None:
            self.language = turn.language

        return turn

    @property
    def state(self) -> FlowState | None:
        return load_state(self.db, phone_number=self.phone_number)

    @property
    def step(self) -> str | None:
        state = self.state

        return None if state is None else state.step


@dataclass(frozen=True, slots=True)
class BotWorld:
    """Two qualified tutors for one subject, each with a 09:00-12:00 range on `DATE`."""

    subject_id: uuid.UUID
    subject_name: str
    first_tutor_id: uuid.UUID
    first_tutor_name: str
    second_tutor_id: uuid.UUID
    second_tutor_name: str
    first_availability_id: uuid.UUID
    second_availability_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class ClientWorld:
    guardian_id: uuid.UUID
    child_id: uuid.UUID
    home_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class Family:
    """One guardian on `CANONICAL_NUMBER` (by default) and exactly these children, by name."""

    client: ClientWorld
    children: dict[str, Child]


@dataclass(frozen=True, slots=True)
class OrmQuery:
    """One ORM statement, with the module that asked for it and the columns it filters on."""

    origin: str | None
    sql: str
    filtered_columns: frozenset[str]


@pytest.fixture(autouse=True)
def parser(monkeypatch: pytest.MonkeyPatch) -> ScriptedParser:
    """P7-I's seam, installed for every test in this module whether it asks for one or not."""
    scripted = ScriptedParser()
    monkeypatch.setattr(parser_service, "parse_intent", scripted)

    return scripted


@pytest.fixture(autouse=True)
def frozen_clock(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(NOW)


@pytest.fixture
def cutoff(db: Session) -> Callable[[int], None]:
    """`cancellation_cutoff_hours`, seeded at migration 0004's value and rewritable per test."""

    def rewrite(hours: int) -> None:
        row = db.execute(
            select(SystemSetting).where(
                SystemSetting.key == bot_service.CANCELLATION_CUTOFF_SETTING
            )
        ).scalar_one_or_none()

        if row is None:
            db.add(
                SystemSetting(
                    key=bot_service.CANCELLATION_CUTOFF_SETTING,
                    value=str(hours),
                    value_type=SETTING_VALUE_TYPE_INTEGER,
                    is_developer_only=False,
                )
            )
        else:
            row.value = str(hours)

        db.flush()

    rewrite(24)

    return rewrite


@pytest.fixture
def chat(db: Session, parser: ScriptedParser) -> Chat:
    return Chat(db=db, parser=parser)


@pytest.fixture
def world(db: Session) -> BotWorld:
    return _make_world(db)


@pytest.fixture
def client(db: Session, world: BotWorld) -> ClientWorld:
    """A returning family whose Child is Evaluated, with a level in `world`'s subject."""
    client = _make_client(db)
    _evaluate(db, client.child_id, levels={world.subject_id: CHILD_LEVEL})

    return client


@pytest.fixture
def orm_queries(db: Session) -> Generator[list[OrmQuery], None, None]:
    """Every ORM statement the test issues, attributed to the innermost `app/services` frame.

    Attribution is what makes the P7-T assertions honest. `slot_service` and
    `booking_write_service` filter on `tutor_id` constantly and are supposed to — they are the
    reviewed, scoped paths. The claim under test is about the statements `bot_service` itself
    emits, and only the call stack can tell the two apart.
    """
    captured: list[OrmQuery] = []

    def record(orm_execute_state: ORMExecuteState) -> None:
        statement = orm_execute_state.statement
        clause = getattr(statement, "whereclause", None)
        columns = (
            frozenset()
            if clause is None
            else frozenset(
                element.name for element in visitors.iterate(clause) if isinstance(element, Column)
            )
        )
        captured.append(OrmQuery(origin=_origin(), sql=str(statement), filtered_columns=columns))

    event.listen(db, "do_orm_execute", record)
    try:
        yield captured
    finally:
        event.remove(db, "do_orm_execute", record)


@pytest.fixture
def executed_sql(db: Session) -> Generator[list[str], None, None]:
    """Raw SQL for everything, inserts and flushes included — the wider net P7-C needs."""
    captured: list[str] = []

    def record(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        captured.append(statement)

    bind = db.get_bind()
    event.listen(bind, "before_cursor_execute", record)
    try:
        yield captured
    finally:
        event.remove(bind, "before_cursor_execute", record)


# --- opening a thread --------------------------------------------------------------------------


def test_a_first_message_from_an_unknown_number_opens_the_intake_flow(chat: Chat) -> None:
    turn = chat.say("hello?")

    assert render("ASK_GUARDIAN_NAME", "en") in turn.reply
    assert chat.step == bot_service.STEP_INTAKE_NAME
    assert turn.flag_reason is None


def test_a_first_message_from_a_known_number_opens_the_menu(
    chat: Chat, client: ClientWorld
) -> None:
    """REQ-075.1 — recognition is by phone number alone, with no challenge."""
    turn = chat.say("hi")

    assert render("ASK_MENU", "en") in turn.reply
    assert chat.step == bot_service.STEP_MENU


def test_the_opening_turn_is_parsed_for_its_language_only(chat: Chat) -> None:
    """ "hi" is not an answer to a question the bot has not asked yet, so it costs no
    re-prompt; the one parse call is there to read the language the parent wrote in."""
    chat.say("hi", value="hi")

    assert [call["step"] for call in chat.parser.calls] == [bot_service.OPENING_STEP]
    assert chat.parser.calls[0]["question"] == bot_service.OPENING_QUESTION
    assert chat.state.misses == 0
    assert chat.state.collected_data == {}


# --- intake (REQ-073) ---------------------------------------------------------------------------


def test_a_completed_intake_writes_the_five_row_kinds_in_one_turn(chat: Chat, db: Session) -> None:
    """REQ-073.2/.3/.5, REQ-096.1 and acceptance criterion 3.

    Nothing is written until the last answer of the first child — the notes answer — arrives,
    so a refused intake leaves none of it behind rather than only none of its tail.
    """
    _answer_up_to_the_notes(chat)
    after_the_school = _count(db, Guardian)
    writing_turn = chat.say(value="Peanut allergy")

    guardian = db.execute(
        select(Guardian).where(Guardian.phone_number == CANONICAL_NUMBER)
    ).scalar_one()
    child = db.execute(select(Child)).scalar_one()

    assert after_the_school == 0
    assert all(turn.link_guardian_id is None for turn in chat.replies[:-1])
    assert writing_turn.link_guardian_id == guardian.id
    assert chat.step == bot_service.STEP_CHILD_MORE
    assert child.date_of_birth == DATE_OF_BIRTH
    assert child.grade_level == 5
    assert child.school_name == "Test School"
    assert child.notes == "Peanut allergy"
    assert _count(db, Home) == 1
    assert _count(db, GuardianHome) == 1
    assert _count(db, Child) == 1
    assert _count(db, ChildHome) == 1
    assert _count(db, ChildGuardian) == 1


def test_the_intake_normalises_the_guardians_phone_number(chat: Chat, db: Session) -> None:
    """REQ-073.4 / D-L. The thread's own key is stored verbatim by the webhook (P7-H); the
    `guardians` row is a new row entering the database and goes through `phone_service`."""
    _run_intake(chat)

    numbers = list(db.scalars(select(Guardian.phone_number)).all())

    assert numbers == [CANONICAL_NUMBER]
    assert INBOUND_NUMBER not in numbers


def test_the_home_label_is_optional_and_skipping_it_costs_no_re_prompt(
    chat: Chat, db: Session
) -> None:
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")
    chat.say(value="1234")

    turn = chat.say("no thanks", value="skip")

    assert render("ASK_CHILD_REGISTERED", "en") in turn.reply
    assert chat.state.misses == 0


def test_an_over_long_answer_is_truncated_to_the_column_it_lands_in(
    chat: Chat, db: Session
) -> None:
    """The bot is the second writer against these tables and skips the Pydantic request schema
    that bounds an admin's typing, so a rambling message would otherwise reach `String(255)` as
    a `DataError` on flush — a 500 the webhook cannot answer and Twilio retries for ever."""
    _open_intake(chat)
    chat.say(value="A" * 400)
    chat.say(value="1 Test Street")
    chat.say(value="B" * 200)
    chat.say(value="skip")
    chat.say(value="no")
    chat.say(value="Sam")
    chat.say(value=DATE_OF_BIRTH.isoformat())
    chat.say(value="C" * 300)
    chat.say(value="5")
    chat.say(value="D" * 2500)

    guardian = db.execute(select(Guardian)).scalar_one()
    home = db.execute(select(Home)).scalar_one()
    child = db.execute(select(Child)).scalar_one()

    assert len(guardian.name) == bot_service.NAME_LIMIT
    assert len(home.access_code) == bot_service.ACCESS_CODE_LIMIT
    assert child.school_name == "C" * bot_service.NAME_LIMIT
    assert child.notes == "D" * NOTES_MAX_LENGTH


@pytest.mark.parametrize(
    ("raw", "lead"),
    [
        ("April 23rd 2016", render("UNREADABLE_DATE", "en")),
        ("23/04/2016", render("UNREADABLE_DATE", "en")),
        ("2016-02-30", render("UNREADABLE_DATE", "en")),
        ("1899-12-31", render("IMPLAUSIBLE_BIRTH_DATE", "en")),
        (TOMORROW.isoformat(), render("IMPLAUSIBLE_BIRTH_DATE", "en")),
        (None, None),
    ],
)
def test_a_date_of_birth_that_is_not_a_plausible_iso_date_is_re_prompted(
    chat: Chat, raw: str | None, lead: str | None
) -> None:
    """REQ-096.3. `create_child` refuses an implausible date on the notes turn, where the only
    outcome left would be a 500 — so the DOB step re-asks instead. Tomorrow is judged against
    the bot's frozen clock, not the wall clock."""
    _answer_up_to_the_child_name(chat)

    turn = chat.say(value=raw)

    nudge = _nudge(bot_service.STEP_CHILD_DOB)
    assert turn.reply == (nudge if lead is None else f"{lead} {nudge}")
    assert chat.step == bot_service.STEP_CHILD_DOB
    assert chat.state.misses == 1
    assert "child_date_of_birth" not in chat.state.collected_data


def test_three_unusable_dates_of_birth_bail_out_stuck(chat: Chat, db: Session) -> None:
    """REQ-096.3 through REQ-078.2's existing bail-out: no new failure path for the new step."""
    _answer_up_to_the_child_name(chat)

    first = chat.say(value="1899-12-31")
    second = chat.say(value=TOMORROW.isoformat())
    third = chat.say(value="he's 9")

    assert first.flag_reason is None
    assert second.flag_reason is None
    assert third.flag_reason is FlagReason.STUCK
    assert third.reply == render("BAILED_OUT", "en")
    assert chat.step == bot_service.STEP_CHILD_DOB
    assert _count(db, Guardian) == 0


def test_the_earliest_plausible_date_of_birth_is_accepted(chat: Chat) -> None:
    _answer_up_to_the_child_name(chat)

    turn = chat.say(value="1900-01-01")

    assert turn.reply == render("ASK_CHILD_SCHOOL", "en")
    assert chat.step == bot_service.STEP_CHILD_SCHOOL
    assert chat.state.collected_data["child_date_of_birth"] == "1900-01-01"


@pytest.mark.parametrize("answer", ["none", "No", "skip", "N/A", None])
def test_declining_the_notes_question_stores_null_without_a_re_prompt(
    chat: Chat, db: Session, answer: str | None
) -> None:
    """A-45. "None" is an answer, and so is a reply the parser extracted nothing from: the
    notes step never spends one of the parent's re-prompts."""
    _answer_up_to_the_notes(chat)

    turn = chat.say(value=answer)

    child = db.execute(select(Child)).scalar_one()

    assert child.notes is None
    assert chat.step == bot_service.STEP_CHILD_MORE
    assert chat.state.misses == 0
    assert turn.reply.startswith(render("CHILD_ADDED", "en", name="Sam"))


def test_the_notes_question_does_not_promise_a_tutor_will_read_it() -> None:
    """A-43 is reversed — the assigned tutor now sees a child's notes on the session detail
    (7C TN) — but the parent-facing copy is deliberately left neutral (OQ-88), so it still
    names no tutor."""
    assert "tutor" not in render("ASK_CHILD_NOTES", "en").casefold()


def test_the_parser_is_told_to_answer_the_date_of_birth_as_a_date(chat: Chat) -> None:
    """The parent-facing question shows a natural example, but `_iso_date` reads ISO only, so
    the parser is told the date kind and the turn's own today."""
    _answer_up_to_the_child_name(chat)
    chat.say(value=DATE_OF_BIRTH.isoformat())

    call = chat.parser.calls[-1]

    assert call["step"] == bot_service.STEP_CHILD_DOB
    assert call["question"] == render("ASK_CHILD_DOB", "en")
    assert call["answer_kind"] is AnswerKind.DATE
    assert call["today"] == NOW.date()


def test_the_parser_is_told_to_answer_the_booking_day_as_a_date(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    _book(chat, world, stop_after_date=True)

    call = chat.parser.calls[-1]

    assert call["step"] == bot_service.STEP_BOOK_DATE
    assert call["question"] == render("ASK_DATE", "en")
    assert call["answer_kind"] is AnswerKind.DATE
    assert call["today"] == NOW.date()


def test_the_cancel_list_labels_a_booking_with_a_human_date_and_time(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    _make_booking(db, world, client, date=DATE, start=datetime.time(16, 0))
    chat.say("hi")

    turn = chat.say("cancel please", intent=BotIntent.CANCEL)

    expected = (
        f"{US_DATE}, 4:00-5:00 PM: "
        f"{world.subject_name} for Sam Guardian with {world.first_tutor_name} at Home"
    )
    assert expected in turn.reply


def test_the_cancel_list_names_a_labelled_home_an_unlabelled_home_and_the_office(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    secret = _add_home(db, client, label=None, address="77 Secret Lane")
    labelled = _add_home(db, client, label="Dad's", address="2 Other Street")
    _make_booking(db, world, client, date=DATE, start=datetime.time(13, 0), home_id=labelled.id)
    _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0), home_id=secret.id)
    _make_booking(
        db,
        world,
        client,
        date=DATE,
        start=datetime.time(15, 0),
        location=BookingLocation.IN_OFFICE,
        home_id=None,
    )
    chat.say("hi")

    turn = chat.say("cancel please", intent=BotIntent.CANCEL)

    tutor = world.first_tutor_name
    assert (
        f"1:00-2:00 PM: {world.subject_name} for Sam Guardian with {tutor} at Dad's" in turn.reply
    )
    assert f"2:00-3:00 PM: {world.subject_name} for Sam Guardian with {tutor} at home" in turn.reply
    assert f"3:00-4:00 PM: {world.subject_name} for Sam Guardian with {tutor} at the office" in (
        turn.reply
    )
    assert "77 Secret Lane" not in turn.reply
    assert "2 Other Street" not in turn.reply
    assert "9999" not in turn.reply


def test_the_reschedule_list_names_the_location_too(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    _make_booking(
        db,
        world,
        client,
        date=DATE,
        start=datetime.time(15, 0),
        location=BookingLocation.IN_OFFICE,
        home_id=None,
    )
    chat.say("hi")

    turn = chat.say("move it", intent=BotIntent.RESCHEDULE)

    assert f"with {world.first_tutor_name} at the office" in turn.reply


@pytest.mark.parametrize("intent", [BotIntent.CANCEL, BotIntent.RESCHEDULE])
def test_an_evaluation_is_on_neither_the_cancel_list_nor_the_reschedule_list(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, intent: BotIntent
) -> None:
    """The office alone moves an Evaluation; the bot lists only the Regular session."""
    _make_evaluation(db, client, date=DATE, start=datetime.time(10, 0))
    _make_booking(db, world, client, date=DATE, start=datetime.time(16, 0))
    chat.say("hi")

    turn = chat.say("please", intent=intent)

    assert "4:00-5:00 PM" in turn.reply
    assert "10:00-11:00 AM" not in turn.reply


@pytest.mark.parametrize("intent", [BotIntent.CANCEL, BotIntent.RESCHEDULE])
def test_a_child_with_only_an_evaluation_has_nothing_to_cancel_or_reschedule(
    chat: Chat, db: Session, client: ClientWorld, intent: BotIntent
) -> None:
    _make_evaluation(db, client, date=DATE, start=datetime.time(10, 0))
    chat.say("hi")

    turn = chat.say("please", intent=intent)

    assert turn.reply == f"{render('NO_UPCOMING', 'en')} {render('ASK_MENU', 'en')}"


def test_rescheduling_a_regular_session_with_no_teaching_profile_behind_it_is_stuck(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """An Admin has no availability to offer slots from; the bot flags rather than guessing."""
    cutoff(1)
    booking = _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0))
    booking.user_id = _make_admin(db).id
    booking.availability_id = None
    db.flush()
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)

    turn = chat.say(value="1")

    assert turn.reply == render("CANNOT_CONTINUE", "en")
    assert turn.flag_reason is FlagReason.STUCK
    assert db.get_one(Booking, booking.id).status is BookingStatus.CONFIRMED


def test_the_booking_flow_lands_a_confirmed_regular_home_booking_for_the_chosen_tutor(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    _book(chat, world, tutor=world.second_tutor_name)

    booking = db.execute(select(Booking)).scalar_one()

    assert booking.kind is BookingKind.REGULAR
    assert booking.location is BookingLocation.HOME
    assert booking.user_id == user_id_of(db, world.second_tutor_id)
    assert booking.status is BookingStatus.CONFIRMED
    assert booking.booked_by_guardian_id == client.guardian_id


def test_a_tutor_promoted_to_admin_is_no_longer_offered_and_returns_when_demoted(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    user = db.get_one(User, user_id_of(db, world.first_tutor_id))

    def offered() -> tuple[str, str]:
        chat.say("hi")
        chat.say("book", intent=BotIntent.BOOK)
        menu = chat.say(value=world.subject_name)
        offer = chat.say(value=render("ANY_TUTOR_LABEL", "en"))
        offer = chat.say(value=DATE.isoformat())
        _expire_flow_state(db, phone_number=chat.phone_number)

        return menu.reply, offer.reply

    user.role = UserRole.ADMIN
    db.flush()
    as_admin = offered()
    user.role = UserRole.TUTOR
    db.flush()
    as_tutor = offered()

    assert all(world.first_tutor_name not in reply for reply in as_admin)
    assert all(world.first_tutor_name in reply for reply in as_tutor)


def test_the_date_of_birth_and_notes_are_never_sent_to_the_parser_again(chat: Chat) -> None:
    """A-55. Neither is needed to understand any later step, and notes can be health
    information; both would otherwise ride along to a third-party model on every message.
    The date is deliberately not `ASK_CHILD_DOB`'s own example, which a prompt may carry."""
    _answer_up_to_the_notes(chat, date_of_birth="2015-11-30")
    collected_at = len(chat.parser.calls)
    chat.say(value="Has dyslexia")
    chat.say(value="yes")
    chat.say(value="no")
    chat.say(value="Robin")

    later = [str(call["context"]) for call in chat.parser.calls[collected_at - 2 :]]
    after_notes = [str(call["context"]) for call in chat.parser.calls[collected_at + 1 :]]

    assert len(later) == 6
    assert all("child_date_of_birth" not in context for context in later)
    assert all("2015-11-30" not in context for context in later)
    assert all("Has dyslexia" not in context for context in after_notes)
    assert all("child_notes" not in context for context in after_notes)


def test_the_address_and_access_code_are_never_sent_to_the_parser(chat: Chat) -> None:
    """A street address and the code that opens its door are the pair #39 built P7-F to
    protect. No step after the one that collected them needs either to be understood, so they
    do not travel to a third-party model once per message for the rest of the conversation."""
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")
    chat.say(value="hunter2")
    chat.say(value="skip")
    chat.say(value="no")

    contexts = [call["context"] for call in chat.parser.calls]

    assert contexts != []
    assert all("1 Test Street" not in str(context) for context in contexts)
    assert all("hunter2" not in str(context) for context in contexts)


def test_a_child_already_registered_elsewhere_writes_nothing_and_flags_a_link_request(
    chat: Chat, db: Session
) -> None:
    """**P7-F**, asserted by row counts rather than by the reply.

    Phone-alone identity cannot distinguish a real second guardian from anyone who knows a
    child's name, and a link would hand over the other guardian's home address and door access
    code. A bot that says the right thing and writes the link anyway passes a reply assertion
    and fails this one.
    """
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")
    chat.say(value="1234")
    chat.say(value="skip")

    turn = chat.say("yes, he's with his dad already", value="yes")

    assert turn.flag_reason is FlagReason.GUARDIAN_LINK_REQUEST
    assert _count(db, Child) == 0
    assert _count(db, ChildGuardian) == 0
    assert _count(db, ChildHome) == 0
    assert _count(db, Guardian) == 0


def test_a_returning_guardian_asking_to_be_linked_is_flagged_rather_than_linked(
    chat: Chat, client: ClientWorld
) -> None:
    """The same rule reached from the menu instead of from intake (REQ-073.6, P7-F)."""
    chat.say("hi")

    turn = chat.say("add me to my son's account", intent=BotIntent.LINK_GUARDIAN)

    assert turn.flag_reason is FlagReason.GUARDIAN_LINK_REQUEST
    assert render("GUARDIAN_LINK_REPLY", "en") == turn.reply


def test_a_second_child_reuses_the_guardian_written_by_the_first(chat: Chat, db: Session) -> None:
    _run_intake(chat, add_another=True)
    chat.say(value="no")
    chat.say(value="Robin")
    chat.say(value="2017-09-01")
    chat.say(value="Test School")
    chat.say(value="3")
    chat.say(value="none")

    assert _count(db, Guardian) == 1
    assert _count(db, Child) == 2
    assert _count(db, ChildGuardian) == 2


def test_a_returning_guardian_with_no_children_is_asked_the_full_child_questions(
    chat: Chat, db: Session
) -> None:
    """REQ-096 through the menu's `NO_CHILDREN_YET` path, not only through first-time intake."""
    detail = client_service.create_client(
        db,
        name="Ada Guardian",
        phone_number=CANONICAL_NUMBER,
        home=client_service.HomeInput(label="Home", address="1 Test Street", access_code="1234"),
    )
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value="no")
    dob_question = chat.say(value="Sam")
    chat.say(value=DATE_OF_BIRTH.isoformat())
    grade_question = chat.say(value="Test School")
    notes_question = chat.say(value="5")
    chat.say(value="Peanut allergy")

    child = db.execute(select(Child)).scalar_one()
    link = db.execute(select(ChildGuardian)).scalar_one()

    assert dob_question.reply == render("ASK_CHILD_DOB", "en")
    assert grade_question.reply == render("ASK_CHILD_GRADE", "en", name="Sam")
    assert notes_question.reply == render("ASK_CHILD_NOTES", "en")
    assert child.date_of_birth == DATE_OF_BIRTH
    assert child.grade_level == 5
    assert child.notes == "Peanut allergy"
    assert link.guardian_id == detail.client.id
    assert _count(db, Guardian) == 1
    assert _count(db, ChildHome) == 1


# --- booking (REQ-074) --------------------------------------------------------------------------


def test_a_booking_is_written_confirmed_through_the_write_service(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """REQ-074.5/.6. `create_booking` is the only path, so all seven rules and
    `excl_bookings_live_overlap` apply to the bot exactly as they do to the dashboard."""
    turn = _book(chat, world)

    booking = db.execute(select(Booking)).scalar_one()

    assert booking.status is BookingStatus.CONFIRMED
    assert booking.booked_by_guardian_id == client.guardian_id
    assert booking.child_id == client.child_id
    assert booking.home_id == client.home_id
    assert chat.step is None
    assert _text_before_placeholder("BOOKING_CONFIRMED") in turn.reply


@pytest.mark.parametrize(("label", "place"), [("Mom's", "at Mom's"), (None, "at home")])
def test_a_new_booking_names_the_home_in_the_confirm_question_and_the_booked_reply(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, label: str | None, place: str
) -> None:
    db.get(Home, client.home_id).label = label
    db.flush()
    _book(chat, world, stop_after_offer=True)
    slot = chat.state.collected_data["options"][0]["label"]

    confirm = chat.say(value="1")
    booked = chat.say(value="yes")

    assert slot.endswith(f" {place}")
    assert f"{slot} on" in confirm.reply
    assert f"{slot} on" in booked.reply
    assert "1 Test Street" not in confirm.reply + booked.reply


def test_the_slot_offer_shows_a_human_date_and_times_but_stores_iso(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    turn = _book(chat, world, stop_after_offer=True)

    assert turn.reply.startswith(f"These times are available on {US_DATE}:\n1. 9:00-10:00 AM with ")
    assert "\n3. 10:30-11:30 AM with " in turn.reply
    slot_lines = [line for line in turn.reply.splitlines() if line[:1].isdigit()]
    assert slot_lines
    assert all(line.endswith(" at Home") for line in slot_lines)
    assert DATE.isoformat() not in turn.reply
    assert "09:00" not in turn.reply
    assert chat.state.collected_data["book_date"] == DATE.isoformat()


def test_the_offer_says_how_many_slots_it_is_not_showing(
    chat: Chat, world: BotWorld, client: ClientWorld, set_int_setting: SetIntSetting
) -> None:
    """REQ-074.2 — `total` is the pre-cap count, so "showing 1 of 4" is honest rather than
    implying one is all there is (`api-design.md:1119`)."""
    set_int_setting(MAX_SLOTS_OFFERED_SETTING, 1)

    turn = _book(chat, world, stop_after_offer=True)

    assert render("SHOWING_SOME", "en", shown=1, total=4) in turn.reply


def test_a_named_tutor_narrows_the_offer_to_that_tutor(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    """The residual P7-T leaves to flow logic: the bot must not offer, and then book, a
    qualified tutor the guardian did not ask for."""
    turn = _book(chat, world, tutor=world.second_tutor_name, stop_after_offer=True)

    assert world.second_tutor_name in turn.reply
    assert world.first_tutor_name not in turn.reply


def test_an_ambiguous_choice_is_re_prompted_rather_than_guessed(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """Two tutors whose names share a substring: picking the first hit would book a different
    person from the one the guardian named, with nothing downstream able to tell."""
    _make_tutor_for(db, world, name=f"{world.first_tutor_name} the second")
    chat.say("hi")
    chat.say("I'd like to book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)

    turn = chat.say(value=world.first_tutor_name)

    assert turn.reply.startswith(f"{render('AMBIGUOUS_NAME', 'en')}\n1. ")
    assert chat.step == bot_service.STEP_BOOK_TUTOR


def test_more_than_one_active_home_asks_which_one(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """REQ-074.3, and where `homes.label` earns its place: "Mum's or Dad's?" is answerable
    over WhatsApp and two full street addresses are not (#39)."""
    _add_home(db, client, label="Dad's", address="2 Other Street")

    turn = _book(chat, world, stop_after_date=True)

    assert render("ASK_WHERE", "en") in turn.reply
    assert "Dad's" in turn.reply
    assert chat.step == bot_service.STEP_BOOK_HOME


def test_exactly_one_active_home_is_not_asked_about(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    """The common path must not cost a needless turn (#39)."""
    turn = _book(chat, world, stop_after_date=True)

    assert render("ASK_WHERE", "en") not in turn.reply
    assert chat.step == bot_service.STEP_BOOK_SLOT


def test_a_deactivated_home_is_not_counted_and_is_never_offered(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    home = _add_home(db, client, label="Old place", address="3 Former Street")
    home.is_active = False
    db.flush()

    turn = _book(chat, world, stop_after_date=True)

    assert render("ASK_WHERE", "en") not in turn.reply
    assert "Old place" not in turn.reply


def test_a_conflict_on_the_write_re_offers_rather_than_erroring(
    chat: Chat, monkeypatch: pytest.MonkeyPatch, world: BotWorld, client: ClientWorld
) -> None:
    """REQ-074.7. Two guardians can be offered the same slot, so REQ-045's concurrent-
    submission 409 is a normal outcome here and not an error to surface."""
    real = booking_write_service.create_booking
    refusals = [booking_write_service.BookingOverlaps()]

    def racing(
        session: Session,
        *,
        request: booking_write_service.BookingRequest,
        now: datetime.datetime,
    ) -> Booking:
        if refusals:
            raise refusals.pop()

        return real(session, request=request, now=now)

    monkeypatch.setattr(booking_write_service, "create_booking", racing)

    turn = _book(chat, world)

    assert render("SLOT_JUST_TAKEN", "en") in turn.reply
    assert turn.flag_reason is None
    assert chat.step == bot_service.STEP_BOOK_SLOT


def test_a_gap_conflict_on_the_write_re_offers_rather_than_erroring(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """The gap is a warning the Office can confirm (#151), but the bot confirms nothing: a
    session booked into the chosen slot's gap between the offer and the confirm is still
    `GapNotRespected` to the bot, and still a re-offer."""
    # A second range leaves the afternoon free, so the re-offer has something to show.
    _make_availability(
        db, world.first_tutor_id, date=DATE, start=datetime.time(14, 0), end=datetime.time(16, 0)
    )
    _book(chat, world, tutor=world.first_tutor_name, stop_after_offer=True)
    _make_booking(db, world, client, date=DATE, start=datetime.time(10, 15))
    chat.say(value="1")

    turn = chat.say(value="yes")

    assert render("SLOT_JUST_TAKEN", "en") in turn.reply
    assert turn.flag_reason is None
    assert chat.step == bot_service.STEP_BOOK_SLOT


def test_time_off_approved_since_the_offer_re_offers_rather_than_erroring(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    _book(chat, world, tutor=world.first_tutor_name, stop_after_offer=True)
    db.add(
        TutorAvailabilityException(
            tutor_id=world.first_tutor_id,
            start_date=DATE,
            end_date=DATE,
            start_time=NINE,
            end_time=datetime.time(10, 0),
            reason="vacation",
            status=ExceptionStatus.APPROVED,
        )
    )
    db.flush()
    chat.say(value="1")

    turn = chat.say(value="yes")

    assert render("SLOT_JUST_TAKEN", "en") in turn.reply
    assert turn.flag_reason is None
    assert chat.step == bot_service.STEP_BOOK_SLOT


def test_a_date_outside_the_booking_window_asks_for_another_day(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("book please", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)
    chat.say(value=render("ANY_TUTOR_LABEL", "en"))

    turn = chat.say(value=(_today() - datetime.timedelta(days=1)).isoformat())

    assert render("DATE_NOT_BOOKABLE", "en") in turn.reply
    assert chat.step == bot_service.STEP_BOOK_DATE


@pytest.mark.parametrize("suffix", ["", "T00:00:00", " 09:00"])
def test_an_iso_date_is_accepted_with_or_without_a_time_attached(
    chat: Chat, world: BotWorld, client: ClientWorld, suffix: str
) -> None:
    """The two shapes a model reaching for ISO 8601 produces. A date the flow cannot read is a
    re-prompt, so a needlessly narrow reader spends the parent's two re-prompts on a date they
    gave correctly."""
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)
    chat.say(value=render("ANY_TUTOR_LABEL", "en"))

    turn = chat.say(value=f"{DATE.isoformat()}{suffix}")

    assert render("ASK_SLOT", "en", date=bot_messages.format_date(DATE, "en")) in turn.reply
    assert chat.step == bot_service.STEP_BOOK_SLOT


@pytest.mark.parametrize("raw", ["next tuesday", "", "14/10/2026"])
def test_a_date_the_parser_did_not_resolve_is_re_prompted_rather_than_guessed(
    chat: Chat, world: BotWorld, client: ClientWorld, raw: str
) -> None:
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)
    chat.say(value=render("ANY_TUTOR_LABEL", "en"))

    turn = chat.say(value=raw)

    nudge = _nudge(bot_service.STEP_BOOK_DATE)
    assert turn.reply == (nudge if raw == "" else f"{render('UNREADABLE_DATE', 'en')} {nudge}")
    assert chat.step == bot_service.STEP_BOOK_DATE


# --- the office handoff: not Evaluated, or no level for the subject ----------------------------


def test_a_child_not_evaluated_is_handed_to_the_office_after_the_subject_and_day(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    _add_child(db, client, name="Robin Guardian")
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)

    subject_question = chat.say(value="Robin")
    day_question = chat.say(value=world.subject_name)
    turn = chat.say(value=DATE.isoformat())

    assert subject_question.reply.startswith(render("ASK_SUBJECT", "en"))
    assert day_question.reply == render("ASK_DATE", "en")
    assert turn.reply == (
        "Thank you. Robin Guardian's first session will be an evaluation session. "
        "Our office will arrange it and be in touch shortly."
    )
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST
    assert chat.state is None
    assert _count(db, Booking) == 0


def test_a_child_whose_evaluation_was_cleared_goes_to_the_handoff_despite_its_levels(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    _clear_evaluation(db, client.child_id)
    chat.say("hi")

    subject_question = chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)
    turn = chat.say(value=DATE.isoformat())

    assert subject_question.reply.startswith(render("ASK_SUBJECT", "en"))
    assert chat.replies[-2].reply == render("ASK_DATE", "en")
    assert turn.reply == render("FIRST_SESSION_HANDOFF", "en", name="Sam Guardian")
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST
    assert _count(db, Booking) == 0


def test_an_evaluated_child_with_no_level_for_the_subject_is_handed_to_the_office(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    science, _ = _make_subject_taught_at(db, name="Science", ceilings=(12,))
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)

    day_question = chat.say(value=science.name)
    turn = chat.say(value=DATE.isoformat())

    assert day_question.reply == render("ASK_DATE", "en")
    assert turn.reply == (
        f"Thank you. Our office will arrange Sam Guardian's {science.name} sessions "
        "and be in touch shortly."
    )
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST
    assert chat.state is None
    assert _count(db, Booking) == 0


def test_a_handoff_day_outside_the_window_asks_again_and_an_unreadable_one_re_prompts(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    _clear_evaluation(db, client.child_id)
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)

    past = chat.say(value=(_today() - datetime.timedelta(days=1)).isoformat())
    unreadable = chat.say(value="next tuesday")

    assert past.reply == f"{render('DATE_NOT_BOOKABLE', 'en')} {render('ASK_DATE', 'en')}"
    assert past.flag_reason is None
    assert unreadable.reply == (
        f"{render('UNREADABLE_DATE', 'en')} {_nudge(bot_service.STEP_FIRST_SESSION_DATE)}"
    )
    assert chat.step == bot_service.STEP_FIRST_SESSION_DATE
    assert _count(db, Booking) == 0


def test_an_evaluated_child_with_a_level_is_still_asked_for_a_tutor_and_booked(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)

    tutor_question = chat.say(value=world.subject_name)
    chat.say(value=render("ANY_TUTOR_LABEL", "en"))
    offer = chat.say(value=DATE.isoformat())
    chat.say(value="1")
    turn = chat.say(value="yes")

    assert tutor_question.reply.startswith(render("ASK_TUTOR", "en"))
    assert offer.reply.startswith(
        render("ASK_SLOT", "en", date=bot_messages.format_date(DATE, "en"))
    )
    assert turn.flag_reason is None
    assert db.execute(select(Booking)).scalar_one().status is BookingStatus.CONFIRMED


# --- matching tutors on the Subject level ------------------------------------------------------


def test_only_tutors_whose_ceiling_reaches_the_childs_level_are_offered(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    math, (at_five, at_eight, at_four) = _make_subject_taught_at(
        db, name="Math", ceilings=(5, 8, 4)
    )
    _set_level(db, client.child_id, math.id, level=5)
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)

    tutor_question = chat.say(value=math.name)
    chat.say(value=render("ANY_TUTOR_LABEL", "en"))
    offer = chat.say(value=DATE.isoformat())

    assert at_five.user.name in tutor_question.reply
    assert at_eight.user.name in tutor_question.reply
    assert at_four.user.name not in tutor_question.reply
    assert at_four.user.name not in offer.reply
    assert at_five.user.name in offer.reply


def test_a_kindergarten_level_matches_a_tutor_whose_ceiling_is_kindergarten(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    phonics, (kindergarten_tutor,) = _make_subject_taught_at(db, name="Phonics", ceilings=(0,))
    _set_level(db, client.child_id, phonics.id, level=0)
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)

    tutor_question = chat.say(value=phonics.name)

    assert tutor_question.reply.startswith(render("ASK_TUTOR", "en"))
    assert kindergarten_tutor.user.name in tutor_question.reply


def test_the_overall_grade_plays_no_part_in_matching(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """The Overall grade (7 here) is a Staff estimate; only the Subject level is matched."""
    math, (at_three,) = _make_subject_taught_at(db, name="Math", ceilings=(3,))
    _set_level(db, client.child_id, math.id, level=2)
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)

    tutor_question = chat.say(value=math.name)

    assert at_three.user.name in tutor_question.reply


def test_rescheduling_a_session_for_a_child_not_evaluated_is_handed_to_the_office(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """The Evaluation session Staff booked can be moved, but only by the office: the bot books
    nothing for a Child it cannot match on a level, and the old session stays as it was. The
    reply names that session and the day asked for, so Staff reading the flagged thread move
    it rather than booking a second one."""
    original = _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0))
    _clear_evaluation(db, client.child_id)
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)
    day_question = chat.say(value="1")
    turn = chat.say(value=DATE.isoformat())

    assert day_question.reply == render("ASK_NEW_DATE", "en")
    assert turn.reply == (
        f"Thank you. Our office will help you move Sam Guardian's {world.subject_name} session "
        f"on {US_DATE}, 2:00-3:00 PM to {US_DATE}, and will be in touch shortly. "
        "The session stays booked until then."
    )
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST
    assert chat.state is None
    assert db.get_one(Booking, original.id).status is BookingStatus.CONFIRMED
    assert _count(db, Booking) == 1


def test_rescheduling_a_session_in_a_subject_with_no_level_is_handed_to_the_office(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    original = _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0))
    db.execute(delete(ChildSubjectLevel).where(ChildSubjectLevel.child_id == client.child_id))
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)
    chat.say(value="1")
    turn = chat.say(value=DATE.isoformat())

    assert turn.reply == render(
        "RESCHEDULE_NEEDS_OFFICE",
        "en",
        child="Sam Guardian",
        subject=world.subject_name,
        old_date=US_DATE,
        old_time="2:00-3:00 PM",
        date=US_DATE,
    )
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST
    assert db.get_one(Booking, original.id).status is BookingStatus.CONFIRMED


def test_a_new_booking_after_a_reschedule_handoff_is_not_treated_as_a_move(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """The handoff ends the flow, so the next request starts without the session to move."""
    _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0))
    _clear_evaluation(db, client.child_id)
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)
    chat.say(value="1")
    chat.say(value=DATE.isoformat())
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)

    turn = chat.say(value=DATE.isoformat())

    assert turn.reply == render("FIRST_SESSION_HANDOFF", "en", name="Sam Guardian")


def test_a_flow_saved_with_the_retired_grade_key_resumes_on_the_childs_level(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    """Builds before Subject levels kept the Overall grade in `book_grade_level`."""
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    state = chat.state
    state.collected_data["book_grade_level"] = "None"
    save_state(chat.db, phone_number=chat.phone_number, state=state)

    turn = chat.say(value=world.subject_name)

    assert turn.reply.startswith(render("ASK_TUTOR", "en"))
    assert chat.step == bot_service.STEP_BOOK_TUTOR


@pytest.mark.parametrize(
    "step", [bot_service.STEP_FIRST_SESSION_SUBJECT, bot_service.STEP_FIRST_SESSION_DATE]
)
def test_a_handoff_step_missing_its_child_restarts_cleanly(
    chat: Chat, client: ClientWorld, step: str
) -> None:
    _park_at(chat, step, prompt=render("ASK_DATE", "en"), collected_data={"book_subject_id": "x"})

    turn = chat.say(value=DATE.isoformat())

    assert chat.step == bot_service.STEP_MENU
    assert chat.state.collected_data == {}
    assert render("ASK_MENU", "en") in turn.reply


def test_a_guardian_sees_only_the_children_they_are_linked_to(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """REQ-075.2 — the list comes through `child_guardians`, never through the whole table."""
    other = _make_client(db, phone_number="+12025550187", child_name="Someone Elses Child")
    chat.say("hi")

    turn = chat.say("book", intent=BotIntent.BOOK)

    assert "Someone Elses Child" not in turn.reply
    assert db.get(Child, other.child_id).name == "Someone Elses Child"


def test_an_inactive_child_beside_an_active_one_is_never_offered(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """REQ-114. One active child left means the child question is skipped outright, so the
    inactive one is neither listed nor silently picked."""
    _add_child(db, client, name="Retired Child", is_active=False)
    chat.say("hi")

    turn = chat.say("book", intent=BotIntent.BOOK)

    assert turn.reply.startswith(render("ASK_SUBJECT", "en"))
    assert chat.step == bot_service.STEP_BOOK_SUBJECT
    assert chat.state.collected_data["book_child_id"] == str(client.child_id)
    assert all("Retired Child" not in reply.reply for reply in chat.replies)


def test_the_which_child_list_leaves_out_an_inactive_child(
    chat: Chat, db: Session, client: ClientWorld
) -> None:
    """REQ-114 where there is a list to leave it out of."""
    _add_child(db, client, name="Robin Guardian")
    _add_child(db, client, name="Retired Child", is_active=False)
    chat.say("hi")

    turn = chat.say("book", intent=BotIntent.BOOK)

    assert turn.reply.startswith(render("ASK_WHICH_CHILD", "en"))
    assert "Sam Guardian" in turn.reply
    assert "Robin Guardian" in turn.reply
    assert "Retired Child" not in turn.reply


@pytest.mark.parametrize(
    ("retirement", "opener"),
    [
        ("unlinked", render("NO_CHILDREN_YET", "en")),
        ("deactivated", render("NO_ACTIVE_CHILDREN", "en")),
    ],
)
def test_a_guardian_whose_only_child_is_inactive_is_treated_as_having_none(
    chat: Chat, db: Session, client: ClientWorld, retirement: str, opener: str
) -> None:
    """REQ-114, P7C-Q: the add-a-child path for both. Phase 7D (REQ-132.7, SA-27) words the
    deactivated case `NO_ACTIVE_CHILDREN`; a guardian with no linked child at all still hears
    `NO_CHILDREN_YET`."""
    child = db.get_one(Child, client.child_id)

    if retirement == "unlinked":
        db.delete(
            db.execute(
                select(ChildGuardian).where(ChildGuardian.child_id == client.child_id)
            ).scalar_one()
        )
    else:
        child.is_active = False

    db.flush()
    chat.say("hi")

    turn = chat.say("book", intent=BotIntent.BOOK)

    assert turn.reply == f"{opener} {render('ASK_CHILD_REGISTERED', 'en')}"
    assert chat.step == bot_service.STEP_CHILD_REGISTERED
    assert child.name not in turn.reply


def test_a_child_deactivated_after_the_offer_is_refused_at_the_write_without_raising(
    chat: Chat, db: Session, monkeypatch: pytest.MonkeyPatch, world: BotWorld, client: ClientWorld
) -> None:
    """The race between the offer and the booking write. `booking_write_service` refuses a
    retired child with `BookingReferenceNotFound`, which the bot catches through the
    `BookingWriteError` base: a reply, a stuck flag for an admin, and nothing written."""

    def retired(
        session: Session,
        *,
        request: booking_write_service.BookingRequest,
        now: datetime.datetime,
    ) -> Booking:
        raise booking_write_service.BookingReferenceNotFound()

    monkeypatch.setattr(booking_write_service, "create_booking", retired)

    turn = _book(chat, world)

    assert turn.reply == render("CANNOT_CONTINUE", "en")
    assert turn.flag_reason is FlagReason.STUCK
    assert chat.step is None
    assert _count(db, Booking) == 0


# --- cancel and reschedule (REQ-075, P7-O) ------------------------------------------------------


def test_cancelling_outside_the_cutoff_moves_the_booking_to_cancelled(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """REQ-075.3 — `confirmed → cancelled` through `booking_status_service`, an edge that
    already ships. No new transition is added."""
    booking = _make_booking(db, world, client, date=DATE)
    chat.say("hi")
    chat.say("cancel please", intent=BotIntent.CANCEL)
    chat.say(value="1")

    turn = chat.say("yes please", value="yes")

    assert db.get(Booking, booking.id).status is BookingStatus.CANCELLED
    assert turn.flag_reason is None
    assert turn.reply == render("CANCELLED", "en")
    assert chat.state is None


def test_picking_a_session_to_cancel_asks_for_confirmation_before_cancelling(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """The parser resolves "the Tuesday one" to an option number, so a pick alone must never
    cancel: the parent sees which session it is and says yes first."""
    booking = _make_booking(db, world, client, date=DATE, start=datetime.time(16, 0))
    chat.say("hi")
    chat.say("cancel please", intent=BotIntent.CANCEL)

    turn = chat.say(value="1")

    assert turn.reply == (
        f"Cancel Sam Guardian's session on {US_DATE}, 4:00-5:00 PM? Please reply yes or no."
    )
    assert chat.step == bot_service.STEP_CANCEL_CONFIRM
    assert db.get(Booking, booking.id).status is BookingStatus.CONFIRMED


def test_a_no_at_the_cancel_confirmation_keeps_the_session_and_returns_to_the_menu(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    booking = _make_booking(db, world, client, date=DATE)
    chat.say("hi")
    chat.say("cancel please", intent=BotIntent.CANCEL)
    chat.say(value="1")

    turn = chat.say("no thanks", value="no")

    assert db.get(Booking, booking.id).status is BookingStatus.CONFIRMED
    assert turn.reply == f"{render('CANCEL_KEPT', 'en')} {render('ASK_MENU', 'en')}"
    assert turn.flag_reason is None
    assert chat.step == bot_service.STEP_MENU
    assert "cancel_booking_id" not in chat.state.collected_data


def test_an_unclear_answer_at_the_cancel_confirmation_nudges_and_cancels_nothing(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    booking = _make_booking(db, world, client, date=DATE)
    chat.say("hi")
    chat.say("cancel please", intent=BotIntent.CANCEL)
    chat.say(value="1")

    turn = chat.say("hmm", value="maybe")

    assert turn.reply == _nudge(bot_service.STEP_CANCEL_CONFIRM)
    assert chat.step == bot_service.STEP_CANCEL_CONFIRM
    assert chat.state.misses == 1
    assert db.get(Booking, booking.id).status is BookingStatus.CONFIRMED


def test_a_flow_saved_at_the_cancel_pick_by_an_older_build_still_asks_to_confirm(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    booking = _make_booking(db, world, client, date=DATE)
    _park_at(
        chat,
        bot_service.STEP_CANCEL_PICK,
        prompt=f"{render('ASK_WHICH_TO_CANCEL', 'en')}\n1. A session",
        collected_data={"options": [{"id": str(booking.id), "label": "A session"}]},
    )

    asked = chat.say(value="1")
    turn = chat.say(value="yes")

    assert asked.reply.startswith("Cancel Sam Guardian's session")
    assert turn.reply == render("CANCELLED", "en")
    assert db.get(Booking, booking.id).status is BookingStatus.CANCELLED


def test_cancelling_inside_the_cutoff_is_declined_and_is_not_flagged(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """REQ-075.5/.6, OQ-24, and `cancellation_cutoff_hours`'s first consumer ever.

    A policy refusal is **not** a bot failure. There are three `flag_reason` values and there
    is no fourth, and putting routine late cancellations in the flag queue would bury the flags
    that mean the bot actually needs help.
    """
    booking = _make_booking(db, world, client, date=TOMORROW, start=NINE)
    chat.say("hi")
    chat.say("cancel please", intent=BotIntent.CANCEL)

    turn = chat.say(value="1")

    assert db.get(Booking, booking.id).status is BookingStatus.CONFIRMED
    assert turn.reply == render("CUTOFF_DECLINED", "en")
    assert turn.flag_reason is None


def test_the_cutoff_is_read_from_settings_rather_than_hardcoded(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """The same booking, refused at one cutoff and cancelled at another, inside one test —
    which is the only shape that shows the number is read at turn time (OB-11)."""
    booking = _make_booking(db, world, client, date=TOMORROW, start=NINE)
    cutoff(48)
    chat.say("hi")
    chat.say("cancel", intent=BotIntent.CANCEL)
    declined = chat.say(value="1")

    cutoff(1)
    chat.say("hi")
    chat.say("cancel", intent=BotIntent.CANCEL)
    chat.say(value="1")
    accepted = chat.say(value="yes")

    assert declined.reply == render("CUTOFF_DECLINED", "en")
    assert accepted.reply == render("CANCELLED", "en")
    assert db.get(Booking, booking.id).status is BookingStatus.CANCELLED


def test_rescheduling_inside_the_cutoff_is_declined_and_is_not_flagged(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    booking = _make_booking(db, world, client, date=TOMORROW, start=NINE)
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)

    turn = chat.say(value="1")

    assert db.get(Booking, booking.id).status is BookingStatus.CONFIRMED
    assert turn.reply == render("CUTOFF_DECLINED", "en")
    assert turn.flag_reason is None


def test_rescheduling_leaves_the_old_booking_cancelled_and_a_new_one_confirmed(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """**P7-O** — cancel-then-rebook through the two paths that already exist; no reschedule
    endpoint is invented. The replacement is written *before* the cancellation, so a parent
    who abandons the flow still has the session they started with."""
    original = _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0))
    _make_availability(db, world.first_tutor_id, date=DATE, start=datetime.time(14, 0), end=TWELVE)
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)
    chat.say(value="1")
    chat.say(value=DATE.isoformat())
    chat.say(value="1")
    turn = chat.say(value="yes")

    live = db.scalars(select(Booking).where(Booking.status == BookingStatus.CONFIRMED)).all()

    assert db.get(Booking, original.id).status is BookingStatus.CANCELLED
    assert len(live) == 1
    assert live[0].id != original.id
    assert _text_before_placeholder("BOOKING_MOVED") in turn.reply
    assert " at Home on " in turn.reply


def test_the_reschedule_confirmation_names_the_session_being_replaced(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """The "yes" cancels the old session, so the parent must see which one it is."""
    _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0))
    _make_availability(db, world.first_tutor_id, date=DATE, start=datetime.time(14, 0), end=TWELVE)
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)
    chat.say(value="1")
    chat.say(value=DATE.isoformat())
    label = chat.state.collected_data["options"][0]["label"]

    turn = chat.say(value="1")

    assert turn.reply == (
        f"To confirm: {label} on {US_DATE}, replacing Sam Guardian's session on {US_DATE}, "
        "2:00-3:00 PM. Should I book it?"
    )
    assert chat.step == bot_service.STEP_BOOK_CONFIRM


def test_a_new_booking_confirmation_mentions_no_replacement(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    _book(chat, world, stop_after_offer=True)
    label = chat.state.collected_data["options"][0]["label"]

    turn = chat.say(value="1")

    assert turn.reply == render(
        "CONFIRM_SLOT", "en", label=label, date=bot_messages.format_date(DATE, "en")
    )


def test_a_reschedule_whose_old_session_cannot_be_loaded_falls_back_to_the_plain_confirmation(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    """A flow saved by an older build, or a booking removed since the pick, still renders."""
    option = {
        "id": str(world.first_availability_id),
        "label": "9:00am-10:00am with Someone",
        "tutor_id": str(world.first_tutor_id),
        "availability_id": str(world.first_availability_id),
        "start_time": "09:00:00",
        "end_time": "10:00:00",
    }
    _park_at(
        chat,
        bot_service.STEP_BOOK_SLOT,
        prompt="These times are available:\n1. 9:00am-10:00am with Someone",
        collected_data={
            "book_date": DATE.isoformat(),
            "reschedule_booking_id": str(uuid.uuid4()),
            "options": [option],
        },
    )

    turn = chat.say(value="1")

    assert turn.reply == render(
        "CONFIRM_SLOT", "en", label=option["label"], date=bot_messages.format_date(DATE, "en")
    )
    assert chat.step == bot_service.STEP_BOOK_CONFIRM


def _unlink(db: Session, client: ClientWorld) -> None:
    """An admin removing the guardian from the child mid-conversation."""
    link = db.execute(
        select(ChildGuardian).where(
            ChildGuardian.child_id == client.child_id,
            ChildGuardian.guardian_id == client.guardian_id,
        )
    ).scalar_one()
    db.delete(link)
    db.flush()


def _reach_reschedule_confirm(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld
) -> Booking:
    original = _make_booking(db, world, client, date=DATE, start=datetime.time(14, 0))
    _make_availability(db, world.first_tutor_id, date=DATE, start=datetime.time(14, 0), end=TWELVE)
    chat.say("hi")
    chat.say("move it", intent=BotIntent.RESCHEDULE)
    chat.say(value="1")
    chat.say(value=DATE.isoformat())
    chat.say(value="1")
    assert chat.step == bot_service.STEP_BOOK_CONFIRM

    return original


def _live_bookings(db: Session) -> list[Booking]:
    return list(db.scalars(select(Booking).where(Booking.status == BookingStatus.CONFIRMED)).all())


def test_a_cancel_confirmed_after_the_guardian_was_unlinked_cancels_nothing(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    booking = _make_booking(db, world, client, date=DATE)
    chat.say("hi")
    chat.say("cancel please", intent=BotIntent.CANCEL)
    chat.say(value="1")
    _unlink(db, client)

    turn = chat.say(value="yes")

    assert db.get(Booking, booking.id).status is BookingStatus.CONFIRMED
    assert turn.reply == render("CANNOT_CONTINUE", "en")
    assert turn.flag_reason is FlagReason.STUCK


def test_a_reschedule_confirmed_after_the_guardian_was_unlinked_writes_and_cancels_nothing(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    original = _reach_reschedule_confirm(chat, db, world, client)
    _unlink(db, client)

    turn = chat.say(value="yes")

    assert [booking.id for booking in _live_bookings(db)] == [original.id]
    assert turn.reply == render("CANNOT_CONTINUE", "en")
    assert turn.flag_reason is FlagReason.STUCK


def test_a_reschedule_whose_old_session_was_cancelled_meanwhile_is_still_moved(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    """The office cancelling the old session first leaves the parent wanting exactly the new
    one, which is what they now have."""
    original = _reach_reschedule_confirm(chat, db, world, client)
    db.get_one(Booking, original.id).status = BookingStatus.CANCELLED
    db.flush()

    turn = chat.say(value="yes")

    live = _live_bookings(db)
    assert len(live) == 1
    assert live[0].id != original.id
    assert turn.reply.startswith(_text_before_placeholder("BOOKING_MOVED"))
    assert turn.flag_reason is None


def test_a_reschedule_whose_old_session_was_removed_meanwhile_is_still_moved(
    chat: Chat, db: Session, world: BotWorld, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    original = _reach_reschedule_confirm(chat, db, world, client)
    db.delete(db.get_one(Booking, original.id))
    db.flush()

    turn = chat.say(value="yes")

    assert len(_live_bookings(db)) == 1
    assert turn.reply.startswith(_text_before_placeholder("BOOKING_MOVED"))
    assert turn.flag_reason is None


def test_an_unexpected_failure_cancelling_the_old_session_undoes_the_new_one(
    chat: Chat,
    db: Session,
    world: BotWorld,
    client: ClientWorld,
    cutoff: Callable[[int], None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Stuck must mean nothing changed: two live sessions where the parent asked for one is
    worse than the move not happening."""
    original = _reach_reschedule_confirm(chat, db, world, client)

    def refuse(
        db: Session,
        *,
        booking_id: uuid.UUID,
        target: BookingStatus,
        expected_updated_at: datetime.datetime | None = None,
    ) -> Booking:
        raise booking_status_service.IllegalTransition(
            current=BookingStatus.CONFIRMED, target=target
        )

    monkeypatch.setattr(booking_status_service, "change_status", refuse)

    turn = chat.say(value="yes")

    assert [booking.id for booking in _live_bookings(db)] == [original.id]
    assert turn.reply == render("CANNOT_CONTINUE", "en")
    assert turn.flag_reason is FlagReason.STUCK


def test_a_guardian_with_no_upcoming_sessions_is_told_so_rather_than_flagged(
    chat: Chat, client: ClientWorld, cutoff: Callable[[int], None]
) -> None:
    chat.say("hi")

    turn = chat.say("cancel my session", intent=BotIntent.CANCEL)

    assert render("NO_UPCOMING", "en") in turn.reply
    assert turn.flag_reason is None
    assert chat.step == bot_service.STEP_MENU


# --- reading natural replies, and specific re-prompts -------------------------------------------


@pytest.mark.parametrize(
    "answer", ["Yes please", "go ahead", "Sounds good!", "yes, thank you", "Of course"]
)
def test_a_common_way_of_saying_yes_is_read_as_yes(chat: Chat, answer: str) -> None:
    _answer_up_to_the_notes(chat)
    chat.say(value="none")

    turn = chat.say(value=answer)

    assert turn.reply == render("ASK_CHILD_REGISTERED", "en")
    assert chat.step == bot_service.STEP_CHILD_REGISTERED


@pytest.mark.parametrize("answer", ["No thanks", "no, thank you", "Not now.", "not right now"])
def test_a_common_way_of_saying_no_is_read_as_no(chat: Chat, answer: str) -> None:
    _answer_up_to_the_notes(chat)
    chat.say(value="none")

    turn = chat.say(value=answer)

    assert turn.reply.startswith(render("EVALUATION_NOTICE", "en"))
    assert chat.step == bot_service.STEP_REMINDERS_OPT_IN


@pytest.mark.parametrize("pick", ["2", "Blaise"])
def test_a_tutor_is_chosen_by_number_or_by_a_unique_name(
    chat: Chat, world: BotWorld, client: ClientWorld, pick: str
) -> None:
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)

    turn = chat.say(value=pick)

    assert turn.reply == render("ASK_DATE", "en")
    assert chat.state.collected_data["book_tutor_id"] == str(world.second_tutor_id)


def test_an_option_number_outside_the_list_says_which_numbers_it_can_take(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)

    turn = chat.say(value="7")

    assert turn.reply == (
        "Please reply with a number from 1 to 3:\n"
        f"1. {world.first_tutor_name}\n2. {world.second_tutor_name}\n"
        f"3. {render('ANY_TUTOR_LABEL', 'en')}"
    )
    assert chat.step == bot_service.STEP_BOOK_TUTOR
    assert chat.state.misses == 1


def test_a_name_the_parser_numbered_at_the_child_list_still_finds_the_inactive_match(
    chat: Chat, db: Session
) -> None:
    """The choice kind asks the parser for the option's number, so "Sam" arrives as `1` with
    the name under `child_name`. An active Sam Lee and an inactive Sam Smith must not book
    Sam Lee (REQ-132.5)."""
    _family(db, active=("Ann Lee", "Sam Lee"), inactive=("Sam Smith",))
    _reach_book_child(chat)

    turn = chat.say("Sam", value="2", fields={bot_service.STEP_CHILD_NAME: "Sam"})

    assert turn.reply == f"{render('AMBIGUOUS_CHILD', 'en')}\n1. Ann Lee\n2. Sam Lee"
    assert chat.step == bot_service.STEP_BOOK_CHILD
    assert "Sam Smith" not in turn.reply


def test_a_numbered_inactive_child_name_is_offered_reactivation_not_the_active_lookalike(
    chat: Chat, db: Session
) -> None:
    """SA-33 through the parser's realistic output: inactive "Tom" beside active "Tommy"."""
    _family(db, active=("Ann Lee", "Tommy Lee"), inactive=("Tom Lee",))
    _reach_book_child(chat)

    turn = chat.say("Tom", value="2", fields={bot_service.STEP_CHILD_NAME: "Tom"})

    assert turn.reply == _offer_for("Tom Lee")
    assert chat.step == bot_service.STEP_REACTIVATION_CONFIRM


def test_a_unicode_digit_at_a_choice_step_re_prompts_rather_than_crashing(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)

    turn = chat.say(value="\u00b2")

    assert turn.reply.startswith(_nudge(bot_service.STEP_BOOK_TUTOR))
    assert chat.step == bot_service.STEP_BOOK_TUTOR


def test_a_punctuated_no_skips_the_home_label(chat: Chat, db: Session) -> None:
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")
    chat.say(value="1234")

    chat.say(value="No, thanks!")

    assert "home_label" not in chat.state.collected_data


def test_a_punctuated_none_stores_no_notes(chat: Chat, db: Session) -> None:
    _answer_up_to_the_notes(chat)

    chat.say(value="Nothing.")

    assert db.execute(select(Child)).scalar_one().notes is None


# Every step, with the question that leads to it. A choice step's question carries one option,
# which its nudge must list again.
_STEP_PROMPTS = {
    bot_service.STEP_INTAKE_NAME: render("ASK_GUARDIAN_NAME", "en"),
    bot_service.STEP_INTAKE_ADDRESS: render("ASK_ADDRESS", "en"),
    bot_service.STEP_INTAKE_ACCESS_CODE: render("ASK_ACCESS_CODE", "en"),
    bot_service.STEP_INTAKE_LABEL: render("ASK_HOME_LABEL", "en"),
    bot_service.STEP_CHILD_REGISTERED: render("ASK_CHILD_REGISTERED", "en"),
    bot_service.STEP_CHILD_NAME: render("ASK_CHILD_NAME", "en"),
    bot_service.STEP_CHILD_DOB: render("ASK_CHILD_DOB", "en"),
    bot_service.STEP_CHILD_SCHOOL: render("ASK_CHILD_SCHOOL", "en"),
    bot_service.STEP_CHILD_GRADE: render("ASK_CHILD_GRADE", "en", name="Sam"),
    bot_service.STEP_CHILD_NOTES: render("ASK_CHILD_NOTES", "en"),
    bot_service.STEP_CHILD_MORE: render("ASK_MORE_CHILDREN", "en"),
    bot_service.STEP_REMINDERS_OPT_IN: render("ASK_REMINDERS", "en"),
    bot_service.STEP_MENU: render("ASK_MENU", "en"),
    bot_service.STEP_BOOK_CHILD: f"{render('ASK_WHICH_CHILD', 'en')}\n1. Option",
    bot_service.STEP_BOOK_SUBJECT: f"{render('ASK_SUBJECT', 'en')}\n1. Option",
    bot_service.STEP_BOOK_TUTOR: f"{render('ASK_TUTOR', 'en')}\n1. Option",
    bot_service.STEP_BOOK_DATE: render("ASK_DATE", "en"),
    bot_service.STEP_BOOK_HOME: f"{render('ASK_WHERE', 'en')}\n1. Option",
    bot_service.STEP_BOOK_SLOT: "These times are available on Tuesday, October 14:\n1. Option",
    bot_service.STEP_BOOK_CONFIRM: "To confirm: Option on Tuesday, October 14. Should I book it?",
    bot_service.STEP_FIRST_SESSION_SUBJECT: f"{render('ASK_SUBJECT', 'en')}\n1. Option",
    bot_service.STEP_FIRST_SESSION_DATE: render("ASK_DATE", "en"),
    bot_service.STEP_CANCEL_PICK: f"{render('ASK_WHICH_TO_CANCEL', 'en')}\n1. Option",
    bot_service.STEP_CANCEL_CONFIRM: "Cancel Sam's session on Tuesday, October 14, 4:00-5:00 PM? Please reply yes or no.",
    bot_service.STEP_RESCHEDULE_PICK: f"{render('ASK_WHICH_TO_MOVE', 'en')}\n1. Option",
    bot_service.STEP_REACTIVATION_CONFIRM: render("REACTIVATION_OFFER", "en", name="Sam Jones"),
}

# Enough of every step's required keys for the flow to resume; a low-confidence parse never
# reaches the handler, so none of them is read.
_PARKED_DATA = {
    "child_name": "Sam",
    "child_date_of_birth": DATE_OF_BIRTH.isoformat(),
    "child_school": "Test School",
    "book_child_id": str(uuid.uuid4()),
    "book_subject_id": str(uuid.uuid4()),
    "book_tutor_id": "",
    "book_home_id": str(uuid.uuid4()),
    "book_date": "2026-10-14",
    "chosen": "Option",
    "reactivation_child_id": str(uuid.uuid4()),
    "reactivation_child_name": "Sam Jones",
    "cancel_booking_id": str(uuid.uuid4()),
}


def test_every_step_has_a_nudge() -> None:
    steps = {value for name, value in vars(bot_service).items() if name.startswith("STEP_")}

    assert set(_STEP_PROMPTS) == steps
    assert all(_NUDGE_IDS.get(step, f"NUDGE_{step}") in bot_messages.MESSAGES for step in steps)


@pytest.mark.parametrize(("step", "prompt"), _STEP_PROMPTS.items())
def test_a_re_prompt_rephrases_the_question_rather_than_repeating_it(
    chat: Chat, client: ClientWorld, step: str, prompt: str
) -> None:
    has_options = "\n1. " in prompt
    data: dict[str, object] = dict(_PARKED_DATA)
    if has_options:
        data["options"] = [{"id": str(uuid.uuid4()), "label": "Option"}]
    _park_at(chat, step, prompt=prompt, collected_data=data)

    turn = chat.say("hmm", value="something", confidence_is_low=True)

    expected = _nudge(step) + ("\n1. Option" if has_options else "")
    assert turn.reply == expected
    assert turn.reply != prompt
    assert chat.step == step
    assert chat.state.misses == 1


def test_two_nudges_then_the_third_unusable_reply_hands_off_to_staff(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")

    first = chat.say("eh?")
    second = chat.say("what")
    third = chat.say("?")

    assert [first.reply, second.reply] == [_nudge(bot_service.STEP_MENU)] * 2
    assert third.reply == render("BAILED_OUT", "en")
    assert third.flag_reason is FlagReason.STUCK
    assert chat.state.misses == 0


# --- small talk and questions at the menu ------------------------------------------------------


def test_small_talk_at_the_menu_gets_a_polite_reply_and_costs_no_re_prompt(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")

    turn = chat.say("thanks!", intent=BotIntent.CHIT_CHAT)

    assert turn.reply.endswith(render("ASK_MENU", "en"))
    assert turn.reply != render("ASK_MENU", "en")
    assert turn.flag_reason is None
    assert chat.step == bot_service.STEP_MENU
    assert chat.state.misses == 0


def test_small_talk_neither_resets_nor_adds_to_a_miss_already_counted(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("eh?")

    chat.say("hi again", intent=BotIntent.CHIT_CHAT)

    assert chat.state.misses == 1


def test_three_rounds_of_small_talk_in_a_row_never_bail_out(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")

    turns = [chat.say(body, intent=BotIntent.CHIT_CHAT) for body in ("thanks", "ok", "great")]

    assert all(turn.reply != render("BAILED_OUT", "en") for turn in turns)
    assert all(turn.flag_reason is None for turn in turns)
    assert chat.step == bot_service.STEP_MENU


def test_a_question_at_the_menu_is_passed_to_the_office_and_flagged(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("eh?")

    turn = chat.say("how much is a session?", intent=BotIntent.QUESTION)

    assert turn.reply == (
        "I'm not able to answer that here, so I've passed your question to our office and "
        "someone will be in touch shortly. " + render("ASK_MENU", "en")
    )
    assert turn.flag_reason is FlagReason.QUESTION
    assert chat.step == bot_service.STEP_MENU
    assert chat.state.misses == 1


def test_an_unreadable_message_after_small_talk_still_counts_as_a_miss(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("thanks", intent=BotIntent.CHIT_CHAT)

    turn = chat.say("?")

    assert turn.reply == _nudge(bot_service.STEP_MENU)
    assert chat.state.misses == 1


def test_small_talk_away_from_the_menu_is_nudged_like_any_unusable_reply(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("I'd like to book", intent=BotIntent.BOOK)
    assert chat.step == bot_service.STEP_BOOK_SUBJECT

    turn = chat.say("thanks!", intent=BotIntent.CHIT_CHAT)

    assert turn.reply.startswith(_nudge(bot_service.STEP_BOOK_SUBJECT))
    assert chat.state.misses == 1


# --- the bail-out and the parser outage (REQ-078) -----------------------------------------------


def test_two_failed_re_prompts_flag_stuck_and_leave_the_flow_where_it_was(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    """REQ-078.2 and acceptance criterion 8. The state survives so the parent resumes
    mid-flow rather than starting over — a bail-out is a handover, not a reset."""
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    collected_before = dict(chat.state.collected_data)

    first = chat.say("???")
    second = chat.say("????")
    third = chat.say("the blue one")

    assert first.flag_reason is None
    assert second.flag_reason is None
    assert second.reply.startswith(_nudge(bot_service.STEP_BOOK_SUBJECT))
    assert third.flag_reason is FlagReason.STUCK
    assert third.reply == render("BAILED_OUT", "en")
    assert chat.step == bot_service.STEP_BOOK_SUBJECT
    assert chat.state.collected_data == collected_before


def test_a_usable_message_after_the_bail_out_resumes_mid_flow(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say("???")
    chat.say("????")
    chat.say("still no")

    turn = chat.say(value=world.subject_name)

    assert render("ASK_TUTOR", "en") in turn.reply
    assert chat.step == bot_service.STEP_BOOK_TUTOR
    assert chat.state.misses == 0


def test_the_bail_out_resets_the_miss_counter_so_the_next_stretch_re_prompts_again(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    """`stuck` means two failed re-prompts in a row (docs/erd.md), so after the bail-out the
    parent gets a fresh two re-prompts before the next flag, not an instant one."""
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    collected_before = dict(chat.state.collected_data)
    chat.say("???")
    chat.say("????")
    bailed = chat.say("still no")

    assert bailed.flag_reason is FlagReason.STUCK
    assert chat.state.misses == 0
    assert chat.step == bot_service.STEP_BOOK_SUBJECT
    assert chat.state.collected_data == collected_before

    first = chat.say("hmm")
    second = chat.say("hmmm")
    third = chat.say("hmmmm")

    assert [first.flag_reason, second.flag_reason] == [None, None]
    assert first.reply.startswith(_nudge(bot_service.STEP_BOOK_SUBJECT))
    assert second.reply.startswith(_nudge(bot_service.STEP_BOOK_SUBJECT))
    assert third.reply == render("BAILED_OUT", "en")
    assert third.flag_reason is FlagReason.STUCK


def test_a_low_confidence_parse_re_prompts_rather_than_acting_on_a_guess(
    chat: Chat, world: BotWorld, client: ClientWorld
) -> None:
    """#27's standing warning. A misparse books the wrong child into the wrong slot, and the
    model's own uncertainty signal is cheaper to act on than that is to undo."""
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)

    turn = chat.say(
        "the tuesday one but later if she can",
        value=world.subject_name,
        confidence_is_low=True,
    )

    assert turn.reply.startswith(_nudge(bot_service.STEP_BOOK_SUBJECT))
    assert chat.step == bot_service.STEP_BOOK_SUBJECT
    assert chat.state.misses == 1


def test_a_parse_failure_flags_parse_error_without_burning_a_re_prompt(
    chat: Chat, client: ClientWorld
) -> None:
    """REQ-078.3 and acceptance criterion 9. A parser outage is not the parent failing to be
    understood, so it flags on the first occurrence and the counter is untouched."""
    chat.say("hi")
    before = chat.state

    turn = chat.say("book me in", fails=True)

    assert turn.flag_reason is FlagReason.PARSE_ERROR
    assert turn.reply == render("PARSER_UNAVAILABLE", "en")
    assert chat.state == before


def test_three_parse_failures_still_never_reach_the_stuck_bail_out(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")

    reasons = [chat.say("x", fails=True).flag_reason for _ in range(3)]

    assert reasons == [FlagReason.PARSE_ERROR] * 3
    assert chat.state.misses == 0


# --- diagnostic logging: metadata only ----------------------------------------------------------


def _warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == bot_service.__name__ and record.levelno == logging.WARNING
    ]


def test_a_parse_failure_logs_the_step_and_the_reason_but_not_the_body(
    chat: Chat, client: ClientWorld, caplog: pytest.LogCaptureFixture
) -> None:
    chat.say("hi")
    caplog.set_level(logging.WARNING, logger=bot_service.__name__)

    turn = chat.say("SECRET-BODY", fails=True)

    [message] = _warnings(caplog)
    assert chat.state is not None
    assert chat.state.step in message
    assert "scripted outage" in message
    assert "SECRET-BODY" not in message
    assert turn.flag_reason is FlagReason.PARSE_ERROR


def test_a_low_confidence_miss_logs_its_metadata_and_no_values(
    chat: Chat, world: BotWorld, client: ClientWorld, caplog: pytest.LogCaptureFixture
) -> None:
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    caplog.set_level(logging.WARNING, logger=bot_service.__name__)

    chat.say(
        "SECRET-BODY",
        value="SECRET-VALUE",
        fields={"zeta_field": "SECRET-VALUE", "alpha_field": "SECRET-VALUE"},
        intent=BotIntent.BOOK,
        confidence_is_low=True,
    )

    [message] = _warnings(caplog)
    assert bot_service.STEP_BOOK_SUBJECT in message
    assert "intent=book" in message
    assert "confidence_is_low=True" in message
    assert "['alpha_field', 'zeta_field']" in message
    assert "answer=present" in message
    assert "misses=1" in message
    assert "SECRET" not in message


def test_a_handler_rejected_miss_logs_an_empty_answer_and_the_bail_out_count(
    chat: Chat, caplog: pytest.LogCaptureFixture
) -> None:
    _answer_up_to_the_child_name(chat)
    caplog.set_level(logging.WARNING, logger=bot_service.__name__)

    chat.say("SECRET-BODY", value="99999999999")
    chat.say("SECRET-BODY", value="99999999999")
    chat.say("SECRET-BODY", value=None)

    messages = _warnings(caplog)
    assert len(messages) == 3
    assert [f"misses={count}" in message for count, message in enumerate(messages, 1)] == [True] * 3
    assert "answer=present" in messages[0]
    assert "answer=empty" in messages[2]
    assert "confidence_is_low=False" in messages[2]
    assert not any("SECRET" in message or "99999999999" in message for message in messages)


def test_a_successful_turn_logs_no_warning(
    chat: Chat, client: ClientWorld, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING, logger=bot_service.__name__)

    chat.say("hi")

    assert _warnings(caplog) == []


# --- TTL expiry (REQ-076) -----------------------------------------------------------------------


def test_an_expired_flow_restarts_with_no_stale_collected_data(
    chat: Chat, client: ClientWorld
) -> None:
    """REQ-076.1 and acceptance criterion 10. Expiry mid-flow is the normal case: the parent
    put their phone down. It restarts, it does not error, and it carries nothing forward."""
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    _expire_flow_state(chat.db, phone_number=chat.phone_number)

    turn = chat.say("hello again")

    assert render("ASK_MENU", "en") in turn.reply
    assert chat.step == bot_service.STEP_MENU
    assert chat.state.collected_data == {}
    assert turn.flag_reason is None


@pytest.mark.parametrize("step", ["a_step_that_was_removed", "child_age"])
def test_a_state_naming_a_step_this_build_does_not_know_restarts_cleanly(
    chat: Chat, client: ClientWorld, step: str
) -> None:
    """A rolling deploy can leave a renamed step in a live row — `child_age` is exactly that,
    from the build before date of birth replaced it. It restarts rather than raising, which is
    the same treatment REQ-076 gives an expired one."""
    save_state(
        chat.db,
        phone_number=chat.phone_number,
        state=FlowState(step=step, collected_data={"stale": "value"}),
    )

    turn = chat.say("are you there?")

    assert chat.step == bot_service.STEP_MENU
    assert chat.state.collected_data == {}
    assert render("ASK_MENU", "en") in turn.reply


def test_a_step_needing_a_guardian_restarts_rather_than_raising(chat: Chat) -> None:
    """A stored `menu` for a number with no client row — a turn whose commit failed, or a
    client an admin removed. Every step after intake dereferences the guardian, so this has to
    restart rather than raise: a raise here is a 500 and a Twilio retry loop."""
    save_state(chat.db, phone_number=chat.phone_number, state=FlowState(step=bot_service.STEP_MENU))

    turn = chat.say("still here")

    assert chat.step == bot_service.STEP_INTAKE_NAME
    assert render("ASK_GUARDIAN_NAME", "en") in turn.reply


def test_a_state_on_the_grade_step_resumes_at_the_grade_answer(
    chat: Chat, client: ClientWorld
) -> None:
    save_state(
        chat.db,
        phone_number=chat.phone_number,
        state=FlowState(
            step=bot_service.STEP_CHILD_GRADE,
            collected_data={
                "child_name": "Sam",
                "child_date_of_birth": DATE_OF_BIRTH.isoformat(),
                "child_school": "Lincoln Elementary",
            },
        ),
    )

    turn = chat.say(value="5")

    assert chat.step == bot_service.STEP_CHILD_NOTES
    assert chat.state.collected_data["child_grade"] == 5
    assert turn.reply == render("ASK_CHILD_NOTES", "en")


def test_a_child_notes_state_written_before_the_grade_was_dropped_still_completes(
    chat: Chat, client: ClientWorld, db: Session
) -> None:
    save_state(
        chat.db,
        phone_number=chat.phone_number,
        state=FlowState(
            step=bot_service.STEP_CHILD_NOTES,
            collected_data={
                "child_name": "Sam",
                "child_date_of_birth": DATE_OF_BIRTH.isoformat(),
                "child_grade": "5",
                "child_school": "Lincoln Elementary",
            },
        ),
    )

    chat.say(value="none")

    child = db.execute(select(Child).where(Child.name == "Sam")).scalar_one()

    assert chat.step == bot_service.STEP_CHILD_MORE
    assert child.grade_level is None


def test_a_state_with_a_payload_missing_a_key_its_handler_reads_restarts_visibly(
    chat: Chat, client: ClientWorld, caplog: pytest.LogCaptureFixture
) -> None:
    """A genuinely stale payload rather than a synthetic one: `child_notes` is a step this
    build still knows, for a guardian who still exists, but its handler now reads
    `child_date_of_birth` and this state — written by the build that asked how old the child
    was — never carried it. Trusting the step name alone would raise `KeyError`; this restarts
    the flow instead, and logs it, so the recovery is not indistinguishable from a bug."""
    save_state(
        chat.db,
        phone_number=chat.phone_number,
        state=FlowState(
            step=bot_service.STEP_CHILD_NOTES,
            collected_data={
                "child_name": "Sam",
                "child_age": "10",
                "child_grade": "5",
                "child_school": "Lincoln Elementary",
            },
        ),
    )

    with caplog.at_level(logging.WARNING, logger=bot_service.__name__):
        turn = chat.say(value="none")

    assert chat.step == bot_service.STEP_MENU
    assert chat.state.collected_data == {}
    assert render("ASK_MENU", "en") in turn.reply
    assert "restarting a stale flow" in caplog.text
    assert "child_date_of_birth" in caplog.text


# --- attributing a recognised guardian's thread (D-P7-15, REQ-075.7) ---------------------------


def test_a_guardian_recognised_by_phone_is_reported_for_linking_on_every_turn(
    chat: Chat, db: Session
) -> None:
    """D-P7-15. A client created outside the bot used to chat as a bare phone number for ever:
    only intake reported `link_guardian_id`. Reported on every turn, not only the first, so a
    thread whose opening turn failed to commit is still attributed by the next one."""
    detail = client_service.create_client(
        db,
        name="Ada Guardian",
        phone_number=CANONICAL_NUMBER,
        home=client_service.HomeInput(label="Home", address="1 Test Street", access_code="1234"),
    )

    opening = chat.say("hi")
    later = chat.say("book", intent=BotIntent.BOOK)
    missed = chat.say("???")

    assert opening.link_guardian_id == detail.client.id
    assert later.link_guardian_id == detail.client.id
    assert missed.link_guardian_id == detail.client.id


def test_a_thread_already_carrying_its_guardian_is_not_re_linked(
    chat: Chat, client: ClientWorld
) -> None:
    chat.guardian_id = client.guardian_id

    opening = chat.say("hi")
    later = chat.say("book", intent=BotIntent.BOOK)

    assert opening.link_guardian_id is None
    assert later.link_guardian_id is None


def test_an_unknown_number_is_not_linked_to_anyone(chat: Chat, client: ClientWorld) -> None:
    chat.phone_number = "+12025550199"

    opening = chat.say("hi")
    later = chat.say(value="Someone New")

    assert opening.link_guardian_id is None
    assert later.link_guardian_id is None


def test_a_parser_outage_still_attributes_a_recognised_guardian(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")

    turn = chat.say("book me in", fails=True)

    assert turn.flag_reason is FlagReason.PARSE_ERROR
    assert turn.link_guardian_id == client.guardian_id


# --- reactivation requests (REQ-132) -------------------------------------------------------------


@pytest.mark.parametrize("intent", [BotIntent.BOOK, BotIntent.UNKNOWN])
def test_naming_an_inactive_child_at_the_menu_offers_reactivation(
    chat: Chat, db: Session, intent: BotIntent
) -> None:
    """REQ-132.2(a), .3 — criteria 2 and 3: "is Sam still with you?" is `unknown`, and still
    the guardian naming Sam."""
    family = _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")

    turn = _name_at_menu(chat, "Sam", intent=intent)

    assert turn.reply == _offer_for("Sam Jones")
    assert chat.step == bot_service.STEP_REACTIVATION_CONFIRM
    assert chat.state.collected_data["reactivation_child_id"] == str(
        family.children["Sam Jones"].id
    )
    assert turn.reactivation_child_id is None
    assert turn.flag_reason is None


def test_yes_to_the_offer_returns_the_child_for_the_webhook_to_record(
    chat: Chat, db: Session
) -> None:
    """REQ-132.3. The bot only reports the request (P7-C) and never reactivates the child
    itself (P7D-C); the flow ends."""
    family = _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    sam = family.children["Sam Jones"]
    chat.say("hi")
    _name_at_menu(chat, "Sam")

    turn = chat.say(value="yes")

    assert turn.reply == render("REACTIVATION_REQUESTED", "en", name="Sam Jones")
    assert turn.reactivation_child_id == sam.id
    assert turn.flag_reason is None
    assert chat.step is None
    assert sam.is_active is False


def test_no_to_the_offer_goes_back_to_the_menu_and_records_nothing(chat: Chat, db: Session) -> None:
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")
    _name_at_menu(chat, "Sam")

    turn = chat.say(value="no")

    assert turn.reply == render("ASK_MENU", "en")
    assert chat.step == bot_service.STEP_MENU
    assert turn.reactivation_child_id is None
    assert turn.flag_reason is None
    assert _reactivation_keys(chat) == set()


def test_an_unclear_answer_to_the_offer_re_prompts_and_keeps_the_offer(
    chat: Chat, db: Session
) -> None:
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")
    _name_at_menu(chat, "Sam")

    turn = chat.say(value="maybe later")

    assert turn.reply == _nudge(bot_service.STEP_REACTIVATION_CONFIRM)
    assert chat.step == bot_service.STEP_REACTIVATION_CONFIRM
    assert _reactivation_keys(chat) == {"reactivation_child_id", "reactivation_child_name"}


def test_naming_an_inactive_child_while_cancelling_takes_the_cancel_path(
    chat: Chat, db: Session
) -> None:
    """Criterion 3: cancel, reschedule and link-guardian never trigger an offer (§4a)."""
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")

    turn = _name_at_menu(chat, "Sam", intent=BotIntent.CANCEL)

    assert turn.reply == f"{render('NO_UPCOMING', 'en')} {render('ASK_MENU', 'en')}"
    assert chat.step == bot_service.STEP_MENU


@pytest.mark.parametrize(
    ("answer", "picked"),
    [("2", "Ben Cole"), ("Ann", "Ann Lee")],
)
def test_the_child_question_still_picks_an_active_child_as_before(
    chat: Chat, db: Session, world: BotWorld, answer: str, picked: str
) -> None:
    """REQ-132.4 — criterion 4's "as today" half: a position and an active child's name."""
    family = _family(db, active=("Ann Lee", "Ben Cole"), inactive=("Sam Jones",))
    _reach_book_child(chat)

    turn = chat.say(value=answer)

    assert turn.reply.startswith(render("ASK_SUBJECT", "en"))
    assert chat.state.collected_data["book_child_id"] == str(family.children[picked].id)


@pytest.mark.parametrize(
    "active",
    [("Ann Lee", "Ben Cole"), ("Samantha Cole", "Ben Cole")],
)
def test_naming_an_inactive_child_at_the_child_question_offers_reactivation(
    chat: Chat, db: Session, active: tuple[str, str]
) -> None:
    """REQ-132.2(b) — criterion 4. With an active "Samantha" offered, "Sam" still offers Sam:
    the exact check runs before `_chosen`, whose substring match would pick Samantha."""
    _family(db, active=active, inactive=("Sam Jones",))
    _reach_book_child(chat)

    turn = chat.say(value="Sam")

    assert turn.reply == _offer_for("Sam Jones")
    assert chat.step == bot_service.STEP_REACTIVATION_CONFIRM


def test_a_returning_guardian_naming_an_inactive_child_at_the_name_question_is_offered_it(
    chat: Chat, db: Session
) -> None:
    """REQ-132.2(c), .7 — criterion 5: the offer instead of a duplicate registration, and a
    "no" writes no `children` row."""
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    _park_at(chat, bot_service.STEP_CHILD_NAME, prompt=render("ASK_CHILD_NAME", "en"))
    children_before = _count(db, Child)

    offer = chat.say(value="Sam")
    declined = chat.say(value="no")

    assert offer.reply == _offer_for("Sam Jones")
    assert declined.reply == render("ASK_MENU", "en")
    assert "child_name" not in chat.state.collected_data
    assert _count(db, Child) == children_before


def test_a_name_matching_none_of_the_guardians_children_continues_the_registration(
    chat: Chat, db: Session
) -> None:
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    _park_at(chat, bot_service.STEP_CHILD_NAME, prompt=render("ASK_CHILD_NAME", "en"))

    turn = chat.say(value="Tom")

    assert turn.reply == render("ASK_CHILD_DOB", "en")
    assert chat.state.collected_data["child_name"] == "Tom"


def test_a_new_guardian_is_never_offered_another_familys_inactive_child(
    chat: Chat, db: Session
) -> None:
    """Criterion 5's last case: a new guardian has no children to match, and another family's
    inactive Sam is never a candidate."""
    _family(db, inactive=("Sam Jones",), phone_number="+12025550187")

    _answer_up_to_the_child_name(chat)

    assert chat.replies[-1].reply == render("ASK_CHILD_DOB", "en")
    assert chat.state.collected_data["child_name"] == "Sam"


def test_two_inactive_matches_at_the_menu_ask_which_child_and_then_re_prompt(
    chat: Chat, db: Session
) -> None:
    """REQ-132.5, OQ-78 — criterion 6. No child is picked by an ambiguous name: the child
    question is asked even with one active child, it lists active children only, and the same
    ambiguous name at it is a re-prompt."""
    _family(db, active=("Ann Lee",), inactive=("Sam Jones", "Sam Smith"))
    chat.say("hi")

    asked = _name_at_menu(chat, "Sam")
    again = chat.say(value="Sam")

    assert asked.reply == f"{render('ASK_WHICH_CHILD', 'en')}\n1. Ann Lee"
    assert chat.step == bot_service.STEP_BOOK_CHILD
    assert again.reply == f"{render('AMBIGUOUS_CHILD', 'en')}\n1. Ann Lee"
    assert all("Sam " not in reply.reply for reply in chat.replies)


def test_an_active_and_an_inactive_match_at_the_child_question_re_prompt(
    chat: Chat, db: Session
) -> None:
    _family(db, active=("Ann Lee", "Sam Lee"), inactive=("Sam Jones",))
    _reach_book_child(chat)

    turn = chat.say(value="Sam")

    assert turn.reply == f"{render('AMBIGUOUS_CHILD', 'en')}\n1. Ann Lee\n2. Sam Lee"
    assert chat.step == bot_service.STEP_BOOK_CHILD


@pytest.mark.parametrize("point", ["menu", "book_child"])
def test_the_full_name_resolves_an_ambiguous_first_name(
    chat: Chat, db: Session, point: str
) -> None:
    _family(db, active=("Ann Lee", "Sam Lee"), inactive=("Sam Jones",))

    if point == "menu":
        chat.say("hi")
        turn = _name_at_menu(chat, "Sam Jones")
    else:
        _reach_book_child(chat)
        turn = chat.say(value="Sam Jones")

    assert turn.reply == _offer_for("Sam Jones")


@pytest.mark.parametrize("named", ["Ben Park", "Sam Jones"])
@pytest.mark.parametrize("point", ["menu", "book_child", "child_name"])
def test_a_second_request_is_refused_while_one_is_pending(
    chat: Chat, db: Session, named: str, point: str
) -> None:
    """REQ-132.6, OQ-74 — criterion 7, bot level. With Sam's request pending, naming inactive
    Ben — or Sam again — at any detection point is refused with no question asked, nothing to
    record and no flag; the refusal names no child."""
    _family(db, active=("Ann Lee", "Cleo Hart"), inactive=("Ben Park", "Sam Jones"))
    chat.reactivation_pending = True

    if point == "menu":
        chat.say("hi")
        turn = _name_at_menu(chat, named)
    elif point == "book_child":
        _reach_book_child(chat)
        turn = chat.say(value=named)
    else:
        _park_at(chat, bot_service.STEP_CHILD_NAME, prompt=render("ASK_CHILD_NAME", "en"))
        turn = chat.say(value=named)

    assert turn.reply == f"{render('REACTIVATION_PENDING', 'en')} {render('ASK_MENU', 'en')}"
    assert chat.step == bot_service.STEP_MENU
    assert turn.reactivation_child_id is None
    assert turn.flag_reason is None
    assert _reactivation_keys(chat) == set()


def test_a_request_that_became_pending_since_the_offer_is_refused_at_the_yes(
    chat: Chat, db: Session
) -> None:
    """Criterion 8 — REQ-132.6's "the same holds when a request becomes pending between the
    offer and the yes"."""
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")
    _name_at_menu(chat, "Sam")
    chat.reactivation_pending = True

    turn = chat.say(value="yes")

    assert turn.reply == f"{render('REACTIVATION_PENDING', 'en')} {render('ASK_MENU', 'en')}"
    assert chat.step == bot_service.STEP_MENU
    assert turn.reactivation_child_id is None
    assert turn.flag_reason is None
    assert _reactivation_keys(chat) == set()


def test_a_child_reactivated_since_the_offer_needs_nothing_asked(chat: Chat, db: Session) -> None:
    """Criterion 8 — REQ-132.3's last sentence."""
    family = _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")
    _name_at_menu(chat, "Sam")
    family.children["Sam Jones"].is_active = True
    db.flush()

    turn = chat.say(value="yes")

    assert turn.reply == (
        f"{render('REACTIVATION_NOT_NEEDED', 'en', name='Sam Jones')} {render('ASK_MENU', 'en')}"
    )
    assert chat.step == bot_service.STEP_MENU
    assert turn.reactivation_child_id is None


def test_a_child_unlinked_since_the_offer_is_stuck_rather_than_requested(
    chat: Chat, db: Session
) -> None:
    """Criterion 8: the "yes" re-reads the child through this guardian's links, so a child that
    is no longer theirs is never asked about on their behalf."""
    family = _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")
    _name_at_menu(chat, "Sam")
    db.delete(
        db.execute(
            select(ChildGuardian).where(ChildGuardian.child_id == family.children["Sam Jones"].id)
        ).scalar_one()
    )
    db.flush()

    turn = chat.say(value="yes")

    assert turn.reply == render("CANNOT_CONTINUE", "en")
    assert turn.flag_reason is FlagReason.STUCK
    assert turn.reactivation_child_id is None


def test_a_guardian_whose_children_are_all_inactive_is_offered_one_named_at_registration(
    chat: Chat, db: Session
) -> None:
    """REQ-132.7, SA-27 — criterion 9: `NO_ACTIVE_CHILDREN`, then the name question recognises
    the returning child instead of registering a duplicate."""
    _family(db, inactive=("Sam Jones",))
    chat.say("hi")

    booked = chat.say("book", intent=BotIntent.BOOK)
    registered = chat.say(value="no")
    named = chat.say(value="Sam")

    assert (
        booked.reply
        == f"{render('NO_ACTIVE_CHILDREN', 'en')} {render('ASK_CHILD_REGISTERED', 'en')}"
    )
    assert registered.reply == render("ASK_CHILD_NAME", "en")
    assert named.reply == _offer_for("Sam Jones")


def test_an_approved_child_is_offered_for_booking_like_any_active_child(
    chat: Chat, db: Session
) -> None:
    """Criterion 10: R0's approve makes the child active, and from the next turn it is an
    ordinary choice — listed, and never offered for reactivation again."""
    family = _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")
    _name_at_menu(chat, "Sam")
    requested = chat.say(value="yes")
    conversation = Conversation(
        phone_number=chat.phone_number,
        last_message_at=datetime.datetime.now(tz=datetime.UTC),
        reactivation_child_id=requested.reactivation_child_id,
    )
    db.add(conversation)
    db.flush()
    conversation_service.resolve_reactivation(db, conversation_id=conversation.id, approve=True)

    chat.say("hi")
    turn = _name_at_menu(chat, "Sam")

    assert family.children["Sam Jones"].is_active is True
    assert turn.reply == f"{render('ASK_WHICH_CHILD', 'en')}\n1. Ann Lee\n2. Sam Jones"


def test_a_stale_offer_missing_its_child_restarts_visibly(
    chat: Chat, db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    """Criterion 11 — the `_resumable` pattern for the new step, never a `KeyError`."""
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    _park_at(
        chat,
        bot_service.STEP_REACTIVATION_CONFIRM,
        prompt=_offer_for("Sam Jones"),
        collected_data={"reactivation_child_name": "Sam Jones"},
    )

    with caplog.at_level(logging.WARNING, logger=bot_service.__name__):
        turn = chat.say(value="yes")

    assert chat.step == bot_service.STEP_MENU
    assert chat.state.collected_data == {}
    assert render("ASK_MENU", "en") in turn.reply
    assert turn.reactivation_child_id is None
    assert "reactivation_child_id" in caplog.text


@pytest.mark.parametrize(
    ("named", "offered"),
    [("Olvia", True), ("Olva", False)],
)
def test_a_one_edit_typo_at_the_menu_offers_and_a_two_edit_one_does_not(
    chat: Chat, db: Session, world: BotWorld, named: str, offered: bool
) -> None:
    """REQ-132.9 — criterion 14."""
    _family(db, active=("Ann Lee",), inactive=("Olivia Brown",))
    chat.say("hi")

    turn = _name_at_menu(chat, named)

    if offered:
        assert turn.reply == _offer_for("Olivia Brown")
    else:
        assert turn.reply.startswith(render("ASK_SUBJECT", "en"))
        assert "Olivia" not in turn.reply


def test_a_typo_at_the_child_question_offers_when_nothing_is_picked(
    chat: Chat, db: Session
) -> None:
    """Criterion 15, first half."""
    _family(db, active=("Ann Lee", "Ben Cole"), inactive=("Olivia Brown",))
    _reach_book_child(chat)

    turn = chat.say(value="Olvia")

    assert turn.reply == _offer_for("Olivia Brown")


def test_a_pick_among_the_offered_children_beats_a_typo_on_an_inactive_one(
    chat: Chat, db: Session, world: BotWorld
) -> None:
    """SA-33 — criterion 15, second half: "Anna" is `_chosen`'s substring pick of Annabel and
    one edit from inactive Anne; the pick wins and Anne is never offered."""
    family = _family(db, active=("Annabel Hart", "Ben Cole"), inactive=("Anne Cole",))
    _reach_book_child(chat)

    turn = chat.say(value="Anna")

    assert turn.reply.startswith(render("ASK_SUBJECT", "en"))
    assert chat.state.collected_data["book_child_id"] == str(family.children["Annabel Hart"].id)


@pytest.mark.parametrize("point", ["menu", "book_child"])
def test_an_exact_active_match_beats_a_typo_on_an_inactive_child(
    chat: Chat, db: Session, world: BotWorld, point: str
) -> None:
    """§4a precedence — criterion 16: "Mark" is Mark Lee exactly, so Marc is never offered."""
    family = _family(db, active=("Mark Lee", "Ben Cole"), inactive=("Marc Jones",))

    if point == "menu":
        chat.say("hi")
        turn = _name_at_menu(chat, "Mark")

        assert turn.reply == f"{render('ASK_WHICH_CHILD', 'en')}\n1. Ben Cole\n2. Mark Lee"
    else:
        _reach_book_child(chat)
        turn = chat.say(value="Mark")

        assert turn.reply.startswith(render("ASK_SUBJECT", "en"))
        assert chat.state.collected_data["book_child_id"] == str(family.children["Mark Lee"].id)

    assert all("Marc" not in reply.reply for reply in chat.replies)


@pytest.mark.parametrize(
    ("named", "offered"),
    [("Sma", False), ("Sam", True)],
)
def test_a_short_name_matches_only_as_a_whole_word(
    chat: Chat, db: Session, world: BotWorld, named: str, offered: bool
) -> None:
    """OQ-81 — criterion 17: three characters are never typo-matched."""
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")

    turn = _name_at_menu(chat, named)

    if offered:
        assert turn.reply == _offer_for("Sam Jones")
    else:
        assert turn.reply.startswith(render("ASK_SUBJECT", "en"))


@pytest.mark.parametrize("named", ["Samuel", "Samual"])
def test_another_familys_inactive_child_never_matches_at_the_menu(
    chat: Chat, db: Session, world: BotWorld, named: str
) -> None:
    """Criterion 18: only this guardian's links are candidates, exactly or by a typo."""
    _family(db, active=("Ann Lee",))
    _family(db, inactive=("Samuel Park",), phone_number="+12025550187")
    chat.say("hi")

    turn = _name_at_menu(chat, named)

    assert turn.reply.startswith(render("ASK_SUBJECT", "en"))
    assert all("Samuel" not in reply.reply for reply in chat.replies)


def test_another_familys_inactive_child_never_matches_at_registration(
    chat: Chat, db: Session
) -> None:
    _family(db, active=("Ann Lee",))
    _family(db, inactive=("Samuel Park",), phone_number="+12025550187")
    _park_at(chat, bot_service.STEP_CHILD_NAME, prompt=render("ASK_CHILD_NAME", "en"))

    turn = chat.say(value="Samual")

    assert turn.reply == render("ASK_CHILD_DOB", "en")


def test_a_typo_hitting_an_active_and_an_inactive_child_picks_neither(
    chat: Chat, db: Session
) -> None:
    """OQ-78 through a typo — criterion 19: "Anni" is one edit from Anna and from Anne, so the
    child question lists Anna only, and "Anni" there is a re-prompt."""
    _family(db, active=("Anna Lee",), inactive=("Anne Cole",))
    chat.say("hi")

    asked = _name_at_menu(chat, "Anni")
    again = chat.say(value="Anni")

    assert asked.reply == f"{render('ASK_WHICH_CHILD', 'en')}\n1. Anna Lee"
    assert again.reply == f"{_nudge(bot_service.STEP_BOOK_CHILD)}\n1. Anna Lee"
    assert all("Anne" not in reply.reply for reply in chat.replies)


def test_no_to_a_typo_only_offer_at_registration_resumes_it_with_the_typed_name(
    chat: Chat, db: Session
) -> None:
    """SA-32, P7D-N — criterion 20: "Liam" beside an inactive "Lian" is as likely a sibling as
    a typo, so declining the offer registers Liam rather than costing the registration."""
    family = _family(db, inactive=("Lian Park",))
    _reach_returning_child_name(chat)

    offer = chat.say(value="Liam")
    offered_data = dict(chat.state.collected_data)
    resumed = chat.say(value="no")
    resumed_data = dict(chat.state.collected_data)
    chat.say(value=DATE_OF_BIRTH.isoformat())
    chat.say(value="Test School")
    chat.say(value="5")
    chat.say(value="none")

    liam = db.execute(select(Child).where(Child.name == "Liam")).scalar_one()

    assert offer.reply == _offer_for("Lian Park")
    assert offered_data["reactivation_resume_name"] == "Liam"
    assert resumed.reply == render("ASK_CHILD_DOB", "en")
    assert resumed.reactivation_child_id is None
    assert resumed_data["child_name"] == "Liam"
    assert not any(key.startswith("reactivation_") for key in resumed_data)
    assert liam.id != family.children["Lian Park"].id


def test_yes_to_a_typo_only_offer_at_registration_requests_that_child(
    chat: Chat, db: Session
) -> None:
    family = _family(db, inactive=("Lian Park",))
    _reach_returning_child_name(chat)
    chat.say(value="Liam")

    turn = chat.say(value="yes")

    assert turn.reply == render("REACTIVATION_REQUESTED", "en", name="Lian Park")
    assert turn.reactivation_child_id == family.children["Lian Park"].id


@pytest.mark.parametrize(
    ("named", "expected"),
    [
        ("Liam", render("ASK_CHILD_DOB", "en")),
        ("Lian Park", f"{render('REACTIVATION_PENDING', 'en')} {render('ASK_MENU', 'en')}"),
    ],
)
def test_while_pending_a_typo_at_registration_is_ignored_and_an_exact_name_refused(
    chat: Chat, db: Session, named: str, expected: str
) -> None:
    """SA-32 — criterion 20's pending half, the one scoped departure from OQ-74's refusal."""
    _family(db, inactive=("Lian Park",))
    _reach_returning_child_name(chat)
    chat.reactivation_pending = True

    turn = chat.say(value=named)

    assert turn.reply == expected
    assert turn.reactivation_child_id is None


def test_a_reactivation_request_never_touches_the_conversation_tables(
    chat: Chat, db: Session, executed_sql: list[str]
) -> None:
    """REQ-132.8, P7-C: the request travels back in the `BotTurn`; the webhook writes it."""
    _family(db, active=("Ann Lee",), inactive=("Sam Jones",))
    chat.say("hi")
    _name_at_menu(chat, "Sam")
    chat.say(value="yes")

    touched = [sql for sql in executed_sql if _mentions_a_chat_table(sql)]

    assert executed_sql != []
    assert touched == []


# --- P7-C and P7-T ------------------------------------------------------------------------------


def test_reply_for_never_reads_or_writes_the_conversation_tables(
    chat: Chat, executed_sql: list[str], world: BotWorld, client: ClientWorld
) -> None:
    """**P7-C**, acceptance criterion 2. The webhook owns those rows and applies the `BotTurn`;
    this module returning instead of writing is what removed its dependency on task D."""
    _book(chat, world)

    touched = [sql for sql in executed_sql if _mentions_a_chat_table(sql)]

    assert executed_sql != []
    assert touched == []


def test_bot_service_issues_no_query_filtered_by_a_bare_tutor_id(
    chat: Chat,
    orm_queries: list[OrmQuery],
    db: Session,
    world: BotWorld,
    client: ClientWorld,
    cutoff: Callable[[int], None],
) -> None:
    """**P7-T** leg 1 and acceptance criterion 14.

    Every read this module makes runs from the guardian's side. The `do_orm_execute` guard is
    never armed on the webhook's `Session`, so a tutor-scoped read here would fail silent-200
    with wrong data rather than loud-500 — this is the assertion standing in for the guard,
    and it is scoped to the statements this module's own frames emit.
    """
    _make_booking(db, world, client, date=DATE)
    _book(chat, world)
    chat.say("hi")
    chat.say("cancel", intent=BotIntent.CANCEL)

    ours = [query for query in orm_queries if query.origin == "bot_service.py"]
    scoped = [query for query in ours if "tutor_id" in query.filtered_columns]
    elsewhere = [
        query
        for query in orm_queries
        if query.origin != "bot_service.py" and "tutor_id" in query.filtered_columns
    ]

    assert ours != []
    assert scoped == []
    # The detector is not vacuous: the scoped paths this module delegates to filter on
    # `tutor_id` constantly, and the attribution is the only thing separating them.
    assert elsewhere != []


def test_the_booking_request_pairs_the_tutor_with_the_availability_it_owns(
    chat: Chat,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    world: BotWorld,
    client: ClientWorld,
) -> None:
    """**P7-T** criterion 13, first half. Both halves of the pair come off one `OpenSlot`, so
    they cannot be resolved from two different places and disagree."""
    real = booking_write_service.create_booking
    seen: list[booking_write_service.BookingRequest] = []

    def recording(
        session: Session,
        *,
        request: booking_write_service.BookingRequest,
        now: datetime.datetime,
    ) -> Booking:
        seen.append(request)

        return real(session, request=request, now=now)

    monkeypatch.setattr(booking_write_service, "create_booking", recording)

    _book(chat, world, tutor=world.second_tutor_name)

    request = seen[-1]
    availability = db.get(TutorAvailability, request.availability_id)

    assert len(seen) == 1
    assert request.user_id == user_id_of(db, world.second_tutor_id)
    assert request.kind is BookingKind.REGULAR
    assert request.location is BookingLocation.HOME
    assert availability.tutor_id == world.second_tutor_id


def test_a_mismatched_tutor_and_availability_pair_is_refused_by_rule_one(
    db: Session, world: BotWorld, client: ClientWorld
) -> None:
    """**P7-T** criterion 13, second half — the one that matters.

    This is the backstop the decision rests on, exercised deliberately rather than assumed: a
    `tutor_id` that does not own the `availability_id` it is booking into is refused loudly by
    rule 1, before anything is written, with no ORM-layer assertion in the picture at all.
    """
    request = booking_write_service.BookingRequest(
        child_id=client.child_id,
        user_id=user_id_of(db, world.first_tutor_id),
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=world.subject_id,
        availability_id=world.second_availability_id,
        home_id=client.home_id,
        scheduled_date=DATE,
        start_time=NINE,
        end_time=datetime.time(10, 0),
        booked_by_guardian_id=client.guardian_id,
        notes=None,
    )

    with pytest.raises(booking_write_service.OutsideAvailability):
        booking_write_service.create_booking(db, request=request, now=NOW)

    assert _count(db, Booking) == 0


def test_the_module_is_a_service_and_not_an_http_shell() -> None:
    """§4 and §6, acceptance criterion 12 — checked against the parsed module rather than its
    text, because the docstring discusses all three by name and a substring search would read
    the prose that forbids them as the thing itself."""
    tree = ast.parse(pathlib.Path(bot_service.__file__).read_text(encoding="utf-8"))
    imported = {
        node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)
    } | {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    called = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    named = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}

    assert not any(module.split(".")[0] == "fastapi" for module in imported)
    assert "HTTPException" not in named
    assert "commit" not in called


# --- world building -----------------------------------------------------------------------------


def _run_intake(chat: Chat, *, add_another: bool = False) -> list[BotTurn]:
    """The whole REQ-073 sequence: guardian name → home → child, ending at the child loop."""
    _answer_up_to_the_notes(chat)
    chat.say(value="Peanut allergy")
    chat.say(value="yes" if add_another else "no")

    return chat.replies


def _answer_up_to_the_notes(chat: Chat, *, date_of_birth: str = DATE_OF_BIRTH.isoformat()) -> None:
    """Every intake answer before the notes question, which is the one that writes."""
    _answer_up_to_the_grade(chat, date_of_birth=date_of_birth)
    chat.say(value="5")


def _answer_up_to_the_grade(chat: Chat, *, date_of_birth: str = DATE_OF_BIRTH.isoformat()) -> None:
    """Every intake answer before the Overall grade question."""
    _answer_up_to_the_child_name(chat)
    chat.say(value=date_of_birth)
    chat.say(value="Test School")


def _answer_up_to_the_child_name(chat: Chat) -> None:
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")
    chat.say(value="1234")
    chat.say(value="Home")
    chat.say(value="no")
    chat.say(value="Sam")


def _open_intake(chat: Chat) -> None:
    chat.say("hello?")


def _book(
    chat: Chat,
    world: BotWorld,
    *,
    tutor: str | None = None,
    stop_after_date: bool = False,
    stop_after_offer: bool = False,
) -> BotTurn:
    """The REQ-074 sequence for a returning guardian with one child and one home."""
    chat.say("hi")
    chat.say("I'd like to book a session", intent=BotIntent.BOOK)
    chat.say(value=world.subject_name)
    chat.say(value=tutor or render("ANY_TUTOR_LABEL", "en"))
    turn = chat.say(value=DATE.isoformat())

    if stop_after_date or stop_after_offer:
        return turn

    chat.say(value="1")

    return chat.say(value="yes")


def _name_at_menu(chat: Chat, name: str, *, intent: BotIntent = BotIntent.BOOK) -> BotTurn:
    """The parser giving a named child under RP's `child_name` field at the menu (§4a (a))."""
    return chat.say(f"{name} please", intent=intent, fields={bot_service.STEP_CHILD_NAME: name})


def _reach_book_child(chat: Chat) -> BotTurn:
    """Menu → "Which child is this for?", for a guardian with at least two active children."""
    chat.say("hi")

    return chat.say("book", intent=BotIntent.BOOK)


def _reach_returning_child_name(chat: Chat) -> None:
    """Menu → `NO_ACTIVE_CHILDREN` → the name question, for a guardian with no active child."""
    chat.say("hi")
    chat.say("book", intent=BotIntent.BOOK)
    chat.say(value="no")


def _park_at(
    chat: Chat, step: str, *, prompt: str, collected_data: dict[str, str] | None = None
) -> None:
    save_state(
        chat.db,
        phone_number=chat.phone_number,
        state=FlowState(step=step, collected_data=collected_data or {}, prompt=prompt),
    )


@pytest.mark.parametrize(
    ("answer", "next_step"),
    [
        ("No.", bot_service.STEP_REMINDERS_OPT_IN),
        ("no  !", bot_service.STEP_REMINDERS_OPT_IN),
        ("Yes ?", bot_service.STEP_CHILD_REGISTERED),
        ("YES!!", bot_service.STEP_CHILD_REGISTERED),
    ],
)
def test_a_yes_or_no_ignores_trailing_punctuation_and_extra_spaces(
    chat: Chat, client: ClientWorld, answer: str, next_step: str
) -> None:
    _park_at(chat, bot_service.STEP_CHILD_MORE, prompt=render("ASK_MORE_CHILDREN", "en"))

    chat.say(value=answer)

    assert chat.step == next_step


def _offer_for(name: str) -> str:
    return render("REACTIVATION_OFFER", "en", name=name)


def _reactivation_keys(chat: Chat) -> set[str]:
    return {key for key in chat.state.collected_data if key.startswith("reactivation_")}


def _family(
    db: Session,
    *,
    active: tuple[str, ...] = (),
    inactive: tuple[str, ...] = (),
    phone_number: str = CANONICAL_NUMBER,
) -> Family:
    names = [*active, *inactive]
    client = _make_client(db, phone_number=phone_number, child_name=names[0])
    children = {names[0]: db.get_one(Child, client.child_id)}

    for name in names[1:]:
        children[name] = _add_child(db, client, name=name)

    for name in inactive:
        children[name].is_active = False

    db.flush()

    return Family(client=client, children=children)


def _make_world(db: Session) -> BotWorld:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()

    first = _make_tutor(db, name="Ada Lovelace")
    second = _make_tutor(db, name="Blaise Pascal")

    for tutor in (first, second):
        db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=12))

    db.flush()

    return BotWorld(
        subject_id=subject.id,
        subject_name=subject.name,
        first_tutor_id=first.id,
        first_tutor_name=first.user.name,
        second_tutor_id=second.id,
        second_tutor_name=second.user.name,
        first_availability_id=_make_availability(db, first.id, date=DATE, start=NINE, end=TWELVE),
        second_availability_id=_make_availability(db, second.id, date=DATE, start=NINE, end=TWELVE),
    )


def _make_tutor(db: Session, *, name: str) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(
            email=f"tutor-{suffix}@example.com", name=f"{name} {suffix[:4]}", role=UserRole.TUTOR
        ),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()

    return tutor


def _make_tutor_for(db: Session, world: BotWorld, *, name: str) -> Tutor:
    tutor = _make_tutor(db, name=name)
    db.add(TutorSubject(tutor_id=tutor.id, subject_id=world.subject_id, max_grade_level=12))
    _make_availability(db, tutor.id, date=DATE, start=NINE, end=TWELVE)

    return tutor


def _make_availability(
    db: Session,
    tutor_id: uuid.UUID,
    *,
    date: datetime.date,
    start: datetime.time,
    end: datetime.time,
) -> uuid.UUID:
    # `weekday()` is the 0 = Monday encoding the column stores, derived from the date under
    # test so the two can never disagree.
    row = TutorAvailability(
        tutor_id=tutor_id, day_of_week=date.weekday(), start_time=start, end_time=end
    )
    db.add(row)
    db.flush()

    return row.id


def _make_client(
    db: Session,
    *,
    phone_number: str = CANONICAL_NUMBER,
    child_name: str = "Sam Guardian",
) -> ClientWorld:
    guardian = Guardian(name="Ada Guardian", phone_number=phone_number)
    home = Home(label="Home", address="1 Test Street", access_code="1234")
    child = Child(
        name=child_name,
        date_of_birth=datetime.date(2014, 5, 2),
        grade_level=7,
        school_name="Test School",
    )
    db.add_all([guardian, home, child])
    db.flush()
    db.add_all(
        [
            GuardianHome(guardian_id=guardian.id, home_id=home.id),
            ChildHome(child_id=child.id, home_id=home.id),
            ChildGuardian(child_id=child.id, guardian_id=guardian.id),
        ]
    )
    db.flush()

    return ClientWorld(guardian_id=guardian.id, child_id=child.id, home_id=home.id)


def _add_child(db: Session, client: ClientWorld, *, name: str, is_active: bool = True) -> Child:
    """A sibling linked to the same guardian and home as `client`'s child."""
    child = Child(
        name=name,
        date_of_birth=datetime.date(2015, 3, 9),
        grade_level=6,
        school_name="Test School",
        is_active=is_active,
    )
    db.add(child)
    db.flush()
    db.add_all(
        [
            ChildHome(child_id=child.id, home_id=client.home_id),
            ChildGuardian(child_id=child.id, guardian_id=client.guardian_id),
        ]
    )
    db.flush()

    return child


def _evaluate(db: Session, child_id: uuid.UUID, *, levels: dict[uuid.UUID, int]) -> None:
    """Mark the Child Evaluated by a Staff member, with these Subject levels."""
    staff = _make_staff(db)
    child = db.get_one(Child, child_id)
    child.evaluated_at = NOW.replace(tzinfo=datetime.UTC)
    child.evaluated_by_user_id = staff.id
    db.add_all(
        ChildSubjectLevel(
            child_id=child_id, subject_id=subject_id, level=level, set_by_user_id=staff.id
        )
        for subject_id, level in levels.items()
    )
    db.flush()


def _set_level(db: Session, child_id: uuid.UUID, subject_id: uuid.UUID, *, level: int) -> None:
    db.add(
        ChildSubjectLevel(
            child_id=child_id,
            subject_id=subject_id,
            level=level,
            set_by_user_id=_make_staff(db).id,
        )
    )
    db.flush()


def _clear_evaluation(db: Session, child_id: uuid.UUID) -> None:
    """Staff clearing Evaluated: both columns go NULL and the levels stay."""
    child = db.get_one(Child, child_id)
    child.evaluated_at = None
    child.evaluated_by_user_id = None
    db.flush()


def _make_subject_taught_at(
    db: Session, *, name: str, ceilings: tuple[int, ...]
) -> tuple[Subject, list[Tutor]]:
    """A subject with one tutor per ceiling, each free 9:00-12:00 on `DATE`."""
    subject = Subject(name=f"{name} {uuid.uuid4().hex[:6]}")
    db.add(subject)
    db.flush()
    tutors = [_make_tutor(db, name=f"Ceiling {ceiling}") for ceiling in ceilings]

    for tutor, ceiling in zip(tutors, ceilings, strict=True):
        db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=ceiling))
        _make_availability(db, tutor.id, date=DATE, start=NINE, end=TWELVE)

    db.flush()

    return subject, tutors


def _make_staff(db: Session) -> User:
    user = User(
        email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
        name="Test Staff",
        # Never logged in with, so no real hash is needed.
        hashed_password="not-a-hash",
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()

    return user


def _add_home(db: Session, client: ClientWorld, *, label: str | None, address: str) -> Home:
    home = Home(label=label, address=address, access_code="9999")
    db.add(home)
    db.flush()
    db.add_all(
        [
            GuardianHome(guardian_id=client.guardian_id, home_id=home.id),
            ChildHome(child_id=client.child_id, home_id=home.id),
        ]
    )
    db.flush()

    return home


class _Unset:
    """Marks "no home_id passed", since `None` is a real value (an In office booking)."""


_UNSET = _Unset()


def _make_booking(
    db: Session,
    world: BotWorld,
    client: ClientWorld,
    *,
    date: datetime.date,
    start: datetime.time = datetime.time(16, 0),
    location: BookingLocation = BookingLocation.HOME,
    home_id: uuid.UUID | None | _Unset = _UNSET,
) -> Booking:
    booking = Booking(
        child_id=client.child_id,
        user_id=user_id_of(db, world.first_tutor_id),
        kind=BookingKind.REGULAR,
        location=location,
        subject_id=world.subject_id,
        availability_id=world.first_availability_id,
        home_id=client.home_id if isinstance(home_id, _Unset) else home_id,
        booked_by_guardian_id=client.guardian_id,
        scheduled_date=date,
        start_time=start,
        end_time=(datetime.datetime.combine(date, start) + datetime.timedelta(hours=1)).time(),
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()

    return booking


def _make_evaluation(
    db: Session, client: ClientWorld, *, date: datetime.date, start: datetime.time
) -> Booking:
    """A live Evaluation session at the office, booked by Staff (no Subject, Home or slot)."""
    booking = Booking(
        child_id=client.child_id,
        user_id=_make_admin(db).id,
        kind=BookingKind.EVALUATION,
        location=BookingLocation.IN_OFFICE,
        scheduled_date=date,
        start_time=start,
        end_time=(datetime.datetime.combine(date, start) + datetime.timedelta(hours=1)).time(),
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()

    return booking


def _make_admin(db: Session) -> User:
    admin = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com", name="Office Admin", role=UserRole.ADMIN
    )
    db.add(admin)
    db.flush()

    return admin


def _count(db: Session, model: type) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def _mentions_a_chat_table(sql: str) -> bool:
    lowered = sql.lower()

    return "conversations" in lowered or " messages" in lowered or "messages " in lowered


def _origin() -> str | None:
    """The innermost `app/services` frame on the stack, or `None` outside one."""
    frames = [
        os.path.basename(frame.filename)
        for frame in traceback.extract_stack()
        if os.path.dirname(frame.filename) == _SERVICE_DIRECTORY
    ]

    return frames[-1] if frames else None
