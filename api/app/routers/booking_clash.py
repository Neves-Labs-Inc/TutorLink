"""Acknowledging a Booking's Time off clash (#209), and withdrawing it.

Shares the `/api/bookings` prefix with the other Booking routers by design. Both routes take
`AdminPrincipal`: only an Admin (or a Developer) keeps a Booking over Time off. Both answer with
`BookingDetail`, so the dashboard reads back the row it already knows how to show.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.routers.bookings import BOOKING_NOT_FOUND_ERROR
from app.schemas.booking import BookingDetail
from app.services import clock
from app.services.booking_read_service import booking_detail
from app.services.booking_service import get_booking
from app.services.clash_acknowledgement_service import (
    BookingNotFound,
    NoClashToAcknowledge,
    acknowledge_clash,
    withdraw_clash_acknowledgement,
)

NO_CLASH_TO_ACKNOWLEDGE_ERROR = "This booking has no time off clash to acknowledge"
ACKNOWLEDGEMENT_PATH = "/{booking_id}/clash-acknowledgement"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.post(ACKNOWLEDGEMENT_PATH, response_model=BookingDetail)
def acknowledge(booking_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> BookingDetail:
    try:
        acknowledge_clash(db, booking_id=booking_id, user_id=user.id)
    except BookingNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, BOOKING_NOT_FOUND_ERROR) from exc
    except NoClashToAcknowledge as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NO_CLASH_TO_ACKNOWLEDGE_ERROR) from exc

    db.commit()

    return _detail(db, booking_id)


@router.delete(ACKNOWLEDGEMENT_PATH, response_model=BookingDetail)
def withdraw(booking_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> BookingDetail:
    try:
        withdraw_clash_acknowledgement(db, booking_id=booking_id)
    except BookingNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, BOOKING_NOT_FOUND_ERROR) from exc

    db.commit()

    return _detail(db, booking_id)


def _detail(db: Session, booking_id: uuid.UUID) -> BookingDetail:
    # `AdminPrincipal` only, so the caller is always Office.
    return booking_detail(
        db,
        get_booking(db, booking_id=booking_id),
        now=clock.business_now(),
        shows_conversations=True,
    )
