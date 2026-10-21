"""Staff Time off (availability exceptions): someone asks for time off, an Admin decides it.

Time off is keyed on the Staff member's user, so any Staff member — an Admin with no teaching
profile included — can hold it. The table has no `tutor_id`, so `TutorScope` has nothing to
filter on. Who may reach whose Time off is decided in `exception_service` (it needs the
target's role for the Developer boundary); this module maps its refusals to status codes:

- `GET /api/users/{user_id}/exceptions`: the person themselves, or an Office role (a Manager
  reads anyone's, as an Admin does).
- `POST /api/users/{user_id}/exceptions`: the person themselves, or an Admin role. A Manager
  enters only their own. A requester's entry lands `pending`, an Admin role's `approved`; the
  status is never read from the body. The caller is recorded as `entered_by`.
- `GET /api/exceptions` takes `OfficePrincipal`: every Staff member's Time off, filtered.
  `status` may repeat; a row at any of them matches.
- `GET /api/exceptions/{exception_id}` takes `Principal`: one row, read by the same people as
  the per-user list (the owner, or an Office role; a Developer's only a Developer), checked
  on the loaded row so an unknown id is 404.
- `PATCH /api/exceptions/{exception_id}` takes `AdminPrincipal`, which is what stops anyone
  approving their own request — the one authorisation rule this feature exists to enforce.
- `POST /api/exceptions/{exception_id}/cancel` takes `Principal`: the owner or an Admin role,
  checked on the loaded row before its status. It replaced `DELETE`; the row is kept.

Every response carries the wire status, which adds `expired` for a pending row that has ended,
and the row's clashing Bookings. An Admin write that would land a row approved over clashes is
the #151 409 `{"detail", "warnings": [booking_clash]}` until the caller confirms it; the
warning lists those Bookings as the row's read would.
"""

import datetime
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal, OfficePrincipal, Principal
from app.models.availability import TutorAvailabilityException
from app.models.user import User
from app.schemas.booking import NamedRef, StaffRef
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.exceptions import (
    ClashingBooking,
    ExceptionCreate,
    ExceptionDecision,
    ExceptionRead,
    ExceptionReadStatus,
    TimeOffWarning,
)
from app.services import clock
from app.services.exception_service import (
    BOOKING_CLASH_WARNING,
    Clash,
    DeveloperTimeOff,
    ExceptionAlreadyDecided,
    ExceptionCancelled,
    ExceptionEnded,
    ExceptionNotCancellable,
    ExceptionNotFound,
    ExceptionRequestError,
    NotYourTimeOff,
    UnconfirmedBookingClash,
    UserArchived,
    UserNotFound,
    WindowEnded,
    cancel_exception,
    clashes_by_exception,
    create_exception,
    decide_exception,
    get_exception,
    list_all_exceptions,
    list_exceptions,
    read_status,
)

USER_NOT_FOUND_ERROR = "No such user"
EXCEPTION_NOT_FOUND_ERROR = "No such availability exception"
OTHERS_TIME_OFF_ERROR = "You can only manage your own time off"
DEVELOPER_TIME_OFF_ERROR = "Only a developer may manage a developer's time off"
USER_ARCHIVED_ERROR = "Time off cannot be entered for an archived user"
WINDOW_ENDED_ERROR = "This time off has already ended"
ALREADY_DECIDED_ERROR = "This time off has already been decided"
TIME_OFF_CANCELLED_ERROR = "This time off has been cancelled"
TIME_OFF_ENDED_ERROR = "This time off has ended"
NOT_CANCELLABLE_ERROR = "Only pending or approved time off can be cancelled"
UNCONFIRMED_WARNINGS_ERROR = "This time off needs the listed warnings confirmed"

_ERRORS: dict[type[ExceptionRequestError], tuple[int, str]] = {
    UserNotFound: (status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR),
    ExceptionNotFound: (status.HTTP_404_NOT_FOUND, EXCEPTION_NOT_FOUND_ERROR),
    NotYourTimeOff: (status.HTTP_403_FORBIDDEN, OTHERS_TIME_OFF_ERROR),
    DeveloperTimeOff: (status.HTTP_403_FORBIDDEN, DEVELOPER_TIME_OFF_ERROR),
    UserArchived: (status.HTTP_422_UNPROCESSABLE_CONTENT, USER_ARCHIVED_ERROR),
    WindowEnded: (status.HTTP_422_UNPROCESSABLE_CONTENT, WINDOW_ENDED_ERROR),
    ExceptionAlreadyDecided: (status.HTTP_409_CONFLICT, ALREADY_DECIDED_ERROR),
    ExceptionCancelled: (status.HTTP_409_CONFLICT, TIME_OFF_CANCELLED_ERROR),
    ExceptionEnded: (status.HTTP_409_CONFLICT, TIME_OFF_ENDED_ERROR),
    ExceptionNotCancellable: (status.HTTP_409_CONFLICT, NOT_CANCELLABLE_ERROR),
}

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api", tags=["exceptions"])


