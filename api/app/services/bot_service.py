"""The bot's conversational flow machine: one turn in, one `BotTurn` out.

**P7-C — this module is pure with respect to the conversation row.** It reads and writes
neither of the two chat tables. Everything it would otherwise have written travels back in the
`BotTurn`: `link_guardian_id` for the guardian backfill, `flag_reason` for the flag,
`reactivation_child_id` for a reactivation request (REQ-132), and `reply` for the outbound row.
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

**The answer to the question a step asked arrives in `ParsedIntent.answer`.** The parser is
shown the pending question (`state.prompt`) as its own section of the prompt and returns the
parent's answer to it in that fixed slot, whatever the step; `_answer` reads nothing else. The
`STEP_*` constants below are state values only, not field names — the model used to be asked to
key the answer by them and did not reliably do so. `fields` carries the extras, of which this
module reads one by name: `child_name` (`STEP_CHILD_NAME`), pinned in the parser's system prompt
for reactivation detection at the menu.
"""

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
from app.models.child import NOTES_MAX_LENGTH, Child
from app.models.enums import BookingStatus, FlagReason
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.subject import Subject
from app.schemas.bot import AnswerKind, BotIntent, BotTurn, ParsedIntent
from app.services import (
    booking_status_service,
    booking_write_service,
    child_service,
    client_service,
    clock,
    parser_service,
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
# A child with no grade on file is not booked by the bot: the office arranges the first session.
# Separate step names keep this path from ever resuming into the slot offer or the write.
STEP_FIRST_SESSION_SUBJECT = "first_session_subject"
STEP_FIRST_SESSION_DATE = "first_session_date"
STEP_CANCEL_PICK = "cancel_pick"
STEP_CANCEL_CONFIRM = "cancel_confirm"
STEP_RESCHEDULE_PICK = "reschedule_pick"
STEP_REACTIVATION_CONFIRM = "reactivation_confirm"

GREETING_NEW = (
    "Hello, this is the Ms Helping Hands booking assistant. "
    "I don't have your details yet, so I'll take a few now."
)
GREETING_RETURNING = "Hello {name}, welcome back."
ASK_GUARDIAN_NAME = "What is your full name?"
ASK_ADDRESS = "Thank you. What is the address where the tutoring will take place?"
ASK_ACCESS_CODE = "Is there an access code or entry instruction the tutor will need?"
ASK_HOME_LABEL = (
    'Would you like to give this address a short name, such as "Mum\'s" or "Dad\'s"? '
    'It makes future bookings quicker. You can reply "skip".'
)
ASK_CHILD_REGISTERED = "Is this child already registered with us under another guardian?"
ASK_CHILD_NAME = "What is your child's name?"
ASK_CHILD_DOB = "What is their date of birth? For example, 23 April 2016."
ASK_CHILD_SCHOOL = "Which school do they go to?"
ASK_CHILD_NOTES = (
    "Is there anything we should know about them, such as learning needs or allergies? "
    'You can reply "none".'
)
ASK_MORE_CHILDREN = "Would you like to add another child?"
ASK_MENU = (
    "I can book a session, cancel one, or move one to another time. What would you like to do?"
)
# Small talk and questions at the menu (REQ-075). Neither reply states a fact about the
# service: the bot knows no prices or policies, and the office answers the question instead.
SMALL_TALK_REPLY = "Thanks for your message."
QUESTION_PASSED_ON = (
    "I'm not able to answer that here, so I've passed your question to our office and "
    "someone will be in touch shortly."
)
ASK_WHICH_CHILD = "Which child is this for?"
ASK_SUBJECT = "Which subject?"
ASK_TUTOR = "Would you like a particular tutor?"
ASK_DATE = 'Which day would you like? For example, "Tuesday" or "14 October".'
ASK_WHICH_HOME = "Which address should the tutor come to?"
ASK_SLOT = "These times are available on {date}:"
ASK_WHICH_TO_CANCEL = "Which session would you like to cancel?"
ASK_WHICH_TO_MOVE = "Which session would you like to move?"
ASK_NEW_DATE = "Which day would you like to move it to?"

ANY_TUTOR_LABEL = "Any available tutor"
CHILD_ADDED = "{name} is all set."
CLIENT_READY = "Your details are saved. Thank you."
SHOWING_SOME = (
    "These are the first {shown} of {total} available times. Let me know if none of them suit."
)
CONFIRM_SLOT = "To confirm: {label} on {date}. Shall I book it?"
# A reschedule's "yes" also cancels the old session, which the parser picked from a description,
# so the confirmation names it.
CONFIRM_RESCHEDULE = (
    "To confirm: {label} on {date}, replacing {child}'s session on {old_date}, {old_time}. "
    "Shall I book it?"
)
BOOKING_CONFIRMED = "Your session is booked: {label} on {date}."
BOOKING_MOVED = "Your session has been moved to {label} on {date}."
FIRST_SESSION_HANDOFF = (
    "Thank you. Our office will arrange the first session for {name} and be in touch shortly."
)
# The pick is a model-resolved option number ("the Tuesday one"), so it never cancels on its
# own: the parent sees the session and says yes first, as a booking is confirmed.
CONFIRM_CANCEL = "Cancel {child}'s session on {date}, {time}? Please reply yes or no."
CANCEL_KEPT = "No problem, I haven't cancelled it."
CANCELLED = "Your session has been cancelled. Let me know if you would like to book another."
NO_UPCOMING = "You don't have any upcoming sessions with us right now."
NO_CHILDREN_YET = "I don't have any children on file for you yet, so let's add one."
NO_ACTIVE_CHILDREN = (
    "I don't have any children active with us for you at the moment, so let's add one."
)
NO_SLOTS = "There are no available times on {date}."
DATE_NOT_BOOKABLE = "I can't book that far ahead, or that date has already passed."
SLOT_JUST_TAKEN = (
    "I'm sorry, that time was taken while we were talking. These times are still available:"
)
# Re-prompts (REQ-078.2). Each rephrases its step's question as what the bot needs, rather than
# repeating it: a parent who misread the question once will misread the same words again. A
# step with numbered options has them listed again under its nudge, so these end with a colon.
NUDGES: dict[str, str] = {
    STEP_INTAKE_NAME: "Please send your first name and surname, for example Jane Smith.",
    STEP_INTAKE_ADDRESS: (
        "Please send the street address the tutor should come to, including the suburb or town."
    ),
    STEP_INTAKE_ACCESS_CODE: (
        'Please send the access code or entry instructions for the tutor, or reply "none".'
    ),
    STEP_INTAKE_LABEL: 'Please send a short name for this address, such as "Home", or reply "skip".',
    STEP_CHILD_REGISTERED: (
        "Please reply yes if another guardian has already registered this child with us, "
        "or no if not."
    ),
    STEP_CHILD_NAME: "Please send your child's first name and surname.",
    STEP_CHILD_DOB: (
        "Please send your child's date of birth with the day, month and year, "
        "for example 23 April 2016."
    ),
    STEP_CHILD_SCHOOL: "Please send the name of your child's school.",
    STEP_CHILD_NOTES: (
        'Please send anything we should know about your child, or reply "none" if there is nothing.'
    ),
    STEP_CHILD_MORE: "Please reply yes to add another child, or no if that's everyone.",
    STEP_MENU: "Please let me know whether you'd like to book, cancel or move a session.",
    STEP_BOOK_CHILD: "Please reply with the number or name of the child the session is for:",
    STEP_BOOK_SUBJECT: "Please reply with the number or name of the subject:",
    STEP_BOOK_TUTOR: "Please reply with the number or name of the tutor you'd like:",
    STEP_BOOK_DATE: (
        'Please send the day you\'d like the session, such as "next Tuesday" or "14 October".'
    ),
    STEP_BOOK_HOME: "Please reply with the number or name of the address for the session:",
    STEP_BOOK_SLOT: "Please reply with the number of the time you'd like:",
    STEP_BOOK_CONFIRM: "Please reply yes to book this session, or no to choose another time.",
    STEP_FIRST_SESSION_SUBJECT: "Please reply with the number or name of the subject:",
    STEP_FIRST_SESSION_DATE: (
        'Please send the day you\'d like the first session, such as "next Tuesday" or "14 October".'
    ),
    STEP_CANCEL_PICK: "Please reply with the number of the session you'd like to cancel:",
    STEP_CANCEL_CONFIRM: "Please reply yes to cancel this session, or no to keep it.",
    STEP_RESCHEDULE_PICK: "Please reply with the number of the session you'd like to move:",
    STEP_REACTIVATION_CONFIRM: (
        "Please reply yes if you'd like me to ask the office to reactivate them, or no if not."
    ),
}

# What a nudge says first when the handler knows why it refused the reply.
IMPLAUSIBLE_BIRTH_DATE = "That date of birth doesn't look right."
UNREADABLE_DATE = "I couldn't read that as a date."
OPTION_OUT_OF_RANGE = "Please reply with a number from 1 to {count}:"
AMBIGUOUS_NAME = "That matches more than one option. Please reply with the number you mean:"
# The name also matches a child who is not active, and so is not in the list (REQ-132.5). The
# full name is what lets the parent reach that child's reactivation offer; no child is named.
AMBIGUOUS_CHILD = (
    "More than one of your children has that name, and not all of them are listed here. "
    "Please reply with the number of the child this session is for, or their full name:"
)

# REQ-075.6 / OQ-24. A refusal inside `cancellation_cutoff_hours` is a **policy** outcome, not
# a bot failure, so it carries no `flag_reason`: no flag reason exists for a policy refusal, and
# putting routine late cancellations in the flag queue would bury the flags that mean the bot
# actually needs help.
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
    "I'm sorry, I'm not following. I've asked one of our team to pick this up and "
    "they'll be in touch shortly."
)

