"""Tutor availability exceptions: a tutor asks for time off, an admin decides it.

The first route in the system a tutor may *write* through, and the two endpoints are
deliberately asymmetric about it:

- `POST /api/tutors/{tutor_id}/exceptions` takes `TutorScope`, so a tutor may create only
  under their own id and an admin or developer may target anyone. The status the row lands at
  is derived from the caller's role in the service, never read from the body.
- `PATCH /api/exceptions/{exception_id}` takes `AdminPrincipal`. No tutor may reach it at all,
  which is what stops a tutor approving their own time off — the one authorisation rule this
  feature exists to enforce. It deliberately does not take `TutorScope`: the unapplied-scope
  guard is not armed here, and does not need to be, because there is no tutor-visible query to
  narrow. The row is loaded by primary key by a caller who is already allowed to see every
  tutor's rows.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal, Principal, TutorScope
from app.models.availability import TutorAvailabilityException
from app.schemas.exceptions import ExceptionCreate, ExceptionDecision, ExceptionRead
from app.services.exception_service import (
    ExceptionAlreadyDecided,
    ExceptionNotFound,
    TutorNotFound,
    create_exception,
    decide_exception,
)

TUTOR_NOT_FOUND_ERROR = "No such tutor"
EXCEPTION_NOT_FOUND_ERROR = "No such availability exception"
ALREADY_DECIDED_ERROR = "This exception has already been decided"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api", tags=["exceptions"])


@router.post(
    "/tutors/{tutor_id}/exceptions",
    response_model=ExceptionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_tutor_exception(
    payload: ExceptionCreate,
    scope: TutorScope,
    user: Principal,
    db: DbSession,
) -> ExceptionRead:
    # No `tutor_id` parameter is declared here: `get_tutor_scope` already declares it and binds
    # it from the path segment. Reading `scope.tutor_id` is both where the owning id comes from
    # and what marks the scope applied. A tutor reaching for another tutor's id was refused
    # with a 403 during dependency resolution, so this id is always one the caller may write.
    tutor_id = scope.tutor_id

    try:
        row = create_exception(
            db,
            tutor_id=tutor_id,
            creator_role=user.role,
            start_date=payload.start_date,
            end_date=payload.end_date,
            start_time=payload.start_time,
            end_time=payload.end_time,
            reason=payload.reason,
            notes=payload.notes,
        )
    except TutorNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=TUTOR_NOT_FOUND_ERROR
        ) from exc

    db.commit()

    return _read(row)


@router.patch("/exceptions/{exception_id}", response_model=ExceptionRead)
def decide_tutor_exception(
    exception_id: uuid.UUID,
    payload: ExceptionDecision,
    user: AdminPrincipal,
    db: DbSession,
) -> ExceptionRead:
    try:
        row = decide_exception(db, exception_id=exception_id, decision=payload.status)
    except ExceptionNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=EXCEPTION_NOT_FOUND_ERROR
        ) from exc
    except ExceptionAlreadyDecided as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=ALREADY_DECIDED_ERROR
        ) from exc

    db.commit()

    return _read(row)


def _read(row: TutorAvailabilityException) -> ExceptionRead:
    # Built field by field rather than with `model_validate(row)`: the constitution forbids an
    # ORM instance crossing the HTTP boundary, and an explicit constructor is what makes adding
    # a column to the table a decision to expose it rather than an accident.
    return ExceptionRead(
        id=row.id,
        tutor_id=row.tutor_id,
        start_date=row.start_date,
        end_date=row.end_date,
        start_time=row.start_time,
        end_time=row.end_time,
        reason=row.reason,
        notes=row.notes,
        status=row.status,
        created_at=row.created_at,
    )
