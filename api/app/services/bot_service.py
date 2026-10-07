"""The bot's conversational flow machine: one turn in, one `BotTurn` out.

**P7-C — this module is pure with respect to the conversation row.** It reads and writes
neither of the two chat tables. Everything it would otherwise have written travels back in the
`BotTurn`: `link_guardian_id` for the guardian backfill, `flag_reason` for the flag,
`reactivation_child_id` for a reactivation request (REQ-132), `consent` for a weekly-reminder
consent (whose evidence is the inbound message's id, which only the webhook has), and `reply` for
the outbound row. Consent *state* is read here, from `reminder_consents`, which is not a chat table.
Whether a request is already pending arrives the same way in the other direction — as the
`reactivation_pending` argument, read by the webhook — so this module never reads the column
either. The webhook (task W) applies all of it and owns
the single `db.commit()`. Two consequences worth keeping: the whole flow machine is testable
without a chat row existing at all, and this module never has to reason about the ordering the
webhook's record-then-branch contract fixes.

**Transaction contract.** Nothing here commits (§4). Every row a turn writes lands through
`client_service`, `child_service`, `booking_write_service` or `booking_status_service`, all of
which flush and leave the boundary to the caller. One turn is therefore one transaction: the
webhook commits it whole or not at all.

**`now` is read exactly once per turn, through `clock.business_now`.** `slot_service` and
`booking_write_service` both take `now` as a parameter rather than reading the clock inside,
which is what makes their window gates testable — that obligation lands on this module, and
`reply_for`'s signature is fixed by P7-A and cannot take one. `now` is the naive business
wall-clock (`BUSINESS_TIMEZONE`), the form every scheduling column stores, and
`clock.business_now` is the one seam a test freezes.

**The `do_orm_execute` guard is not armed on this path, and no assertion replaces it
(decision P7-T).** A webhook carries no `Principal` and no `TutorScope`, so the listener that
500s an unscoped query against a tutor-owned table (`dependencies.py:237-255`) is never bound
to this `Session`. Three things make that safe here, in order of strength:

1. **This module performs no tutor-scoped read.** Every read runs from the guardian's side —
   phone number → guardian → `child_guardians` → children → that child's homes and bookings.
   It never lists "a tutor's" anything, so the guard has no surface here to protect. The one
   place a tutor id is *selected* is `_qualified_tutors`, which filters by subject and level
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

**Copy lives in `bot_messages`, by ID, deliberately not in `system_settings` rows** (OQ-29). The
project's runtime-settings convention governs numbers that re-cut behaviour; this is product
copy, reviewed against a live thread at `qa-visual` time. Every reply here is
`bot_messages.render(id, language)` in the turn's effective language — see "Guardian language"
below. The genuine tuning number this module
reads — `cancellation_cutoff_hours` — is a settings row, read at turn time like every other.

**The answer to the question a step asked arrives in `ParsedIntent.answer`.** The parser is
shown the pending question (`state.prompt`) as its own section of the prompt and returns the
parent's answer to it in that fixed slot, whatever the step; `_answer` reads nothing else. The
`STEP_*` constants below are state values only, not field names — the model used to be asked to
key the answer by them and did not reliably do so. `fields` carries the extras, of which this
module reads one by name: `child_name` (`STEP_CHILD_NAME`), pinned in the parser's system prompt
for reactivation detection at the menu.

**Guardian language.** The webhook passes the stored `conversations.language` in, and every
reply is built in the turn's effective language: the parser's `language` when it read the
message as clearly English or Spanish, else the stored value, else English. When the parsed
language differs from the stored one (or nothing is stored), the turn adopts it and returns it
in `BotTurn.language` for the webhook to store; this module never touches the row (P7-C). The
opening message of a flow is parsed for its language only — its answer and intent are never
read — and a parser outage there greets in the stored language without a flag, because the
greeting needs nothing from the parse.
"""

import dataclasses
import datetime
import enum
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.child import HIGHEST_GRADE, LOWEST_GRADE, NOTES_MAX_LENGTH, Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.enums import BookingStatus, ConsentAction, ConsentSource, FlagReason
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.subject import Subject
from app.schemas.bot import (
    AnswerKind,
    BotIntent,
    BotTurn,
    ConsentInstruction,
    GuardianLanguage,
    ParsedIntent,
    ReminderButton,
    RemindersRequest,
)
from app.services import (
    bot_messages,
    booking_status_service,
    booking_write_service,
    child_service,
    client_service,
    clock,
    parser_service,
    reminder_consent_service,
    reminder_service,
    scheduling_service,
    slot_service,
)
from app.services.bot_state import FlowState, clear_state, load_state, save_state
from app.services.name_matching import exact_matches, named_children, typo_matches
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
STEP_CHILD_SCHOOL = "child_school"
STEP_CHILD_GRADE = "child_grade"
STEP_CHILD_NOTES = "child_notes"
STEP_CHILD_MORE = "child_more"
STEP_REMINDERS_OPT_IN = "reminders_opt_in"
STEP_MENU = "menu"
STEP_BOOK_CHILD = "book_child"
STEP_BOOK_SUBJECT = "book_subject"
STEP_BOOK_TUTOR = "book_tutor"
STEP_BOOK_DATE = "book_date"
STEP_BOOK_HOME = "book_home"
STEP_BOOK_SLOT = "book_slot"
STEP_BOOK_CONFIRM = "book_confirm"
# The Office handoff path: a Child not Evaluated, or with no Subject level for the chosen subject,
# is not booked by the bot. Separate step names keep this path from ever resuming into the slot
# offer or the write.
STEP_FIRST_SESSION_SUBJECT = "first_session_subject"
STEP_FIRST_SESSION_DATE = "first_session_date"
STEP_CANCEL_PICK = "cancel_pick"
STEP_CANCEL_CONFIRM = "cancel_confirm"
STEP_RESCHEDULE_PICK = "reschedule_pick"
STEP_REACTIVATION_CONFIRM = "reactivation_confirm"

# The opening message of a flow is parsed for its language only; the parser is told there is
# no question yet, so it has nothing to read the message as an answer to.
OPENING_STEP = "opening"
OPENING_QUESTION = "Nothing yet: this is the parent's first message in a new conversation."

# Staff-facing, so it is not a catalogue message.
BOOKING_NOTE = "Booked by the WhatsApp assistant."

# What a "no access code" answer is stored as: `homes.access_code` is NOT NULL, and this is the
# word an English Guardian has always sent, so Staff and tutors read one thing in both languages.
NO_ACCESS_CODE = "none"

# The widths of the columns the intake answers land in. `homes.address` is TEXT and takes a
# loose bound of its own; `children.notes` is TEXT bounded by the same `NOTES_MAX_LENGTH` the
# API schema enforces; the rest are the declared `String(...)` lengths in `models/`.
NAME_LIMIT = 255
ADDRESS_LIMIT = 1000
ACCESS_CODE_LIMIT = 64
LABEL_LIMIT = 64

# See `_context`. A street address and its door code are what P7-F exists to protect; a child's
# date of birth and the notes answer — which can be health information — are withheld on the
# same reasoning (A-55). No step after the one that collected any of them needs it in order to
# be understood.
_WITHHELD_FROM_CONTEXT = frozenset({"address", "access_code", "child_date_of_birth", "child_notes"})

# Compared after `_normalized`, so "Yes, please!" is "yes please". The parser is told to answer
# `yes` or `no`; these are the phrasings it may still pass through verbatim.
_AFFIRMATIVE = frozenset(
    {
        "yes",
        "y",
        "yeah",
        "yep",
        "yup",
        "sure",
        "ok",
        "okay",
        "please",
        "true",
        "yes please",
        "yes thanks",
        "yes thank you",
        "ok thanks",
        "okay thanks",
        "please do",
        "go ahead",
        "go for it",
        "sounds good",
        "that's fine",
        "that works",
        "correct",
        "of course",
        "definitely",
        "absolutely",
    }
)
_NEGATIVE = frozenset(
    {
        "no",
        "n",
        "nope",
        "nah",
        "skip",
        "false",
        "no thanks",
        "no thank you",
        "nope thanks",
        "not now",
        "not right now",
        "not at the moment",
        "not really",
        "no need",
        "no that's all",
        "no that's everyone",
    }
)
# The catalogue's Spanish skip/none words ("omitir", "ninguno", "no hay"...) in `_normalized`
# form. The parser hands a text answer through as written, so these raw-text checks need them;
# yes/no does not, because the parser normalises those answers to English `yes`/`no`.
_SPANISH_SKIP = frozenset(bot_messages.normalize(word) for word in bot_messages.SPANISH_SKIP_WORDS)
_SKIP_LABEL = _NEGATIVE | _SPANISH_SKIP
_NO_NOTES = _NEGATIVE | _SPANISH_SKIP | {"none", "nothing", "n/a", "na"}

# The form each step needs its answer in, told to the parser. A step absent here takes `TEXT`.
_ANSWER_KINDS: dict[str, AnswerKind] = {
    STEP_CHILD_REGISTERED: AnswerKind.YES_NO,
    STEP_CHILD_MORE: AnswerKind.YES_NO,
    STEP_REMINDERS_OPT_IN: AnswerKind.YES_NO,
    STEP_BOOK_CONFIRM: AnswerKind.YES_NO,
    STEP_CANCEL_CONFIRM: AnswerKind.YES_NO,
    STEP_REACTIVATION_CONFIRM: AnswerKind.YES_NO,
    STEP_CHILD_DOB: AnswerKind.DATE,
    STEP_CHILD_GRADE: AnswerKind.NUMBER,
    STEP_BOOK_DATE: AnswerKind.DATE,
    STEP_FIRST_SESSION_DATE: AnswerKind.DATE,
    STEP_BOOK_CHILD: AnswerKind.CHOICE,
    STEP_BOOK_SUBJECT: AnswerKind.CHOICE,
    STEP_BOOK_TUTOR: AnswerKind.CHOICE,
    STEP_BOOK_HOME: AnswerKind.CHOICE,
    STEP_BOOK_SLOT: AnswerKind.CHOICE,
    STEP_FIRST_SESSION_SUBJECT: AnswerKind.CHOICE,
    STEP_CANCEL_PICK: AnswerKind.CHOICE,
    STEP_RESCHEDULE_PICK: AnswerKind.CHOICE,
}

