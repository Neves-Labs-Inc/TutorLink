"""The bot agent's booking tools: `list_slots`, `propose` and `commit_proposal`
(docs/specs/whatsapp-bot-agent.md §2 "Propose then commit", §3 Booking).

**One code path validates and writes.** `propose` runs every action exactly as
`commit_proposal` will, inside a savepoint it then rolls back, so a proposal is checked by the
same `guardian_policy` checks and the same shared Booking services (`booking_write_service`,
`booking_status_service`) that the commit runs. Nothing is re-derived here, and a proposal the
Guardian is asked about can't be refused later for a rule the proposal skipped; only what
changed in between (a slot taken, the cutoff reached, a Booking edited) can.

**`guardian_policy` goes first, always.** `booking_status_service` (cancel) has no Guardian
ownership check of its own, and the policy answers `child_not_linked` for a Booking id that
names nothing or another family's, before any rule could leak something about it.

**Reschedule cancels the old Session, then books the new one**, in the commit's one savepoint.
In that order the new time can overlap the old one with the same Tutor, which the other order
refuses as an overlap with itself; the savepoint undoes the cancel if the booking fails.

**`propose` takes one list per kind** (`book`, `cancel`, `reschedule`), not one list of
actions tagged by kind: strict mode can then require every field each kind needs without a
union type, which the API caps across a request. Nothing the agent sends can raise: a malformed
shape or field is an `invalid_input` refusal naming every problem, its place (`book[0].date`)
and the format expected, so one retry can fix it all.

A rule refusal is a `refused` ToolResult with a stable `reason` and the details the agent may
rephrase (`hours`, `action`). Anything else raises: the turn loop treats it as an outage. Every
call and result goes to the app log with the conversation id; there's no DB audit.
"""

import datetime
import json
import logging
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, MessageAuthor
from app.models.guardian import ChildGuardian
from app.models.home import GuardianHome, Home
from app.models.message import Message
from app.models.tutor import Tutor
from app.services import (
    booking_status_service,
    booking_write_service,
    clock,
    guardian_policy,
    scheduling_service,
    slot_service,
)
from app.services.bot_tool_contract import CommittedAction, ToolContext, ToolResult, ToolSpec

logger = logging.getLogger(__name__)

# A proposal is dropped once it is older than this, checked at commit (spec §2).
PROPOSAL_TTL = datetime.timedelta(minutes=30)
# Bounds one `list_slots` call: two weeks of the default five slots a day is already a lot of
# prompt.
MAX_LIST_DAYS = 14
# Staff-facing, so it is not a catalogue message.
BOOKING_NOTE = "Booked by the WhatsApp assistant."

NOTHING_PENDING = "nothing_pending"
PROPOSAL_EXPIRED = "proposal_expired"
NEEDS_GUARDIAN_YES = "needs_guardian_yes"
NO_TUTOR_FOR_SUBJECT = "no_tutor_for_subject"
CHILD_NOT_EVALUATED = "child_not_evaluated"
CHILD_ARCHIVED = "child_archived"
INVALID_INPUT = "invalid_input"
HOME_NEEDED = "home_needed"
RANGE_TOO_LONG = "range_too_long"
DATE_OUT_OF_WINDOW = "date_out_of_window"
TOO_SOON = "too_soon"
SLOT_NOT_FREE = "slot_not_free"
TUTOR_NOT_QUALIFIED = "tutor_not_qualified"
HOME_NOT_ALLOWED = "home_not_allowed"
NOT_BOOKABLE = "not_bookable"
BOOKING_CHANGED = "booking_changed"
BOOKING_NOT_LIVE = "booking_not_live"
EVALUATION_GOES_TO_OFFICE = "evaluation_goes_to_office"

# The shared write path's refusals a Guardian can meet, by the code the agent hears. Anything
# else it raises is a bug on this side and propagates as an outage.
_WRITE_REFUSALS: dict[type[booking_write_service.BookingWriteError], str] = {
    booking_write_service.DateOutOfWindow: DATE_OUT_OF_WINDOW,
    booking_write_service.LeadTimeNotMet: TOO_SOON,
    booking_write_service.BookingOverlaps: SLOT_NOT_FREE,
    booking_write_service.GapNotRespected: SLOT_NOT_FREE,
    booking_write_service.BlockedByException: SLOT_NOT_FREE,
    booking_write_service.OutsideAvailability: SLOT_NOT_FREE,
    booking_write_service.TutorGradeCeilingExceeded: TUTOR_NOT_QUALIFIED,
    booking_write_service.HomeNotLinkedToChild: HOME_NOT_ALLOWED,
    booking_write_service.ChildNotEvaluated: CHILD_NOT_EVALUATED,
    booking_write_service.BookingReferenceNotFound: NOT_BOOKABLE,
    booking_write_service.StaffArchived: NOT_BOOKABLE,
}

_LOCATIONS = {"home": BookingLocation.HOME, "office": BookingLocation.IN_OFFICE}
_LOCATION_NAMES = {location: name for name, location in _LOCATIONS.items()}

