"""Booking creation and the dashboard Reschedule, `PUT /api/bookings/{id}`.

Shares the `/api/bookings` prefix with `routers/bookings.py` and `routers/booking_status.py`
by design, so the three can be built and reviewed separately; the paths do not shadow one
another.

Both routes are **Office only** (`docs/api-design.md`) and so take `OfficePrincipal`. They
deliberately do **not** take `TutorScope` (`CONSTITUTION.md` §15): the validation touches five
tutor-owned mappers with no tutor filter to apply, and an unread scope would arm
`_guard_unapplied_scope` and turn every one of those queries into a 500.

`PUT` answers with `BookingDetail`, the shape `GET /api/bookings/{id}` returns, so the
dashboard's edit form reads back the row it already knows how to show, `updated_at` included.
Neither route sends a WhatsApp message: a dashboard write is the Office's to announce.

The clock is read here rather than in the service, through `clock.business_now`, which hands
the service a **naive** datetime in the business wall-clock (`BUSINESS_TIMEZONE`):
`scheduled_date`, `start_time` and `end_time` are naive columns holding the times staff typed
in that zone, and comparing an aware `now` with a naive `combine(date, start_time)` raises
`TypeError` — a 500 on an ordinary request. Passing it in is what lets the window gates be
tested without freezing time.

The status classes are the service's, not this module's invention: a reference failure, rule
1's hard half and the window gates are 400; overlap, a live Evaluation and unconfirmed warnings
are 409; a role, Subject, slot or home against the kind or Location, the grade ceiling, an
unlinked home or guardian and an Evaluated Child are **422** — a deliberate semantic refusal of
a well-formed request, which is `CONSTITUTION.md` §10's own parenthetical. Do not fold them
into 400.

**Unconfirmed warnings are the one refusal with a body beyond `detail`** (#151):
`{"detail": ..., "warnings": [{"code", "message"}, ...]}`, returned as a `JSONResponse` because
`HTTPException` can carry nothing beside `detail`. The messages are the same constants the
hard refusals use, so a rule reads the same whether it blocked or warned.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.booking import Booking
from app.routers.booking_status import BOOKING_NOT_FOUND_ERROR
from app.schemas.booking import BookingDetail, booking_detail
from app.schemas.booking_write import (
    BookingCreate,
    BookingCreated,
    BookingReplace,
    BookingWarning,
)
from app.services import clock
from app.services.booking_write_service import (
    BlockedByException,
    BookingKindImmutable,
    BookingNotFound,
    BookingNotLive,
    BookingOverlaps,
    BookingReferenceNotFound,
    BookingReplacement,
    BookingRequest,
    BookingShapeInvalid,
    BookingWriteError,
    ChildAlreadyEvaluated,
    DateOutOfWindow,
    GapNotRespected,
    GuardianNotLinkedToChild,
    HomeNotLinkedToChild,
    LeadTimeNotMet,
    LiveEvaluationExists,
    OutsideAvailability,
    StaffRoleNotAllowed,
    TutorGradeCeilingExceeded,
    UnconfirmedWarnings,
    WarningCode,
    create_booking,
    replace_booking,
)

BOOKING_NOT_LIVE_ERROR = "Only a pending or confirmed booking can be edited"
BOOKING_KIND_IMMUTABLE_ERROR = "A booking's kind cannot be changed"
REFERENCE_NOT_FOUND_ERROR = "One of the ids in the request does not exist"
OUTSIDE_AVAILABILITY_ERROR = "That time is not inside the availability range that was named"
BOOKING_OVERLAPS_ERROR = "That Staff member already has a booking overlapping this time"
GAP_NOT_RESPECTED_ERROR = "That time is too close to another booking for the same Staff member"
BLOCKED_BY_EXCEPTION_ERROR = "That Staff member has approved time off covering this time"
GRADE_CEILING_ERROR = "That Staff member does not teach this subject at the child's level"
HOME_NOT_LINKED_ERROR = "That home is not one of the child's homes"
GUARDIAN_NOT_LINKED_ERROR = "That guardian is not linked to the child"
DATE_OUT_OF_WINDOW_ERROR = "That date is in the past or beyond the booking window"
LEAD_TIME_NOT_MET_ERROR = "That start time is too soon to be booked"
STAFF_ROLE_NOT_ALLOWED_ERROR = "That Staff member's role cannot take this kind of booking"
BOOKING_SHAPE_INVALID_ERROR = (
    "The subject, availability range and home must match the booking's kind and location"
)
CHILD_ALREADY_EVALUATED_ERROR = "That child is already Evaluated"
LIVE_EVALUATION_EXISTS_ERROR = "That child already has an Evaluation booked"
UNCONFIRMED_WARNINGS_ERROR = "This booking needs the listed warnings confirmed"

WARNING_MESSAGES: dict[WarningCode, str] = {
    WarningCode.OUTSIDE_SLOT: OUTSIDE_AVAILABILITY_ERROR,
    WarningCode.GAP: GAP_NOT_RESPECTED_ERROR,
    WarningCode.TIME_OFF: BLOCKED_BY_EXCEPTION_ERROR,
    WarningCode.GRADE_CEILING: GRADE_CEILING_ERROR,
}

_STATUS_BY_ERROR: tuple[tuple[type[BookingWriteError], int, str], ...] = (
    (BookingNotFound, status.HTTP_404_NOT_FOUND, BOOKING_NOT_FOUND_ERROR),
    (BookingNotLive, status.HTTP_409_CONFLICT, BOOKING_NOT_LIVE_ERROR),
    (BookingKindImmutable, status.HTTP_422_UNPROCESSABLE_CONTENT, BOOKING_KIND_IMMUTABLE_ERROR),
    (BookingReferenceNotFound, status.HTTP_400_BAD_REQUEST, REFERENCE_NOT_FOUND_ERROR),
    (OutsideAvailability, status.HTTP_400_BAD_REQUEST, OUTSIDE_AVAILABILITY_ERROR),
    (DateOutOfWindow, status.HTTP_400_BAD_REQUEST, DATE_OUT_OF_WINDOW_ERROR),
    (LeadTimeNotMet, status.HTTP_400_BAD_REQUEST, LEAD_TIME_NOT_MET_ERROR),
    (BookingOverlaps, status.HTTP_409_CONFLICT, BOOKING_OVERLAPS_ERROR),
    (GapNotRespected, status.HTTP_409_CONFLICT, GAP_NOT_RESPECTED_ERROR),
    (BlockedByException, status.HTTP_409_CONFLICT, BLOCKED_BY_EXCEPTION_ERROR),
    (LiveEvaluationExists, status.HTTP_409_CONFLICT, LIVE_EVALUATION_EXISTS_ERROR),
    (TutorGradeCeilingExceeded, status.HTTP_422_UNPROCESSABLE_CONTENT, GRADE_CEILING_ERROR),
    (HomeNotLinkedToChild, status.HTTP_422_UNPROCESSABLE_CONTENT, HOME_NOT_LINKED_ERROR),
    (GuardianNotLinkedToChild, status.HTTP_422_UNPROCESSABLE_CONTENT, GUARDIAN_NOT_LINKED_ERROR),
    (StaffRoleNotAllowed, status.HTTP_422_UNPROCESSABLE_CONTENT, STAFF_ROLE_NOT_ALLOWED_ERROR),
    (BookingShapeInvalid, status.HTTP_422_UNPROCESSABLE_CONTENT, BOOKING_SHAPE_INVALID_ERROR),
    (
        ChildAlreadyEvaluated,
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        CHILD_ALREADY_EVALUATED_ERROR,
    ),
)

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.post("", response_model=BookingCreated, status_code=status.HTTP_201_CREATED)
def create(
    payload: BookingCreate, user: OfficePrincipal, db: DbSession
) -> BookingCreated | JSONResponse:
    try:
        booking = create_booking(
            db,
            request=_request(payload),
            now=clock.business_now(),
            confirm_warnings=frozenset(payload.confirm_warnings),
        )
    except UnconfirmedWarnings as exc:
        return _warnings_response(exc)
    except BookingWriteError as exc:
        raise _http_error(exc) from exc

    db.commit()

    return _created(booking)


@router.put("/{booking_id}", response_model=BookingDetail)
def replace(
    booking_id: uuid.UUID, payload: BookingReplace, user: OfficePrincipal, db: DbSession
) -> BookingDetail | JSONResponse:
    try:
        booking = replace_booking(
            db,
            booking_id=booking_id,
            replacement=_replacement(payload),
            now=clock.business_now(),
            confirm_warnings=frozenset(payload.confirm_warnings),
        )
    except UnconfirmedWarnings as exc:
        return _warnings_response(exc)
    except BookingWriteError as exc:
        raise _http_error(exc) from exc

    db.commit()

    return booking_detail(booking)


def _http_error(exc: BookingWriteError) -> HTTPException:
    for error, status_code, detail in _STATUS_BY_ERROR:
        if isinstance(exc, error):
            return HTTPException(status_code=status_code, detail=detail)

    # Every refusal the service raises is in the table; one that is not is a programmer error.
    raise exc


def _warnings_response(exc: UnconfirmedWarnings) -> JSONResponse:
    warnings = [
        BookingWarning(code=code, message=WARNING_MESSAGES[code]).model_dump(mode="json")
        for code in exc.codes
    ]

    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": UNCONFIRMED_WARNINGS_ERROR, "warnings": warnings},
    )


def _request(payload: BookingCreate) -> BookingRequest:
    return BookingRequest(
        child_id=payload.child_id,
        user_id=payload.user_id,
        kind=payload.kind,
        location=payload.location,
        subject_id=payload.subject_id,
        availability_id=payload.availability_id,
        home_id=payload.home_id,
        scheduled_date=payload.scheduled_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        booked_by_guardian_id=payload.booked_by_guardian_id,
        notes=payload.notes,
    )


def _replacement(payload: BookingReplace) -> BookingReplacement:
    return BookingReplacement(
        user_id=payload.user_id,
        location=payload.location,
        subject_id=payload.subject_id,
        availability_id=payload.availability_id,
        home_id=payload.home_id,
        scheduled_date=payload.scheduled_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        kind=payload.kind,
    )


def _created(booking: Booking) -> BookingCreated:
    return BookingCreated(
        id=booking.id,
        status=booking.status,
        scheduled_date=booking.scheduled_date,
        start_time=booking.start_time,
        end_time=booking.end_time,
    )
