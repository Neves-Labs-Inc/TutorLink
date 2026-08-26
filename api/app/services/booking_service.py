"""The read path over `bookings`, scoped to one client.

Same transaction contract as every other service here: nothing commits, the caller owns the
boundary.
"""

import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, joinedload

from app.models.booking import Booking
from app.models.enums import BookingStatus
from app.models.guardian import ChildGuardian, Guardian


@dataclass(frozen=True, slots=True)
class BookingFilters:
    statuses: tuple[BookingStatus, ...] = ()
    tutor_id: uuid.UUID | None = None
    date_from: datetime.date | None = None
    date_to: datetime.date | None = None


class BookingServiceError(Exception): ...


class ClientNotFound(BookingServiceError): ...


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
                joinedload(Booking.tutor),
                joinedload(Booking.subject),
            )
            .order_by(Booking.scheduled_date, Booking.start_time)
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

    if filters.statuses:
        statement = statement.where(Booking.status.in_(filters.statuses))

    if filters.tutor_id is not None:
        statement = statement.where(Booking.tutor_id == filters.tutor_id)

    if filters.date_from is not None:
        statement = statement.where(Booking.scheduled_date >= filters.date_from)

    if filters.date_to is not None:
        statement = statement.where(Booking.scheduled_date <= filters.date_to)

    return statement