# The order a proposal's actions run, are stored and are named in refusals (`cancel[0]`):
# freeing a time first lets a book in the same proposal take it.
_KINDS = ("cancel", "reschedule", "book")
_SLOT_FIELDS = ("tutor_id", "date", "start_time", "location")
# What each kind reads; `home_id` too when the location is home.
_NEEDS = {
    "book": ("child_id", "subject_id", *_SLOT_FIELDS),
    "cancel": ("booking_id",),
    "reschedule": ("booking_id", *_SLOT_FIELDS),
}
# What a refusal tells the agent a field must hold, so one retry can fix it.
_EXPECTED = {
    "child_id": "the Child's child id from the snapshot (a UUID)",
    "subject_id": "the Subject's subject id from the snapshot (a UUID)",
    "booking_id": "the session's booking id from the snapshot (a UUID)",
    "tutor_id": "the tutor_id of the chosen list_slots slot (a UUID)",
    "home_id": "the home id of one of the family's Homes, from the snapshot (a UUID)",
    "date": "a date as YYYY-MM-DD, e.g. 2026-10-28: the date of the chosen list_slots slot",
    "start_time": (
        "a time as HH:MM on the 24-hour clock, e.g. 16:30 (not 4:30 PM): the start_time of the "
        "chosen list_slots slot"
    ),
    "location": "home or office",
    "date_from": "a date as YYYY-MM-DD, e.g. 2026-10-28",
    "date_to": "a date as YYYY-MM-DD, on or after date_from",
}
MISSING = "missing"
NOT_VALID = "not valid"

_UUID = {"type": "string", "format": "uuid"}
_DATE = {"type": "string", "format": "date", "description": "YYYY-MM-DD."}
_LOCATION = {"type": "string", "enum": list(_LOCATIONS)}


class _Refused(Exception):
    """A rule refusal, raised from deep inside an action so the savepoint around it rolls back,
    and turned into a `refused` ToolResult at the tool's edge."""

    def __init__(self, reason: str, **detail: object) -> None:
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True, slots=True)
class _Problem:
    """One thing wrong with the agent's input. `at` names it without its value: `date_to`,
    `book[0].start_time`, or `book[1]` for an item that isn't an object."""

    at: str
    field: str
    kind: str
    expected: str
    # The action it belongs to (`book[0]`), if any.
    action: str | None = None

    def as_json(self) -> dict[str, str]:
        return {"at": self.at, "problem": self.kind, "expected": self.expected}


@dataclass(frozen=True, slots=True)
class _Slot:
    """Where and when a book or a Reschedule puts the Session."""

    tutor_id: uuid.UUID
    date: datetime.date
    start_time: datetime.time
    location: BookingLocation
    # Set exactly when `location` is home.
    home_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class _Book:
    child_id: uuid.UUID
    subject_id: uuid.UUID
    slot: _Slot


@dataclass(frozen=True, slots=True)
class _Cancel:
    booking_id: uuid.UUID
    # The Booking's `updated_at` when proposed; a commit refuses a Booking changed since.
    expected_updated_at: datetime.datetime | None


@dataclass(frozen=True, slots=True)
class _Reschedule:
    booking_id: uuid.UUID
    slot: _Slot
    expected_updated_at: datetime.datetime | None


type _Action = _Book | _Cancel | _Reschedule


@dataclass(frozen=True, slots=True)
class _Done:
    """One action run: what it saved, and how to say it back to the agent."""

    committed: CommittedAction
    summary: dict[str, Any]


# --- list_slots ---------------------------------------------------------------------------------


def _list_slots(ctx: ToolContext, raw: dict[str, Any]) -> ToolResult:
    fields = _Fields(raw)
    child_id = fields.uuid("child_id")
    subject_id = fields.uuid("subject_id")
    date_from = fields.date("date_from")
    date_to = fields.date("date_to")
    location = fields.location()
    fields.check()
    wall_now = _wall_clock(ctx)

    _check_bookable_child(ctx, child_id=child_id)
    if not slot_service.has_assigned_tutor(
        ctx.db, child_id=child_id, subject_id=subject_id, location=location
    ):
        raise _Refused(NO_TUTOR_FOR_SUBJECT)

    slots = [
        _slot_json(slot, location=location)
        for day in _days_in_window(ctx.db, date_from, date_to, today=wall_now.date())
        for slot in slot_service.find_available_slots(
            ctx.db,
            subject_id=subject_id,
            child_id=child_id,
            date=day,
            tutor_id=None,
            now=wall_now,
            location=location,
            assigned_only=True,
        ).items
    ]

    return ToolResult(status="ok", content={"slots": slots})


