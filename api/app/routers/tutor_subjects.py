"""`/api/tutors/{tutor_id}/subjects` — admin only, assigning and removing subject-grade
assignments.

A thin HTTP shell over `tutor_subject_service`: the service raises domain exceptions, this
maps them to status codes and owns the commit. `remove` returns 204 because a hard-deleted
row leaves nothing to echo back.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.schemas.tutor_subject import TutorSubjectAssignmentRead, TutorSubjectCreate
from app.services.tutor_subject_service import (
    AssignmentExists,
    AssignmentNotFound,
    SubjectNotFound,
    TutorNotFound,
    assign_subject,
    remove_subject,
)

TUTOR_NOT_FOUND_ERROR = "Tutor not found"
SUBJECT_NOT_FOUND_ERROR = "Unknown subject_id"
ASSIGNMENT_EXISTS_ERROR = "That subject is already assigned to this tutor"
ASSIGNMENT_NOT_FOUND_ERROR = "That subject is not assigned to this tutor"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/tutors", tags=["tutor-subjects"])


@router.post(
    "/{tutor_id}/subjects",
    response_model=TutorSubjectAssignmentRead,
    status_code=status.HTTP_201_CREATED,
)
def assign(
    tutor_id: uuid.UUID, payload: TutorSubjectCreate, user: AdminPrincipal, db: DbSession
) -> TutorSubjectAssignmentRead:
    try:
        assignment = assign_subject(
            db,
            tutor_id=tutor_id,
            subject_id=payload.subject_id,
            max_grade_level=payload.max_grade_level,
        )
    except TutorNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, TUTOR_NOT_FOUND_ERROR) from exc
    except SubjectNotFound as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, SUBJECT_NOT_FOUND_ERROR) from exc
    except AssignmentExists as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, ASSIGNMENT_EXISTS_ERROR) from exc

    db.commit()

    return TutorSubjectAssignmentRead(
        subject_id=assignment.subject_id,
        name=assignment.subject.name,
        max_grade_level=assignment.max_grade_level,
    )


@router.delete(
    "/{tutor_id}/subjects/{subject_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def remove(tutor_id: uuid.UUID, subject_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> None:
    try:
        remove_subject(db, tutor_id=tutor_id, subject_id=subject_id)
    except TutorNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, TUTOR_NOT_FOUND_ERROR) from exc
    except AssignmentNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, ASSIGNMENT_NOT_FOUND_ERROR) from exc

    db.commit()
