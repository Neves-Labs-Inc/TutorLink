"""Booking status transitions (REQ-044.25, REQ-044.26, #151, #152).

Shares the `/api/bookings` prefix with `routers/bookings.py` and `routers/booking_writes.py`
by design, so the three can be built concurrently.

`PATCH /api/bookings/{id}` loads one row by id, so it takes `Principal` rather than
`TutorScope` — the unapplied-scope guard is not armed here, and does not need to be, because
there is no tutor-visible query to narrow. Who may make which move is the service's rule
(`Actor`): the Office gets the whole table, a Tutor only Mark completed on their own booking.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OFFICE_ROLES, Principal
from app.models.booking import Booking
from app.schemas.booking_status import BookingStatusChanged, BookingStatusUpdate
from app.services.booking_status_service import (
    Actor,
    BookingChanged,
    BookingNotFound,
    ChildAlreadyEvaluated,
    IllegalTransition,
    LiveEvaluationExists,
    NotBookingOwner,
    OfficeOnlyTransition,
    RevertOverlaps,
    TooEarlyToComplete,
    change_status,
)

BOOKING_NOT_FOUND_ERROR = "Booking not found"
ILLEGAL_TRANSITION_ERROR = "Cannot move booking from {current} to {target}"
BOOKING_NOT_YOURS_ERROR = "Not permitted to change another Staff member's booking"
OFFICE_ONLY_TRANSITION_ERROR = "Only the Office can make this change"
TOO_EARLY_TO_COMPLETE_ERROR = "A booking can be marked completed only after it has started"
BOOKING_CHANGED_ERROR = "That booking changed since it was picked"
REVERT_OVERLAPS_ERROR = "Reverting would overlap another live booking of this Staff member"
CHILD_ALREADY_EVALUATED_ERROR = "Child is already Evaluated"
LIVE_EVALUATION_EXISTS_ERROR = "Child already has a live Evaluation"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.patch("/{booking_id}", response_model=BookingStatusChanged)
def update_booking_status(
    booking_id: uuid.UUID,
    payload: BookingStatusUpdate,
    user: Principal,
    db: DbSession,
) -> BookingStatusChanged:
    actor = Actor(user_id=user.id, is_office=user.role in OFFICE_ROLES)

    try:
        row = change_status(
            db,
            booking_id=booking_id,
            target=payload.status,
            actor=actor,
            expected_updated_at=payload.expected_updated_at,
        )
    except BookingNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=BOOKING_NOT_FOUND_ERROR
        ) from exc
    except NotBookingOwner as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=BOOKING_NOT_YOURS_ERROR
        ) from exc
    except OfficeOnlyTransition as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=OFFICE_ONLY_TRANSITION_ERROR
        ) from exc
    except IllegalTransition as exc:
        detail = ILLEGAL_TRANSITION_ERROR.format(current=exc.current.value, target=exc.target.value)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc
    except TooEarlyToComplete as exc:
        raise _conflict(TOO_EARLY_TO_COMPLETE_ERROR) from exc
    except BookingChanged as exc:
        raise _conflict(BOOKING_CHANGED_ERROR) from exc
    except RevertOverlaps as exc:
        raise _conflict(REVERT_OVERLAPS_ERROR) from exc
    except ChildAlreadyEvaluated as exc:
        raise _conflict(CHILD_ALREADY_EVALUATED_ERROR) from exc
    except LiveEvaluationExists as exc:
        raise _conflict(LIVE_EVALUATION_EXISTS_ERROR) from exc

    db.commit()

    return _read(row)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _read(row: Booking) -> BookingStatusChanged:
    return BookingStatusChanged(
        id=row.id,
        status=row.status,
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
        updated_at=row.updated_at,
    )
