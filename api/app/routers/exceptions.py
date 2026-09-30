"""Tutor availability exceptions: a tutor asks for time off, an admin decides it.

The first routes in the system a tutor may *write* through, and the four endpoints are
deliberately asymmetric about it:

- `GET /api/tutors/{tutor_id}/exceptions` takes `TutorScope` and returns every status. A
  `pending` row is visible to the tutor who asked and to the admins who have yet to rule on
  it; it simply blocks nothing until it is approved.
- `POST /api/tutors/{tutor_id}/exceptions` takes `TutorScope`, so a tutor may create only
  under their own id and an admin or developer may target anyone. The status the row lands at
  is derived from the caller's role in the service, never read from the body.
- `PATCH /api/exceptions/{exception_id}` takes `AdminPrincipal`. No tutor may reach it at all,
  which is what stops a tutor approving their own time off — the one authorisation rule this
  feature exists to enforce. It deliberately does not take `TutorScope`: the unapplied-scope
  guard is not armed here, and does not need to be, because there is no tutor-visible query to
  narrow. The row is loaded by primary key by a caller who is already allowed to see every
  tutor's rows.
- `DELETE /api/exceptions/{exception_id}` takes `Principal` and checks the loaded row's owner,
  the other half of the two-shape rule: it cannot filter by tutor before it knows whose row it
  is. An admin or developer deletes any exception — the only reversal of a mistaken approval,
  since `PATCH` refuses to re-decide — while a tutor deletes only their own, and only while it
  is still `pending`.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal, Principal, TutorScope, assert_can_access_tutor
from app.models.availability import TutorAvailabilityException
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.exceptions import ExceptionCreate, ExceptionDecision, ExceptionRead
from app.services.exception_service import (
    ExceptionAlreadyDecided,
    ExceptionNotDeletable,
    ExceptionNotFound,
    TutorNotFound,
    create_exception,
    decide_exception,
    delete_exception,
    list_exceptions,
    load_exception_for_delete,
)

TUTOR_NOT_FOUND_ERROR = "No such tutor"
EXCEPTION_NOT_FOUND_ERROR = "No such availability exception"
ALREADY_DECIDED_ERROR = "This exception has already been decided"
EXCEPTION_NOT_DELETABLE_ERROR = "An admin has already decided this request"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api", tags=["exceptions"])


@router.get("/tutors/{tutor_id}/exceptions", response_model=Page[ExceptionRead])
def list_tutor_exceptions(
    scope: TutorScope,
    db: DbSession,
    date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
    date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[ExceptionRead]:
    # As in `create_tutor_exception` below, `get_tutor_scope` declares the `{tutor_id}` segment
    # and this read is what marks the scope applied. Leaving it unread would not widen the
    # query — it would 500 it, since exceptions are a tutor-owned table.
    tutor_id = scope.tutor_id

    rows, total = list_exceptions(
        db,
        tutor_id=tutor_id,
        date_from=date_from,
        date_to=date_to,
        limit=page_size,
        offset=(page - 1) * page_size,
    )

    return Page[ExceptionRead](
        items=[_read(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


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


@router.delete(
    "/exceptions/{exception_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_tutor_exception(exception_id: uuid.UUID, user: Principal, db: DbSession) -> None:
    try:
        row = load_exception_for_delete(db, exception_id=exception_id)
    except ExceptionNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=EXCEPTION_NOT_FOUND_ERROR
        ) from exc

    # Ownership first, status second, and the order is load-bearing: answering "already
    # decided" to a tutor holding someone else's id would tell them which of that tutor's
    # requests have been ruled on. An id matching no row is 404 for everyone and an id matching
    # another tutor's row is 403 — that pair does reveal to a tutor whether an id exists, and
    # it is the constitution's deliberate choice (cross-tutor access is 403, never 404, never
    # an empty 200), not an oversight to harden into a uniform 404.
    assert_can_access_tutor(user, row.tutor_id)

    try:
        delete_exception(db, exception=row, actor_role=user.role)
    except ExceptionNotDeletable as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=EXCEPTION_NOT_DELETABLE_ERROR
        ) from exc

    db.commit()


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
