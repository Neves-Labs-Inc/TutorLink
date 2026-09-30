"""A tutor's recurring weekly slots: full CRUD over `tutor_availability`.

This module knows nothing about FastAPI, status codes, or request bodies; it raises the domain
exceptions below and `app.routers.availability` maps them.

**Transaction contract — read this before calling.** Nothing here commits: the caller owns the
transaction boundary, as in `exception_service`. `db.flush()` makes writes visible within the
transaction and surfaces `IntegrityError` immediately.

**Duplicate slots are refused twice**, per `03-RESEARCH.md`'s normative idiom. The pre-check
`_slot_taken` produces the contract's readable message; `uq_tutor_availability_slot
(tutor_id, day_of_week, start_time)` is what survives a race between two requests, and the
savepoint around the write is what leaves the `Session` usable when it fires. Both write paths
carry both layers.

`deactivate_availability` can only ever be a soft delete: `bookings.availability_id` is a
`NOT NULL` foreign key (`models/booking.py:83-85`), so a hard delete would either fail on that
constraint or orphan a booking's history. Deactivating an already-inactive row is a no-op, not
a conflict.
"""

import datetime
import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.tutor import Tutor


class AvailabilityServiceError(Exception):
    """Base class for every failure this module reports."""


class TutorNotFound(AvailabilityServiceError):
    """No `tutors` row for the requested id."""


class AvailabilityNotFound(AvailabilityServiceError):
    """No `tutor_availability` row for the requested id."""


class AvailabilitySlotTaken(AvailabilityServiceError):
    """This tutor already has a slot starting at that time on that day."""


class InvalidTimeRange(AvailabilityServiceError):
    """`end_time` is not after `start_time`."""


def list_availability(
    db: Session, *, tutor_id: uuid.UUID, limit: int, offset: int
) -> tuple[list[TutorAvailability], int]:
    """Every slot for `tutor_id`, active and deactivated alike, plus the count before paging.

    No `is_active` filter (OQ-5, `docs/api-design.md:68`): the schedule editor needs to see a
    withdrawn slot in order to restore it, which is why this list is the documented exception to
    the otherwise-uniform soft-delete list rule (`CONSTITUTION.md` §9).
    """

    matching = select(TutorAvailability).where(TutorAvailability.tutor_id == tutor_id)
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0

    rows = list(
        db.scalars(
            matching.order_by(
                TutorAvailability.day_of_week, TutorAvailability.start_time, TutorAvailability.id
            )
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return rows, total


def create_availability(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    day_of_week: int,
    start_time: datetime.time,
    end_time: datetime.time,
) -> TutorAvailability:
    """Add a recurring weekly slot for `tutor_id`."""
    if db.get(Tutor, tutor_id) is None:
        raise TutorNotFound(f"no tutor {tutor_id}")

    if end_time <= start_time:
        raise InvalidTimeRange("end_time must be after start_time")

    if _slot_taken(
        db, tutor_id=tutor_id, day_of_week=day_of_week, start_time=start_time, exclude_id=None
    ):
        raise AvailabilitySlotTaken

    row = TutorAvailability(
        tutor_id=tutor_id, day_of_week=day_of_week, start_time=start_time, end_time=end_time
    )

    # The savepoint wraps the insert and nothing else — the same shape `client_service.py`'s
    # `create_client` uses, for the same reason: unwinding to it on `IntegrityError` is what
    # keeps the `Session` usable for the rest of the request. Never match on the constraint's
    # name; it does not survive a table rename across a migrated vs `create_all` database.
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError as exc:
        raise AvailabilitySlotTaken from exc

    return row


def update_availability(
    db: Session,
    *,
    availability_id: uuid.UUID,
    start_time: datetime.time | None,
    end_time: datetime.time | None,
    is_active: bool | None,
) -> TutorAvailability:
    """Change a slot's time window or active status. `day_of_week` cannot move here — moving a
    slot to a different day is a delete plus a create, not an edit."""
    row = _availability(db, availability_id=availability_id)

    merged_start = start_time if start_time is not None else row.start_time
    merged_end = end_time if end_time is not None else row.end_time

    if merged_end <= merged_start:
        raise InvalidTimeRange("end_time must be after start_time")

    if _slot_taken(
        db,
        tutor_id=row.tutor_id,
        day_of_week=row.day_of_week,
        start_time=merged_start,
        exclude_id=availability_id,
    ):
        raise AvailabilitySlotTaken

    # The edits are assigned *inside* the savepoint, not before it: `begin_nested` flushes
    # whatever is already dirty before it emits the SAVEPOINT (`SessionTransaction._take_
    # snapshot`), so an assignment made above this block would run outside the savepoint and a
    # constraint violation here would deactivate the request's whole root transaction rather
    # than just this edit, leaving the `Session` unusable behind a correct-looking 409.
    try:
        with db.begin_nested():
            if start_time is not None:
                row.start_time = start_time

            if end_time is not None:
                row.end_time = end_time

            if is_active is not None:
                row.is_active = is_active

            db.flush()
    except IntegrityError as exc:
        raise AvailabilitySlotTaken from exc

    return row


def deactivate_availability(db: Session, *, availability_id: uuid.UUID) -> TutorAvailability:
    """Soft-delete a slot. The only delete there is: `bookings.availability_id` is a `NOT NULL`
    foreign key, so a hard delete would either fail on it or orphan booking history."""
    row = _availability(db, availability_id=availability_id)
    row.is_active = False
    db.flush()

    return row


def _slot_taken(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    day_of_week: int,
    start_time: datetime.time,
    exclude_id: uuid.UUID | None,
) -> bool:
    statement = select(TutorAvailability.id).where(
        TutorAvailability.tutor_id == tutor_id,
        TutorAvailability.day_of_week == day_of_week,
        TutorAvailability.start_time == start_time,
    )

    if exclude_id is not None:
        statement = statement.where(TutorAvailability.id != exclude_id)

    return db.scalars(statement).first() is not None


def _availability(db: Session, *, availability_id: uuid.UUID) -> TutorAvailability:
    row = db.get(TutorAvailability, availability_id)

    if row is None:
        raise AvailabilityNotFound(f"no availability {availability_id}")

    return row
