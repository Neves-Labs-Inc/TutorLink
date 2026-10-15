"""Staff Time off (availability exceptions): someone asks for time off, an Admin decides it.

Time off is keyed on the Staff member's user, so any Staff member — an Admin with no teaching
profile included — can hold it. The table has no `tutor_id`, so `TutorScope` has nothing to
filter on. Who may reach whose Time off is decided in `exception_service` (it needs the
target's role for the Developer boundary); this module maps its refusals to status codes:

- `GET /api/users/{user_id}/exceptions` and `POST` on the same path: the person themselves, or
  an Admin role. A Manager reads and writes only their own. A requester's entry lands
  `pending`, an Admin role's `approved`; the status is never read from the body.
- `PATCH /api/exceptions/{exception_id}` takes `AdminPrincipal`, which is what stops anyone
  approving their own request — the one authorisation rule this feature exists to enforce.
- `POST /api/exceptions/{exception_id}/cancel` takes `Principal`: the owner or an Admin role,
  checked on the loaded row before its status. It replaced `DELETE`; the row is kept.

Every response carries the wire status, which adds `expired` for a pending row that has ended.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal, Principal
from app.models.availability import TutorAvailabilityException
from app.models.user import User
from app.schemas.booking import NamedRef, StaffRef
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.exceptions import ExceptionCreate, ExceptionDecision, ExceptionRead
from app.services import clock
from app.services.exception_service import (
    DeveloperTimeOff,
    ExceptionAlreadyDecided,
    ExceptionCancelled,
    ExceptionEnded,
    ExceptionNotCancellable,
    ExceptionNotFound,
    ExceptionRequestError,
    NotYourTimeOff,
    UserArchived,
    UserNotFound,
    WindowEnded,
    cancel_exception,
    create_exception,
    decide_exception,
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
            limit=page_size,
            offset=(page - 1) * page_size,
        )
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    now = clock.business_now()

    return Page[ExceptionRead](
        items=[_read(row, now=now) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


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
) -> ExceptionRead:
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
        )
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    db.commit()

    return _read(row, now=clock.business_now())


@router.patch("/exceptions/{exception_id}", response_model=ExceptionRead)
def decide_staff_exception(
    exception_id: uuid.UUID,
    payload: ExceptionDecision,
    user: AdminPrincipal,
    db: DbSession,
) -> ExceptionRead:
    try:
        row = decide_exception(
            db,
            actor_id=user.id,
            actor_role=user.role,
            exception_id=exception_id,
            decision=payload.status,
        )
    except ExceptionRequestError as exc:
        raise _http_error(exc) from exc

    db.commit()

    return _read(row, now=clock.business_now())


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

    return _read(row, now=clock.business_now())


def _http_error(exc: ExceptionRequestError) -> HTTPException:
    status_code, detail = _ERRORS[type(exc)]
    return HTTPException(status_code=status_code, detail=detail)


def _read(row: TutorAvailabilityException, *, now: datetime.datetime) -> ExceptionRead:
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
    )


def _named(person: User | None) -> NamedRef | None:
    return None if person is None else NamedRef(id=person.id, name=person.name)