def _days_in_window(
    db: Session, date_from: datetime.date, date_to: datetime.date, *, today: datetime.date
) -> list[datetime.date]:
    """The requested days, clipped to the booking window (today to `booking_lookahead_days`)."""
    if date_to < date_from:
        raise _invalid([_Problem("date_to", "date_to", NOT_VALID, _EXPECTED["date_to"])])
    if (date_to - date_from).days >= MAX_LIST_DAYS:
        raise _Refused(RANGE_TOO_LONG, max_days=MAX_LIST_DAYS)

    lookahead = scheduling_service.load_scheduling_settings(db).booking_lookahead_days
    last = today + datetime.timedelta(days=lookahead)
    first_day = max(date_from, today)
    last_day = min(date_to, last)

    if last_day < first_day:
        raise _Refused(DATE_OUT_OF_WINDOW, first=today.isoformat(), last=last.isoformat())

    return [
        first_day + datetime.timedelta(days=offset)
        for offset in range((last_day - first_day).days + 1)
    ]


def _slot_json(slot: slot_service.OpenSlot, *, location: BookingLocation) -> dict[str, Any]:
    """`tutor_id`, `date`, `start_time` and `location` are exactly what `propose` takes."""
    return {
        "tutor_id": str(slot.tutor_id),
        "date": slot.date.isoformat(),
        "start_time": _hhmm(slot.start_time),
        "location": _LOCATION_NAMES[location],
        "end_time": _hhmm(slot.end_time),
        "tutor_name": slot.tutor_name,
    }


# --- propose ------------------------------------------------------------------------------------


def _propose(ctx: ToolContext, raw: dict[str, Any]) -> ToolResult:
    """Validates by running the actions in a savepoint it rolls back, then stores them,
    replacing any earlier proposal. A refused one drops the earlier proposal too: the Guardian
    has changed their mind, so a later message mustn't commit the old one."""
    try:
        homes = _family_homes(ctx)
        actions = [_stamped(ctx.db, action) for action in _proposed_actions(raw, homes=homes)]
        done = _run_actions(ctx, actions, keep=False)
    except _Refused:
        _drop_proposal(ctx)
        raise

    ctx.conversation.proposal_actions = [_action_json(action) for action in actions]
    ctx.conversation.proposed_at = ctx.now
    ctx.db.flush()

    return ToolResult(
        status="ok", content={"proposal": [item.summary for item in done]}, progress=True
    )


def _stamped(db: Session, action: _Action) -> _Action:
    """A cancel or Reschedule carrying its Booking's `updated_at` as of now, for the commit's
    changed-meanwhile check. An id naming nothing stays unstamped; the policy refuses it."""
    if isinstance(action, _Book):
        return action

    # Read fresh: the Session may hold a copy loaded before another writer changed it.
    booking = db.get(Booking, action.booking_id, populate_existing=True)
    updated_at = None if booking is None else booking.updated_at

    return replace(action, expected_updated_at=updated_at)


# --- commit_proposal ----------------------------------------------------------------------------


def _commit_proposal(ctx: ToolContext, raw: dict[str, Any]) -> ToolResult:
    conversation = ctx.conversation
    stored = conversation.proposal_actions
    proposed_at = conversation.proposed_at

    if stored is None or proposed_at is None:
        raise _Refused(NOTHING_PENDING)
    if ctx.now - proposed_at > PROPOSAL_TTL:
        _drop_proposal(ctx)
        raise _Refused(PROPOSAL_EXPIRED)
    if not _guardian_spoke_since(ctx.db, conversation_id=conversation.id, since=proposed_at):
        raise _Refused(NEEDS_GUARDIAN_YES)

    done = _run_actions(ctx, [_stored_action(item) for item in stored], keep=True)
    _drop_proposal(ctx)

    return ToolResult(
        status="ok",
        content={"committed": [item.summary for item in done]},
        progress=True,
        committed=tuple(item.committed for item in done),
    )


def _guardian_spoke_since(
    db: Session, *, conversation_id: uuid.UUID, since: datetime.datetime
) -> bool:
    """The Guardian's yes: any inbound message in the thread created after the proposal."""
    return bool(
        db.scalar(
            select(
                exists().where(
                    Message.conversation_id == conversation_id,
                    Message.author_kind == MessageAuthor.CLIENT,
                    Message.created_at > since,
                )
            )
        )
    )


def _drop_proposal(ctx: ToolContext) -> None:
    ctx.conversation.proposal_actions = None
    ctx.conversation.proposed_at = None
    ctx.db.flush()


# --- running actions ----------------------------------------------------------------------------


def _run_actions(ctx: ToolContext, actions: list[_Action], *, keep: bool) -> list[_Done]:
    """Every action in one savepoint: all land (`keep`) or none do. A refusal names the action
    it came from as the agent sent it (`book[1]`)."""
    wall_now = _wall_clock(ctx)
    guardian_id = _guardian_id(ctx)
    savepoint = ctx.db.begin_nested()

    try:
        done = [
            _run_action(ctx, action, label=label, guardian_id=guardian_id, wall_now=wall_now)
            for action, label in zip(actions, _labels(actions), strict=True)
        ]
    except BaseException:
        savepoint.rollback()
        raise

    if keep:
        savepoint.commit()
    else:
        savepoint.rollback()
    return done


