"""The read path over `bookings`, scoped to one client.

Same transaction contract as every other service here: nothing commits, the caller owns the
boundary.
"""

import datetime
import uuid
from dataclasses import dataclass, replace

from sqlalchemy import ColumnElement, Select, func, not_, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus
from app.models.guardian import ChildGuardian, Guardian
from app.models.tutor import Tutor
from app.models.user import User
from app.services.sort_out_service import SortOutReason, sort_out_predicate

_LIKE_ESCAPE = "\\"
_LIKE_WILDCARDS = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


@dataclass(frozen=True, slots=True)
class BookingFilters:
    statuses: tuple[BookingStatus, ...] = ()
    # A teaching profile's id, resolved to the Staff member's user through `tutors.user_id`:
    # it is what tutor scoping carries. Spec 02 adds a Staff (user) filter beside it.
    tutor_id: uuid.UUID | None = None
    date_from: datetime.date | None = None
    date_to: datetime.date | None = None
    subject_id: uuid.UUID | None = None
    child_id: uuid.UUID | None = None
    kinds: tuple[BookingKind, ...] = ()
    location: BookingLocation | None = None
    # Staff members' user ids (`bookings.user_id`); `tutor_id` above is the profile-keyed twin.
    user_ids: tuple[uuid.UUID, ...] = ()
    # Case-insensitive substring of the Child's or the Staff member's name.
    q: str | None = None
    # Bookings to sort out (`sort_out_service`): True only those with a reason, False only those
    # with none, None either. `reason` narrows to that one reason and implies True. Both read
    # `now` (business wall-clock), which must then be set.
    to_sort_out: bool | None = None
    reason: SortOutReason | None = None
    now: datetime.datetime | None = None
    # Only this Staff member's Bookings (`bookings.user_id`), on top of `user_ids`: the route
    # sets it from `sort_out_staff_limit` for a Manager sorting out.
    staff_user_id: uuid.UUID | None = None


class BookingServiceError(Exception): ...


class ClientNotFound(BookingServiceError): ...


class BookingNotFound(BookingServiceError): ...


