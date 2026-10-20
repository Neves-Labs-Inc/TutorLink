"""Guardian self-service policy: the rules a Guardian's own booking changes meet and the
Office's don't (spec §2 "Where rules live", #252).

The bot's booking tools call a `check_*` function **before** the shared Booking services
(`booking_write_service`, `booking_status_service`); the dashboard never does, so the Office
can still cancel inside the cutoff and book any Tutor. A `Refusal` carries a stable `code` the
agent rephrases for the Guardian, and `None` means "go on to the shared services".

Read-only: nothing here writes, flushes or commits.

The Guardian–Child link is checked **first**, in every check, even though
`booking_write_service` checks it too: `booking_status_service` (cancel) does not, and without it
every later refusal (assigned Tutors, Location, another Child's Sessions, the cutoff) would be an
oracle on another family. A Booking id that names nothing gets the same `child_not_linked` as a
foreign one, so existence doesn't leak either.

Not checked here, because the shared services already refuse them for everyone: Evaluated-only
Tutoring, booking window and lead time, Availability, gap, Time off and archived references.
"""

import datetime
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.child_assigned_tutor import ChildAssignedTutor
from app.models.enums import BookingLocation
from app.models.guardian import ChildGuardian
from app.models.tutor import Tutor
from app.services.scheduling_service import overlaps
from app.services.settings_service import get_int_setting
from app.services.slot_service import MODE_LOCATIONS

logger = logging.getLogger(__name__)

CANCELLATION_CUTOFF_SETTING = "cancellation_cutoff_hours"

CHILD_NOT_LINKED = "child_not_linked"
INSIDE_CUTOFF = "inside_cutoff"
NOT_ASSIGNED_TUTOR = "not_assigned_tutor"
LOCATION_NOT_ALLOWED = "location_not_allowed"
CHILD_OVERLAP = "child_overlap"


@dataclass(frozen=True, slots=True)
class _Slot:
    """The slot being written: a new booking's, or a Reschedule's new time."""

    child_id: uuid.UUID
    tutor_id: uuid.UUID
    date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    location: BookingLocation
    # A Reschedule's Booking, which is not its own neighbour; `None` on a new booking.
    moving_booking_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Refusal:
    code: str
    detail: dict[str, Any] = field(default_factory=dict)


def check_book(
    db: Session,
    *,
    guardian_id: uuid.UUID,
    child_id: uuid.UUID,
    tutor_id: uuid.UUID,
    date: datetime.date,
    start_time: datetime.time,
    end_time: datetime.time,
    location: BookingLocation,
    now: datetime.datetime,
) -> Refusal | None:
    """A new Session for `child_id` with the Tutor profile `tutor_id` (the id a slot offers).

    No rule here depends on `now` yet (lead time is the shared services'); it is taken so the
    three checks share one call shape."""
    slot = _Slot(
        child_id=child_id,
        tutor_id=tutor_id,
        date=date,
        start_time=start_time,
        end_time=end_time,
        location=location,
    )
    refusal = (
        _slot_refusal(db, slot=slot)
        if _is_linked(db, guardian_id=guardian_id, child_id=child_id)
        else Refusal(code=CHILD_NOT_LINKED)
    )

    _log(refusal, operation="book", guardian_id=guardian_id, child_id=child_id, tutor_id=tutor_id)
    return refusal


def check_reschedule(
    db: Session,
    *,
    guardian_id: uuid.UUID,
    booking_id: uuid.UUID,
    tutor_id: uuid.UUID,
    date: datetime.date,
    start_time: datetime.time,
    end_time: datetime.time,
    location: BookingLocation,
    now: datetime.datetime,
) -> Refusal | None:
    """Moving `booking_id` to a new slot: the cutoff applies to the Session being moved, and
    the new slot meets every rule a new booking does, for the same Child."""
    booking = _linked_booking(db, guardian_id=guardian_id, booking_id=booking_id)
    refusal = Refusal(code=CHILD_NOT_LINKED)

    if booking is not None:
        slot = _Slot(
            child_id=booking.child_id,
            tutor_id=tutor_id,
            date=date,
            start_time=start_time,
            end_time=end_time,
            location=location,
            moving_booking_id=booking.id,
        )
        refusal = _cutoff_refusal(db, booking=booking, now=now) or _slot_refusal(db, slot=slot)

    _log(refusal, operation="reschedule", guardian_id=guardian_id, booking_id=booking_id)
    return refusal


def check_cancel(
    db: Session, *, guardian_id: uuid.UUID, booking_id: uuid.UUID, now: datetime.datetime
) -> Refusal | None:
    """`now` is the naive business wall-clock, the zone every scheduling column is in."""
    booking = _linked_booking(db, guardian_id=guardian_id, booking_id=booking_id)
    refusal = (
        Refusal(code=CHILD_NOT_LINKED)
        if booking is None
        else _cutoff_refusal(db, booking=booking, now=now)
    )

    _log(refusal, operation="cancel", guardian_id=guardian_id, booking_id=booking_id)
    return refusal