def _run_action(
    ctx: ToolContext,
    action: _Action,
    *,
    label: str,
    guardian_id: uuid.UUID,
    wall_now: datetime.datetime,
) -> _Done:
    try:
        if isinstance(action, _Book):
            done = _book(ctx, action, guardian_id=guardian_id, wall_now=wall_now)
        elif isinstance(action, _Cancel):
            done = _cancel(ctx, action, guardian_id=guardian_id, wall_now=wall_now)
        else:
            done = _reschedule(ctx, action, guardian_id=guardian_id, wall_now=wall_now)
    except _Refused as refusal:
        raise _Refused(refusal.reason, **refusal.detail, action=label) from refusal

    return done


def _book(
    ctx: ToolContext, action: _Book, *, guardian_id: uuid.UUID, wall_now: datetime.datetime
) -> _Done:
    _check_bookable_child(ctx, child_id=action.child_id)
    end_time = _end_time(ctx.db, action.slot.start_time)
    _check_policy(
        guardian_policy.check_book(
            ctx.db,
            guardian_id=guardian_id,
            child_id=action.child_id,
            tutor_id=action.slot.tutor_id,
            date=action.slot.date,
            start_time=action.slot.start_time,
            end_time=end_time,
            location=action.slot.location,
            now=wall_now,
        )
    )
    booking = _create(
        ctx.db,
        child_id=action.child_id,
        subject_id=action.subject_id,
        slot=action.slot,
        end_time=end_time,
        guardian_id=guardian_id,
        wall_now=wall_now,
    )

    return _Done(
        committed=CommittedAction(kind="book", booking_id=booking.id),
        summary={"kind": "book", **_booking_json(booking)},
    )


def _cancel(
    ctx: ToolContext, action: _Cancel, *, guardian_id: uuid.UUID, wall_now: datetime.datetime
) -> _Done:
    _check_policy(
        guardian_policy.check_cancel(
            ctx.db, guardian_id=guardian_id, booking_id=action.booking_id, now=wall_now
        )
    )
    booking = _cancel_booking(
        ctx.db, booking_id=action.booking_id, expected_updated_at=action.expected_updated_at
    )

    return _Done(
        committed=CommittedAction(kind="cancel", booking_id=booking.id),
        summary={"kind": "cancel", **_booking_json(booking)},
    )


def _reschedule(
    ctx: ToolContext,
    action: _Reschedule,
    *,
    guardian_id: uuid.UUID,
    wall_now: datetime.datetime,
) -> _Done:
    end_time = _end_time(ctx.db, action.slot.start_time)
    _check_policy(
        guardian_policy.check_reschedule(
            ctx.db,
            guardian_id=guardian_id,
            booking_id=action.booking_id,
            tutor_id=action.slot.tutor_id,
            date=action.slot.date,
            start_time=action.slot.start_time,
            end_time=end_time,
            location=action.slot.location,
            now=wall_now,
        )
    )
    # The policy has matched the id to the Guardian's own Booking.
    subject_id = ctx.db.get_one(Booking, action.booking_id).subject_id
    # An Evaluation has no Subject to rebook with; the office arranges those.
    if subject_id is None:
        raise _Refused(EVALUATION_GOES_TO_OFFICE)

    old = _cancel_booking(
        ctx.db, booking_id=action.booking_id, expected_updated_at=action.expected_updated_at
    )
    previous = _booking_json(old)
    booking = _create(
        ctx.db,
        child_id=old.child_id,
        subject_id=subject_id,
        slot=action.slot,
        end_time=end_time,
        guardian_id=guardian_id,
        wall_now=wall_now,
    )

    return _Done(
        committed=CommittedAction(kind="reschedule", booking_id=booking.id),
        summary={"kind": "reschedule", **_booking_json(booking), "from": previous},
    )


def _create(
    db: Session,
    *,
    child_id: uuid.UUID,
    subject_id: uuid.UUID,
    slot: _Slot,
    end_time: datetime.time,
    guardian_id: uuid.UUID,
    wall_now: datetime.datetime,
) -> Booking:
    """A Session through `booking_write_service`, every warning a hard refusal (the bot
    confirms none). Policy has already matched the slot to a range that allows the Location."""
    availability_id = _availability_id(db, slot=slot, end_time=end_time)
    if availability_id is None:
        raise _Refused(SLOT_NOT_FREE)

    request = booking_write_service.BookingRequest(
        child_id=child_id,
        user_id=db.scalars(select(Tutor.user_id).where(Tutor.id == slot.tutor_id)).one(),
        kind=BookingKind.REGULAR,
        location=slot.location,
        subject_id=subject_id,
        availability_id=availability_id,
        home_id=slot.home_id,
        scheduled_date=slot.date,
        start_time=slot.start_time,
        end_time=end_time,
        booked_by_guardian_id=guardian_id,
        notes=BOOKING_NOTE,
    )

    try:
        booking = booking_write_service.create_booking(db, request=request, now=wall_now)
    except booking_write_service.BookingWriteError as error:
        reason = _WRITE_REFUSALS.get(type(error))
        if reason is None:
            raise
        raise _Refused(reason) from error

    return booking


