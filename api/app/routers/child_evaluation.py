"""A Child's Subject levels and Evaluated mark — admin only for now (ticket 16 opens them to
Managers).

- `PUT /api/children/{id}/levels/{subject_id}` sets or replaces a level; the caller is its setter.
- `DELETE /api/children/{id}/levels/{subject_id}` removes one.
- `POST /api/children/{id}/evaluated` with `{tutor_ids}` marks the Child Evaluated and sets its
  Assigned Tutors; `DELETE` clears the mark and keeps the assignments.

A thin HTTP shell over `child_evaluation_service`, matching `children.py`: the service raises
domain exceptions, this maps them to status codes and owns the commit. Mounted on the same
`/api/children` prefix as the other child routers; no path here overlaps theirs. The new state
reads back on `GET /api/children/{id}` (`levels`, `evaluated`).
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.routers.assigned_tutors import NOT_ASSIGNABLE_ERROR
from app.schemas.child import ChildLevelRead, EvaluatedCreate, EvaluatedRead, LevelSet, StaffRef
from app.services.assigned_tutor_service import NotAssignable
from app.services.child_evaluation_service import (
    ChildNotFound,
    LastLevelOfEvaluatedChild,
    LevelNotFound,
    NoLevelsToEvaluate,
    SubjectInactive,
    SubjectNotFound,
    clear_evaluated,
    mark_evaluated,
    remove_level,
    set_level,
)

CHILD_NOT_FOUND_ERROR = "Child not found"
SUBJECT_NOT_FOUND_ERROR = "Subject not found"
LEVEL_NOT_FOUND_ERROR = "This child has no level for that subject"
SUBJECT_INACTIVE_ERROR = "That subject is inactive, so it can't get a new level"
LAST_LEVEL_ERROR = (
    "An Evaluated child needs at least one level; clear Evaluated before removing this one"
)
NO_TUTORS_ERROR = "Pick at least one Tutor or Manager to assign"
NO_LEVELS_ERROR = "Add at least one subject level before marking the child Evaluated"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/children", tags=["children"])


@router.put("/{child_id}/levels/{subject_id}", response_model=ChildLevelRead)
def put_level(
    child_id: uuid.UUID,
    subject_id: uuid.UUID,
    payload: LevelSet,
    user: OfficePrincipal,
    db: DbSession,
) -> ChildLevelRead:
    try:
        row = set_level(
            db,
            child_id=child_id,
            subject_id=subject_id,
            level=payload.level,
            set_by_user_id=user.id,
        )
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except SubjectNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, SUBJECT_NOT_FOUND_ERROR) from exc
    except SubjectInactive as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, SUBJECT_INACTIVE_ERROR) from exc

    db.commit()

    return _level(row)


@router.delete("/{child_id}/levels/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_level(
    child_id: uuid.UUID, subject_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> Response:
    try:
        remove_level(db, child_id=child_id, subject_id=subject_id)
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except LevelNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, LEVEL_NOT_FOUND_ERROR) from exc
    except LastLevelOfEvaluatedChild as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, LAST_LEVEL_ERROR) from exc

    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{child_id}/evaluated", response_model=EvaluatedRead)
def post_evaluated(
    child_id: uuid.UUID,
    user: OfficePrincipal,
    db: DbSession,
    payload: Annotated[EvaluatedCreate | None, Body()] = None,
) -> EvaluatedRead:
    # An absent body is 422 like an empty list, not the app-wide 400 for a malformed one.
    if payload is None or not payload.tutor_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, NO_TUTORS_ERROR)

    try:
        child = mark_evaluated(
            db,
            child_id=child_id,
            by_user_id=user.id,
            tutor_ids=payload.tutor_ids,
            now=datetime.now(UTC),
        )
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except NoLevelsToEvaluate as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NO_LEVELS_ERROR) from exc
    except NotAssignable as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, NOT_ASSIGNABLE_ERROR) from exc

    db.commit()

    return _evaluated(child)


@router.delete("/{child_id}/evaluated", status_code=status.HTTP_204_NO_CONTENT)
def delete_evaluated(child_id: uuid.UUID, user: OfficePrincipal, db: DbSession) -> Response:
    try:
        clear_evaluated(db, child_id=child_id)
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc

    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _level(row: ChildSubjectLevel) -> ChildLevelRead:
    return ChildLevelRead(
        subject_id=row.subject_id,
        name=row.subject.name,
        archived=row.subject.is_archived,
        level=row.level,
        set_by=StaffRef(id=row.set_by.id, name=row.set_by.name),
        updated_at=row.updated_at,
    )


def _evaluated(child: Child) -> EvaluatedRead:
    # `mark_evaluated` either set both columns or found them set; the CHECK keeps them paired.
    assert child.evaluated_at is not None and child.evaluated_by is not None
    return EvaluatedRead(
        at=child.evaluated_at,
        by=StaffRef(id=child.evaluated_by.id, name=child.evaluated_by.name),
    )
