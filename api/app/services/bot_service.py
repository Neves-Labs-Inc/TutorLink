"""The bot's conversational flow machine: one turn in, one `BotTurn` out.

**P7-C — this module is pure with respect to the conversation row.** It reads and writes
neither of the two chat tables. Everything it would otherwise have written travels back in the
`BotTurn`: `link_guardian_id` for the guardian backfill, `flag_reason` for the flag, and `reply`
for the outbound row. The webhook (task W) applies all of it and owns
the single `db.commit()`. Two consequences worth keeping: the whole flow machine is testable
without a chat row existing at all, and this module never has to reason about the ordering the
webhook's record-then-branch contract fixes.

**Transaction contract.** Nothing here commits (§4). Every row a turn writes lands through
`client_service`, `child_service`, `booking_write_service` or `booking_status_service`, all of
which flush and leave the boundary to the caller. One turn is therefore one transaction: the
webhook commits it whole or not at all.

**`now` is read exactly once per turn, through `server_now`.** `slot_service` and
`booking_write_service` both take `now` as a parameter rather than reading the clock inside,
which is what makes their window gates testable — that obligation lands on this module, and
`reply_for`'s signature is fixed by P7-A and cannot take one. `server_now` is the named seam a
test freezes, in the same spirit as `_overlapping_booking` in `booking_write_service`.

**The `do_orm_execute` guard is not armed on this path, and no assertion replaces it
(decision P7-T).** A webhook carries no `Principal` and no `TutorScope`, so the listener that
500s an unscoped query against a tutor-owned table (`dependencies.py:237-255`) is never bound
to this `Session`. Three things make that safe here, in order of strength:

1. **This module performs no tutor-scoped read.** Every read runs from the guardian's side —
   phone number → guardian → `child_guardians` → children → that child's homes and bookings.
   It never lists "a tutor's" anything, so the guard has no surface here to protect. The one
   place a tutor id is *selected* is `_qualified_tutors`, which filters by subject and grade
   and has no `tutor_id` predicate at all.
2. **Every booking write goes through `booking_write_service` unconditionally.** `_resolve`
   refuses a missing or retired tutor with its 400, and rule 1 validates the booking against
   the `tutor_availability` row named by `availability_id` — so a tutor id that does not own
   that row is refused loudly, before anything commits. This module never constructs the pair
   from two sources: both halves come off the same `OpenSlot` the offer produced.
3. The residual rules 1-7 cannot catch — offering, then booking, a *qualified but not
   requested* tutor — is flow logic, not a scoping leak. It is closed above by passing the
   requested tutor id into `find_available_slots` and by refusing an ambiguous name match
   rather than picking one.

**Copy is module-level constants, deliberately not `system_settings` rows** (OQ-29). The
project's runtime-settings convention governs numbers that re-cut behaviour; this is product
copy, reviewed against a live thread at `qa-visual` time. The genuine tuning number this module
reads — `cancellation_cutoff_hours` — is a settings row, read at turn time like every other.

**The answer to the question a step asked arrives under that step's own name.**
`ParsedIntent.fields` is keyed in `lower_snake_case` and `parser_service`'s system prompt says
so in those words (`parser_service.py:44-46`), so the `STEP_*` constants below are the field
names as well as the state values. That is the entire contract between the two modules and
nothing else pins them together; a step renamed here is a step the parser stops answering.
"""

import datetime
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.child import NOTES_MAX_LENGTH, Child
from app.models.enums import BookingStatus, FlagReason
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.subject import Subject
from app.redis_client import get_redis
from app.schemas.bot import BotIntent, BotTurn, ParsedIntent
from app.services import (
    booking_status_service,
    booking_write_service,
    child_service,
    client_service,
    parser_service,
    scheduling_service,
    slot_service,
)
from app.services.bot_state import FlowState, clear_state, load_state, save_state
from app.services.phone_service import InvalidPhoneNumber, normalize_phone_number
from app.services.settings_service import get_int_setting

logger = logging.getLogger(__name__)

CANCELLATION_CUTOFF_SETTING = "cancellation_cutoff_hours"

# Two re-prompts, then bail out (#26, #27, REQ-078.2). The counter is incremented on every
# reply this module cannot use, so the first unusable message buys re-prompt one, the second
# buys re-prompt two, and the third — two *failed* re-prompts — bails.
MAX_REPROMPTS = 2

# Every active subject, in one read. The list is a WhatsApp menu, so a second page would be
# unreadable long before this bound is reached.
SUBJECT_LIMIT = 100

STEP_INTAKE_NAME = "intake_name"
STEP_INTAKE_ADDRESS = "intake_address"
STEP_INTAKE_ACCESS_CODE = "intake_access_code"
STEP_INTAKE_LABEL = "intake_label"
STEP_CHILD_REGISTERED = "child_registered"
STEP_CHILD_NAME = "child_name"
STEP_CHILD_DOB = "child_date_of_birth"
STEP_CHILD_GRADE = "child_grade"
STEP_CHILD_SCHOOL = "child_school"
STEP_CHILD_NOTES = "child_notes"
STEP_CHILD_MORE = "child_more"
STEP_MENU = "menu"
STEP_BOOK_CHILD = "book_child"
STEP_BOOK_SUBJECT = "book_subject"
STEP_BOOK_TUTOR = "book_tutor"
STEP_BOOK_DATE = "book_date"
STEP_BOOK_HOME = "book_home"
STEP_BOOK_SLOT = "book_slot"
STEP_BOOK_CONFIRM = "book_confirm"
STEP_CANCEL_PICK = "cancel_pick"
STEP_RESCHEDULE_PICK = "reschedule_pick"

GREETING_NEW = "Hi! I'm the Ms Helping Hands booking assistant. I don't have you on file yet."
GREETING_RETURNING = "Hi {name}! Good to hear from you."
ASK_GUARDIAN_NAME = "What's your full name?"
ASK_ADDRESS = "Thanks! What's the address where the tutoring will take place?"
ASK_ACCESS_CODE = "Got it. What's the access code or entry instruction for getting in?"
ASK_HOME_LABEL = (
    'Would you like to give that address a short name, like "Mum\'s" or "Dad\'s"? '
    'It makes later bookings quicker. Reply "skip" if you\'d rather not.'
)
ASK_CHILD_REGISTERED = "Is this child already registered with us under another guardian?"
ASK_CHILD_NAME = "What's your child's name?"
ASK_CHILD_DOB = "What's their date of birth? A date like 2016-04-23 works."
ASK_CHILD_GRADE = "What grade are they in?"
ASK_CHILD_SCHOOL = "Which school do they go to?"
ASK_CHILD_NOTES = (
    "Is there anything we should know about them — learning needs, allergies, anything else? "
    'Reply "none" if not.'
)
ASK_MORE_CHILDREN = "Would you like to add another child?"
ASK_MENU = "I can book a session, cancel one, or move one to a different time. What would you like?"
ASK_WHICH_CHILD = "Which child is this for?"
ASK_SUBJECT = "Which subject?"
ASK_TUTOR = "Would you like a particular tutor?"
ASK_DATE = "Which day would you like? A date like 2026-10-14 works, or just tell me the day."
ASK_WHICH_HOME = "Which address should the tutor come to?"
ASK_SLOT = "Here's what's free on {date}:"
ASK_WHICH_TO_CANCEL = "Which session would you like to cancel?"
ASK_WHICH_TO_MOVE = "Which session would you like to move?"
ASK_NEW_DATE = "Which day would you like to move it to?"