def _cancel_booking(
    db: Session, *, booking_id: uuid.UUID, expected_updated_at: datetime.datetime | None
) -> Booking:
    try:
        booking = booking_status_service.change_status(
            db,
            booking_id=booking_id,
            target=BookingStatus.CANCELLED,
            expected_updated_at=expected_updated_at,
        )
    except booking_status_service.BookingChanged as error:
        raise _Refused(BOOKING_CHANGED) from error
    except booking_status_service.IllegalTransition as error:
        raise _Refused(BOOKING_NOT_LIVE) from error

    return booking


def _availability_id(db: Session, *, slot: _Slot, end_time: datetime.time) -> uuid.UUID | None:
    """The Tutor's active range that holds the whole slot and allows its Location: the range
    `slot_service` would have offered it from."""
    modes = [
        mode for mode, allowed in slot_service.MODE_LOCATIONS.items() if slot.location in allowed
    ]

    return db.scalars(
        select(TutorAvailability.id)
        .where(
            TutorAvailability.tutor_id == slot.tutor_id,
            TutorAvailability.is_active.is_(True),
            # 0 = Monday, the encoding `tutor_availability` stores; never `isoweekday()`.
            TutorAvailability.day_of_week == slot.date.weekday(),
            TutorAvailability.start_time <= slot.start_time,
            TutorAvailability.end_time >= end_time,
            TutorAvailability.mode.in_(modes),
        )
        .order_by(TutorAvailability.start_time, TutorAvailability.id)
    ).first()


def _end_time(db: Session, start_time: datetime.time) -> datetime.time:
    """A Session is `session_length_minutes` long, as the slot grid cuts it."""
    length = scheduling_service.load_scheduling_settings(db).session_length_minutes
    starts_at = datetime.datetime.combine(datetime.date.min, start_time)
    ends_at = starts_at + datetime.timedelta(minutes=length)
    # A Session never crosses midnight; a wrapped end would break `ck_bookings_time_order`.
    if ends_at.date() != starts_at.date():
        raise _Refused(SLOT_NOT_FREE)

    return ends_at.time()


# --- shared checks ------------------------------------------------------------------------------


def _check_bookable_child(ctx: ToolContext, *, child_id: uuid.UUID) -> None:
    """The Guardian's own, active and Evaluated Child. The link is checked first, so the other
    refusals say nothing about another family's Child."""
    guardian_id = _guardian_id(ctx)
    is_linked = ctx.db.scalar(
        select(
            exists().where(
                ChildGuardian.child_id == child_id, ChildGuardian.guardian_id == guardian_id
            )
        )
    )
    child = ctx.db.get(Child, child_id) if is_linked else None

    if child is None:
        raise _Refused(guardian_policy.CHILD_NOT_LINKED)
    if child.is_archived:
        raise _Refused(CHILD_ARCHIVED)
    if child.evaluated_at is None:
        raise _Refused(CHILD_NOT_EVALUATED)


def _check_policy(refusal: guardian_policy.Refusal | None) -> None:
    if refusal is not None:
        raise _Refused(refusal.code, **refusal.detail)


def _guardian_id(ctx: ToolContext) -> uuid.UUID:
    """No Guardian yet (Intake not started) owns no Child, so it is refused like a stranger."""
    guardian_id = ctx.conversation.guardian_id
    if guardian_id is None:
        raise _Refused(guardian_policy.CHILD_NOT_LINKED)

    return guardian_id


def _wall_clock(ctx: ToolContext) -> datetime.datetime:
    """The turn's instant as business wall-clock, the zone every scheduling column is in."""
    return clock.to_business_wall_clock(ctx.now, clock.business_zone())


# --- input, storage and output shapes -----------------------------------------------------------


def _proposed_actions(raw: Mapping[str, Any], *, homes: Sequence[Home]) -> list[_Action]:
    """The agent's `book`, `cancel` and `reschedule` lists as actions, in `_KINDS` order. Every
    problem in the input is reported at once, so one retry can fix them all. A list (or an
    item) sent as JSON text is read as the JSON it holds: a common model slip, and unambiguous.
    `homes` are the Guardian's active Homes: with exactly one, a home action may leave out
    `home_id`."""
    problems: list[_Problem] = []
    actions: list[_Action] = []

    if "actions" in raw:
        problems.append(
            _Problem(
                "actions",
                "actions",
                NOT_VALID,
                "no `actions` field: put each action in the book, cancel or reschedule list",
            )
        )

    for kind in _KINDS:
        items = _decoded(raw.get(kind, []))
        if not isinstance(items, list):
            problems.append(
                _Problem(kind, kind, NOT_VALID, f"a list of {kind} objects (empty for none)")
            )
            continue

        for index, item in enumerate(items):
            label = f"{kind}[{index}]"
            fields = _Fields(_decoded(item), action=label)
            action = _action_of(kind, fields, homes=homes)
            problems += fields.problems
            if action is not None:
                actions.append(action)

    if not problems and not actions:
        problems.append(
            _Problem("book", "book", MISSING, "at least one action in book, cancel or reschedule")
        )
    if problems:
        raise _invalid(problems)

    return actions