@router.get("/users/{user_id}/exceptions", response_model=Page[ExceptionRead])
def list_user_exceptions(
    user_id: uuid.UUID,
    user: Principal,
    db: DbSession,
    date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
    date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
    order: Literal["asc", "desc"] = "asc",
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[ExceptionRead]:
    try:
        rows, total = list_exceptions(
            db,
            actor_id=user.id,
            actor_role=user.role,
            user_id=user_id,
            date_from=date_from,
            date_to=date_to,
            is_newest_first=order == "desc",
            limit=page_size,
            offset=(page - 1) * page_size,
        )
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    return Page[ExceptionRead](
        items=_reads(db, rows, now=clock.business_now()),
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/exceptions", response_model=Page[ExceptionRead])
def list_all_staff_exceptions(
    _user: OfficePrincipal,
    db: DbSession,
    status_filter: Annotated[list[ExceptionReadStatus] | None, Query(alias="status")] = None,
    user_id: uuid.UUID | None = None,
    date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
    date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
    sort: Literal["start", "requested"] = "start",
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[ExceptionRead]:
    # One reading for both the status filter and the rendered statuses, so they agree.
    now = clock.business_now()
    rows, total = list_all_exceptions(
        db,
        statuses=status_filter or (),
        user_id=user_id,
        date_from=date_from,
        date_to=date_to,
        sort=sort,
        limit=page_size,
        offset=(page - 1) * page_size,
        now=now,
    )

    return Page[ExceptionRead](
        items=_reads(db, rows, now=now),
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/exceptions/{exception_id}", response_model=ExceptionRead)
def read_staff_exception(exception_id: uuid.UUID, user: Principal, db: DbSession) -> ExceptionRead:
    try:
        row = get_exception(db, actor_id=user.id, actor_role=user.role, exception_id=exception_id)
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    return _reads(db, [row], now=clock.business_now())[0]


@router.post(
    "/users/{user_id}/exceptions",
    response_model=ExceptionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_user_exception(
    user_id: uuid.UUID,
    payload: ExceptionCreate,
    user: Principal,
    db: DbSession,
) -> ExceptionRead | JSONResponse:
    try:
        row = create_exception(
            db,
            actor_id=user.id,
            actor_role=user.role,
            user_id=user_id,
            start_date=payload.start_date,
            end_date=payload.end_date,
            start_time=payload.start_time,
            end_time=payload.end_time,
            reason=payload.reason,
            confirm_warnings=frozenset(payload.confirm_warnings),
        )
    except UnconfirmedBookingClash as exc:
        return _warnings_response(exc)
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    db.commit()

    return _reads(db, [row], now=clock.business_now())[0]


@router.patch("/exceptions/{exception_id}", response_model=ExceptionRead)
def decide_staff_exception(
    exception_id: uuid.UUID,
    payload: ExceptionDecision,
    user: AdminPrincipal,
    db: DbSession,
) -> ExceptionRead | JSONResponse:
    try:
        row = decide_exception(
            db,
            actor_id=user.id,
            actor_role=user.role,
            exception_id=exception_id,
            decision=payload.status,
            confirm_warnings=frozenset(payload.confirm_warnings),
        )
    except UnconfirmedBookingClash as exc:
        return _warnings_response(exc)
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    db.commit()

    return _reads(db, [row], now=clock.business_now())[0]


@router.post("/exceptions/{exception_id}/cancel", response_model=ExceptionRead)
def cancel_staff_exception(
    exception_id: uuid.UUID, user: Principal, db: DbSession
) -> ExceptionRead:
    try:
        row = cancel_exception(
            db, actor_id=user.id, actor_role=user.role, exception_id=exception_id
        )
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    db.commit()

    return _reads(db, [row], now=clock.business_now())[0]


def _http_error(exc: ExceptionRequestError) -> HTTPException:
    status_code, detail = _ERRORS[type(exc)]
    return HTTPException(status_code=status_code, detail=detail)


def _warnings_response(exc: UnconfirmedBookingClash) -> JSONResponse:
    warning = TimeOffWarning(
        code=BOOKING_CLASH_WARNING,
        message=f"This time off clashes with {len(exc.clashes)} booking(s)",
        clashing_bookings=[_clashing(clash) for clash in exc.clashes],
    )

    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": UNCONFIRMED_WARNINGS_ERROR,
            "warnings": [warning.model_dump(mode="json")],
        },
    )


def _reads(
    db: Session, rows: list[TutorAvailabilityException], *, now: datetime.datetime
) -> list[ExceptionRead]:
    """The rows as read, their clashes fetched for the whole batch at once."""
    clashes = clashes_by_exception(db, rows, now=now)

    return [_read(row, now=now, clashes=clashes.get(row.id, [])) for row in rows]


def _read(
    row: TutorAvailabilityException, *, now: datetime.datetime, clashes: list[Clash]
) -> ExceptionRead:
    # Built field by field rather than with `model_validate(row)`: the constitution forbids an
    # ORM instance crossing the HTTP boundary, and an explicit constructor is what makes adding
    # a column to the table a decision to expose it rather than an accident.
    return ExceptionRead(
        id=row.id,
        staff=StaffRef(id=row.staff.id, name=row.staff.name, role=row.staff.role),
        start_date=row.start_date,
        end_date=row.end_date,
        start_time=row.start_time,
        end_time=row.end_time,
        reason=row.reason,
        status=read_status(row, now=now),
        created_at=row.created_at,
        decided_by=_named(row.decider),
        decided_at=row.decided_at,
        cancelled_by=_named(row.canceller),
        cancelled_at=row.cancelled_at,
        entered_by=_named(row.creator),
        clashing_bookings=[_clashing(clash) for clash in clashes],
        clashing_bookings_count=len(clashes),
    )


def _clashing(clash: Clash) -> ClashingBooking:
    return ClashingBooking(
        booking_id=clash.booking_id,
        date=clash.date,
        start_time=clash.start_time,
        end_time=clash.end_time,
        child_name=clash.child_name,
        status=clash.status,
    )


def _named(person: User | None) -> NamedRef | None:
    return None if person is None else NamedRef(id=person.id, name=person.name)