ANY_TUTOR_LABEL = "Anyone who's available"
CHILD_ADDED = "{name} is all set."
CLIENT_READY = "You're all set up, thank you!"
SHOWING_SOME = "Showing the first {shown} of {total} — tell me if none of these work."
CONFIRM_SLOT = "Just to confirm: {label} on {date}. Shall I book it?"
BOOKING_CONFIRMED = "Booked! {label} on {date}. See you then."
BOOKING_MOVED = "All moved. Your new session is {label} on {date}."
CANCELLED = "That session is cancelled. Let me know if you'd like to book another."
NO_UPCOMING = "You don't have any upcoming sessions with us right now."
NO_CHILDREN_YET = "I don't have any children on file for you yet, so let's add one."
NO_SLOTS = "I'm afraid there's nothing free on {date}."
DATE_NOT_BOOKABLE = "I can't book that far ahead, or that date has already passed."
SLOT_JUST_TAKEN = "Sorry — that slot was taken while we were talking. Here's what's still free:"
NOT_UNDERSTOOD = "Sorry, I didn't quite catch that."

# REQ-075.6 / OQ-24. A refusal inside `cancellation_cutoff_hours` is a **policy** outcome, not
# a bot failure, so it carries no `flag_reason`: there are three reasons and there is no fourth,
# and putting routine late cancellations in the flag queue would bury the flags that mean the
# bot actually needs help.
CUTOFF_DECLINED = (
    "That session is too close to its start time for me to change it. "
    "I've let the office know and someone will be in touch shortly."
)

# P7-F, #39, verbatim and non-negotiable. Phone-alone identity cannot distinguish a real
# second guardian from anyone who knows a child's name, and linking would hand over the other
# guardian's home address and door access code. The bot therefore never links a second
# guardian to an existing child: it asks, and a "yes" stops the flow, writes no child row and
# no link, and raises `guardian_link_request` for an admin to fulfil. This is the most
# security-relevant line in the phase. Do not relax it into an automatic link.
GUARDIAN_LINK_REPLY = (
    "Because another guardian is already registered for that child, an admin needs to set this "
    "up rather than me. I've passed it on and someone will be in touch shortly."
)

# REQ-078.2's bail-out. The flow state is deliberately left where it is, so the parent resumes
# mid-flow on their next usable message rather than starting intake over.
BAILED_OUT = (
    "I'm sorry — I'm not following. I've asked one of our team to pick this up and "
    "they'll be in touch shortly."
)

# REQ-078.3. A parser outage is not the parent failing to be understood, so it flags
# immediately with `parse_error` and does not spend a re-prompt.
PARSER_UNAVAILABLE = (
    "Sorry, I'm having trouble right now. I've asked one of our team to pick this up and "
    "they'll be in touch shortly."
)

# Anything this module cannot complete through the services it calls: a retired row, a child
# with no active home, a phone number `phone_service` refuses. Not the parent's fault and not
# something a re-prompt fixes, so it flags `stuck` straight away.
CANNOT_CONTINUE = (
    "I can't finish that from here. I've asked one of our team to pick this up and "
    "they'll be in touch shortly."
)

BOOKING_NOTE = "Booked by the WhatsApp assistant."

# The widths of the columns the intake answers land in, plus the grade's range. `homes.address`
# is TEXT and takes a loose bound of its own; `children.notes` is TEXT bounded by the same
# `NOTES_MAX_LENGTH` the API schema enforces; the rest are the declared `String(...)` lengths in
# `models/`. Grade 0 is refused because the API refuses it (`ChildCreate.grade_level >= 1`,
# OQ-42): the bot is the second writer and must not store what the first would reject.
NAME_LIMIT = 255
ADDRESS_LIMIT = 1000
ACCESS_CODE_LIMIT = 64
LABEL_LIMIT = 64
GRADE_MINIMUM = 1
GRADE_MAXIMUM = 30

# See `_context`. A street address and its door code are what P7-F exists to protect; a child's
# date of birth and the notes answer — which can be health information — are withheld on the
# same reasoning (A-55). No step after the one that collected any of them needs it in order to
# be understood.
_WITHHELD_FROM_CONTEXT = frozenset({"address", "access_code", "child_date_of_birth", "child_notes"})

_AFFIRMATIVE = frozenset({"yes", "y", "yeah", "yep", "sure", "ok", "okay", "please", "true"})
_NEGATIVE = frozenset({"no", "n", "nope", "nah", "skip", "false"})
_NO_NOTES = _NEGATIVE | {"none", "nothing", "n/a", "na"}

# The steps that cannot run without a `guardians` row. A stored state pointing at one of these
# with no guardian behind it — a turn whose commit failed, a client an admin removed — restarts
# the flow rather than raising, which is the same clean restart REQ-076 asks of an expired key.
# The intake steps are absent on purpose: they run both before a guardian exists and again for
# the second child of a guardian who now does.
_GUARDIAN_STEPS = frozenset(
    {
        STEP_MENU,
        STEP_BOOK_CHILD,
        STEP_BOOK_SUBJECT,
        STEP_BOOK_TUTOR,
        STEP_BOOK_DATE,
        STEP_BOOK_HOME,
        STEP_BOOK_SLOT,
        STEP_BOOK_CONFIRM,
        STEP_CANCEL_PICK,
        STEP_RESCHEDULE_PICK,
    }
)

_BOOKING_KEYS = (
    "book_child_id",
    "book_grade_level",
    "book_subject_id",
    "book_tutor_id",
    "book_date",
    "book_home_id",
    "chosen",
    "reschedule_booking_id",
)