# Said to the parser after the step's question. The parser eval asks the grade question this way.
_PARSER_HINTS = {STEP_CHILD_GRADE: "(K, Kindergarten or kínder = 0)"}

# The steps that cannot run without a `guardians` row. A stored state pointing at one of these
# with no guardian behind it — a turn whose commit failed, a client an admin removed — restarts
# the flow rather than raising, which is the same clean restart REQ-076 asks of an expired key.
# The intake steps are absent on purpose: they run both before a guardian exists and again for
# the second child of a guardian who now does.
_GUARDIAN_STEPS = frozenset(
    {
        STEP_REMINDERS_OPT_IN,
        STEP_MENU,
        STEP_BOOK_CHILD,
        STEP_BOOK_SUBJECT,
        STEP_BOOK_TUTOR,
        STEP_BOOK_DATE,
        STEP_BOOK_HOME,
        STEP_BOOK_SLOT,
        STEP_BOOK_CONFIRM,
        STEP_FIRST_SESSION_SUBJECT,
        STEP_FIRST_SESSION_DATE,
        STEP_CANCEL_PICK,
        STEP_CANCEL_CONFIRM,
        STEP_RESCHEDULE_PICK,
        STEP_REACTIVATION_CONFIRM,
    }
)

# What a reactivation offer parks in `collected_data`, popped on every exit from
# `STEP_REACTIVATION_CONFIRM`. `reactivation_resume_name` is optional — present only for a
# typo-only offer at the child-name question (SA-32) — and so is not in `_REQUIRED_KEYS`.
_REACTIVATION_KEYS = (
    "reactivation_child_id",
    "reactivation_child_name",
    "reactivation_resume_name",
)

# The intents at the menu whose `child_name` field is read for an inactive child (§4a (a)).
# Cancel and reschedule have nothing to act on for an inactive child — deactivation cancelled
# its sessions (REQ-110.3) — and a link request is P7-F's path.
_NAMING_INTENTS = frozenset({BotIntent.BOOK, BotIntent.UNKNOWN})

_BOOKING_KEYS = (
    "book_child_id",
    # Retired with Subject levels; still popped so a flow saved before then drops it.
    "book_grade_level",
    "book_subject_id",
    "book_tutor_id",
    "book_date",
    "book_home_id",
    "chosen",
    "reschedule_booking_id",
    "cancel_booking_id",
)

# What each step's handler reads out of `collected_data` before it writes anything of its own —
# the exact shape a stale payload (a build whose handler now reads a key an older build never
# wrote) fails on with a `KeyError`. A step absent here needs nothing beyond the step's own
# answer, which arrives through `parsed.answer` rather than `collected_data`.
_INTAKE_KEYS = frozenset({"guardian_name", "address", "access_code"})

_REQUIRED_KEYS: dict[str, frozenset[str]] = {
    # `child_grade` is optional: a flow saved before the grade step existed creates the Child
    # with no grade rather than restarting.
    STEP_CHILD_SCHOOL: frozenset({"child_name"}),
    STEP_CHILD_GRADE: frozenset({"child_name"}),
    STEP_CHILD_NOTES: frozenset({"child_name", "child_date_of_birth", "child_school"}),
    STEP_BOOK_SUBJECT: frozenset({"book_child_id"}),
    STEP_BOOK_DATE: frozenset({"book_child_id"}),
    STEP_FIRST_SESSION_SUBJECT: frozenset({"book_child_id"}),
    STEP_FIRST_SESSION_DATE: frozenset({"book_child_id", "book_subject_id"}),
    STEP_BOOK_HOME: frozenset({"book_child_id", "book_date", "book_tutor_id", "book_subject_id"}),
    STEP_BOOK_SLOT: frozenset({"book_date"}),
    STEP_REACTIVATION_CONFIRM: frozenset({"reactivation_child_id", "reactivation_child_name"}),
    STEP_CANCEL_CONFIRM: frozenset({"cancel_booking_id"}),
    STEP_BOOK_CONFIRM: frozenset(
        {
            "chosen",
            "book_child_id",
            "book_subject_id",
            "book_home_id",
            "book_date",
            "book_tutor_id",
        }
    ),
}


@dataclass(frozen=True, slots=True)
class _Turn:
    """Everything one turn of one flow is allowed to see."""

    db: Session
    phone_number: str
    body: str
    guardian: Guardian | None
    now: datetime.datetime
    state: FlowState
    reactivation_pending: bool
    # The effective language of this turn's replies: adopted, stored, or English.
    language: GuardianLanguage

    @property
    def data(self) -> dict[str, Any]:
        return self.state.collected_data


@dataclass(frozen=True, slots=True)
class _Next:
    """A handler's verdict: what to say, and where the flow goes.

    `step is None` ends the flow and clears the row — the next message opens a new one.
    It is **not** how the bail-out ends a turn: REQ-078.2 requires the state to survive there,
    so `_miss` writes the state back itself and never builds one of these.
    """

    reply: str
    step: str | None
    link_guardian_id: uuid.UUID | None = None
    flag_reason: FlagReason | None = None
    reactivation_child_id: uuid.UUID | None = None
    consent: ConsentInstruction | None = None


@dataclass(frozen=True, slots=True)
class _Aside:
    """A reply that answers the parent without moving the flow.

    The step and the miss count stay exactly as they were, so small talk can never bail a
    parent out and never wipes a miss they have already used.
    """

    reply: str
    flag_reason: FlagReason | None = None


@dataclass(frozen=True, slots=True)
class _GiveUp:
    """How an optional step ends instead of bailing out: after `reprompts` re-prompts, the next
    unusable reply moves the flow on with `move_on` rather than handing it to Staff."""

    reprompts: int
    move_on: Callable[[_Turn], _Next]


class _Ambiguity(enum.Enum):
    """More than one child matched a name, and at least one of them is inactive (REQ-132.5)."""

    INACTIVE_AMONG_SEVERAL = "inactive_among_several"


_AMBIGUOUS = _Ambiguity.INACTIVE_AMONG_SEVERAL


class _Refusal(enum.Enum):
    """Why a handler could not use a reply it did read, so the re-prompt can say so.

    A handler returns `None` when the reply gave it nothing to work with, and one of these
    when it did and the value was wrong; `_miss` turns either into the parent's nudge.
    """

    IMPLAUSIBLE_BIRTH_DATE = "implausible_birth_date"
    UNREADABLE_DATE = "unreadable_date"
    OPTION_OUT_OF_RANGE = "option_out_of_range"
    AMBIGUOUS_NAME = "ambiguous_name"
    AMBIGUOUS_CHILD = "ambiguous_child"
    GRADE_OUT_OF_RANGE = "grade_out_of_range"


type _Outcome = _Next | _Aside | _Refusal | None
type _Handler = Callable[[_Turn, ParsedIntent], _Outcome]
type _NameHit = Child | _Ambiguity | None