def _action_of(kind: str, fields: "_Fields", *, homes: Sequence[Home]) -> _Action | None:
    """The action `fields` describes, or `None` with its problems left on `fields`."""
    if not fields.is_object:
        return None

    if kind == "cancel":
        action: _Action = _Cancel(booking_id=fields.uuid("booking_id"), expected_updated_at=None)
    elif kind == "reschedule":
        action = _Reschedule(
            booking_id=fields.uuid("booking_id"),
            slot=_slot_of(fields, homes=homes),
            expected_updated_at=None,
        )
    else:
        action = _Book(
            child_id=fields.uuid("child_id"),
            subject_id=fields.uuid("subject_id"),
            slot=_slot_of(fields, homes=homes),
        )

    # Built from placeholders when a field had a problem; never used then.
    return None if fields.problems else action


def _slot_of(fields: "_Fields", *, homes: Sequence[Home]) -> _Slot:
    location = fields.location()

    return _Slot(
        tutor_id=fields.uuid("tutor_id"),
        date=fields.date("date"),
        start_time=fields.time("start_time"),
        location=location,
        home_id=_home_of(fields, location=location, homes=homes),
    )


def _home_of(
    fields: "_Fields", *, location: BookingLocation | None, homes: Sequence[Home]
) -> uuid.UUID | None:
    """The Home a home action is at: the one given, or the family's only Home. With no
    location (it had a problem) and no Home to fill in, the missing `home_id` is reported now
    too, so one retry fixes both."""
    is_given = fields.has("home_id")
    only_home = homes[0].id if len(homes) == 1 else None
    home_id = None

    if location is BookingLocation.HOME and is_given:
        home_id = fields.uuid("home_id")
    elif location is BookingLocation.HOME and only_home is not None:
        home_id = only_home
    elif location is not BookingLocation.IN_OFFICE and not is_given and only_home is None:
        fields.add_missing("home_id", _home_choices(homes))
    return home_id


def _home_choices(homes: Sequence[Home]) -> str:
    """What `home_id` must be when it can't be filled in: the agent picks from these."""
    if not homes:
        return (
            "a Home's id, but the Guardian has no Home saved: save one with create_home, or "
            "book at the office"
        )

    choices = ", ".join(
        f"{home.id} ({'no label' if home.label is None else home.label})" for home in homes
    )
    return f"needed when location is home: the home id of one of the family's Homes: {choices}"


def _family_homes(ctx: ToolContext) -> list[Home]:
    """The Guardian's active Homes, the ones the snapshot lists; none before a Guardian."""
    guardian_id = ctx.conversation.guardian_id
    if guardian_id is None:
        return []

    return list(
        ctx.db.scalars(
            select(Home)
            .join(GuardianHome, GuardianHome.home_id == Home.id)
            .where(GuardianHome.guardian_id == guardian_id, Home.is_archived.is_(False))
            .order_by(Home.created_at, Home.id)
        ).all()
    )


def _labels(actions: list[_Action]) -> list[str]:
    """`book[0]`, `cancel[1]`...: each action's place in its own kind's list, as the agent sent
    it. Actions run and are stored grouped in `_KINDS` order, so this recounts the same."""
    seen: dict[str, int] = {}
    labels = []
    for action in actions:
        kind = _kind_of(action)
        labels.append(f"{kind}[{seen.get(kind, 0)}]")
        seen[kind] = seen.get(kind, 0) + 1
    return labels


def _kind_of(action: _Action) -> str:
    if isinstance(action, _Book):
        return "book"
    return "cancel" if isinstance(action, _Cancel) else "reschedule"


class _Fields:
    """Reads one input object's fields, collecting every problem instead of stopping at the
    first. A field with a problem reads as `None`; check `problems` before using the values."""

    def __init__(self, raw: object, *, action: str | None = None) -> None:
        self._raw: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
        self._action = action
        self.is_object = isinstance(raw, Mapping)
        self.problems: list[_Problem] = []
        if not self.is_object:
            kind = (action or "").split("[")[0]
            needs = ", ".join(_NEEDS.get(kind, ()))
            self.problems.append(
                _Problem(
                    action or "input",
                    kind or "input",
                    NOT_VALID,
                    f"a JSON object with {needs}",
                    action,
                )
            )

    def uuid(self, field: str) -> Any:
        return self._read(field, uuid.UUID)

    def date(self, field: str) -> Any:
        return self._read(field, datetime.date.fromisoformat)

    def time(self, field: str) -> Any:
        return self._read(field, _naive_time)

    def location(self) -> Any:
        return self._read("location", _LOCATIONS.__getitem__)

    def has(self, field: str) -> bool:
        return self._raw.get(field) is not None

    def add_missing(self, field: str, expected: str) -> None:
        at = field if self._action is None else f"{self._action}.{field}"
        self.problems.append(_Problem(at, field, MISSING, expected, self._action))

    def check(self) -> None:
        if self.problems:
            raise _invalid(self.problems)

    def _read[T](self, field: str, parse: Callable[[str], T]) -> T | None:
        value = self._raw.get(field)
        problem = None
        parsed = None
        if value is None:
            problem = MISSING
        elif not isinstance(value, str):
            problem = NOT_VALID
        else:
            try:
                parsed = parse(value)
            except (ValueError, KeyError):
                problem = NOT_VALID

        if problem is not None:
            at = field if self._action is None else f"{self._action}.{field}"
            self.problems.append(_Problem(at, field, problem, _EXPECTED[field], self._action))
        return parsed


