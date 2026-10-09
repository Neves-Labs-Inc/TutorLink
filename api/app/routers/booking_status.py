"""Booking status transitions (REQ-044.25, REQ-044.26).

Shares the `/api/bookings` prefix with `routers/bookings.py` and `routers/booking_writes.py`
by design, so the three can be built concurrently.

`PATCH /api/bookings/{id}` is admin-only (`docs/api-design.md:278`) and loads one row by id, so
it takes `OfficePrincipal` rather than `TutorScope` — the unapplied-scope guard is not armed
here, and does not need to be, because there is no tutor-visible query to narrow.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.booking import Booking
from app.schemas.booking_status import BookingStatusChanged, BookingStatusUpdate
from app.services.booking_status_service import (
    BookingNotFound,
    IllegalTransition,
    change_status,
)

BOOKING_NOT_FOUND_ERROR = "Booking not found"
ILLEGAL_TRANSITION_ERROR = "Cannot move booking from {current} to {target}"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.patch("/{booking_id}", response_model=BookingStatusChanged)
def update_booking_status(
    booking_id: uuid.UUID,
    payload: BookingStatusUpdate,
    user: OfficePrincipal,
    db: DbSession,
) -> BookingStatusChanged:
    try:
        row = change_status(db, booking_id=booking_id, target=payload.status)
    except BookingNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=BOOKING_NOT_FOUND_ERROR
        ) from exc
    except IllegalTransition as exc:
        detail = ILLEGAL_TRANSITION_ERROR.format(current=exc.current.value, target=exc.target.value)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc

    db.commit()

    return _read(row)


def _read(row: Booking) -> BookingStatusChanged:
    return BookingStatusChanged(
        id=row.id,
        status=row.status,
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
    )