# What each step's handler reads out of `collected_data` before it writes anything of its own —
# the exact shape a stale payload (a build whose handler now reads a key an older build never
# wrote) fails on with a `KeyError`. A step absent here needs nothing beyond the step's own
# answer, which arrives through `parsed.fields` rather than `collected_data`.
_INTAKE_KEYS = frozenset({"guardian_name", "address", "access_code"})

_REQUIRED_KEYS: dict[str, frozenset[str]] = {
    STEP_CHILD_NOTES: frozenset(
        {"child_name", "child_date_of_birth", "child_grade", "child_school"}
    ),
    STEP_BOOK_SUBJECT: frozenset({"book_child_id", "book_grade_level"}),
    STEP_BOOK_DATE: frozenset({"book_child_id"}),
    STEP_BOOK_HOME: frozenset(
        {"book_date", "book_tutor_id", "book_subject_id", "book_grade_level"}
    ),
    STEP_BOOK_SLOT: frozenset({"book_date"}),
    STEP_BOOK_CONFIRM: frozenset(
        {
            "chosen",
            "book_child_id",
            "book_subject_id",
            "book_home_id",
            "book_date",
            "book_tutor_id",
            "book_grade_level",
        }
    ),
}


@dataclass(frozen=True, slots=True)
class _Turn:
    """Everything one turn of one flow is allowed to see."""

    db: Session
    redis: Redis
    phone_number: str
    body: str
    guardian: Guardian | None
    now: datetime.datetime
    state: FlowState

    @property
    def data(self) -> dict[str, Any]:
        return self.state.collected_data


@dataclass(frozen=True, slots=True)
class _Next:
    """A handler's verdict: what to say, and where the flow goes.

    `step is None` ends the flow and clears the Redis key — the next message opens a new one.
    It is **not** how the bail-out ends a turn: REQ-078.2 requires the state to survive there,
    so `_miss` writes the state back itself and never builds one of these.
    """

    reply: str
    step: str | None
    link_guardian_id: uuid.UUID | None = None
    flag_reason: FlagReason | None = None


type _Handler = Callable[[_Turn, ParsedIntent], _Next | None]


def server_now() -> datetime.datetime:
    """The one clock read per turn, in the naive UTC every scheduling column stores.

    Named rather than inlined so a test can freeze it: `reply_for`'s signature is settled by
    P7-A and cannot take `now`, but `slot_service` and `booking_write_service` both require one
    from their caller. Same form as `routers/slots.py:_now`.
    """
    return datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)


def reply_for(
    db: Session, *, phone_number: str, body: str, guardian_id: uuid.UUID | None
) -> BotTurn:
    """One inbound message in, one turn's decision out.

    `phone_number` is Twilio's `From` with the `whatsapp:` prefix stripped, stored by the
    webhook verbatim (P7-H): an inbound message is proof of dialability by delivery, and
    refusing it on stale libphonenumber metadata would drop a real customer's message. The
    intake **write** path does normalise, because that is a new row entering the database
    (REQ-073.4, D-L), and `_recognise` matches both forms so the two never drift apart.

    **D-P7-15 / REQ-075.7.** A thread with no `guardian_id` whose number belongs to a guardian
    is attributed to that guardian on whatever turn this is — the opening one, a re-prompt, a
    parser outage — because `erd.md` says a known guardian's conversation carries their id and
    the recognition has already happened. Only intake used to report it, so every client created
    outside the bot chatted as a bare phone number for ever. The bot still only *reports* the
    link (P7-C); the webhook writes it.
    """
    redis = get_redis()
    state = load_state(redis, phone_number=phone_number)
    guardian = _recognise(db, phone_number=phone_number, guardian_id=guardian_id)

    if _resumable(state, guardian):
        decided = _take_turn(
            db, redis=redis, phone_number=phone_number, body=body, guardian=guardian, state=state
        )
    else:
        decided = _open(redis, phone_number=phone_number, guardian=guardian)

    if guardian_id is None and guardian is not None and decided.link_guardian_id is None:
        decided = decided.model_copy(update={"link_guardian_id": guardian.id})

    return decided


def _take_turn(
    db: Session,
    *,
    redis: Redis,
    phone_number: str,
    body: str,
    guardian: Guardian | None,
    state: FlowState,
) -> BotTurn:
    turn = _Turn(
        db=db,
        redis=redis,
        phone_number=phone_number,
        body=body,
        guardian=guardian,
        now=server_now(),
        state=state,
    )

    try:
        parsed = parser_service.parse_intent(step=state.step, body=body, context=_context(state))
    except parser_service.ParseFailed:
        # REQ-078.3: flag on the first occurrence and leave the state exactly as it is — the
        # re-prompt counter is not burned on an outage the parent did not cause.
        parsed = None

    if parsed is None:
        decided = BotTurn(reply=PARSER_UNAVAILABLE, flag_reason=FlagReason.PARSE_ERROR)
    else:
        result = None if parsed.confidence_is_low else _HANDLERS[state.step](turn, parsed)
        decided = _miss(turn) if result is None else _apply(turn, result)

    return decided


def _resumable(state: FlowState | None, guardian: Guardian | None) -> bool:
    """Whether the stored flow can still be continued.

    A missing key is REQ-076's clean restart. So is a step this build no longer knows — a
    rolling deploy can leave one behind — and so is a step that needs a guardian the database
    no longer has. The fourth case is a step this build still knows, with a guardian to match,
    but a `collected_data` an older build wrote before this build's handler started reading a
    key it never carried — the same rolling deploy, one payload shape earlier. Trusting the step
    name alone there is a `KeyError` this webhook has no way to answer, so the check fails
    closed to a fresh start instead, and says so: a recovery nobody can see is indistinguishable
    from a bug.
    """
    if state is None or state.step not in _HANDLERS:
        usable = False
    elif guardian is None and state.step in _GUARDIAN_STEPS:
        usable = False
    else:
        required = _REQUIRED_KEYS.get(state.step, frozenset())

        if state.step == STEP_CHILD_NOTES and guardian is None:
            required = required | _INTAKE_KEYS

        missing = required - state.collected_data.keys()
        usable = not missing

        if missing:
            logger.warning(
                "restarting a stale flow at step %s: collected_data is missing %s",
                state.step,
                sorted(missing),
            )

    return usable


def _open(redis: Redis, *, phone_number: str, guardian: Guardian | None) -> BotTurn:
    """Greet, and ask the first question. This turn's message is not consumed.

    A fresh flow answers the opening prompt rather than trying to interpret "hi" as a step it
    has not asked about yet — which is what a re-prompt counter would otherwise start eating.
    """
    if guardian is None:
        reply = f"{GREETING_NEW} {ASK_GUARDIAN_NAME}"
        step = STEP_INTAKE_NAME
    else:
        reply = f"{GREETING_RETURNING.format(name=guardian.name)} {ASK_MENU}"
        step = STEP_MENU

    save_state(
        redis,
        phone_number=phone_number,
        state=FlowState(step=step, collected_data={}, misses=0, prompt=reply),
    )

    return BotTurn(reply=reply)