def _naive_time(value: str) -> datetime.time:
    """HH:MM (seconds tolerated); a time with a zone isn't a wall-clock slot."""
    parsed = datetime.time.fromisoformat(value)
    if parsed.tzinfo is not None:
        raise ValueError(value)
    return parsed


def _decoded(value: object) -> object:
    """`value`, or the JSON a string of it holds when it decodes to a list or an object."""
    if not isinstance(value, str):
        return value

    try:
        decoded = json.loads(value)
    # Deeply nested text overflows the decoder's recursion: as unreadable as malformed JSON.
    except (ValueError, RecursionError):
        return value

    return decoded if isinstance(decoded, list | dict) else value


def _invalid(problems: list[_Problem]) -> "_Refused":
    """The refusal for bad input, naming every problem. A Home id left out is the one problem
    with its own reason: `home_needed`."""
    first = problems[0]
    is_home_needed = all(p.field == "home_id" and p.kind == MISSING for p in problems)
    detail: dict[str, object] = {
        "field": first.field,
        "expected": first.expected,
        "problems": [problem.as_json() for problem in problems],
    }
    if first.action is not None:
        detail["action"] = first.action

    return _Refused(HOME_NEEDED if is_home_needed else INVALID_INPUT, **detail)


def _action_json(action: _Action) -> dict[str, object]:
    """The stored form: the agent's own fields plus the `updated_at` stamp."""
    if isinstance(action, _Book):
        return {
            "kind": "book",
            "child_id": str(action.child_id),
            "subject_id": str(action.subject_id),
            **_slot_json_of(action.slot),
        }

    stamp = action.expected_updated_at
    stored: dict[str, object] = {
        "kind": _kind_of(action),
        "booking_id": str(action.booking_id),
        "expected_updated_at": None if stamp is None else stamp.isoformat(),
    }
    if isinstance(action, _Reschedule):
        stored.update(_slot_json_of(action.slot))
    return stored


def _slot_json_of(slot: _Slot) -> dict[str, object]:
    return {
        "tutor_id": str(slot.tutor_id),
        "date": slot.date.isoformat(),
        "start_time": _hhmm(slot.start_time),
        "location": _LOCATION_NAMES[slot.location],
        "home_id": None if slot.home_id is None else str(slot.home_id),
    }


def _stored_action(stored: dict[str, object]) -> _Action:
    """The inverse of `_action_json`. Written by `propose` only, so a malformed row is a bug
    and raises."""
    kind = str(stored.get("kind"))
    fields = _Fields(stored, action=kind)
    action = _action_of(kind, fields, homes=())
    if action is None:
        raise ValueError(f"malformed stored action: {[p.at for p in fields.problems]}")
    raw_stamp = stored.get("expected_updated_at")
    stamp = datetime.datetime.fromisoformat(raw_stamp) if isinstance(raw_stamp, str) else None

    return action if isinstance(action, _Book) else replace(action, expected_updated_at=stamp)


def _booking_json(booking: Booking) -> dict[str, Any]:
    """The plain facts of a Session, for the agent's summary. Read before any savepoint rolls
    back, while the row is still loaded."""
    return {
        "booking_id": str(booking.id),
        "child": booking.child.name,
        "tutor": booking.staff.name,
        "date": booking.scheduled_date.isoformat(),
        "start_time": _hhmm(booking.start_time),
        "end_time": _hhmm(booking.end_time),
        "location": _LOCATION_NAMES[booking.location],
    }


def _hhmm(value: datetime.time) -> str:
    return value.strftime("%H:%M")


# --- the tool edge ------------------------------------------------------------------------------


def _logged(
    name: str, run: Callable[[ToolContext, dict[str, Any]], ToolResult]
) -> Callable[[ToolContext, dict[str, Any]], ToolResult]:
    """The tool audit (spec §8: app log, no table) and the one place a `_Refused` becomes a
    `refused` result."""

    def logged_run(ctx: ToolContext, raw: dict[str, Any]) -> ToolResult:
        context = {"conversation_id": str(ctx.conversation.id), "tool": name}
        logger.info("bot_tool.%s called", name, extra={**context, "input": raw})

        try:
            result = run(ctx, raw)
        except _Refused as refusal:
            result = ToolResult(
                status="refused", content={"reason": refusal.reason, **refusal.detail}
            )
            logger.warning(
                "bot_tool.%s refused: %s%s",
                name,
                refusal.reason,
                _refusal_where(refusal.detail),
                extra={**context, "content": result.content},
            )
        except Exception:
            logger.exception("bot_tool.%s failed", name, extra=context)
            raise
        else:
            logger.info("bot_tool.%s ok", name, extra={**context, **_loggable(result)})

        return result

    return logged_run


