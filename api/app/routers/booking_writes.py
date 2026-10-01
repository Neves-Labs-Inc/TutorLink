"""Booking creation.

Shares the `/api/bookings` prefix with `routers/bookings.py` and `routers/booking_status.py`
by design, so the three can be built and reviewed separately; the four paths do not shadow one
another.

`POST /api/bookings` is **admin-or-above** (`docs/api-design.md:278`) and so takes
`AdminPrincipal`. It deliberately does **not** take `TutorScope` (`CONSTITUTION.md` §15): the
validation touches five tutor-owned mappers with no tutor filter to apply, and an unread scope
would arm `_guard_unapplied_scope` and turn every one of those queries into a 500.

The clock is read here rather than in the service, through `clock.business_now`, which hands
the service a **naive** datetime in the business wall-clock (`BUSINESS_TIMEZONE`):
`scheduled_date`, `start_time` and `end_time` are naive columns holding the times staff typed
in that zone, and comparing an aware `now` with a naive `combine(date, start_time)` raises
`TypeError` — a 500 on an ordinary request. Passing it in is what lets the window gates be
tested without freezing time.

The three status classes are the service's, not this module's invention: rule 1 and the window
gates are 400, rules 2, 3 and 4 are 409, and rules 5, 6 and 7 are **422** — a deliberate
semantic refusal of a well-formed request, which is `CONSTITUTION.md` §10's own parenthetical
and what `docs/api-design.md:1141-1144` assigns them. Do not fold them into 400.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.models.booking import Booking
from app.schemas.booking_write import BookingCreate, BookingCreated
from app.services import clock
from app.services.booking_write_service import (
    BlockedByException,
    BookingOverlaps,
    BookingReferenceNotFound,
    BookingRequest,
    DateOutOfWindow,
    GapNotRespected,
    GuardianNotLinkedToChild,
    HomeNotLinkedToChild,
    LeadTimeNotMet,
    OutsideAvailability,
    TutorGradeCeilingExceeded,
    create_booking,
)

REFERENCE_NOT_FOUND_ERROR = "One of the ids in the request does not exist"
OUTSIDE_AVAILABILITY_ERROR = "That time is not inside the availability range that was named"
BOOKING_OVERLAPS_ERROR = "That tutor already has a booking overlapping this time"
GAP_NOT_RESPECTED_ERROR = "That time is too close to another booking for the same tutor"
BLOCKED_BY_EXCEPTION_ERROR = "That tutor has approved time off covering this time"
GRADE_CEILING_ERROR = "That tutor does not teach this subject at the child's grade level"
HOME_NOT_LINKED_ERROR = "That home is not one of the child's homes"
GUARDIAN_NOT_LINKED_ERROR = "That guardian is not linked to the child"
DATE_OUT_OF_WINDOW_ERROR = "That date is in the past or beyond the booking window"
LEAD_TIME_NOT_MET_ERROR = "That start time is too soon to be booked"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.post("", response_model=BookingCreated, status_code=status.HTTP_201_CREATED)
def create(payload: BookingCreate, user: AdminPrincipal, db: DbSession) -> BookingCreated:
    try:
        booking = create_booking(db, request=_request(payload), now=clock.business_now())
    except BookingReferenceNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=REFERENCE_NOT_FOUND_ERROR
        ) from exc
    except OutsideAvailability as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=OUTSIDE_AVAILABILITY_ERROR
        ) from exc
    except DateOutOfWindow as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=DATE_OUT_OF_WINDOW_ERROR
        ) from exc
    except LeadTimeNotMet as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=LEAD_TIME_NOT_MET_ERROR
        ) from exc
    except BookingOverlaps as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=BOOKING_OVERLAPS_ERROR
        ) from exc
    except GapNotRespected as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=GAP_NOT_RESPECTED_ERROR
        ) from exc
    except BlockedByException as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=BLOCKED_BY_EXCEPTION_ERROR
        ) from exc
    except TutorGradeCeilingExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=GRADE_CEILING_ERROR
        ) from exc
    except HomeNotLinkedToChild as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=HOME_NOT_LINKED_ERROR
        ) from exc
    except GuardianNotLinkedToChild as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=GUARDIAN_NOT_LINKED_ERROR
        ) from exc

    db.commit()

    return _created(booking)


def _request(payload: BookingCreate) -> BookingRequest:
    return BookingRequest(
        child_id=payload.child_id,
        tutor_id=payload.tutor_id,
        subject_id=payload.subject_id,
        availability_id=payload.availability_id,
        home_id=payload.home_id,
        scheduled_date=payload.scheduled_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        booked_by_guardian_id=payload.booked_by_guardian_id,
        notes=payload.notes,
    )


def _created(booking: Booking) -> BookingCreated:
    return BookingCreated(
        id=booking.id,
        status=booking.status,
        scheduled_date=booking.scheduled_date,
        start_time=booking.start_time,
        end_time=booking.end_time,
    )