def list_bookings(
    db: Session,
    *,
    tutor_id: uuid.UUID | None,
    filters: BookingFilters,
    limit: int,
    offset: int,
) -> tuple[list[Booking], int]:
    statement = _matching_scope(tutor_id, filters)

    total = _count_matching(db, tutor_id=tutor_id, filters=filters)
    bookings = list(
        db.scalars(
            statement.options(
                joinedload(Booking.child),
                joinedload(Booking.staff),
                joinedload(Booking.subject),
                joinedload(Booking.home),
                joinedload(Booking.clash_acknowledged_by_user),
            )
            .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return bookings, total


def count_bookings_by_kind(
    db: Session, *, tutor_id: uuid.UUID | None, filters: BookingFilters
) -> dict[BookingKind, int]:
    """What `list_bookings` would total with `kind` forced to each value, `filters.kinds` ignored."""
    return {
        kind: _count_matching(db, tutor_id=tutor_id, filters=replace(filters, kinds=(kind,)))
        for kind in BookingKind
    }


def _matching_scope(tutor_id: uuid.UUID | None, filters: BookingFilters) -> Select[tuple[Booking]]:
    statement = select(Booking)
    if tutor_id is not None:
        statement = statement.where(booked_with_profile(tutor_id))

    return apply_booking_filters(statement, filters)


def _count_matching(db: Session, *, tutor_id: uuid.UUID | None, filters: BookingFilters) -> int:
    statement = _matching_scope(tutor_id, filters)

    return db.scalar(select(func.count()).select_from(statement.subquery())) or 0


def booked_with_profile(tutor_id: uuid.UUID) -> ColumnElement[bool]:
    """Bookings whose Staff member is the person behind the teaching profile `tutor_id`."""
    return Booking.user_id.in_(select(Tutor.user_id).where(Tutor.id == tutor_id))


def get_booking(db: Session, *, booking_id: uuid.UUID) -> Booking:
    """The row with every relationship a detail read needs, refreshed even when the session
    already holds it: a write made through a Core `UPDATE` leaves the loaded object stale."""
    booking = db.scalar(
        select(Booking)
        .where(Booking.id == booking_id)
        .execution_options(populate_existing=True)
        .options(
            joinedload(Booking.child),
            joinedload(Booking.staff),
            joinedload(Booking.subject),
            joinedload(Booking.home),
            joinedload(Booking.clash_acknowledged_by_user),
            joinedload(Booking.booked_by_guardian),
        )
    )
    if booking is None:
        raise BookingNotFound

    return booking


def list_client_bookings(
    db: Session,
    *,
    client_id: uuid.UUID,
    filters: BookingFilters,
    limit: int,
    offset: int,
) -> tuple[list[Booking], int]:
    if db.get(Guardian, client_id) is None:
        raise ClientNotFound

    matching = _matching(client_id=client_id, filters=filters)
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0
    bookings = list(
        db.scalars(
            matching.options(
                joinedload(Booking.child),
                joinedload(Booking.staff),
                joinedload(Booking.subject),
                joinedload(Booking.home),
                joinedload(Booking.clash_acknowledged_by_user),
            )
            .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return bookings, total


def _matching(*, client_id: uuid.UUID, filters: BookingFilters) -> Select[tuple[Booking]]:
    """Every booking of every child this guardian is linked to, whoever made it.

    Scoped through `child_guardians` and never through `bookings.booked_by_guardian_id`: that
    column is NULL for an admin-created booking (`models/booking.py:93-95`) and carries the
    co-guardian's id when they were the one who booked, so filtering on it drops exactly the
    rows the dashboard creates and half of the rows a two-guardian family creates.

    Correlated `EXISTS` and not a `JOIN` because `total` counts the subquery: a client with
    several children, or a child with two guardians, is where a join inflates that count.
    """
    guardian_link = (
        select(1)
        .select_from(ChildGuardian)
        .where(ChildGuardian.child_id == Booking.child_id, ChildGuardian.guardian_id == client_id)
    )
    statement = select(Booking).where(guardian_link.exists())

    return apply_booking_filters(statement, filters)


def apply_booking_filters(
    statement: Select[tuple[Booking]], filters: BookingFilters
) -> Select[tuple[Booking]]:
    if filters.statuses:
        statement = statement.where(Booking.status.in_(filters.statuses))

    if filters.tutor_id is not None:
        statement = statement.where(booked_with_profile(filters.tutor_id))

    if filters.subject_id is not None:
        statement = statement.where(Booking.subject_id == filters.subject_id)

    if filters.child_id is not None:
        statement = statement.where(Booking.child_id == filters.child_id)

    if filters.kinds:
        statement = statement.where(Booking.kind.in_(filters.kinds))

    if filters.location is not None:
        statement = statement.where(Booking.location == filters.location)

    if filters.user_ids:
        statement = statement.where(Booking.user_id.in_(filters.user_ids))

    if filters.staff_user_id is not None:
        statement = statement.where(Booking.user_id == filters.staff_user_id)

    sorting_out = _sort_out_condition(filters)
    if sorting_out is not None:
        statement = statement.where(sorting_out)

    pattern = _substring_pattern(filters.q)
    if pattern is not None:
        # Correlated EXISTS, never a join: `total` counts this statement.
        child_named = select(1).where(
            Child.id == Booking.child_id, Child.name.ilike(pattern, escape=_LIKE_ESCAPE)
        )
        staff_named = select(1).where(
            User.id == Booking.user_id, User.name.ilike(pattern, escape=_LIKE_ESCAPE)
        )
        statement = statement.where(or_(child_named.exists(), staff_named.exists()))

    if filters.date_from is not None:
        statement = statement.where(Booking.scheduled_date >= filters.date_from)

    if filters.date_to is not None:
        statement = statement.where(Booking.scheduled_date <= filters.date_to)

    return statement


def _sort_out_condition(filters: BookingFilters) -> ColumnElement[bool] | None:
    wants_reason = filters.reason is not None or filters.to_sort_out is True
    if not wants_reason and filters.to_sort_out is None:
        return None
    if filters.now is None:
        raise ValueError("BookingFilters.now is required to filter Bookings to sort out")

    if wants_reason:
        condition = sort_out_predicate(filters.now, filters.reason)
    else:
        condition = not_(sort_out_predicate(filters.now))

    return condition


def _substring_pattern(raw: str | None) -> str | None:
    trimmed = "" if raw is None else raw.strip()

    if not trimmed:
        pattern = None
    else:
        pattern = f"%{trimmed.translate(_LIKE_WILDCARDS)}%"

    return pattern