def _refusal_where(detail: dict[str, object]) -> str:
    """` (book[0].date, book[0].start_time)`: where a refusal points, by field and action name
    only. Never a value: the input carries the Guardian's data."""
    problems = detail.get("problems")
    if isinstance(problems, list):
        places = [str(problem["at"]) for problem in problems]
    elif detail.get("action") is not None:
        places = [str(detail["action"])]
    else:
        places = []

    return f" ({', '.join(places)})" if places else ""


def _loggable(result: ToolResult) -> dict[str, object]:
    """Ids and counts only: summaries carry Child and Tutor names, which stay out of the log."""
    content = result.content
    entries = content.get("proposal") or content.get("committed") or []

    return {
        "slot_count": len(content.get("slots", [])),
        "booking_ids": [entry["booking_id"] for entry in entries],
    }


def _strict(
    properties: dict[str, Any], *, optional: frozenset[str] = frozenset()
) -> dict[str, Any]:
    """Strict: closed object. An optional property is left out of `required`, never made
    nullable, because the API caps the union-typed parameters a request may carry."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [name for name in properties if name not in optional],
        "properties": properties,
    }


_SLOT_PROPERTIES = {
    "tutor_id": {**_UUID, "description": "The chosen list_slots slot's tutor_id."},
    "date": {**_DATE, "description": "The chosen slot's date, YYYY-MM-DD."},
    "start_time": {
        "type": "string",
        "description": "The chosen slot's start_time: HH:MM, 24-hour (16:30, not 4:30 PM).",
    },
    "location": {**_LOCATION, "description": "The location list_slots was asked for."},
    "home_id": {
        **_UUID,
        "description": "The Home's home id from the snapshot. Needed when location is home and "
        "the family has more than one Home; with one Home it is filled in. Leave out for office.",
    },
}
_BOOK_SCHEMA = _strict(
    {
        "child_id": {**_UUID, "description": "The Child's child id from the snapshot."},
        "subject_id": {**_UUID, "description": "The Subject's subject id from the snapshot."},
        **_SLOT_PROPERTIES,
    },
    optional=frozenset({"home_id"}),
)
_CANCEL_SCHEMA = _strict(
    {"booking_id": {**_UUID, "description": "The session's booking id from the snapshot."}}
)
_RESCHEDULE_SCHEMA = _strict(
    {
        "booking_id": {
            **_UUID,
            "description": "The booking id of the session to move, from the snapshot.",
        },
        **_SLOT_PROPERTIES,
    },
    optional=frozenset({"home_id"}),
)

LIST_SLOTS = ToolSpec(
    name="list_slots",
    description=(
        "Free Session times for an Evaluated Child and a Subject, between two dates (at most "
        f"{MAX_LIST_DAYS} days), at home or at the office. Each slot's tutor_id, date, "
        "start_time and location are exactly what propose takes. Refused no_tutor_for_subject "
        "when nobody can teach it at that Location (hand off to the office); an empty list "
        "means nobody is free in that range (offer other days first)."
    ),
    input_schema=_strict(
        {
            "child_id": {**_UUID, "description": "The Child's child id from the snapshot."},
            "subject_id": {**_UUID, "description": "The Subject's subject id from the snapshot."},
            "date_from": _DATE,
            "date_to": {**_DATE, "description": "YYYY-MM-DD, on or after date_from."},
            "location": _LOCATION,
        }
    ),
    run=_logged("list_slots", _list_slots),
)

PROPOSE = ToolSpec(
    name="propose",
    description=(
        "Check and hold book, cancel and reschedule actions for the Guardian's yes; at least "
        "one action across the three lists, an empty list for a kind you don't need. Replaces "
        "any earlier proposal. Nothing is saved until commit_proposal. Copy tutor_id, date, "
        "start_time and location from the chosen list_slots slot, and ids from the snapshot. "
        "Refused with a reason and the failing action (book[0], cancel[1]...) if any action "
        "breaks a rule; an invalid_input refusal lists every field to fix and its format."
    ),
    input_schema=_strict(
        {
            "book": {"type": "array", "items": _BOOK_SCHEMA},
            "cancel": {"type": "array", "items": _CANCEL_SCHEMA},
            "reschedule": {"type": "array", "items": _RESCHEDULE_SCHEMA},
        }
    ),
    run=_logged("propose", _propose),
)

COMMIT_PROPOSAL = ToolSpec(
    name="commit_proposal",
    description=(
        "Save the pending proposal, only after the Guardian said yes to it in a later message. "
        "All actions land or none do. The confirmation message is sent for you."
    ),
    input_schema=_strict({}),
    run=_logged("commit_proposal", _commit_proposal),
)

TOOLS: tuple[ToolSpec, ...] = (LIST_SLOTS, PROPOSE, COMMIT_PROPOSAL)
