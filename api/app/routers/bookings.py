"""Booking reads: list and load-by-id.

Stub mounted by T0 (REQ-P4.1). Shares the `/api/bookings` prefix with `routers/booking_writes.py`
and `routers/booking_status.py` by design, so the three can be built concurrently.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import Principal, TutorScope, assert_can_access_tutor
from app.models.booking import Booking
from app.models.enums import BookingStatus
from app.schemas.booking import BookingChild, BookingDetail, BookingSummary, HomeRef, NamedRef
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.services.booking_service import (
    BookingFilters,
    BookingNotFound,
    get_booking,
    list_bookings,
)

BOOKING_NOT_FOUND_ERROR = "Booking not found"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.get("", response_model=Page[BookingSummary])
def list_bookings_route(
    scope: TutorScope,
    db: DbSession,
    statuses: Annotated[list[BookingStatus] | None, Query(alias="status")] = None,
    subject_id: uuid.UUID | None = None,
    child_id: uuid.UUID | None = None,
    date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
    date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[BookingSummary]:
    # `?tutor_id=` here is the `TutorScope` dependency's own query parameter
    # (`get_tutor_scope`, `dependencies.py:258-261`), not redeclared here: a tutor sees only
    # their own bookings, and redeclaring it would shadow the dependency's parameter and break
    # the cross-tutor 403.
    filters = BookingFilters(
        statuses=tuple(statuses or ()),
        tutor_id=None,
        date_from=date_from,
        date_to=date_to,
        subject_id=subject_id,
        child_id=child_id,
    )

    bookings, total = list_bookings(
        db,
        tutor_id=scope.tutor_id,
        filters=filters,
        limit=page_size,
        offset=(page - 1) * page_size,
    )

    return Page[BookingSummary](
        items=[_summary(row) for row in bookings],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{booking_id}", response_model=BookingDetail)
def get_booking_route(booking_id: uuid.UUID, user: Principal, db: DbSession) -> BookingDetail:
    try:
        booking = get_booking(db, booking_id=booking_id)
    except BookingNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, BOOKING_NOT_FOUND_ERROR) from exc

    assert_can_access_tutor(user, booking.tutor_id)

    return _detail(booking)


def _summary(row: Booking) -> BookingSummary:
    return BookingSummary(
        id=row.id,
        child=NamedRef(id=row.child.id, name=row.child.name),
        tutor=NamedRef(id=row.tutor.id, name=row.tutor.user.name),
        subject=NamedRef(id=row.subject.id, name=row.subject.name),
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
        status=row.status,
        notes=row.notes,
    )


def _detail(row: Booking) -> BookingDetail:
    return BookingDetail(
        id=row.id,
        child=BookingChild(id=row.child.id, name=row.child.name, notes=row.child.notes),
        tutor=NamedRef(id=row.tutor.id, name=row.tutor.user.name),
        subject=NamedRef(id=row.subject.id, name=row.subject.name),
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
        status=row.status,
        notes=row.notes,
        home=HomeRef(
            id=row.home.id,
            label=row.home.label,
            address=row.home.address,
            access_code=row.home.access_code,
        ),
        booked_by_guardian=(
            None
            if row.booked_by_guardian is None
            else NamedRef(id=row.booked_by_guardian.id, name=row.booked_by_guardian.name)
        ),
    )
