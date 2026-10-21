"""A Child's Assigned Tutors (#242) — Office only, from the Child screen and the Staff screen.

- `POST /api/children/{id}/assigned-tutors` with `{user_id}` assigns one; it answers with the
  Child's whole `assigned_tutors` list, the same rows `GET /api/children/{id}` carries.
- `DELETE /api/children/{id}/assigned-tutors/{user_id}` removes one, the last one included.

A thin HTTP shell over `assigned_tutor_service`, matching `child_evaluation.py`: the service
raises domain exceptions, this maps them to status codes and owns the commit.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.schemas.child import AssignedTutorCreate, AssignedTutorRead, assigned_tutor_reads
from app.services.assigned_tutor_service import (
    ChildNotEvaluated,
    ChildNotFound,
    NotAssignable,
    NotAssigned,
    assign,
    unassign,
)

CHILD_NOT_FOUND_ERROR = "Child not found"
NOT_EVALUATED_ERROR = "Mark the child Evaluated before changing its Assigned Tutors"
NOT_ASSIGNABLE_ERROR = "Only an active Tutor or Manager can be an Assigned Tutor"
NOT_ASSIGNED_ERROR = "That person isn't one of this child's Assigned Tutors"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/children", tags=["children"])


@router.post("/{child_id}/assigned-tutors", response_model=list[AssignedTutorRead])
def post_assigned_tutor(
    child_id: uuid.UUID, payload: AssignedTutorCreate, user: OfficePrincipal, db: DbSession
) -> list[AssignedTutorRead]:
    try:
        tutors = assign(db, child_id=child_id, user_id=payload.user_id, by_user_id=user.id)
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except ChildNotEvaluated as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NOT_EVALUATED_ERROR) from exc
    except NotAssignable as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, NOT_ASSIGNABLE_ERROR) from exc

    db.commit()

    return assigned_tutor_reads(tutors)


@router.delete("/{child_id}/assigned-tutors/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assigned_tutor(
    child_id: uuid.UUID, user_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> Response:
    try:
        unassign(db, child_id=child_id, user_id=user_id)
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except ChildNotEvaluated as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NOT_EVALUATED_ERROR) from exc
    except NotAssigned as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_ASSIGNED_ERROR) from exc

    db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
