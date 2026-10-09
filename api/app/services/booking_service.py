"""The read path over `bookings`, scoped to one client.

Same transaction contract as every other service here: nothing commits, the caller owns the
boundary.
"""

import datetime
import uuid
from dataclasses import dataclass, replace

from sqlalchemy import ColumnElement, Select, func, select
from sqlalchemy.orm import Session, joinedload

from app.models.booking import Booking
from app.models.enums import BookingKind, BookingLocation, BookingStatus
from app.models.guardian import ChildGuardian, Guardian
from app.models.tutor import Tutor


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
    kind: BookingKind | None = None
    location: BookingLocation | None = None
    # The Staff member's user id (`bookings.user_id`); `tutor_id` above is the profile-keyed twin.
    user_id: uuid.UUID | None = None


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
    """What `list_bookings` would total with `kind` forced to each value, `filters.kind` ignored."""
    return {
        kind: _count_matching(db, tutor_id=tutor_id, filters=replace(filters, kind=kind))
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
    booking = db.scalar(
        select(Booking)
        .where(Booking.id == booking_id)
        .options(
            joinedload(Booking.child),
            joinedload(Booking.staff),
            joinedload(Booking.subject),
            joinedload(Booking.home),
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

    if filters.kind is not None:
        statement = statement.where(Booking.kind == filters.kind)

    if filters.location is not None:
        statement = statement.where(Booking.location == filters.location)

    if filters.user_id is not None:
        statement = statement.where(Booking.user_id == filters.user_id)

    if filters.date_from is not None:
        statement = statement.where(Booking.scheduled_date >= filters.date_from)

    if filters.date_to is not None:
        statement = statement.where(Booking.scheduled_date <= filters.date_to)

    return statement