# REQ-078.3. A parser outage is not the parent failing to be understood, so it flags
# immediately with `parse_error` and does not spend a re-prompt.
PARSER_UNAVAILABLE = (
    "I'm sorry, I'm having trouble right now. I've asked one of our team to pick this up and "
    "they'll be in touch shortly."
)

# Anything this module cannot complete through the services it calls: a retired row, a child
# with no active home, a phone number `phone_service` refuses. Not the parent's fault and not
# something a re-prompt fixes, so it flags `stuck` straight away.
CANNOT_CONTINUE = (
    "I can't finish that from here. I've asked one of our team to pick this up and "
    "they'll be in touch shortly."
)

# REQ-132 (OQ-71 (a), OQ-73, OQ-74). The bot never reactivates a child itself (P7D-C): a "yes"
# only asks the office, through `BotTurn.reactivation_child_id`, and an admin decides.
REACTIVATION_OFFER = (
    "{name} isn't active with us at the moment. "
    "Would you like me to ask the office to reactivate them?"
)
REACTIVATION_REQUESTED = "I've asked the office to reactivate {name}. They'll be in touch."
REACTIVATION_NOT_NEEDED = "{name} is active with us again, so there's nothing to ask the office."

# OQ-74: at most one pending request per conversation, and a second is refused rather than
# substituted. The refusal names no child, which is why the bot needs only a boolean.
REACTIVATION_PENDING = (
    "An earlier request is still waiting for our team, so I can't send another one yet. "
    "They'll be in touch."
)