def _linked_booking(
    db: Session, *, guardian_id: uuid.UUID, booking_id: uuid.UUID
) -> Booking | None:
    """The Booking, if it exists and its Child is linked to the Guardian; else `None`."""
    booking = db.get(Booking, booking_id)
    is_theirs = booking is not None and _is_linked(
        db, guardian_id=guardian_id, child_id=booking.child_id
    )

    return booking if is_theirs else None


def _is_linked(db: Session, *, guardian_id: uuid.UUID, child_id: uuid.UUID) -> bool:
    link = db.scalar(
        select(ChildGuardian.id).where(
            ChildGuardian.child_id == child_id, ChildGuardian.guardian_id == guardian_id
        )
    )

    return link is not None


def _slot_refusal(db: Session, *, slot: _Slot) -> Refusal | None:
    """The rules on the slot being written, in the order the agent should hear them."""
    if not _is_assigned(db, child_id=slot.child_id, tutor_id=slot.tutor_id):
        return Refusal(code=NOT_ASSIGNED_TUTOR)

    allowed = _allowed_locations(db, slot=slot)
    if slot.location not in allowed:
        return Refusal(
            code=LOCATION_NOT_ALLOWED,
            detail={"allowed": sorted(location.value for location in allowed)},
        )

    clash = _overlapping_session(db, slot=slot)
    if clash is not None:
        return Refusal(code=CHILD_OVERLAP, detail={"booking_id": str(clash.id)})

    return None


def _overlapping_session(db: Session, *, slot: _Slot) -> Booking | None:
    """The Child's earliest live Session of either kind that overlaps the slot. Half-open, as
    the Staff exclusion constraint is, so back-to-back Sessions don't clash."""
    sessions = db.scalars(
        select(Booking)
        .where(
            Booking.child_id == slot.child_id,
            Booking.scheduled_date == slot.date,
            Booking.status.in_(LIVE_BOOKING_STATUSES),
        )
        .order_by(Booking.start_time, Booking.id)
    )

    return next(
        (
            session
            for session in sessions
            if session.id != slot.moving_booking_id
            and overlaps(slot.start_time, slot.end_time, session.start_time, session.end_time)
        ),
        None,
    )


def _allowed_locations(db: Session, *, slot: _Slot) -> frozenset[BookingLocation]:
    """The union of `MODE_LOCATIONS` over the Tutor's active ranges that hold the whole slot.

    A slot no range holds allows nothing: the bot only ever offers slots inside a range, and
    the shared write path only *warns* about one outside (`outside_slot`), which the Office may
    confirm and a Guardian must not.
    """
    ranges = db.scalars(
        select(TutorAvailability).where(
            TutorAvailability.tutor_id == slot.tutor_id,
            TutorAvailability.is_active.is_(True),
            # 0 = Monday, the encoding `tutor_availability` stores; never `isoweekday()`.
            TutorAvailability.day_of_week == slot.date.weekday(),
            TutorAvailability.start_time <= slot.start_time,
            TutorAvailability.end_time >= slot.end_time,
        )
    )

    return frozenset().union(*(MODE_LOCATIONS[row.mode] for row in ranges))


def _is_assigned(db: Session, *, child_id: uuid.UUID, tutor_id: uuid.UUID) -> bool:
    """An assignment names the person, so the slot's Tutor profile is matched by its user. An
    unknown profile is never assigned."""
    assigned = db.scalar(
        select(ChildAssignedTutor.id)
        .join(Tutor, Tutor.user_id == ChildAssignedTutor.user_id)
        .where(ChildAssignedTutor.child_id == child_id, Tutor.id == tutor_id)
    )

    return assigned is not None


def _cutoff_refusal(db: Session, *, booking: Booking, now: datetime.datetime) -> Refusal | None:
    """`cancellation_cutoff_hours`, read per call like every other setting."""
    hours = get_int_setting(db, key=CANCELLATION_CUTOFF_SETTING)
    starts_at = datetime.datetime.combine(booking.scheduled_date, booking.start_time)

    if starts_at - now >= datetime.timedelta(hours=hours):
        return None

    return Refusal(code=INSIDE_CUTOFF, detail={"hours": hours})


def _log(refusal: Refusal | None, *, operation: str, **context: object) -> None:
    if refusal is None:
        return

    logger.warning(
        "guardian_policy.%s refused: %s",
        operation,
        refusal.code,
        extra={**{key: str(value) for key, value in context.items()}, "detail": refusal.detail},
    )
