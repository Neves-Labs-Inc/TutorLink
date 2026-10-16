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
from app.dependencies import OFFICE_ROLES, Principal, TutorScope, assert_can_access_booking
from app.models.enums import BookingKind, BookingLocation, BookingStatus
from app.schemas.booking import BookingDetail, BookingKindCounts, BookingPage
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.services import clock
from app.services.booking_read_service import booking_detail, booking_summaries
from app.services.booking_service import (
    BookingFilters,
    BookingNotFound,
    count_bookings_by_kind,
    get_booking,
    list_bookings,
)
from app.services.sort_out_service import SortOutReason, sort_out_staff_limit

BOOKING_NOT_FOUND_ERROR = "Booking not found"
REASON_NEEDS_SORT_OUT_ERROR = "reason can only be used with to_sort_out=true"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.get("", response_model=BookingPage)
def list_bookings_route(
    scope: TutorScope,
    user: Principal,
    db: DbSession,
    statuses: Annotated[list[BookingStatus] | None, Query(alias="status")] = None,
    subject_id: uuid.UUID | None = None,
    child_ids: Annotated[list[uuid.UUID] | None, Query(alias="child_id")] = None,
    kinds: Annotated[list[BookingKind] | None, Query(alias="kind")] = None,
    location: BookingLocation | None = None,
    user_ids: Annotated[list[uuid.UUID] | None, Query(alias="user_id")] = None,
    q: str | None = None,
    to_sort_out: bool | None = None,
    reason: SortOutReason | None = None,
    date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
    date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> BookingPage:
    if to_sort_out is False and reason is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, REASON_NEEDS_SORT_OUT_ERROR)

    now = clock.business_now()
    is_sorting_out = to_sort_out is True or reason is not None
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
        child_ids=tuple(child_ids or ()),
        kinds=tuple(kinds or ()),
        location=location,
        user_ids=tuple(user_ids or ()),
        q=q,
        to_sort_out=to_sort_out,
        reason=reason,
        now=now,
        staff_user_id=sort_out_staff_limit(user.role, user.id) if is_sorting_out else None,
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
        items=booking_summaries(db, bookings, now=now),
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

    return booking_detail(
        db, booking, now=clock.business_now(), shows_conversations=user.role in OFFICE_ROLES
    )