BOOKING_NOTE = "Booked by the WhatsApp assistant."

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
_NO_NOTES = _NEGATIVE | {"none", "nothing", "n/a", "na"}

# The form each step needs its answer in, told to the parser. A step absent here takes `TEXT`.
_ANSWER_KINDS: dict[str, AnswerKind] = {
    STEP_CHILD_REGISTERED: AnswerKind.YES_NO,
    STEP_CHILD_MORE: AnswerKind.YES_NO,
    STEP_BOOK_CONFIRM: AnswerKind.YES_NO,
    STEP_CANCEL_CONFIRM: AnswerKind.YES_NO,
    STEP_REACTIVATION_CONFIRM: AnswerKind.YES_NO,
    STEP_CHILD_DOB: AnswerKind.DATE,
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
    STEP_CHILD_NOTES: frozenset({"child_name", "child_date_of_birth", "child_school"}),
    STEP_BOOK_SUBJECT: frozenset({"book_child_id", "book_grade_level"}),
    STEP_BOOK_DATE: frozenset({"book_child_id"}),
    STEP_FIRST_SESSION_SUBJECT: frozenset({"book_child_id"}),
    STEP_FIRST_SESSION_DATE: frozenset({"book_child_id"}),
    STEP_BOOK_HOME: frozenset(
        {"book_date", "book_tutor_id", "book_subject_id", "book_grade_level"}
    ),
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
            "book_grade_level",
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


@dataclass(frozen=True, slots=True)
class _Aside:
    """A reply that answers the parent without moving the flow.

    The step and the miss count stay exactly as they were, so small talk can never bail a
    parent out and never wipes a miss they have already used.
    """

    reply: str
    flag_reason: FlagReason | None = None


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
    """
    state = load_state(db, phone_number=phone_number)
    guardian = _recognise(db, phone_number=phone_number, guardian_id=guardian_id)

    if _resumable(state, guardian):
        decided = _take_turn(
            db,
            phone_number=phone_number,
            body=body,
            guardian=guardian,
            state=state,
            reactivation_pending=reactivation_pending,
        )
    else:
        decided = _open(db, phone_number=phone_number, guardian=guardian)

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
) -> BotTurn:
    turn = _Turn(
        db=db,
        phone_number=phone_number,
        body=body,
        guardian=guardian,
        # The turn's one clock read; every handler uses `turn.now`.
        now=clock.business_now(),
        state=state,
        reactivation_pending=reactivation_pending,
    )

    try:
        parsed = parser_service.parse_intent(
            step=state.step,
            question=state.prompt,
            body=body,
            context=_context(state),
            answer_kind=_ANSWER_KINDS.get(state.step, AnswerKind.TEXT),
            today=turn.now.date(),
        )
    except parser_service.ParseFailed as error:
        # REQ-078.3: flag on the first occurrence and leave the state exactly as it is — the
        # re-prompt counter is not burned on an outage the parent did not cause.
        # ParseFailed messages are fixed strings, so logging one cannot leak the body.
        logger.warning("bot parser failed at step %s: %s", state.step, error)
        parsed = None

    if parsed is None:
        decided = BotTurn(reply=PARSER_UNAVAILABLE, flag_reason=FlagReason.PARSE_ERROR)
    else:
        result = None if parsed.confidence_is_low else _HANDLERS[state.step](turn, parsed)
        if isinstance(result, _Next):
            decided = _apply(turn, result)
        elif isinstance(result, _Aside):
            decided = _set_aside(turn, result)
        else:
            decided = _miss(turn, parsed, result)

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


def _open(db: Session, *, phone_number: str, guardian: Guardian | None) -> BotTurn:
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
    """
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
    has_bailed_out = turn.state.misses > MAX_REPROMPTS
    if has_bailed_out:
        # `stuck` is "two failed re-prompts in a row" (docs/erd.md): the next stretch of
        # unusable replies starts counting from zero instead of re-flagging at once.
        turn.state.misses = 0
    save_state(turn.db, phone_number=turn.phone_number, state=turn.state)

    if has_bailed_out:
        result = BotTurn(reply=BAILED_OUT, flag_reason=FlagReason.STUCK)
    else:
        result = BotTurn(reply=_nudge(turn, refusal))

    return result


def _nudge(turn: _Turn, refusal: _Refusal | None) -> str:
    """The re-prompt: what the step needs, led by why the reply was refused when that is known,
    and followed by the step's numbered options when it has them."""
    step = turn.state.step
    options: list[dict[str, Any]] = turn.data.get("options", [])

    if refusal is _Refusal.OPTION_OUT_OF_RANGE:
        text = OPTION_OUT_OF_RANGE.format(count=len(options))
    elif refusal is _Refusal.AMBIGUOUS_NAME:
        text = AMBIGUOUS_NAME
    elif refusal is _Refusal.AMBIGUOUS_CHILD:
        text = AMBIGUOUS_CHILD
    elif refusal is _Refusal.IMPLAUSIBLE_BIRTH_DATE:
        text = f"{IMPLAUSIBLE_BIRTH_DATE} {NUDGES[step]}"
    elif refusal is _Refusal.UNREADABLE_DATE:
        text = f"{UNREADABLE_DATE} {NUDGES[step]}"
    else:
        text = NUDGES[step]

    if _ANSWER_KINDS.get(step) is AnswerKind.CHOICE and options:
        text = f"{text}\n{_numbered(options)}"

    return text


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


def _intake_label(turn: _Turn, parsed: ParsedIntent) -> _Next | None:
    """The optional home label, and therefore the one intake step that never re-prompts.

    "No thanks" is an answer, so a missing or negative value stores nothing rather than costing
    the parent a re-prompt. `homes.label` is what makes the later "Mum's or Dad's?" question
    answerable over WhatsApp, where two full street addresses are not (#39).
    """
    label = _answer(turn, parsed)

    if label is not None and _normalized(label) not in _NEGATIVE:
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


_collect_child_name = _collect_text("child_name", ASK_CHILD_DOB, STEP_CHILD_DOB, limit=NAME_LIMIT)


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
        result = _Next(reply=ASK_CHILD_SCHOOL, step=STEP_CHILD_SCHOOL)

    return result


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

    if guardian_id is None or not home_ids:
        result = _stuck(turn)
    else:
        child = child_service.create_child(
            turn.db,
            guardian_ids=[guardian_id],
            home_ids=home_ids,
            name=turn.data["child_name"],
            date_of_birth=datetime.date.fromisoformat(turn.data["child_date_of_birth"]),
            # Unknown at intake: an admin sets the grade after the first session.
            grade_level=None,
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
            reply=GUARDIAN_LINK_REPLY,
            step=None,
            flag_reason=FlagReason.GUARDIAN_LINK_REQUEST,
        )
    elif parsed.intent is BotIntent.CHIT_CHAT:
        result = _Aside(reply=f"{SMALL_TALK_REPLY} {ASK_MENU}")
    elif parsed.intent is BotIntent.QUESTION:
        result = _Aside(reply=f"{QUESTION_PASSED_ON} {ASK_MENU}", flag_reason=FlagReason.QUESTION)
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
        opener = NO_ACTIVE_CHILDREN if has_inactive else NO_CHILDREN_YET
        result = _Next(reply=f"{opener} {ASK_CHILD_REGISTERED}", step=STEP_CHILD_REGISTERED)
    elif len(children) == 1 and not always_ask:
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
        return _Next(reply=CUTOFF_DECLINED, step=None)

    turn.data["cancel_booking_id"] = str(booking.id)

    return _Next(
        reply=CONFIRM_CANCEL.format(
            child=booking.child.name,
            date=format_date(booking.scheduled_date),
            time=format_time_range(booking.start_time, booking.end_time),
        ),
        step=STEP_CANCEL_CONFIRM,
    )


def _cancel_confirm(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """The answer to `CONFIRM_CANCEL`. "No" keeps the session and goes back to the menu."""
    answer = _yes_no(turn, parsed)

    if answer is None:
        return None

    booking_id = uuid.UUID(turn.data.pop("cancel_booking_id"))

    if not answer:
        return _Next(reply=f"{CANCEL_KEPT} {ASK_MENU}", step=STEP_MENU)

    # Re-read through the guardian's own upcoming list: an admin may have unlinked them from
    # the child, or the session may have changed, since the pick.
    upcoming = _upcoming_bookings(
        turn.db, guardian_id=turn.guardian.id, on_or_after=turn.now.date()
    )
    booking = next((booking for booking in upcoming if booking.id == booking_id), None)

    if booking is None:
        return _stuck(turn)

    if _inside_cutoff(turn.db, booking=booking, now=turn.now):
        return _Next(reply=CUTOFF_DECLINED, step=None)

    try:
        booking_status_service.change_status(
            turn.db, booking_id=booking.id, target=BookingStatus.CANCELLED
        )
    except booking_status_service.BookingStatusError:
        return _stuck(turn)

    return _Next(reply=CANCELLED, step=None)


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
        return _Next(reply=CUTOFF_DECLINED, step=None)

    _reset_booking(turn.data)
    turn.data["reschedule_booking_id"] = str(booking.id)
    turn.data["book_child_id"] = str(booking.child_id)
    turn.data["book_grade_level"] = _stored_grade(booking.child.grade_level)
    turn.data["book_subject_id"] = str(booking.subject_id)
    turn.data["book_tutor_id"] = str(booking.tutor_id)
    turn.data["book_home_id"] = str(booking.home_id)

    return _Next(reply=ASK_NEW_DATE, step=STEP_BOOK_DATE)


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
    """The subject question, on the handoff path when the child has no grade on file: without
    a grade there is no ceiling to match tutors against, so the office arranges that session."""
    turn.data["book_child_id"] = str(child.id)
    turn.data["book_grade_level"] = _stored_grade(child.grade_level)
    step = STEP_BOOK_SUBJECT if child.grade_level is not None else STEP_FIRST_SESSION_SUBJECT
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
        result = _Next(reply=f"{ASK_SUBJECT}\n{_offer(turn.state, options)}", step=step)

    return result


def _book_subject(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        return option

    turn.data["book_subject_id"] = option["id"]
    tutors = _qualified_tutors(
        turn.db,
        subject_id=uuid.UUID(option["id"]),
        grade_level=_read_grade(turn.data["book_grade_level"]),
    )

    if not tutors:
        return _ask_subject(
            turn, child=turn.db.get_one(Child, uuid.UUID(turn.data["book_child_id"]))
        )

    options = [{"id": str(tutor_id), "label": name} for tutor_id, name in tutors.items()]
    options.append({"id": "", "label": ANY_TUTOR_LABEL})

    return _Next(reply=f"{ASK_TUTOR}\n{_offer(turn.state, options)}", step=STEP_BOOK_TUTOR)


def _book_tutor(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        result: _Outcome = option
    else:
        turn.data["book_tutor_id"] = option["id"]
        result = _Next(reply=ASK_DATE, step=STEP_BOOK_DATE)

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
        result = _Next(reply=ASK_DATE, step=STEP_FIRST_SESSION_DATE)

    return result


def _first_session_date(turn: _Turn, parsed: ParsedIntent) -> _Outcome:
    """Read like `_book_date`, then hand the chat to the office: no tutor, no home, no slots and
    no write. The window is still checked, so the office is never asked for a day the bot would
    have refused."""
    date = _read_date(turn, parsed)

    if not isinstance(date, datetime.date):
        return date

    settings = scheduling_service.load_scheduling_settings(turn.db)

    try:
        scheduling_service.assert_date_in_window(
            date, today=turn.now.date(), lookahead_days=settings.booking_lookahead_days
        )
    except scheduling_service.DateOutOfWindow:
        return _Next(reply=f"{DATE_NOT_BOOKABLE} {ASK_DATE}", step=STEP_FIRST_SESSION_DATE)

    child = turn.db.get(Child, uuid.UUID(turn.data["book_child_id"]))

    if child is None:
        return _stuck(turn)

    return _Next(
        reply=FIRST_SESSION_HANDOFF.format(name=child.name),
        step=None,
        flag_reason=FlagReason.BOOKING_REQUEST,
    )


def _stored_grade(grade_level: int | None) -> str | None:
    return None if grade_level is None else str(grade_level)


def _read_grade(stored: str | None) -> int | None:
    # "None" is what builds before the first-session handoff stored for a child with no grade.
    return None if stored in (None, "None") else int(stored)


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
            reply=f"{ASK_WHICH_HOME}\n{_offer(turn.state, options)}", step=STEP_BOOK_HOME
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
            grade_level=_read_grade(turn.data["book_grade_level"]),
            date=date,
            tutor_id=uuid.UUID(requested) if requested else None,
            now=turn.now,
        )
    except scheduling_service.DateOutOfWindow:
        return _Next(reply=f"{DATE_NOT_BOOKABLE} {ASK_DATE}", step=STEP_BOOK_DATE)

    if not found.items:
        return _Next(
            reply=f"{NO_SLOTS.format(date=format_date(date))} {ASK_DATE}", step=STEP_BOOK_DATE
        )

    options = [
        {
            "id": str(slot.availability_id),
            "label": f"{format_time_range(slot.start_time, slot.end_time)} with {slot.tutor_name}",
            "tutor_id": str(slot.tutor_id),
            "availability_id": str(slot.availability_id),
            "start_time": slot.start_time.isoformat(),
            "end_time": slot.end_time.isoformat(),
        }
        for slot in found.items
    ]
    lines = [preamble or ASK_SLOT.format(date=format_date(date)), _offer(turn.state, options)]

    if found.total > len(found.items):
        lines.append(SHOWING_SOME.format(shown=len(found.items), total=found.total))

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
    """`CONFIRM_RESCHEDULE` when this booking replaces one, else `CONFIRM_SLOT`.

    A replaced booking that cannot be loaded (a row removed since the pick) gets the plain
    confirmation rather than a crash; the write then treats it as already moved.
    """
    date = _human_date(turn.data["book_date"])
    replaced_id = turn.data.get("reschedule_booking_id")
    replaced = None if replaced_id is None else turn.db.get(Booking, uuid.UUID(replaced_id))

    if replaced is None:
        text = CONFIRM_SLOT.format(label=option["label"], date=date)
    else:
        text = CONFIRM_RESCHEDULE.format(
            label=option["label"],
            date=date,
            child=replaced.child.name,
            old_date=format_date(replaced.scheduled_date),
            old_time=format_time_range(replaced.start_time, replaced.end_time),
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
        return _offer_slots(turn, preamble=SLOT_JUST_TAKEN)
    except (booking_write_service.DateOutOfWindow, booking_write_service.LeadTimeNotMet):
        return _Next(reply=f"{DATE_NOT_BOOKABLE} {ASK_DATE}", step=STEP_BOOK_DATE)
    except (booking_write_service.BookingWriteError, _ReplaceFailed):
        return _stuck(turn)

    summary = {"label": chosen["label"], "date": _human_date(turn.data["book_date"])}
    reply = BOOKING_CONFIRMED if replaced is None else BOOKING_MOVED

    return _Next(reply=reply.format(**summary), step=None)


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
        result = _refuse_while_pending()
    else:
        turn.data["reactivation_child_id"] = str(child.id)
        turn.data["reactivation_child_name"] = child.name

        if resume_name is not None:
            turn.data["reactivation_resume_name"] = resume_name

        result = _Next(
            reply=REACTIVATION_OFFER.format(name=child.name), step=STEP_REACTIVATION_CONFIRM
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
        result = _Next(reply=ASK_MENU, step=STEP_MENU)
    else:
        turn.data["child_name"] = resume_name
        result = _Next(reply=ASK_CHILD_DOB, step=STEP_CHILD_DOB)

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
        result = _refuse_while_pending()
    elif child is None:
        result = _stuck(turn)
    elif child.is_active:
        result = _Next(
            reply=f"{REACTIVATION_NOT_NEEDED.format(name=child.name)} {ASK_MENU}", step=STEP_MENU
        )
    else:
        result = _Next(
            reply=REACTIVATION_REQUESTED.format(name=child.name),
            step=None,
            reactivation_child_id=child.id,
        )

    return result


def _linked_child(turn: _Turn) -> Child | None:
    """The offered child, read again through this guardian's links — `None` once unlinked."""
    child_id = uuid.UUID(turn.data["reactivation_child_id"])
    linked = _linked_children(turn.db, guardian_id=turn.guardian.id)

    return next((child for child in linked if child.id == child_id), None)


def _refuse_while_pending() -> _Next:
    return _Next(reply=f"{REACTIVATION_PENDING} {ASK_MENU}", step=STEP_MENU)


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


def _qualified_tutors(
    db: Session, *, subject_id: uuid.UUID, grade_level: int | None
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


def _picked_booking(turn: _Turn, parsed: ParsedIntent) -> Booking | _Refusal | None:
    option = _chosen(turn, parsed)

    if not isinstance(option, dict):
        return option

    return turn.db.get(Booking, uuid.UUID(option["id"]))


NOON_HOUR = 12


def format_date(day: datetime.date) -> str:
    """ "Tuesday 14 October". Built from `%A`/`%B` and `day.day` rather than `%-d`, which is a
    platform-specific strftime flag."""
    return f"{day:%A} {day.day} {day:%B}"


def format_time_range(start: datetime.time, end: datetime.time) -> str:
    """ "4:00pm-5:00pm". Spelled out by hand because `%-I` and `%p` casing vary by platform."""
    return f"{_format_time(start)}-{_format_time(end)}"


def _format_time(moment: datetime.time) -> str:
    suffix = "am" if moment.hour < NOON_HOUR else "pm"
    return f"{moment.hour % NOON_HOUR or NOON_HOUR}:{moment.minute:02d}{suffix}"


def _human_date(iso: str) -> str:
    """The flow state keeps ISO; only the reply text is human."""
    return format_date(datetime.date.fromisoformat(iso))


def _booking_label(booking: Booking) -> str:
    return (
        f"{format_date(booking.scheduled_date)}, "
        f"{format_time_range(booking.start_time, booking.end_time)}: "
        f"{booking.subject.name} for {booking.child.name} with {booking.tutor.name}"
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
    """Lower case, curly apostrophes straightened, commas and closing punctuation dropped and
    spaces collapsed — so "No, thanks!" compares equal to "no thanks"."""
    straightened = raw.casefold().replace("\u2019", "'").replace(",", " ")

    return " ".join(straightened.split()).rstrip(".!")


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
    STEP_CHILD_NAME: _child_name,
    STEP_CHILD_DOB: _child_date_of_birth,
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
    STEP_FIRST_SESSION_SUBJECT: _first_session_subject,
    STEP_FIRST_SESSION_DATE: _first_session_date,
    STEP_CANCEL_PICK: _cancel_pick,
    STEP_CANCEL_CONFIRM: _cancel_confirm,
    STEP_RESCHEDULE_PICK: _reschedule_pick,
    STEP_REACTIVATION_CONFIRM: _reactivation_confirm,
}