def _apply(turn: _Turn, result: _Next) -> BotTurn:
    """Persist the advanced flow and turn the handler's verdict into the webhook's instructions."""
    if result.step is None:
        clear_state(turn.redis, phone_number=turn.phone_number)
    else:
        turn.state.step = result.step
        turn.state.prompt = result.reply
        turn.state.misses = 0
        save_state(turn.redis, phone_number=turn.phone_number, state=turn.state)

    return BotTurn(
        reply=result.reply,
        link_guardian_id=result.link_guardian_id,
        flag_reason=result.flag_reason,
    )


def _miss(turn: _Turn) -> BotTurn:
    """A reply this step could not use: re-prompt, or bail out on the third one (REQ-078.2).

    `step` and `collected_data` are untouched either way, so the bail-out hands the thread to
    an admin without costing the parent the answers they have already given — the next message
    the bot *can* use carries on from the same question.
    """
    turn.state.misses += 1
    save_state(turn.redis, phone_number=turn.phone_number, state=turn.state)

    if turn.state.misses > MAX_REPROMPTS:
        result = BotTurn(reply=BAILED_OUT, flag_reason=FlagReason.STUCK)
    else:
        result = BotTurn(reply=f"{NOT_UNDERSTOOD}\n\n{turn.state.prompt}")

    return result


def _stuck(turn: _Turn) -> _Next:
    return _Next(reply=CANNOT_CONTINUE, step=None, flag_reason=FlagReason.STUCK)


# --- intake (REQ-073) ------------------------------------------------------------------------


