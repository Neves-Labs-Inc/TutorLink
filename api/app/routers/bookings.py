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
from app.dependencies import Principal, TutorScope, assert_can_access_booking
from app.models.enums import BookingKind, BookingLocation, BookingStatus
from app.schemas.booking import (
    BookingDetail,
    BookingKindCounts,
    BookingPage,
    booking_detail,
    booking_summary,
)
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.services.booking_service import (
    BookingFilters,
    BookingNotFound,
    count_bookings_by_kind,
    get_booking,
    list_bookings,
)

BOOKING_NOT_FOUND_ERROR = "Booking not found"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.get("", response_model=BookingPage)
def list_bookings_route(
    scope: TutorScope,
    db: DbSession,
    statuses: Annotated[list[BookingStatus] | None, Query(alias="status")] = None,
    subject_id: uuid.UUID | None = None,
    child_id: uuid.UUID | None = None,
    kind: BookingKind | None = None,
    location: BookingLocation | None = None,
    user_id: uuid.UUID | None = None,
    date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
    date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> BookingPage:
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
        kind=kind,
        location=location,
        user_id=user_id,
    )

    bookings, total = list_bookings(
        db,
        tutor_id=scope.tutor_id,
        filters=filters,
        limit=page_size,
        offset=(page - 1) * page_size,
    )

    counts = count_bookings_by_kind(db, tutor_id=scope.tutor_id, filters=filters)

    return BookingPage(
        items=[booking_summary(row) for row in bookings],
        total=total,
        page=page,
        page_size=page_size,
        counts_by_kind=BookingKindCounts(
            regular=counts[BookingKind.REGULAR], evaluation=counts[BookingKind.EVALUATION]
        ),
    )


@router.get("/{booking_id}", response_model=BookingDetail)
def get_booking_route(booking_id: uuid.UUID, user: Principal, db: DbSession) -> BookingDetail:
    try:
        booking = get_booking(db, booking_id=booking_id)
    except BookingNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, BOOKING_NOT_FOUND_ERROR) from exc

    assert_can_access_booking(user, booking.user_id)

    return booking_detail(booking)
