"""`/api/subjects` — routes added by the Phase 3 task that owns the subjects resource."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal, Principal
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.subject import SubjectCreate, SubjectRead, SubjectUpdate
from app.services.subject_service import (
    KEEP,
    SubjectNameTaken,
    SubjectNotFound,
    SubjectWithCount,
    create_subject,
    deactivate_subject,
    list_subjects,
    update_subject,
)

SUBJECT_NOT_FOUND_ERROR = "Subject not found"
SUBJECT_NAME_TAKEN_ERROR = "A subject with that name already exists"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/subjects", tags=["subjects"])


def _read(row: SubjectWithCount) -> SubjectRead:
    return SubjectRead(
        id=row.subject.id,
        name=row.subject.name,
        name_es=row.subject.name_es,
        description=row.subject.description,
        is_active=row.subject.is_active,
        tutor_count=row.tutor_count,
    )


@router.get("", response_model=Page[SubjectRead])
def list_all(
    user: Principal,
    db: DbSession,
    is_active: bool = True,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[SubjectRead]:
    subjects, total = list_subjects(
        db, is_active=is_active, limit=page_size, offset=(page - 1) * page_size
    )

    return Page[SubjectRead](
        items=[_read(row) for row in subjects],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("", response_model=SubjectRead, status_code=status.HTTP_201_CREATED)
def create(payload: SubjectCreate, user: OfficePrincipal, db: DbSession) -> SubjectRead:
    try:
        created = create_subject(
            db, name=payload.name, name_es=payload.name_es, description=payload.description
        )
    except SubjectNameTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, SUBJECT_NAME_TAKEN_ERROR) from exc

    db.commit()

    return _read(created)


@router.patch("/{subject_id}", response_model=SubjectRead)
def update(
    subject_id: uuid.UUID, payload: SubjectUpdate, user: OfficePrincipal, db: DbSession
) -> SubjectRead:
    try:
        updated = update_subject(
            db,
            subject_id=subject_id,
            name=payload.name,
            description=payload.description,
            is_active=payload.is_active,
            # Left out keeps the stored name; `null` or blank clears it.
            name_es=payload.name_es if "name_es" in payload.model_fields_set else KEEP,
        )
    except SubjectNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, SUBJECT_NOT_FOUND_ERROR) from exc
    except SubjectNameTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, SUBJECT_NAME_TAKEN_ERROR) from exc

    db.commit()

    return _read(updated)


@router.delete("/{subject_id}", response_model=SubjectRead)
def soft_delete(subject_id: uuid.UUID, user: OfficePrincipal, db: DbSession) -> SubjectRead:
    try:
        deactivated = deactivate_subject(db, subject_id=subject_id)
    except SubjectNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, SUBJECT_NOT_FOUND_ERROR) from exc

    db.commit()

    return _read(deactivated)