def reply_for(
    db: Session,
    *,
    phone_number: str,
    body: str,
    guardian_id: uuid.UUID | None,
    reactivation_pending: bool = False,
    language: GuardianLanguage | None = None,
    button: ReminderButton | None = None,
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

    **`reactivation_pending`** is whether the conversation already carries a reactivation
    request (REQ-132.6, OQ-74). The webhook reads the column under the conversation's row lock
    and passes it in, so this module stays off the conversation row (P7-C). While it is true the
    bot refuses a second request rather than offering one.

    **`language`** is the stored Guardian language, `None` when not detected yet. The returned
    `BotTurn.language` is set only when this turn adopted a different one (module docstring).

    **`button`** is a weekly-reminder quick-reply tap. Neither needs the parser. "Stop
    reminders" is the STOP keyword, and "Book a session" starts a booking for the Children the
    reminder is about (`_book_from_reminder`). Both need a known Guardian; without one the tap
    is read as the text it carries.
    """
    state = load_state(db, phone_number=phone_number)
    guardian = _recognise(db, phone_number=phone_number, guardian_id=guardian_id)

    if button is ReminderButton.BOOK_SESSION and guardian is not None:
        decided = _book_from_reminder(
            db,
            phone_number=phone_number,
            body=body,
            guardian=guardian,
            reactivation_pending=reactivation_pending,
            stored_language=language,
        )
    elif _resumable(state, guardian):
        decided = _take_turn(
            db,
            phone_number=phone_number,
            body=body,
            guardian=guardian,
            state=state,
            reactivation_pending=reactivation_pending,
            stored_language=language,
            button=button,
        )
    else:
        decided = _open(
            db,
            phone_number=phone_number,
            body=body,
            guardian=guardian,
            stored_language=language,
            button=button,
        )

    if guardian_id is None and guardian is not None and decided.link_guardian_id is None:
        decided = decided.model_copy(update={"link_guardian_id": guardian.id})

    return decided


def _take_turn(
    db: Session,
    *,
    phone_number: str,
    body: str,
    guardian: Guardian | None,
    state: FlowState,
    reactivation_pending: bool,
    stored_language: GuardianLanguage | None,
    button: ReminderButton | None,
) -> BotTurn:
    # The turn's one clock read; every handler uses `turn.now`.
    now = clock.business_now()
    keyword = _keyword_request(body, guardian=guardian, step=state.step, button=button)
    # A keyword needs no parse, which is what keeps STOP working through a parser outage.
    parsed = (
        None
        if keyword is not None
        else _parse(
            step=state.step,
            question=" ".join(filter(None, [state.prompt, _PARSER_HINTS.get(state.step)])),
            body=body,
            context=_context(state),
            answer_kind=_ANSWER_KINDS.get(state.step, AnswerKind.TEXT),
            today=now.date(),
        )
    )
    adopted = _adopted_language(parsed, body=body, keyword=keyword, stored=stored_language)
    turn = _Turn(
        db=db,
        phone_number=phone_number,
        body=body,
        guardian=guardian,
        now=now,
        state=state,
        reactivation_pending=reactivation_pending,
        language=_effective_language(adopted, stored=stored_language),
    )

    request = keyword or _parsed_request(parsed, guardian=guardian, step=state.step)

    if keyword is not None and state.step == STEP_REMINDERS_OPT_IN:
        # Only STOP reaches here (`_keyword_request`): at this question it is a plain no.
        decided = _apply(turn, _answer_reminders(turn, is_yes=False))
    elif request is not None:
        decided = _confirm_reminders(request, language=turn.language)
    elif parsed is None:
        # REQ-078.3: flag on the first occurrence and leave the state exactly as it is — the
        # re-prompt counter is not burned on an outage the parent did not cause.
        decided = BotTurn(
            reply=_say(turn, "PARSER_UNAVAILABLE"), flag_reason=FlagReason.PARSE_ERROR
        )
    else:
        result = None if parsed.confidence_is_low else _HANDLERS[state.step](turn, parsed)
        if isinstance(result, _Next):
            decided = _apply(turn, result)
        elif isinstance(result, _Aside):
            decided = _set_aside(turn, result)
        else:
            decided = _miss(turn, parsed, result)

    return decided.model_copy(update={"language": adopted})


def _parse(
    *,
    step: str,
    question: str,
    body: str,
    context: dict[str, str],
    answer_kind: AnswerKind,
    today: datetime.date,
) -> ParsedIntent | None:
    """`parser_service.parse_intent`, with an outage as `None` for the caller to decide on."""
    try:
        parsed = parser_service.parse_intent(
            step=step,
            question=question,
            body=body,
            context=context,
            answer_kind=answer_kind,
            today=today,
        )
    except parser_service.ParseFailed as error:
        # ParseFailed messages are fixed strings, so logging one cannot leak the body.
        logger.warning("bot parser failed at step %s: %s", step, error)
        parsed = None

    return parsed


def _keyword_request(
    body: str, *, guardian: Guardian | None, step: str | None, button: ReminderButton | None
) -> RemindersRequest | None:
    """A STOP/BAJA/PARAR or START/ALTA keyword this turn acts on without the parser. A "Stop
    reminders" tap is a STOP.

    None before a Guardian exists: there is nothing to record against, and the message is the
    answer to the Intake question it replies to. At the reminder question only STOP counts
    (a no); anything else there is that question's yes/no for the parser to read.
    """
    if guardian is None:
        request = None
    elif button is ReminderButton.STOP_REMINDERS or bot_messages.is_stop_keyword(body):
        request = "stop"
    elif bot_messages.is_start_keyword(body) and step != STEP_REMINDERS_OPT_IN:
        request = "start"
    else:
        request = None

    return request


def _parsed_request(
    parsed: ParsedIntent | None, *, guardian: Guardian | None, step: str | None
) -> RemindersRequest | None:
    """The parser's stop/start reading of a free-text phrase, when the turn can act on it.

    Ignored at the reminder question, where the yes/no is the answer, and when the parser was
    unsure: a guess must not turn reminders on or off.
    """
    is_readable = (
        parsed is not None
        and guardian is not None
        and step != STEP_REMINDERS_OPT_IN
        and not parsed.confidence_is_low
    )

    return parsed.reminders if is_readable and parsed is not None else None


def _confirm_reminders(request: RemindersRequest, *, language: GuardianLanguage) -> BotTurn:
    """Confirm a stop or start and hand the consent to the webhook.

    The flow state is deliberately not saved: its step, answers, misses and prompt stay as
    they were, so the next message answers the same question the Guardian was on.
    """
    is_stop = request == "stop"

    return BotTurn(
        reply=bot_messages.render("OPTED_OUT" if is_stop else "OPTED_IN", language),
        consent=ConsentInstruction(
            action=ConsentAction.OPT_OUT if is_stop else ConsentAction.OPT_IN,
            source=ConsentSource.MESSAGE,
        ),
    )


def _adopted_language(
    parsed: ParsedIntent | None,
    *,
    body: str,
    keyword: RemindersRequest | None,
    stored: GuardianLanguage | None,
) -> GuardianLanguage | None:
    """The language this turn switches to: a clear one that differs from the stored one.

    A name, a number or "ok" parses as no language, so it never flips a Guardian's language.
    A keyword is never parsed: BAJA, PARAR and ALTA are Spanish words and mean Spanish, while
    STOP and START are neutral.
    """
    if keyword is not None:
        detected = keyword_language(body)
    else:
        detected = None if parsed is None else parsed.language

    return detected if detected != stored else None


def keyword_language(body: str) -> GuardianLanguage | None:
    """Spanish for a Spanish-only stop/start keyword, else `None` (no clear language).

    Public because the webhook applies the same rule to a keyword sent under Takeover.
    """
    return "es" if bot_messages.is_spanish_keyword(body) else None


def _effective_language(
    adopted: GuardianLanguage | None, *, stored: GuardianLanguage | None
) -> GuardianLanguage:
    return adopted or stored or bot_messages.DEFAULT_LANGUAGE


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


def _open(
    db: Session,
    *,
    phone_number: str,
    body: str,
    guardian: Guardian | None,
    stored_language: GuardianLanguage | None,
    button: ReminderButton | None,
) -> BotTurn:
    """Greet, and ask the first question. This turn's message is not consumed.

    A fresh flow answers the opening prompt rather than trying to interpret "hi" as a step it
    has not asked about yet — which is what a re-prompt counter would otherwise start eating.
    The message is parsed for its language only, so "Hola" is greeted in Spanish. An outage
    here is not flagged: the greeting needs nothing from the parse.
    """
    keyword = _keyword_request(body, guardian=guardian, step=None, button=button)
    parsed = (
        None
        if keyword is not None
        else _parse(
            step=OPENING_STEP,
            question=OPENING_QUESTION,
            body=body,
            context={},
            answer_kind=AnswerKind.TEXT,
            today=clock.business_now().date(),
        )
    )
    adopted = _adopted_language(parsed, body=body, keyword=keyword, stored=stored_language)
    language = _effective_language(adopted, stored=stored_language)
    request = keyword or _parsed_request(parsed, guardian=guardian, step=None)

    if request is not None:
        # A stop or start opens no flow: the next message is greeted as this one would be.
        decided = _confirm_reminders(request, language=language)
    else:
        decided = _greet(db, phone_number=phone_number, guardian=guardian, language=language)

    return decided.model_copy(update={"language": adopted})


def _greet(
    db: Session, *, phone_number: str, guardian: Guardian | None, language: GuardianLanguage
) -> BotTurn:
    if guardian is None:
        greeting = bot_messages.render("GREETING_NEW", language)
        question = bot_messages.render("ASK_GUARDIAN_NAME", language)
        step = STEP_INTAKE_NAME
    else:
        greeting = bot_messages.render("GREETING_RETURNING", language, name=guardian.name)
        question = bot_messages.render("ASK_MENU", language)
        step = STEP_MENU
    reply = f"{greeting} {question}"

    save_state(
        db,
        phone_number=phone_number,
        state=FlowState(step=step, collected_data={}, misses=0, prompt=reply),
    )

    return BotTurn(reply=reply)


def _apply(turn: _Turn, result: _Next) -> BotTurn:
    """Persist the advanced flow and turn the handler's verdict into the webhook's instructions."""
    if result.step is None:
        clear_state(turn.db, phone_number=turn.phone_number)
    else:
        turn.state.step = result.step
        turn.state.prompt = result.reply
        turn.state.misses = 0
        save_state(turn.db, phone_number=turn.phone_number, state=turn.state)

    return BotTurn(
        reply=result.reply,
        link_guardian_id=result.link_guardian_id,
        flag_reason=result.flag_reason,
        reactivation_child_id=result.reactivation_child_id,
        consent=result.consent,
    )


def _set_aside(turn: _Turn, result: _Aside) -> BotTurn:
    """Answer without advancing: only the prompt moves on, so the parser sees what was said."""
    turn.state.prompt = result.reply
    save_state(turn.db, phone_number=turn.phone_number, state=turn.state)

    return BotTurn(reply=result.reply, flag_reason=result.flag_reason)


def _miss(turn: _Turn, parsed: ParsedIntent, refusal: _Refusal | None) -> BotTurn:
    """A reply this step could not use: re-prompt, or bail out on the third one (REQ-078.2).

    `step` and `collected_data` are untouched either way, so the bail-out hands the thread to
    an admin without costing the parent the answers they have already given — the next message
    the bot *can* use carries on from the same question.
    A step in `_GIVE_UPS` never bails: once its own re-prompts are spent it moves the flow on
    instead, with no flag.
    """
    give_up = _GIVE_UPS.get(turn.state.step)
    reprompts = MAX_REPROMPTS if give_up is None else give_up.reprompts
    turn.state.misses += 1
    # Names and presence only, never values: fields and answers hold the parent's PII.
    logger.warning(
        "bot miss at step %s: intent=%s confidence_is_low=%s fields=%s answer=%s "
        "refusal=%s misses=%d",
        turn.state.step,
        parsed.intent.value,
        parsed.confidence_is_low,
        sorted(parsed.fields),
        "present" if parsed.answer and parsed.answer.strip() else "empty",
        None if refusal is None else refusal.value,
        turn.state.misses,
    )
    has_run_out = turn.state.misses > reprompts

    if has_run_out and give_up is not None:
        # `_apply` saves the advanced state and resets the counter.
        result = _apply(turn, give_up.move_on(turn))
    elif has_run_out:
        # `stuck` is "two failed re-prompts in a row" (docs/erd.md): the next stretch of
        # unusable replies starts counting from zero instead of re-flagging at once.
        turn.state.misses = 0
        save_state(turn.db, phone_number=turn.phone_number, state=turn.state)
        result = BotTurn(reply=_say(turn, "BAILED_OUT"), flag_reason=FlagReason.STUCK)
    else:
        save_state(turn.db, phone_number=turn.phone_number, state=turn.state)
        result = BotTurn(reply=_nudge(turn, refusal))

    return result


def _nudge(turn: _Turn, refusal: _Refusal | None) -> str:
    """The re-prompt: what the step needs, led by why the reply was refused when that is known,
    and followed by the step's numbered options when it has them."""
    step = turn.state.step
    options: list[dict[str, Any]] = turn.data.get("options", [])

    # Each step rephrases its question as what the bot needs rather than repeating it (REQ-078.2):
    # a parent who misread the question once would misread the same words again.
    nudge_values = {"name": turn.data["child_name"]} if step == STEP_CHILD_GRADE else {}
    step_nudge = _say(turn, _NUDGE_IDS.get(step, f"NUDGE_{step}"), **nudge_values)

    if refusal is _Refusal.OPTION_OUT_OF_RANGE:
        text = _say(turn, "OPTION_OUT_OF_RANGE", count=len(options))
    elif refusal is _Refusal.AMBIGUOUS_NAME:
        text = _say(turn, "AMBIGUOUS_NAME")
    elif refusal is _Refusal.AMBIGUOUS_CHILD:
        # The name also matches an inactive child, who is not in the list (REQ-132.5); no child is
        # named, and the full name is what reaches that child's reactivation offer.
        text = _say(turn, "AMBIGUOUS_CHILD")
    elif refusal is _Refusal.IMPLAUSIBLE_BIRTH_DATE:
        text = f"{_say(turn, 'IMPLAUSIBLE_BIRTH_DATE')} {step_nudge}"
    elif refusal is _Refusal.UNREADABLE_DATE:
        text = f"{_say(turn, 'UNREADABLE_DATE')} {step_nudge}"
    elif refusal is _Refusal.GRADE_OUT_OF_RANGE:
        text = f"{_say(turn, 'GRADE_OUT_OF_RANGE')} {step_nudge}"
    else:
        text = step_nudge

    if _ANSWER_KINDS.get(step) is AnswerKind.CHOICE and options:
        text = f"{text}\n{_numbered(options)}"

    return text


def _stuck(turn: _Turn) -> _Next:
    return _Next(reply=_say(turn, "CANNOT_CONTINUE"), step=None, flag_reason=FlagReason.STUCK)


# --- intake (REQ-073) ------------------------------------------------------------------------


def _say(turn: _Turn, message_id: str, **values: str | int) -> str:
    return bot_messages.render(message_id, turn.language, **values)


def _collect_text(key: str, reply_id: str, step: str, *, limit: int) -> _Handler:
    """A step whose whole job is to store one free-text answer and ask the next question,
    named by its message ID.

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
            result = _Next(reply=_say(turn, reply_id), step=step)

        return result

    return handler


def _intake_access_code(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The access code, kept as written, except that a Spanish none word ("ninguno", "no hay")
    is stored as `NO_ACCESS_CODE`, the English Guardian's "none"."""
    value = _answer(turn, parsed)

    if value is None:
        result = None
    else:
        is_none = _normalized(value) in _SPANISH_SKIP
        turn.data["access_code"] = NO_ACCESS_CODE if is_none else value[:ACCESS_CODE_LIMIT]
        result = _Next(reply=_say(turn, "ASK_HOME_LABEL"), step=STEP_INTAKE_LABEL)

    return result


def _intake_label(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The optional home label, and therefore the one intake step that never re-prompts.

    "No thanks" is an answer, so a missing or negative value stores nothing rather than costing
    the parent a re-prompt. `homes.label` is what makes the later "Mum's or Dad's?" question
    answerable over WhatsApp, where two full street addresses are not (#39).
    """
    label = _answer(turn, parsed)

    if label is not None and _normalized(label) not in _SKIP_LABEL:
        turn.data["home_label"] = label[:LABEL_LIMIT]

    return _Next(reply=_say(turn, "ASK_CHILD_REGISTERED"), step=STEP_CHILD_REGISTERED)


def _child_registered(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """P7-F's gate. "Yes" stops here and writes nothing: phone-alone identity cannot tell a real
    second guardian from anyone who knows a child's name, and linking would hand over the other
    guardian's home address and door access code. The bot asks, writes no child row and no link,
    and raises `guardian_link_request` for an admin. Do not relax this into an automatic link."""
    answer = _yes_no(turn, parsed)

    if answer is None:
        result = None
    elif answer:
        result = _Next(
            reply=_say(turn, "GUARDIAN_LINK_REPLY"),
            step=None,
            flag_reason=FlagReason.GUARDIAN_LINK_REQUEST,
        )
    else:
        result = _Next(reply=_say(turn, "ASK_CHILD_NAME"), step=STEP_CHILD_NAME)

    return result


_collect_child_name = _collect_text("child_name", "ASK_CHILD_DOB", STEP_CHILD_DOB, limit=NAME_LIMIT)


def _child_name(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The new child's name — and detection point (c) for a guardian who already exists (§4a).

    A returning guardian naming one of their own inactive children is offered reactivation
    rather than registering a duplicate (REQ-132.7). An exact or whole-word hit is offered, or
    refused while a request is pending, and nothing is stored under `child_name`. A **typo-only**
    hit is as likely a new sibling ("Liam" beside an inactive "Lian") as a typo, so its offer
    keeps the name as typed in `reactivation_resume_name` for a "no" to resume with, and while a
    request is pending it is ignored rather than refused (SA-32, P7D-N). Everything else is
    `_collect_text`'s answer, unchanged. A new guardian has no children to match.
    """
    raw = _answer(turn, parsed)

    if turn.guardian is None or raw is None:
        result = _collect_child_name(turn, parsed)
    else:
        linked = _linked_children(turn.db, guardian_id=turn.guardian.id)
        exact = exact_matches(linked, raw)
        hit = _inactive_hit(exact) if exact else _inactive_hit(typo_matches(linked, raw))

        if not isinstance(hit, Child):
            result = _collect_child_name(turn, parsed)
        elif exact:
            result = _offer_reactivation(turn, child=hit)
        elif turn.reactivation_pending:
            result = _collect_child_name(turn, parsed)
        else:
            result = _offer_reactivation(turn, child=hit, resume_name=raw[:NAME_LIMIT])

    return result


def _child_date_of_birth(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """The ISO form only, and only a date `child_service` would accept (REQ-096.3).

    Resolving "April 23rd 2016" is the parser's job, told the `DATE` answer kind and today's
    date. Anything else is a re-prompt rather than a guess, and so is an implausible date:
    `create_child` refuses one on the notes turn, and a refusal there is a 500 the webhook
    cannot answer. The two refusals say which went wrong.
    """
    raw = _answer(turn, parsed)
    value = _iso_date(raw)

    if raw is None:
        result: _Outcome = None
    elif value is None:
        result = _Refusal.UNREADABLE_DATE
    elif not child_service.date_of_birth_is_plausible(value, today=turn.now.date()):
        result = _Refusal.IMPLAUSIBLE_BIRTH_DATE
    else:
        turn.data["child_date_of_birth"] = value.isoformat()
        result = _Next(reply=_say(turn, "ASK_CHILD_SCHOOL"), step=STEP_CHILD_SCHOOL)

    return result


def _child_school(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    value = _answer(turn, parsed)

    if value is None:
        result = None
    else:
        turn.data["child_school"] = value[:NAME_LIMIT]
        result = _Next(
            reply=_say(turn, "ASK_CHILD_GRADE", name=turn.data["child_name"]),
            step=STEP_CHILD_GRADE,
        )

    return result


def _child_grade(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """The Overall grade, K (0) to 12. The parser turns "quinto grado" or "kínder" into digits;
    anything it gives that is not a K-12 grade ("13", "college") is refused as out of range."""
    raw = _answer(turn, parsed)
    grade = None if raw is None else _k12_grade(raw)

    if raw is None:
        result: _Outcome = None
    elif grade is None:
        result = _Refusal.GRADE_OUT_OF_RANGE
    else:
        turn.data["child_grade"] = grade
        result = _ask_child_notes(turn)

    return result


def _k12_grade(raw: str) -> int | None:
    # `isdecimal`, not `isdigit`: "²" is a digit that `int` refuses.
    grade = int(raw) if raw.isdecimal() else None
    is_in_range = grade is not None and LOWEST_GRADE <= grade <= HIGHEST_GRADE

    return grade if is_in_range else None


def _ask_child_notes(turn: _Turn) -> _Next:
    return _Next(reply=_say(turn, "ASK_CHILD_NOTES"), step=STEP_CHILD_NOTES)


def _child_notes(turn: _Turn, parsed: ParsedIntent) -> _Next:
    """The optional notes answer, the last of one child's details, and the only turn an intake
    writes anything.

    **It never re-prompts** (A-45), like `_intake_label`: "none" is an answer, and so is a reply
    the parser extracted nothing from. Either stores `notes` as NULL.

    **Every row #39 names lands here, in one transaction** (REQ-073.2/.3, P7-AA): a `guardians`
    row, a `homes` row and a `guardian_homes` link on the first child, then a `children` row plus
    a `child_homes` and a `child_guardians` link for each. Holding the guardian in flow state
    until a child exists is what makes "a refused intake leaves none of it behind" true of the whole
    intake rather than only of its tail — and it is what lets P7-F's refusal write *nothing at
    all*.

    The guardian's `phone_number` goes through `phone_service` here (REQ-073.4, D-L): this is a
    new row entering the database, unlike the inbound number the thread is keyed on (P7-H).

    For a guardian who already exists — the second child of an intake, or a returning client
    with no child on file — the child is linked to every home that guardian already has, which
    is the correlation `child_homes` exists to record.
    """
    answer = _answer(turn, parsed)

    if answer is None or _normalized(answer) in _NO_NOTES:
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

    # Popped so the next Child of this Intake never inherits it. Only an int is a grade this
    # step stored: a string is the retired grade step's, from an older build, and is dropped.
    stored_grade = turn.data.pop("child_grade", None)
    grade_level = stored_grade if isinstance(stored_grade, int) else None

    if guardian_id is None or not home_ids:
        result = _stuck(turn)
    else:
        child = child_service.create_child(
            turn.db,
            guardian_ids=[guardian_id],
            home_ids=home_ids,
            name=turn.data["child_name"],
            date_of_birth=datetime.date.fromisoformat(turn.data["child_date_of_birth"]),
            grade_level=grade_level,
            school_name=turn.data["child_school"],
            notes=notes,
        )
        result = _Next(
            reply=f"{_say(turn, 'CHILD_ADDED', name=child.name)} {_say(turn, 'ASK_MORE_CHILDREN')}",
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
        result = _Next(reply=_say(turn, "ASK_CHILD_REGISTERED"), step=STEP_CHILD_REGISTERED)
    else:
        result = _end_intake(turn)

    return result


def _end_intake(turn: _Turn) -> _Next:
    """The evaluation notice, once however many Children were added, then the reminder
    question for a Guardian who has never opted in or out, else straight to the menu.

    Every Guardian ends an Intake here, a returning or Staff-created one adding a Child too.
    """
    notice = _say(turn, "EVALUATION_NOTICE")
    should_ask = turn.guardian is not None and not reminder_consent_service.has_consent(
        turn.db, guardian_id=turn.guardian.id
    )

    if should_ask:
        result = _Next(reply=f"{notice} {_say(turn, 'ASK_REMINDERS')}", step=STEP_REMINDERS_OPT_IN)
    else:
        result = _ready_at_menu(turn, lead=notice)

    return result


def _reminders_opt_in(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The answer to `ASK_REMINDERS`, which is the opt-in evidence.

    STOP/BAJA/PARAR is a clear no here, answered with the no reply alone; `_take_turn` reads
    it from the raw message before the parser, so it holds through a parser outage. The
    parser's `reminders` field is deliberately not read: at this question a request to stop is
    a "no". An unclear reply is re-asked once, then reminders are left off (`_GIVE_UPS`).
    """
    answer = _yes_no(turn, parsed)

    return None if answer is None else _answer_reminders(turn, is_yes=answer)


def _answer_reminders(turn: _Turn, *, is_yes: bool) -> _Next:
    action = ConsentAction.OPT_IN if is_yes else ConsentAction.OPT_OUT

    return _ready_at_menu(
        turn,
        lead=_say(turn, "REMINDERS_ON" if is_yes else "REMINDERS_DECLINED"),
        consent=ConsentInstruction(action=action, source=ConsentSource.INTAKE),
    )


def _leave_reminders_off(turn: _Turn) -> _Next:
    return _ready_at_menu(turn, lead=_say(turn, "REMINDERS_LEFT_OFF"))


def _ready_at_menu(turn: _Turn, *, lead: str, consent: ConsentInstruction | None = None) -> _Next:
    reply = f"{lead} {_say(turn, 'CLIENT_READY')} {_say(turn, 'ASK_MENU')}"

    return _Next(reply=reply, step=STEP_MENU, consent=consent)


# --- the menu, and the three things a returning guardian can ask for (REQ-075) -----------------


def _menu(turn: _Turn, parsed: ParsedIntent) -> _Next | _Aside | None:
    """Dispatch on the intent — after detection point (a) has looked for an inactive child.

    Only `book` and `unknown` are read for a name (§4a). A unique inactive hit is offered; an
    ambiguous one picks nothing by that name, so a booking asks which child even when only one
    is active and an `unknown` re-prompts (REQ-132.5). Anything else is today's dispatch.
    Small talk and a question the bot cannot answer are asides: neither is a miss.
    """
    named = _named_at_menu(turn, parsed)

    if isinstance(named, Child):
        result = _offer_reactivation(turn, child=named)
    elif named is _AMBIGUOUS:
        result = _begin_booking(turn, always_ask=True) if parsed.intent is BotIntent.BOOK else None
    elif parsed.intent is BotIntent.BOOK:
        result = _begin_booking(turn)
    elif parsed.intent is BotIntent.CANCEL:
        result = _begin_change(turn, moving=False)
    elif parsed.intent is BotIntent.RESCHEDULE:
        result = _begin_change(turn, moving=True)
    elif parsed.intent is BotIntent.LINK_GUARDIAN:
        result = _Next(
            reply=_say(turn, "GUARDIAN_LINK_REPLY"),
            step=None,
            flag_reason=FlagReason.GUARDIAN_LINK_REQUEST,
        )
    elif parsed.intent is BotIntent.CHIT_CHAT:
        # Neither aside states a fact about the service: the bot knows no prices or policies
        # (REQ-075), and the office answers the question instead.
        result = _Aside(reply=f"{_say(turn, 'SMALL_TALK_REPLY')} {_say(turn, 'ASK_MENU')}")
    elif parsed.intent is BotIntent.QUESTION:
        result = _Aside(
            reply=f"{_say(turn, 'QUESTION_PASSED_ON')} {_say(turn, 'ASK_MENU')}",
            flag_reason=FlagReason.QUESTION,
        )
    else:
        result = None

    return result


def _begin_booking(turn: _Turn, *, always_ask: bool = False) -> _Next:
    """REQ-074's first step. The child question is skipped when there is only one active child,
    unless `always_ask`: the guardian named a child ambiguously with an inactive one among the
    matches, and skipping would pick a child by that name after all (REQ-132.5).

    With no active child the guardian takes the add-a-child path, and that fallback is **final,
    not interim** (SA-27, REQ-114.3): `NO_ACTIVE_CHILDREN` when they have inactive children —
    whose names detection point (c) then recognises at the name question (REQ-132.7) — and
    `NO_CHILDREN_YET` when they have none at all.
    """
    _reset_booking(turn.data)
    children = _children(turn.db, guardian_id=turn.guardian.id)

    if not children:
        has_inactive = bool(_linked_children(turn.db, guardian_id=turn.guardian.id))
        opener = _say(turn, "NO_ACTIVE_CHILDREN" if has_inactive else "NO_CHILDREN_YET")
        result = _Next(
            reply=f"{opener} {_say(turn, 'ASK_CHILD_REGISTERED')}", step=STEP_CHILD_REGISTERED
        )
    elif len(children) == 1 and not always_ask:
        result = _ask_subject(turn, child=children[0])
    else:
        options = [{"id": str(child.id), "label": child.name} for child in children]
        result = _Next(
            reply=f"{_say(turn, 'ASK_WHICH_CHILD')}\n{_offer(turn.state, options)}",
            step=STEP_BOOK_CHILD,
        )

    return result


def _book_from_reminder(
    db: Session,
    *,
    phone_number: str,
    body: str,
    guardian: Guardian,
    reactivation_pending: bool,
    stored_language: GuardianLanguage | None,
) -> BotTurn:
    """A "Book a session" tap: book for the Children a reminder sent now would name.

    The week is the first Monday strictly after today, and the Children are the reminder's
    own rule (`reminder_service.eligible_children`), recomputed at the tap: one booked since
    the reminder went out is no longer offered. Any flow in progress is dropped, as a new
    booking from the menu drops it. The reply stays in the stored language: a tap carries no
    words to detect one from.
    """
    now = clock.business_now()
    turn = _Turn(
        db=db,
        phone_number=phone_number,
        body=body,
        guardian=guardian,
        now=now,
        state=FlowState(step=STEP_MENU, collected_data={}, misses=0, prompt=""),
        reactivation_pending=reactivation_pending,
        language=_effective_language(None, stored=stored_language),
    )
    children = reminder_service.eligible_children(
        db, guardian_id=guardian.id, week_start=reminder_service.week_start_after(now.date())
    )

    if not children:
        result = _Next(
            reply=f"{_say(turn, 'REMINDER_ALL_BOOKED')} {_say(turn, 'ASK_MENU')}", step=STEP_MENU
        )
    elif len(children) == 1:
        subject = _ask_subject(turn, child=children[0])
        lead = _say(turn, "REMINDER_BOOK_ONE", name=children[0].name)
        # A flow that cannot go on (no active Subject) ends on its own reply, without the lead.
        is_booking = subject.step is not None
        result = (
            dataclasses.replace(subject, reply=f"{lead} {subject.reply}") if is_booking else subject
        )
    else:
        options = [{"id": str(child.id), "label": child.name} for child in children]
        result = _Next(
            reply=f"{_say(turn, 'ASK_WHICH_CHILD')}\n{_offer(turn.state, options)}",
            step=STEP_BOOK_CHILD,
        )

    return _apply(turn, result)


def _begin_change(turn: _Turn, *, moving: bool) -> _Next:
    """The shared front half of cancel and reschedule: list what there is to act on.

    The list is read from the guardian's side — their children's live, future bookings — and
    carries no `tutor_id` predicate. P7-T leg 1 is this query.
    """
    bookings = _upcoming_bookings(
        turn.db, guardian_id=turn.guardian.id, on_or_after=turn.now.date()
    )

    if not bookings:
        result = _Next(
            reply=f"{_say(turn, 'NO_UPCOMING')} {_say(turn, 'ASK_MENU')}", step=STEP_MENU
        )
    else:
        options = [
            {"id": str(booking.id), "label": _booking_label(booking, turn.language)}
            for booking in bookings
        ]
        question = _say(turn, "ASK_WHICH_TO_MOVE" if moving else "ASK_WHICH_TO_CANCEL")
        result = _Next(
            reply=f"{question}\n{_offer(turn.state, options)}",
            step=STEP_RESCHEDULE_PICK if moving else STEP_CANCEL_PICK,
        )

    return result


def _cancel_pick(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """REQ-075.3, and `cancellation_cutoff_hours`'s first consumer: the pick, then a confirm.

    Inside the window the bot declines and does **not** flag: a policy refusal is not a bot
    failure, and no flag reason exists for one. The cutoff is checked here so the refusal comes
    before the confirm question, and again on the "yes", which can arrive much later.
    """
    booking = _picked_booking(turn, parsed)

    if not isinstance(booking, Booking):
        return booking

    if _inside_cutoff(turn.db, booking=booking, now=turn.now):
        return _Next(reply=_say(turn, "CUTOFF_DECLINED"), step=None)

    turn.data["cancel_booking_id"] = str(booking.id)

    return _Next(
        reply=_say(
            turn,
            "CONFIRM_CANCEL",
            child=booking.child.name,
            date=bot_messages.format_date(booking.scheduled_date, turn.language),
            time=bot_messages.format_time_range(
                booking.start_time, booking.end_time, turn.language
            ),
        ),
        step=STEP_CANCEL_CONFIRM,
    )


def _cancel_confirm(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """The answer to the cancel confirmation. "No" keeps the session and goes back to the menu."""
    answer = _yes_no(turn, parsed)

    if answer is None:
        return None

    booking_id = uuid.UUID(turn.data.pop("cancel_booking_id"))

    if not answer:
        return _Next(reply=f"{_say(turn, 'CANCEL_KEPT')} {_say(turn, 'ASK_MENU')}", step=STEP_MENU)

    # Re-read through the guardian's own upcoming list: an admin may have unlinked them from
    # the child, or the session may have changed, since the pick.
    upcoming = _upcoming_bookings(
        turn.db, guardian_id=turn.guardian.id, on_or_after=turn.now.date()
    )
    booking = next((booking for booking in upcoming if booking.id == booking_id), None)

    if booking is None:
        return _stuck(turn)

    if _inside_cutoff(turn.db, booking=booking, now=turn.now):
        return _Next(reply=_say(turn, "CUTOFF_DECLINED"), step=None)

    try:
        booking_status_service.change_status(
            turn.db, booking_id=booking.id, target=BookingStatus.CANCELLED
        )
    except booking_status_service.BookingStatusError:
        return _stuck(turn)

    return _Next(reply=_say(turn, "CANCELLED"), step=None)


def _reschedule_pick(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """P7-O: reschedule is cancel-then-rebook through the two paths that already exist.

    Nothing is cancelled here. The old booking's id is carried in the flow state and the old
    booking is only cancelled once the replacement has been written, inside the same turn and
    therefore the same transaction — so a parent who abandons the flow, or a slot that is taken
    between the offer and the confirmation, still has the session they started with. The cutoff
    is checked here rather than at the write, so the refusal arrives before the parent is asked
    to pick a new day.
    """
    booking = _picked_booking(turn, parsed)

    if not isinstance(booking, Booking):
        return booking

    if _inside_cutoff(turn.db, booking=booking, now=turn.now):
        return _Next(reply=_say(turn, "CUTOFF_DECLINED"), step=None)

    _reset_booking(turn.data)
    turn.data["book_child_id"] = str(booking.child_id)
    turn.data["book_subject_id"] = str(booking.subject_id)

    turn.data["reschedule_booking_id"] = str(booking.id)

    # The bot moves only a session it could have booked; the rest go to the office, and the
    # old session stays until Staff move it. Nothing on that path writes or cancels.
    if _needs_office(turn.db, child=booking.child, subject_id=booking.subject_id):
        return _Next(reply=_say(turn, "ASK_NEW_DATE"), step=STEP_FIRST_SESSION_DATE)

    turn.data["book_tutor_id"] = str(booking.tutor_id)
    turn.data["book_home_id"] = str(booking.home_id)

    return _Next(reply=_say(turn, "ASK_NEW_DATE"), step=STEP_BOOK_DATE)


# --- the booking flow (REQ-074) ----------------------------------------------------------------


def _book_child(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """The child pick — and detection point (b) when the answer is a name rather than a list
    position (§4a).

    The order is pinned (SA-33): exact and whole-word hits first, so an inactive "Sam" is not
    swallowed by `_chosen`'s substring hit on an active "Samantha"; then `_chosen` exactly as
    before; and a typo only when `_chosen` found nothing, so a typo never overrides a pick among
    the offered children. A typo serves only the reactivation offer and never selects an active
    child.

    The name is read from `child_name` before `answer`: the `CHOICE` kind asks the parser for
    the option's number, so "Sam" usually arrives as a digit with the name only under that field
    (SA-28). Checking the digit alone would book the active lookalike.
    """
    named = parsed.fields.get(STEP_CHILD_NAME, "").strip() or _answer(turn, parsed)

    if named is None or named.isdecimal():
        return _pick_child(turn, parsed)

    linked = _linked_children(turn.db, guardian_id=turn.guardian.id)
    exact = exact_matches(linked, named)
    hit = _inactive_hit(exact)

    if isinstance(hit, Child):
        result = _offer_reactivation(turn, child=hit)
    elif hit is _AMBIGUOUS:
        result = _Refusal.AMBIGUOUS_CHILD
    else:
        result = _pick_child(turn, parsed)

    if not isinstance(result, _Next) and not exact:
        typo_hit = _inactive_hit(typo_matches(linked, named))
        if isinstance(typo_hit, Child):
            result = _offer_reactivation(turn, child=typo_hit)

    return result


def _pick_child(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        return option

    child = turn.db.get(Child, uuid.UUID(option["id"]))

    return None if child is None else _ask_subject(turn, child=child)


def _ask_subject(turn: _Turn, *, child: Child) -> _Next:
    """The subject question, on the handoff path when the Child is not Evaluated: their first
    session is the Evaluation session, which the office arranges."""
    turn.data["book_child_id"] = str(child.id)
    step = STEP_BOOK_SUBJECT if child.evaluated_at is not None else STEP_FIRST_SESSION_SUBJECT
    subjects = turn.db.scalars(
        select(Subject)
        .where(Subject.is_active.is_(True))
        .order_by(Subject.name, Subject.id)
        .limit(SUBJECT_LIMIT)
    ).all()

    if not subjects:
        result = _stuck(turn)
    else:
        options = [
            {"id": str(subject.id), "label": _subject_name(subject, turn.language)}
            for subject in subjects
        ]
        result = _Next(
            reply=f"{_say(turn, 'ASK_SUBJECT')}\n{_offer(turn.state, options)}", step=step
        )

    return result


def _book_subject(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        return option

    child = turn.db.get(Child, uuid.UUID(turn.data["book_child_id"]))

    if child is None:
        return _stuck(turn)

    subject_id = uuid.UUID(option["id"])
    turn.data["book_subject_id"] = option["id"]

    # Also catches a flow saved at this step before the Child's evaluation was cleared.
    if _needs_office(turn.db, child=child, subject_id=subject_id):
        return _Next(reply=_say(turn, "ASK_DATE"), step=STEP_FIRST_SESSION_DATE)

    tutors = _qualified_tutors(turn.db, subject_id=subject_id, child_id=child.id)

    if not tutors:
        return _ask_subject(turn, child=child)

    options = [{"id": str(tutor_id), "label": name} for tutor_id, name in tutors.items()]
    options.append({"id": "", "label": _say(turn, "ANY_TUTOR_LABEL")})

    return _Next(
        reply=f"{_say(turn, 'ASK_TUTOR')}\n{_offer(turn.state, options)}", step=STEP_BOOK_TUTOR
    )


def _book_tutor(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        result: _Outcome = option
    else:
        turn.data["book_tutor_id"] = option["id"]
        result = _Next(reply=_say(turn, "ASK_DATE"), step=STEP_BOOK_DATE)

    return result


def _book_date(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """Resolving "next tuesday" is the parser's job; this step only accepts the ISO form.

    The parser is told the `DATE` answer kind and today's date, which is what makes the
    convention visible to the model rather than assumed of it. Anything else is a re-prompt:
    guessing a date books a session on a day nobody named.
    """
    date = _read_date(turn, parsed)

    if not isinstance(date, datetime.date):
        return date

    turn.data["book_date"] = date.isoformat()

    return _ask_home(turn)


def _first_session_subject(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        result: _Outcome = option
    else:
        turn.data["book_subject_id"] = option["id"]
        result = _Next(reply=_say(turn, "ASK_DATE"), step=STEP_FIRST_SESSION_DATE)

    return result


def _first_session_date(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """Read like `_book_date`, then hand the chat to the office: no tutor, no home, no slots and
    no write. The window is still checked, so the office is never asked for a day the bot would
    have refused.

    A reschedule names the session being moved and the day asked for, so Staff reading the
    flagged thread move that session rather than booking a second one. Otherwise a Child not
    Evaluated is told about the Evaluation session, and an Evaluated Child reached this step for
    a subject they have no level in, so that subject is named instead.
    """
    date = _read_date(turn, parsed)

    if not isinstance(date, datetime.date):
        return date

    settings = scheduling_service.load_scheduling_settings(turn.db)

    try:
        scheduling_service.assert_date_in_window(
            date, today=turn.now.date(), lookahead_days=settings.booking_lookahead_days
        )
    except scheduling_service.DateOutOfWindow:
        return _Next(reply=_date_not_bookable(turn), step=STEP_FIRST_SESSION_DATE)

    child = turn.db.get(Child, uuid.UUID(turn.data["book_child_id"]))
    subject = turn.db.get(Subject, uuid.UUID(turn.data["book_subject_id"]))

    if child is None or subject is None:
        return _stuck(turn)

    moving = _booking_to_move(turn)

    if moving is not None:
        reply = _say(
            turn,
            "RESCHEDULE_NEEDS_OFFICE",
            child=child.name,
            subject=_subject_name(moving.subject, turn.language),
            old_date=bot_messages.format_date(moving.scheduled_date, turn.language),
            old_time=bot_messages.format_time_range(
                moving.start_time, moving.end_time, turn.language
            ),
            date=bot_messages.format_date(date, turn.language),
        )
    elif child.evaluated_at is None:
        reply = _say(turn, "FIRST_SESSION_HANDOFF", name=child.name)
    else:
        reply = _say(
            turn,
            "SUBJECT_NEEDS_OFFICE",
            name=child.name,
            subject=_subject_name(subject, turn.language),
        )

    return _Next(reply=reply, step=None, flag_reason=FlagReason.BOOKING_REQUEST)


def _booking_to_move(turn: _Turn) -> Booking | None:
    """The session a reschedule handed to the office would move, if it still exists."""
    raw = turn.data.get("reschedule_booking_id")

    return None if not raw else turn.db.get(Booking, uuid.UUID(raw))


def _date_not_bookable(turn: _Turn) -> str:
    return f"{_say(turn, 'DATE_NOT_BOOKABLE')} {_say(turn, 'ASK_DATE')}"


def _read_date(turn: _Turn, parsed: ParsedIntent) -> datetime.date | _Refusal | None:
    """The answer as a date; `None` when there was no answer, a refusal when it is not ISO."""
    raw = _answer(turn, parsed)
    date = _iso_date(raw)

    if raw is not None and date is None:
        return _Refusal.UNREADABLE_DATE

    return date


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
            reply=f"{_say(turn, 'ASK_WHICH_HOME')}\n{_offer(turn.state, options)}",
            step=STEP_BOOK_HOME,
        )

    return result


def _book_home(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        result: _Outcome = option
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
            child_id=uuid.UUID(turn.data["book_child_id"]),
            date=date,
            tutor_id=uuid.UUID(requested) if requested else None,
            now=turn.now,
        )
    except scheduling_service.DateOutOfWindow:
        return _Next(reply=_date_not_bookable(turn), step=STEP_BOOK_DATE)

    if not found.items:
        no_slots = _say(turn, "NO_SLOTS", date=bot_messages.format_date(date, turn.language))
        return _Next(reply=f"{no_slots} {_say(turn, 'ASK_DATE')}", step=STEP_BOOK_DATE)

    options = [
        {
            "id": str(slot.availability_id),
            "label": bot_messages.format_slot_label(
                bot_messages.format_time_range(slot.start_time, slot.end_time, turn.language),
                slot.tutor_name,
                turn.language,
            ),
            "tutor_id": str(slot.tutor_id),
            "availability_id": str(slot.availability_id),
            "start_time": slot.start_time.isoformat(),
            "end_time": slot.end_time.isoformat(),
        }
        for slot in found.items
    ]
    heading = preamble or _say(turn, "ASK_SLOT", date=bot_messages.format_date(date, turn.language))
    lines = [heading, _offer(turn.state, options)]

    if found.total > len(found.items):
        lines.append(_say(turn, "SHOWING_SOME", shown=len(found.items), total=found.total))

    return _Next(reply="\n".join(lines), step=STEP_BOOK_SLOT)


def _book_slot(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        result: _Outcome = option
    else:
        turn.data["chosen"] = option
        result = _Next(reply=_slot_confirmation(turn, option), step=STEP_BOOK_CONFIRM)

    return result


def _slot_confirmation(turn: _Turn, option: dict[str, Any]) -> str:
    """The reschedule confirmation when this booking replaces one, else the plain one.

    A replaced booking that cannot be loaded (a row removed since the pick) gets the plain
    confirmation rather than a crash; the write then treats it as already moved.
    """
    date = _human_date(turn.data["book_date"], turn.language)
    replaced_id = turn.data.get("reschedule_booking_id")
    replaced = None if replaced_id is None else turn.db.get(Booking, uuid.UUID(replaced_id))

    if replaced is None:
        text = _say(turn, "CONFIRM_SLOT", label=option["label"], date=date)
    else:
        text = _say(
            turn,
            "CONFIRM_RESCHEDULE",
            label=option["label"],
            date=date,
            child=replaced.child.name,
            old_date=bot_messages.format_date(replaced.scheduled_date, turn.language),
            old_time=bot_messages.format_time_range(
                replaced.start_time, replaced.end_time, turn.language
            ),
        )
    return text


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
    cancellation would already be in the transaction the webhook is about to commit. Both run
    in one savepoint, so a cancel that fails unexpectedly undoes the new booking too: `stuck`
    then means nothing changed, never two live sessions. An old session that is already
    cancelled or gone counts as moved.

    The replaced booking is checked against the guardian's links first: the id was picked from
    their own list, but they may have been unlinked from the child since.
    """
    replaced = turn.data.get("reschedule_booking_id")

    if replaced is not None and not _may_replace(turn, booking_id=uuid.UUID(replaced)):
        return _stuck(turn)

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
        with turn.db.begin_nested():
            booking_write_service.create_booking(turn.db, request=request, now=turn.now)
            if replaced is not None:
                _cancel_replaced(turn, booking_id=uuid.UUID(replaced))
    except (
        booking_write_service.BookingOverlaps,
        booking_write_service.GapNotRespected,
        booking_write_service.BlockedByException,
    ):
        return _offer_slots(turn, preamble=_say(turn, "SLOT_JUST_TAKEN"))
    except (booking_write_service.DateOutOfWindow, booking_write_service.LeadTimeNotMet):
        return _Next(reply=_date_not_bookable(turn), step=STEP_BOOK_DATE)
    except (booking_write_service.BookingWriteError, _ReplaceFailed):
        return _stuck(turn)

    summary = {"label": chosen["label"], "date": _human_date(turn.data["book_date"], turn.language)}
    message_id = "BOOKING_CONFIRMED" if replaced is None else "BOOKING_MOVED"

    return _Next(reply=_say(turn, message_id, **summary), step=None)


class _ReplaceFailed(Exception):
    """The old session of a reschedule is still live and could not be cancelled."""


def _may_replace(turn: _Turn, *, booking_id: uuid.UUID) -> bool:
    """Whether this guardian is still linked to the child being rebooked, and to the old
    session's child when that session still exists."""
    linked_ids = {child.id for child in _linked_children(turn.db, guardian_id=turn.guardian.id)}
    old = turn.db.get(Booking, booking_id)
    child_ids = {uuid.UUID(turn.data["book_child_id"])}

    if old is not None:
        child_ids.add(old.child_id)

    return child_ids <= linked_ids


def _cancel_replaced(turn: _Turn, *, booking_id: uuid.UUID) -> None:
    try:
        booking_status_service.change_status(
            turn.db, booking_id=booking_id, target=BookingStatus.CANCELLED
        )
    except booking_status_service.BookingNotFound:
        # Removed since the pick: the parent already holds only the new session.
        logger.info("reschedule: replaced booking %s no longer exists", booking_id)
    except booking_status_service.IllegalTransition as error:
        if error.current.value in LIVE_BOOKING_STATUSES:
            raise _ReplaceFailed(str(error)) from error
        logger.info("reschedule: replaced booking %s was already %s", booking_id, error.current)


# --- reactivation requests (REQ-132) -----------------------------------------------------------


def _named_at_menu(turn: _Turn, parsed: ParsedIntent) -> _NameHit:
    """Detection point (a): the parser's `child_name` field, on a `book` or `unknown` intent.

    The field is RP's pinned key, which is `STEP_CHILD_NAME` — the parser gives a named child
    under it whatever the step (SA-28). `named_children` applies the whole precedence: exact or
    whole-word first, a typo only when those find nothing.
    """
    raw = parsed.fields.get(STEP_CHILD_NAME, "")

    if parsed.intent in _NAMING_INTENTS and raw.strip():
        linked = _linked_children(turn.db, guardian_id=turn.guardian.id)
        hit = _inactive_hit(named_children(linked, raw))
    else:
        hit = None

    return hit


def _inactive_hit(hits: list[Child]) -> _NameHit:
    """§4a's outcome table, shared by the three detection points.

    One hit, inactive → that child, to offer. Several with at least one inactive →
    `_AMBIGUOUS`: no child is picked by that name (REQ-132.5). Anything else — no hit, one
    active hit, several all active — is `None`, and the point carries on as it did before 7D.
    """
    if len(hits) == 1 and not hits[0].is_active:
        result: _NameHit = hits[0]
    elif len(hits) > 1 and any(not child.is_active for child in hits):
        result = _AMBIGUOUS
    else:
        result = None

    return result


def _offer_reactivation(turn: _Turn, *, child: Child, resume_name: str | None = None) -> _Next:
    """Ask whether to request `child`'s reactivation — or refuse, while one is pending.

    The refusal (OQ-74, REQ-132.6) asks nothing, names no child and records nothing: the menu
    question follows it, and the pending request, its flag and its flag time stay exactly as
    they were. `resume_name` is set only for a typo-only offer at the child-name question
    (SA-32), which never reaches here while a request is pending.
    """
    if turn.reactivation_pending:
        result = _refuse_while_pending(turn)
    else:
        turn.data["reactivation_child_id"] = str(child.id)
        turn.data["reactivation_child_name"] = child.name

        if resume_name is not None:
            turn.data["reactivation_resume_name"] = resume_name

        result = _Next(
            reply=_say(turn, "REACTIVATION_OFFER", name=child.name),
            step=STEP_REACTIVATION_CONFIRM,
        )

    return result


def _reactivation_confirm(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The answer to `REACTIVATION_OFFER`.

    "No" records nothing and goes back to the menu — or, after a typo-only offer at the
    child-name question, resumes the registration with the name as typed, exactly where
    `_collect_text` would have gone (SA-32). Neither answer → the usual re-prompt, and the
    offer's keys stay for it. Every other exit pops them.
    """
    answer = _yes_no(turn, parsed)
    resume_name = turn.data.get("reactivation_resume_name")

    if answer is None:
        result = None
    elif answer:
        result = _request_reactivation(turn)
    elif resume_name is None:
        result = _Next(reply=_say(turn, "ASK_MENU"), step=STEP_MENU)
    else:
        turn.data["child_name"] = resume_name
        result = _Next(reply=_say(turn, "ASK_CHILD_DOB"), step=STEP_CHILD_DOB)

    if result is not None:
        for key in _REACTIVATION_KEYS:
            turn.data.pop(key, None)

    return result


def _request_reactivation(turn: _Turn) -> _Next:
    """The "yes": ask the office, unless something changed since the offer.

    A request that became pending in between is refused exactly as at a detection point, and
    first — REQ-132.6 holds the pending request's flag and flag time unchanged, which a `stuck`
    here would overwrite. Otherwise the child is re-read **through this guardian's links**: one
    unlinked since the offer is not theirs to ask about (`_stuck`), and one an admin has already
    reactivated needs nothing asked. Only a child still linked and still inactive is returned
    for the webhook to record; the bot never reactivates it itself (P7D-C).
    """
    child = None if turn.reactivation_pending else _linked_child(turn)

    if turn.reactivation_pending:
        result = _refuse_while_pending(turn)
    elif child is None:
        result = _stuck(turn)
    elif child.is_active:
        result = _Next(
            reply=(
                f"{_say(turn, 'REACTIVATION_NOT_NEEDED', name=child.name)} {_say(turn, 'ASK_MENU')}"
            ),
            step=STEP_MENU,
        )
    else:
        result = _Next(
            reply=_say(turn, "REACTIVATION_REQUESTED", name=child.name),
            step=None,
            reactivation_child_id=child.id,
        )

    return result


def _linked_child(turn: _Turn) -> Child | None:
    """The offered child, read again through this guardian's links — `None` once unlinked."""
    child_id = uuid.UUID(turn.data["reactivation_child_id"])
    linked = _linked_children(turn.db, guardian_id=turn.guardian.id)

    return next((child for child in linked if child.id == child_id), None)


def _refuse_while_pending(turn: _Turn) -> _Next:
    # At most one pending request per conversation (OQ-74): a second is refused, not substituted.
    return _Next(
        reply=f"{_say(turn, 'REACTIVATION_PENDING')} {_say(turn, 'ASK_MENU')}", step=STEP_MENU
    )


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
    """REQ-075.2: through `child_guardians`, so a guardian sees their children and no others.

    Active children only (REQ-114, REQ-132.1): every child choice the bot presents comes from
    here, so an inactive child is never listed or offered for booking. A guardian whose children
    are all inactive reads as one with none and takes the add-a-child path, which is final, not
    interim (SA-27) — `_begin_booking` says `NO_ACTIVE_CHILDREN` rather than `NO_CHILDREN_YET`
    for them (REQ-132.7).
    """
    return list(
        db.scalars(
            select(Child)
            .join(ChildGuardian, ChildGuardian.child_id == Child.id)
            .where(ChildGuardian.guardian_id == guardian_id, Child.is_active.is_(True))
            .order_by(Child.name, Child.id)
        ).all()
    )


def _linked_children(db: Session, *, guardian_id: uuid.UUID) -> list[Child]:
    """Every child linked to this guardian, active **and** inactive (§4a).

    The candidates a named child is matched against, and nothing else: a name is only ever
    resolved against this guardian's own links, so another family's child can never match,
    exactly or by a typo. Never used to list or offer a child — that is `_children`.
    """
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


def _needs_office(db: Session, *, child: Child, subject_id: uuid.UUID) -> bool:
    """Whether a booking for this Child and subject is an Office handoff rather than the bot's:
    the Child is not Evaluated, or has no Subject level to match tutors against."""
    level = db.scalar(
        select(ChildSubjectLevel.id).where(
            ChildSubjectLevel.child_id == child.id, ChildSubjectLevel.subject_id == subject_id
        )
    )

    return child.evaluated_at is None or level is None


def _qualified_tutors(
    db: Session, *, subject_id: uuid.UUID, child_id: uuid.UUID
) -> dict[uuid.UUID, str]:
    """Active tutors who teach this subject at or above the Child's Subject level in it.

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
        db, subject_id=subject_id, child_id=child_id, tutor_id=None
    )


def _inside_cutoff(db: Session, *, booking: Booking, now: datetime.datetime) -> bool:
    """`cancellation_cutoff_hours`, read at turn time like every other setting (§6).

    Phase 4 seeded this row and deliberately left it unwired; this is its first consumer.
    """
    hours = get_int_setting(db, key=CANCELLATION_CUTOFF_SETTING)
    starts_at = datetime.datetime.combine(booking.scheduled_date, booking.start_time)

    return starts_at - now < datetime.timedelta(hours=hours)


def _picked_booking(turn: _Turn, parsed: ParsedIntent) -> Booking | _Refusal | None:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        return option

    return turn.db.get(Booking, uuid.UUID(option["id"]))


def _human_date(iso: str, language: str) -> str:
    """The flow state keeps ISO; only the reply text is human."""
    return bot_messages.format_date(datetime.date.fromisoformat(iso), language)


def _subject_name(subject: Subject, language: str) -> str:
    """The Spanish name for a Spanish reply when Staff have given one, else the English one."""
    spanish = (subject.name_es or "").strip()

    return spanish if language == bot_messages.SPANISH and spanish else subject.name


def _booking_label(booking: Booking, language: str) -> str:
    return bot_messages.format_session_line(
        bot_messages.format_date(booking.scheduled_date, language),
        bot_messages.format_time_range(booking.start_time, booking.end_time, language),
        _subject_name(booking.subject, language),
        booking.child.name,
        booking.tutor.name,
        language,
    )


# --- reading one message, and offering a numbered choice ---------------------------------------


def _answer(turn: _Turn, parsed: ParsedIntent) -> str | None:
    """What the parent said in reply to the question this step asked, or `None` when nothing.

    Read only from the parser's fixed `answer` slot. There is deliberately no fallback to
    `fields[<step>]`: that key was the model's to name, and it named it wrongly often enough
    to strand parents at the first question.
    """
    value = (parsed.answer or "").strip()

    return value or None


def _normalized(raw: str) -> str:
    """`bot_messages.normalize` with curly apostrophes straightened and commas read as pauses,
    so "No, thanks!" compares equal to "no thanks"."""
    return bot_messages.normalize(raw.replace("\u2019", "'").replace(",", " "))


def _yes_no(turn: _Turn, parsed: ParsedIntent) -> bool | None:
    raw = _normalized(_answer(turn, parsed) or "")

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

    return _numbered(options)


def _numbered(options: list[dict[str, Any]]) -> str:
    return "\n".join(
        f"{number}. {option['label']}" for number, option in enumerate(options, start=1)
    )


def _chosen(turn: _Turn, parsed: ParsedIntent) -> dict[str, Any] | _Refusal | None:
    """The option the parent picked, by position or by an unambiguous name.

    A number outside the list is refused as such rather than read as part of a name: the parser
    is told to answer a choice with its number, and "5" is not a name. An ambiguous name match
    is a re-prompt rather than the first hit. On the tutor step that is
    the difference between booking the tutor the guardian asked for and booking a different one
    whose name happens to contain the same letters — the REQ-074 correctness bug decision P7-T
    leaves to this module rather than to an ORM-layer assertion.
    """
    options: list[dict[str, Any]] = turn.data.get("options", [])
    raw = _answer(turn, parsed)

    if raw is None or not options:
        return None

    # `isdecimal`, not `isdigit`: "²" is a digit that `int` refuses.
    if raw.isdecimal():
        is_in_range = 1 <= int(raw) <= len(options)
        return options[int(raw) - 1] if is_in_range else _Refusal.OPTION_OUT_OF_RANGE

    needle = raw.casefold()
    hits = [option for option in options if needle in option["label"].casefold()]

    if len(hits) > 1:
        return _Refusal.AMBIGUOUS_NAME

    return hits[0] if hits else None


def _context(state: FlowState) -> dict[str, str]:
    """What the parser is told about what has been collected so far.

    The pending question is not here: it travels as `parse_intent`'s own `question` argument.
    The numbered choices go in verbatim, because "the second one" and "the 10:30 one" are only
    resolvable against them.

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
    options: list[dict[str, Any]] = state.collected_data.get("options", [])

    if options:
        context["options"] = _numbered(options)

    return context


def _reset_booking(data: dict[str, Any]) -> None:
    """Drop the previous booking attempt's answers before a new one starts.

    Without this a second booking in one conversation inherits the first one's child, subject
    and — worst of all — its `reschedule_booking_id`, which would cancel a session nobody asked
    to cancel.
    """
    for key in _BOOKING_KEYS:
        data.pop(key, None)


# A Guardian who cannot say a grade is not handed to the office: the Child is written without
# one, and Staff set it at the evaluation.
_GIVE_UPS: dict[str, _GiveUp] = {
    STEP_CHILD_GRADE: _GiveUp(reprompts=MAX_REPROMPTS, move_on=_ask_child_notes),
    # Nothing is recorded: a Guardian who never said yes is not opted in.
    STEP_REMINDERS_OPT_IN: _GiveUp(reprompts=1, move_on=_leave_reminders_off),
}

# A step whose re-prompt is not `NUDGE_<step>`.
_NUDGE_IDS: dict[str, str] = {STEP_REMINDERS_OPT_IN: "NUDGE_reminders"}

_HANDLERS: dict[str, _Handler] = {
    STEP_INTAKE_NAME: _collect_text(
        "guardian_name", "ASK_ADDRESS", STEP_INTAKE_ADDRESS, limit=NAME_LIMIT
    ),
    STEP_INTAKE_ADDRESS: _collect_text(
        "address", "ASK_ACCESS_CODE", STEP_INTAKE_ACCESS_CODE, limit=ADDRESS_LIMIT
    ),
    STEP_INTAKE_ACCESS_CODE: _intake_access_code,
    STEP_INTAKE_LABEL: _intake_label,
    STEP_CHILD_REGISTERED: _child_registered,
    STEP_CHILD_NAME: _child_name,
    STEP_CHILD_DOB: _child_date_of_birth,
    STEP_CHILD_SCHOOL: _child_school,
    STEP_CHILD_GRADE: _child_grade,
    STEP_CHILD_NOTES: _child_notes,
    STEP_CHILD_MORE: _child_more,
    STEP_REMINDERS_OPT_IN: _reminders_opt_in,
    STEP_MENU: _menu,
    STEP_BOOK_CHILD: _book_child,
    STEP_BOOK_SUBJECT: _book_subject,
    STEP_BOOK_TUTOR: _book_tutor,
    STEP_BOOK_DATE: _book_date,
    STEP_BOOK_HOME: _book_home,
    STEP_BOOK_SLOT: _book_slot,
    STEP_BOOK_CONFIRM: _book_confirm,
    STEP_FIRST_SESSION_SUBJECT: _first_session_subject,
    STEP_FIRST_SESSION_DATE: _first_session_date,
    STEP_CANCEL_PICK: _cancel_pick,
    STEP_CANCEL_CONFIRM: _cancel_confirm,
    STEP_RESCHEDULE_PICK: _reschedule_pick,
    STEP_REACTIVATION_CONFIRM: _reactivation_confirm,
}