def _collect_text(key: str, reply: str, step: str, *, limit: int) -> _Handler:
    """A step whose whole job is to store one free-text answer and ask the next question.

    `limit` is the width of the column the answer eventually lands in, and truncation here is
    the only length check this write path has: the bot is the second writer against these
    tables and it does not pass through the Pydantic request schema that bounds an admin's
    typing. Without it a rambling WhatsApp message becomes a `DataError` on flush, which is a
    500 the webhook cannot answer and a delivery Twilio then retries for ever.
    """

    def handler(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
        value = _answer(turn, parsed)

        if value is None:
            result = None
        else:
            turn.data[key] = value[:limit]
            result = _Next(reply=reply, step=step)

        return result

    return handler


def _collect_number(key: str, reply: str, step: str, *, minimum: int, maximum: int) -> _Handler:
    """As `_collect_text`, for an answer that has to be a whole number.

    Out of range is treated as not understood rather than stored: `grade_level` is an `integer`
    column, and a number past PostgreSQL's four-byte range is the same 500-then-retry-for-ever
    failure truncation exists to prevent above.
    """

    def handler(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
        value = _number(turn, parsed)

        if value is None or not minimum <= value <= maximum:
            result = None
        else:
            turn.data[key] = str(value)
            result = _Next(reply=reply, step=step)

        return result

    return handler


def _intake_label(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The optional home label, and therefore the one intake step that never re-prompts.

    "No thanks" is an answer, so a missing or negative value stores nothing rather than costing
    the parent a re-prompt. `homes.label` is what makes the later "Mum's or Dad's?" question
    answerable over WhatsApp, where two full street addresses are not (#39).
    """
    label = _answer(turn, parsed)

    if label is not None and label.casefold() not in _NEGATIVE:
        turn.data["home_label"] = label[:LABEL_LIMIT]

    return _Next(reply=ASK_CHILD_REGISTERED, step=STEP_CHILD_REGISTERED)


def _child_registered(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """P7-F's gate. "Yes" stops here and writes nothing — see `GUARDIAN_LINK_REPLY`."""
    answer = _yes_no(turn, parsed)

    if answer is None:
        result = None
    elif answer:
        result = _Next(
            reply=GUARDIAN_LINK_REPLY,
            step=None,
            flag_reason=FlagReason.GUARDIAN_LINK_REQUEST,
        )
    else:
        result = _Next(reply=ASK_CHILD_NAME, step=STEP_CHILD_NAME)

    return result


def _child_date_of_birth(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The ISO form only, and only a date `child_service` would accept (REQ-096.3).

    Resolving "April 23rd 2016" is the parser's job, taught by the example in `ASK_CHILD_DOB`
    the way `ASK_DATE` teaches it for bookings. Anything else is a re-prompt rather than a
    guess, and so is an implausible date: `create_child` refuses one on the notes turn, and a
    refusal there is a 500 the webhook cannot answer.
    """
    value = _iso_date(_answer(turn, parsed))

    if value is None or not child_service.date_of_birth_is_plausible(value, today=turn.now.date()):
        result = None
    else:
        turn.data["child_date_of_birth"] = value.isoformat()
        result = _Next(reply=ASK_CHILD_GRADE, step=STEP_CHILD_GRADE)

    return result


def _child_notes(turn: _Turn, parsed: ParsedIntent) -> _Next:
    """The optional notes answer, the last of one child's details, and the only turn an intake
    writes anything.

    **It never re-prompts** (A-45), like `_intake_label`: "none" is an answer, and so is a reply
    the parser extracted nothing from. Either stores `notes` as NULL.

    **Every row #39 names lands here, in one transaction** (REQ-073.2/.3, P7-AA): a `guardians`
    row, a `homes` row and a `guardian_homes` link on the first child, then a `children` row plus
    a `child_homes` and a `child_guardians` link for each. Holding the guardian in Redis until a
    child exists is what makes "a refused intake leaves none of it behind" true of the whole
    intake rather than only of its tail — and it is what lets P7-F's refusal write *nothing at
    all*.

    The guardian's `phone_number` goes through `phone_service` here (REQ-073.4, D-L): this is a
    new row entering the database, unlike the inbound number the thread is keyed on (P7-H).

    For a guardian who already exists — the second child of an intake, or a returning client
    with no child on file — the child is linked to every home that guardian already has, which
    is the correlation `child_homes` exists to record.
    """
    answer = _answer(turn, parsed)

    if answer is None or answer.casefold() in _NO_NOTES:
        notes = None
    else:
        notes = answer[:NOTES_MAX_LENGTH]

    if turn.guardian is None:
        created = _create_client(turn)
        guardian_id = None if created is None else created.client.id
        home_ids = [] if created is None else [home.id for home in created.homes]
    else:
        guardian_id = turn.guardian.id
        home_ids = [home.id for home in _guardian_homes(turn.db, guardian_id=guardian_id)]

    if guardian_id is None or not home_ids:
        result = _stuck(turn)
    else:
        child = child_service.create_child(
            turn.db,
            guardian_ids=[guardian_id],
            home_ids=home_ids,
            name=turn.data["child_name"],
            date_of_birth=datetime.date.fromisoformat(turn.data["child_date_of_birth"]),
            grade_level=int(turn.data["child_grade"]),
            school_name=turn.data["child_school"],
            notes=notes,
        )
        result = _Next(
            reply=f"{CHILD_ADDED.format(name=child.name)} {ASK_MORE_CHILDREN}",
            step=STEP_CHILD_MORE,
            link_guardian_id=guardian_id if turn.guardian is None else None,
        )

    return result


def _create_client(turn: _Turn) -> client_service.ClientDetail | None:
    """The `guardians` + `homes` + `guardian_homes` trio, or `None` when it cannot be written.

    `InvalidPhoneNumber` reaches here when libphonenumber refuses a number WhatsApp has just
    delivered a message from, and `PhoneNumberTaken` when the number belongs to a client this
    turn did not recognise — a deactivated one, or one created by a racing turn. Neither is
    something a re-prompt fixes.
    """
    home = client_service.HomeInput(
        label=turn.data.get("home_label"),
        address=turn.data["address"],
        access_code=turn.data["access_code"],
    )

    try:
        detail = client_service.create_client(
            turn.db,
            name=turn.data["guardian_name"],
            phone_number=turn.phone_number,
            home=home,
        )
    except (InvalidPhoneNumber, client_service.PhoneNumberTaken):
        detail = None

    return detail


def _child_more(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    answer = _yes_no(turn, parsed)

    if answer is None:
        result = None
    elif answer:
        result = _Next(reply=ASK_CHILD_REGISTERED, step=STEP_CHILD_REGISTERED)
    else:
        result = _Next(reply=f"{CLIENT_READY} {ASK_MENU}", step=STEP_MENU)

    return result


# --- the menu, and the three things a returning guardian can ask for (REQ-075) -----------------


def _menu(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    if parsed.intent is BotIntent.BOOK:
        result = _begin_booking(turn)
    elif parsed.intent is BotIntent.CANCEL:
        result = _begin_change(turn, moving=False)
    elif parsed.intent is BotIntent.RESCHEDULE:
        result = _begin_change(turn, moving=True)
    elif parsed.intent is BotIntent.LINK_GUARDIAN:
        result = _Next(
            reply=GUARDIAN_LINK_REPLY,
            step=None,
            flag_reason=FlagReason.GUARDIAN_LINK_REQUEST,
        )
    else:
        result = None

    return result


def _begin_booking(turn: _Turn) -> _Next:
    """REQ-074's first step. The child question is skipped when there is only one child."""
    _reset_booking(turn.data)
    children = _children(turn.db, guardian_id=turn.guardian.id)

    if not children:
        result = _Next(
            reply=f"{NO_CHILDREN_YET} {ASK_CHILD_REGISTERED}", step=STEP_CHILD_REGISTERED
        )
    elif len(children) == 1:
        result = _ask_subject(turn, child=children[0])
    else:
        options = [{"id": str(child.id), "label": child.name} for child in children]
        result = _Next(
            reply=f"{ASK_WHICH_CHILD}\n{_offer(turn.state, options)}", step=STEP_BOOK_CHILD
        )

    return result


def _begin_change(turn: _Turn, *, moving: bool) -> _Next:
    """The shared front half of cancel and reschedule: list what there is to act on.

    The list is read from the guardian's side — their children's live, future bookings — and
    carries no `tutor_id` predicate. P7-T leg 1 is this query.
    """
    bookings = _upcoming_bookings(
        turn.db, guardian_id=turn.guardian.id, on_or_after=turn.now.date()
    )

    if not bookings:
        result = _Next(reply=f"{NO_UPCOMING} {ASK_MENU}", step=STEP_MENU)
    else:
        options = [
            {"id": str(booking.id), "label": _booking_label(booking)} for booking in bookings
        ]
        question = ASK_WHICH_TO_MOVE if moving else ASK_WHICH_TO_CANCEL
        result = _Next(
            reply=f"{question}\n{_offer(turn.state, options)}",
            step=STEP_RESCHEDULE_PICK if moving else STEP_CANCEL_PICK,
        )

    return result


def _cancel_pick(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """REQ-075.3, and `cancellation_cutoff_hours`'s first consumer.

    Inside the window the bot declines and does **not** flag: a policy refusal is not a bot
    failure, and there is no fourth `flag_reason`.
    """
    booking = _picked_booking(turn, parsed)

    if booking is None:
        return None

    if _inside_cutoff(turn.db, booking=booking, now=turn.now):
        return _Next(reply=CUTOFF_DECLINED, step=None)

    try:
        booking_status_service.change_status(
            turn.db, booking_id=booking.id, target=BookingStatus.CANCELLED
        )
    except booking_status_service.BookingStatusError:
        return _stuck(turn)

    return _Next(reply=CANCELLED, step=None)


def _reschedule_pick(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """P7-O: reschedule is cancel-then-rebook through the two paths that already exist.

    Nothing is cancelled here. The old booking's id is carried in the flow state and the old
    booking is only cancelled once the replacement has been written, inside the same turn and
    therefore the same transaction — so a parent who abandons the flow, or a slot that is taken
    between the offer and the confirmation, still has the session they started with. The cutoff
    is checked here rather than at the write, so the refusal arrives before the parent is asked
    to pick a new day.
    """
    booking = _picked_booking(turn, parsed)

    if booking is None:
        return None

    if _inside_cutoff(turn.db, booking=booking, now=turn.now):
        return _Next(reply=CUTOFF_DECLINED, step=None)

    _reset_booking(turn.data)
    turn.data["reschedule_booking_id"] = str(booking.id)
    turn.data["book_child_id"] = str(booking.child_id)
    turn.data["book_grade_level"] = str(booking.child.grade_level)
    turn.data["book_subject_id"] = str(booking.subject_id)
    turn.data["book_tutor_id"] = str(booking.tutor_id)
    turn.data["book_home_id"] = str(booking.home_id)

    return _Next(reply=ASK_NEW_DATE, step=STEP_BOOK_DATE)


# --- the booking flow (REQ-074) ----------------------------------------------------------------


def _book_child(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    option = _chosen(turn, parsed)
    child = None if option is None else turn.db.get(Child, uuid.UUID(option["id"]))

    return None if child is None else _ask_subject(turn, child=child)


def _ask_subject(turn: _Turn, *, child: Child) -> _Next:
    turn.data["book_child_id"] = str(child.id)
    turn.data["book_grade_level"] = str(child.grade_level)
    subjects = turn.db.scalars(
        select(Subject)
        .where(Subject.is_active.is_(True))
        .order_by(Subject.name, Subject.id)
        .limit(SUBJECT_LIMIT)
    ).all()

    if not subjects:
        result = _stuck(turn)
    else:
        options = [{"id": str(subject.id), "label": subject.name} for subject in subjects]
        result = _Next(
            reply=f"{ASK_SUBJECT}\n{_offer(turn.state, options)}", step=STEP_BOOK_SUBJECT
        )

    return result


def _book_subject(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    option = _chosen(turn, parsed)

    if option is None:
        return None

    turn.data["book_subject_id"] = option["id"]
    tutors = _qualified_tutors(
        turn.db,
        subject_id=uuid.UUID(option["id"]),
        grade_level=int(turn.data["book_grade_level"]),
    )

    if not tutors:
        return _ask_subject(
            turn, child=turn.db.get_one(Child, uuid.UUID(turn.data["book_child_id"]))
        )

    options = [{"id": str(tutor_id), "label": name} for tutor_id, name in tutors.items()]
    options.append({"id": "", "label": ANY_TUTOR_LABEL})

    return _Next(reply=f"{ASK_TUTOR}\n{_offer(turn.state, options)}", step=STEP_BOOK_TUTOR)


def _book_tutor(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    option = _chosen(turn, parsed)

    if option is None:
        result = None
    else:
        turn.data["book_tutor_id"] = option["id"]
        result = _Next(reply=ASK_DATE, step=STEP_BOOK_DATE)

    return result


def _book_date(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """Resolving "next tuesday" is the parser's job; this step only accepts the ISO form.

    `ASK_DATE` shows the format and the prompt travels into the parser's context verbatim,
    which is what makes the convention visible to the model rather than assumed of it. Anything
    else is a re-prompt: guessing a date books a session on a day nobody named.
    """
    date = _iso_date(_answer(turn, parsed))

    if date is None:
        return None

    turn.data["book_date"] = date.isoformat()

    return _ask_home(turn)


def _iso_date(raw: str | None) -> datetime.date | None:
    """`2026-10-14`, or the same date with a time attached, which is the other shape a model
    reaching for ISO 8601 produces."""
    if raw is None:
        return None

    try:
        return datetime.date.fromisoformat(raw)
    except ValueError:
        pass

    try:
        return datetime.datetime.fromisoformat(raw).date()
    except ValueError:
        return None


def _ask_home(turn: _Turn) -> _Next:
    """REQ-074.3: the home question is asked only when the child has more than one active home.

    The homes come from `child_homes` directly. The bot is not a client of
    `GET /api/clients/{id}` and issue #60's flat uncorrelated lists are not in its path (P7-M).
    """
    homes = _homes(turn.db, child_id=uuid.UUID(turn.data["book_child_id"]))
    preset = turn.data.get("book_home_id")

    if not homes:
        result = _stuck(turn)
    elif preset in {str(home.id) for home in homes}:
        result = _offer_slots(turn)
    elif len(homes) == 1:
        turn.data["book_home_id"] = str(homes[0].id)
        result = _offer_slots(turn)
    else:
        options = [{"id": str(home.id), "label": home.label or home.address} for home in homes]
        result = _Next(
            reply=f"{ASK_WHICH_HOME}\n{_offer(turn.state, options)}", step=STEP_BOOK_HOME
        )

    return result


def _book_home(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    option = _chosen(turn, parsed)

    if option is None:
        result = None
    else:
        turn.data["book_home_id"] = option["id"]
        result = _offer_slots(turn)

    return result


def _offer_slots(turn: _Turn, *, preamble: str | None = None) -> _Next:
    """REQ-074.1/.2, in-process through `slot_service` with the server clock passed in.

    Each option carries the `tutor_id` **and** the `availability_id` off the same `OpenSlot`,
    which is what keeps the pair the booking is written with structurally matched (P7-T).
    `total` is the pre-cap count, so "showing 5 of 8" is honest rather than implying 5 is all
    there is.
    """
    date = datetime.date.fromisoformat(turn.data["book_date"])
    requested = turn.data["book_tutor_id"]

    try:
        found = slot_service.find_available_slots(
            turn.db,
            subject_id=uuid.UUID(turn.data["book_subject_id"]),
            grade_level=int(turn.data["book_grade_level"]),
            date=date,
            tutor_id=uuid.UUID(requested) if requested else None,
            now=turn.now,
        )
    except scheduling_service.DateOutOfWindow:
        return _Next(reply=f"{DATE_NOT_BOOKABLE} {ASK_DATE}", step=STEP_BOOK_DATE)

    if not found.items:
        return _Next(
            reply=f"{NO_SLOTS.format(date=date.isoformat())} {ASK_DATE}", step=STEP_BOOK_DATE
        )

    options = [
        {
            "id": str(slot.availability_id),
            "label": f"{slot.start_time:%H:%M}-{slot.end_time:%H:%M} with {slot.tutor_name}",
            "tutor_id": str(slot.tutor_id),
            "availability_id": str(slot.availability_id),
            "start_time": slot.start_time.isoformat(),
            "end_time": slot.end_time.isoformat(),
        }
        for slot in found.items
    ]
    lines = [preamble or ASK_SLOT.format(date=date.isoformat()), _offer(turn.state, options)]

    if found.total > len(found.items):
        lines.append(SHOWING_SOME.format(shown=len(found.items), total=found.total))

    return _Next(reply="\n".join(lines), step=STEP_BOOK_SLOT)


def _book_slot(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    option = _chosen(turn, parsed)

    if option is None:
        result = None
    else:
        turn.data["chosen"] = option
        result = _Next(
            reply=CONFIRM_SLOT.format(label=option["label"], date=turn.data["book_date"]),
            step=STEP_BOOK_CONFIRM,
        )

    return result


def _book_confirm(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    answer = _yes_no(turn, parsed)

    if answer is None:
        result = None
    elif answer:
        result = _write_booking(turn)
    else:
        result = _offer_slots(turn)

    return result


def _write_booking(turn: _Turn) -> _Next:
    """The write, through `booking_write_service` and therefore through all seven rules.

    A conflict is a **normal** outcome here (REQ-074.7): two guardians can be offered the same
    slot, and REQ-045's concurrent-submission 409 stops being theoretical the moment a second
    writer exists. The answer is to re-offer, not to surface an error.

    On a reschedule the new booking is written **first** and the old one cancelled after it. The
    other order would leave a parent with nothing whenever the replacement is refused, since the
    cancellation would already be in the transaction the webhook is about to commit.
    """
    chosen = turn.data["chosen"]
    request = booking_write_service.BookingRequest(
        child_id=uuid.UUID(turn.data["book_child_id"]),
        tutor_id=uuid.UUID(chosen["tutor_id"]),
        subject_id=uuid.UUID(turn.data["book_subject_id"]),
        availability_id=uuid.UUID(chosen["availability_id"]),
        home_id=uuid.UUID(turn.data["book_home_id"]),
        scheduled_date=datetime.date.fromisoformat(turn.data["book_date"]),
        start_time=datetime.time.fromisoformat(chosen["start_time"]),
        end_time=datetime.time.fromisoformat(chosen["end_time"]),
        booked_by_guardian_id=turn.guardian.id,
        notes=BOOKING_NOTE,
    )

    try:
        booking_write_service.create_booking(turn.db, request=request, now=turn.now)
    except (
        booking_write_service.BookingOverlaps,
        booking_write_service.GapNotRespected,
        booking_write_service.BlockedByException,
    ):
        return _offer_slots(turn, preamble=SLOT_JUST_TAKEN)
    except (booking_write_service.DateOutOfWindow, booking_write_service.LeadTimeNotMet):
        return _Next(reply=f"{DATE_NOT_BOOKABLE} {ASK_DATE}", step=STEP_BOOK_DATE)
    except booking_write_service.BookingWriteError:
        return _stuck(turn)

    replaced = turn.data.get("reschedule_booking_id")
    summary = {"label": chosen["label"], "date": turn.data["book_date"]}

    if replaced is None:
        return _Next(reply=BOOKING_CONFIRMED.format(**summary), step=None)

    try:
        booking_status_service.change_status(
            turn.db, booking_id=uuid.UUID(replaced), target=BookingStatus.CANCELLED
        )
    except booking_status_service.BookingStatusError:
        return _stuck(turn)

    return _Next(reply=BOOKING_MOVED.format(**summary), step=None)


# --- reads, all of them from the guardian's side (P7-T) ----------------------------------------


def _recognise(db: Session, *, phone_number: str, guardian_id: uuid.UUID | None) -> Guardian | None:
    """REQ-075.1: recognition is by phone number alone, with no challenge.

    The conversation's own `guardian_id` wins when the webhook has one, so a guardian whose
    number was edited on the client record still resolves through the thread they are on.
    `is_active` is deliberately not filtered: a deactivated client is recognised and then
    refused at the write path by `_resolve`, which is a clearer outcome than an intake that
    collides with their own row on `UNIQUE (phone_number)`.

    The lookup matches the number **as it arrived and as `phone_service` would store it**, and
    an unparseable one falls back to the raw form rather than raising. `guardians.phone_number`
    is E.164 and Twilio's `From` normally is too, so the two usually compare like with like —
    but P7-H stores the inbound value verbatim on purpose, so "usually" is the whole risk: one
    non-canonical `From` that failed to match here would run the guardian through intake again
    and collide with their own row on `UNIQUE (phone_number)` every time.
    """
    if guardian_id is not None:
        return db.get(Guardian, guardian_id)

    try:
        canonical = normalize_phone_number(db, raw=phone_number)
    except InvalidPhoneNumber:
        canonical = phone_number

    return db.scalars(
        select(Guardian).where(Guardian.phone_number.in_({phone_number, canonical}))
    ).first()


def _children(db: Session, *, guardian_id: uuid.UUID) -> list[Child]:
    """REQ-075.2: through `child_guardians`, so a guardian sees their children and no others."""
    return list(
        db.scalars(
            select(Child)
            .join(ChildGuardian, ChildGuardian.child_id == Child.id)
            .where(ChildGuardian.guardian_id == guardian_id)
            .order_by(Child.name, Child.id)
        ).all()
    )


def _guardian_homes(db: Session, *, guardian_id: uuid.UUID) -> list[Home]:
    """The guardian's own active homes, read from `guardian_homes`.

    Explicit rather than derived through their children, which is the reason that junction
    exists at all: intake collects the address before any child row does.
    """
    return list(
        db.scalars(
            select(Home)
            .join(GuardianHome, GuardianHome.home_id == Home.id)
            .where(GuardianHome.guardian_id == guardian_id, Home.is_active.is_(True))
            .order_by(Home.created_at, Home.id)
        ).all()
    )


def _homes(db: Session, *, child_id: uuid.UUID) -> list[Home]:
    """The child's active homes, read from `child_homes` (REQ-074.4)."""
    return list(
        db.scalars(
            select(Home)
            .join(ChildHome, ChildHome.home_id == Home.id)
            .where(ChildHome.child_id == child_id, Home.is_active.is_(True))
            .order_by(Home.created_at, Home.id)
        ).all()
    )


def _upcoming_bookings(
    db: Session, *, guardian_id: uuid.UUID, on_or_after: datetime.date
) -> list[Booking]:
    """Live, future bookings for the children this guardian is linked to.

    `LIVE_BOOKING_STATUSES` is the one definition of a booking that counts, so a cancelled
    session never appears in a cancel or reschedule list.
    """
    return list(
        db.scalars(
            select(Booking)
            .join(ChildGuardian, ChildGuardian.child_id == Booking.child_id)
            .where(
                ChildGuardian.guardian_id == guardian_id,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
                Booking.scheduled_date >= on_or_after,
            )
            .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
        ).all()
    )


def _qualified_tutors(
    db: Session, *, subject_id: uuid.UUID, grade_level: int
) -> dict[uuid.UUID, str]:
    """Active tutors who teach this subject at or above this grade.

    Consumed from `slot_service` rather than re-derived (§12, the stats rule). The tutor menu
    and the offer surface have to agree about who qualifies: a tutor offered here that
    `find_available_slots` then drops produces an empty slot list for no reason a parent can
    see, and one rule 5 would refuse is a 422 on a slot the bot itself proposed — #44 item 1
    reached through a second copy of the same three predicates.

    The leading underscore is `slot_service`'s, not a boundary: that function had no second
    caller until this module, and it is the named predicate, not an implementation detail.
    Promoting it is a one-line change in a file this task does not own.

    `tutor_id=None` searches every qualified tutor, so **no `tutor_id` predicate is issued** —
    this is not the tutor-scoped read P7-T is about.
    """
    return slot_service._qualified_tutor_names(
        db, subject_id=subject_id, grade_level=grade_level, tutor_id=None
    )


def _inside_cutoff(db: Session, *, booking: Booking, now: datetime.datetime) -> bool:
    """`cancellation_cutoff_hours`, read at turn time like every other setting (§6).

    Phase 4 seeded this row and deliberately left it unwired; this is its first consumer.
    """
    hours = get_int_setting(db, key=CANCELLATION_CUTOFF_SETTING)
    starts_at = datetime.datetime.combine(booking.scheduled_date, booking.start_time)

    return starts_at - now < datetime.timedelta(hours=hours)


def _picked_booking(turn: _Turn, parsed: ParsedIntent) -> Booking | None:
    option = _chosen(turn, parsed)

    return None if option is None else turn.db.get(Booking, uuid.UUID(option["id"]))


def _booking_label(booking: Booking) -> str:
    return (
        f"{booking.scheduled_date.isoformat()} {booking.start_time:%H:%M} — "
        f"{booking.subject.name} for {booking.child.name} with {booking.tutor.name}"
    )


# --- reading one message, and offering a numbered choice ---------------------------------------


def _answer(turn: _Turn, parsed: ParsedIntent) -> str | None:
    """What the parent said in reply to the question this step asked.

    Keyed by the step's own name: that is the convention `parser_service`'s system prompt
    instructs the model with (`parser_service.py:44-46`), and reading any other key here would
    make every extraction silently empty.
    """
    value = parsed.fields.get(turn.state.step, "").strip()

    return value or None


def _number(turn: _Turn, parsed: ParsedIntent) -> int | None:
    raw = _answer(turn, parsed)

    try:
        value = None if raw is None else int(raw)
    except ValueError:
        value = None

    return value


def _yes_no(turn: _Turn, parsed: ParsedIntent) -> bool | None:
    raw = (_answer(turn, parsed) or "").casefold()

    if raw in _AFFIRMATIVE:
        answer = True
    elif raw in _NEGATIVE:
        answer = False
    else:
        answer = None

    return answer


def _offer(state: FlowState, options: list[dict[str, Any]]) -> str:
    """Record the choices this step is presenting and render them as a numbered list.

    One pending choice at a time, so one key. Each option keeps whatever the consuming handler
    needs beside its `label` — for a slot that is the tutor and availability pair, which is how
    the two never come from different places.
    """
    state.collected_data["options"] = options

    return "\n".join(
        f"{number}. {option['label']}" for number, option in enumerate(options, start=1)
    )


def _chosen(turn: _Turn, parsed: ParsedIntent) -> dict[str, Any] | None:
    """The option the parent picked, by position or by an unambiguous name.

    An ambiguous name match is a re-prompt rather than the first hit. On the tutor step that is
    the difference between booking the tutor the guardian asked for and booking a different one
    whose name happens to contain the same letters — the REQ-074 correctness bug decision P7-T
    leaves to this module rather than to an ORM-layer assertion.
    """
    options: list[dict[str, Any]] = turn.data.get("options", [])
    raw = _answer(turn, parsed)

    if raw is None or not options:
        return None

    if raw.isdigit() and 1 <= int(raw) <= len(options):
        return options[int(raw) - 1]

    needle = raw.casefold()
    hits = [option for option in options if needle in option["label"].casefold()]

    return hits[0] if len(hits) == 1 else None


def _context(state: FlowState) -> dict[str, str]:
    """What the parser is told about where the conversation is.

    The pending question and the numbered choices go in verbatim, because "the second one" and
    "the 10:30 one" are only resolvable against them.

    **The home address and its access code are withheld** (`_WITHHELD_FROM_CONTEXT`). They are
    the pair #39 built P7-F to protect — a street address and the code that opens its door —
    and no later step needs either to be interpreted, so sending them to a third-party model
    once per message of the rest of the conversation buys nothing and exposes the two values
    this system most needs to keep. A child's date of birth and the notes answer, which can be
    health information, are withheld for the same reason (A-55).
    """
    context = {
        key: value
        for key, value in state.collected_data.items()
        if isinstance(value, str) and key not in _WITHHELD_FROM_CONTEXT
    }
    context["prompt"] = state.prompt
    options: list[dict[str, Any]] = state.collected_data.get("options", [])

    if options:
        context["options"] = "\n".join(
            f"{number}. {option['label']}" for number, option in enumerate(options, start=1)
        )

    return context


def _reset_booking(data: dict[str, Any]) -> None:
    """Drop the previous booking attempt's answers before a new one starts.

    Without this a second booking in one conversation inherits the first one's child, subject
    and — worst of all — its `reschedule_booking_id`, which would cancel a session nobody asked
    to cancel.
    """
    for key in _BOOKING_KEYS:
        data.pop(key, None)


_HANDLERS: dict[str, _Handler] = {
    STEP_INTAKE_NAME: _collect_text(
        "guardian_name", ASK_ADDRESS, STEP_INTAKE_ADDRESS, limit=NAME_LIMIT
    ),
    STEP_INTAKE_ADDRESS: _collect_text(
        "address", ASK_ACCESS_CODE, STEP_INTAKE_ACCESS_CODE, limit=ADDRESS_LIMIT
    ),
    STEP_INTAKE_ACCESS_CODE: _collect_text(
        "access_code", ASK_HOME_LABEL, STEP_INTAKE_LABEL, limit=ACCESS_CODE_LIMIT
    ),
    STEP_INTAKE_LABEL: _intake_label,
    STEP_CHILD_REGISTERED: _child_registered,
    STEP_CHILD_NAME: _collect_text("child_name", ASK_CHILD_DOB, STEP_CHILD_DOB, limit=NAME_LIMIT),
    STEP_CHILD_DOB: _child_date_of_birth,
    STEP_CHILD_GRADE: _collect_number(
        "child_grade",
        ASK_CHILD_SCHOOL,
        STEP_CHILD_SCHOOL,
        minimum=GRADE_MINIMUM,
        maximum=GRADE_MAXIMUM,
    ),
    STEP_CHILD_SCHOOL: _collect_text(
        "child_school", ASK_CHILD_NOTES, STEP_CHILD_NOTES, limit=NAME_LIMIT
    ),
    STEP_CHILD_NOTES: _child_notes,
    STEP_CHILD_MORE: _child_more,
    STEP_MENU: _menu,
    STEP_BOOK_CHILD: _book_child,
    STEP_BOOK_SUBJECT: _book_subject,
    STEP_BOOK_TUTOR: _book_tutor,
    STEP_BOOK_DATE: _book_date,
    STEP_BOOK_HOME: _book_home,
    STEP_BOOK_SLOT: _book_slot,
    STEP_BOOK_CONFIRM: _book_confirm,
    STEP_CANCEL_PICK: _cancel_pick,
    STEP_RESCHEDULE_PICK: _reschedule_pick,
}
