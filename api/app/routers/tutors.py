"""`/api/tutors` — the two auth shapes side by side, on the same resource.

`GET ""` **lists**, so it takes `TutorScope` and hands `scope.tutor_id` to the service: a tutor
sees their own profile and nothing else, and reading the scope is what disarms the guard that
would otherwise 500 the request (`dependencies.py:237-255`).

`GET "/{tutor_id}"` **loads one row by id**, so it takes `Principal` and calls
`assert_can_access_tutor` with the **path** id, *before* the row is loaded. For this resource a
row's owner is its own id, so the check is exact — and doing it first is what makes a tutor
asking for an id that does not exist get 403 rather than a 404 that discloses non-existence.

The write routes take `AdminPrincipal` and deliberately **not** `TutorScope`: they are
admin-only, they have no filter to apply, and an unread scope would turn every one of them into
a 500 the moment it touched `tutors`.

`POST /{tutor_id}/subjects` and its `DELETE` live in `routers/tutor_subjects.py`, which mounts
them on this same prefix.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal, Principal, TutorScope, assert_can_access_tutor
from app.models.tutor import Tutor
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.tutor import TutorCreate, TutorRead, TutorSubjectRead, TutorUpdate
from app.services.phone_service import InvalidPhoneNumber
from app.services.tutor_service import (
    TutorEmailTaken,
    TutorNotFound,
    TutorPhoneNumberTaken,
    TutorUniqueViolation,
    create_tutor,
    deactivate_tutor,
    get_tutor,
    list_tutors,
    update_tutor,
)

TUTOR_NOT_FOUND_ERROR = "Tutor not found"
EMAIL_TAKEN_ERROR = "A tutor with that email already exists"
PHONE_NUMBER_TAKEN_ERROR = "A tutor with that phone number already exists"
UNIQUE_VIOLATION_ERROR = "A tutor with that email or phone number already exists"
INVALID_PHONE_NUMBER_ERROR = "phone_number is not a phone number that can be dialled"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/tutors", tags=["tutors"])


def _read(tutor: Tutor) -> TutorRead:
    return TutorRead(
        id=tutor.id,
        name=tutor.name,
        email=tutor.email,
        phone_number=tutor.phone_number,
        bio=tutor.bio,
        is_active=tutor.is_active,
        subjects=[
            TutorSubjectRead(
                subject_id=assignment.subject_id,
                name=assignment.subject.name,
                max_grade_level=assignment.max_grade_level,
            )
            for assignment in sorted(tutor.tutor_subjects, key=lambda row: row.subject.name)
        ],
    )


@router.get("", response_model=Page[TutorRead])
def list_all(
    scope: TutorScope,
    db: DbSession,
    is_active: bool = True,
    subject_id: uuid.UUID | None = None,
    grade_level: Annotated[int | None, Query(ge=1)] = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[TutorRead]:
    # No `tutor_id` parameter here: `get_tutor_scope` declares one, and FastAPI surfaces it on
    # this route automatically. Declaring a second would shadow the scoped one.
    tutors, total = list_tutors(
        db,
        is_active=is_active,
        tutor_id=scope.tutor_id,
        subject_id=subject_id,
        grade_level=grade_level,
        q=q,
        limit=page_size,
        offset=(page - 1) * page_size,
    )

    return Page[TutorRead](
        items=[_read(row) for row in tutors],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{tutor_id}", response_model=TutorRead)
def read_one(tutor_id: uuid.UUID, user: Principal, db: DbSession) -> TutorRead:
    assert_can_access_tutor(user, tutor_id)

    try:
        found = get_tutor(db, tutor_id=tutor_id)
    except TutorNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, TUTOR_NOT_FOUND_ERROR) from exc

    return _read(found)


@router.post("", response_model=TutorRead, status_code=status.HTTP_201_CREATED)
def create(payload: TutorCreate, user: AdminPrincipal, db: DbSession) -> TutorRead:
    try:
        created = create_tutor(
            db,
            name=payload.name,
            email=payload.email,
            phone_number=payload.phone_number,
            bio=payload.bio,
        )
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc
    except TutorEmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except TutorPhoneNumberTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, PHONE_NUMBER_TAKEN_ERROR) from exc
    except TutorUniqueViolation as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, UNIQUE_VIOLATION_ERROR) from exc

    db.commit()

    return _read(created)


@router.patch("/{tutor_id}", response_model=TutorRead)
def update(
    tutor_id: uuid.UUID, payload: TutorUpdate, user: AdminPrincipal, db: DbSession
) -> TutorRead:
    try:
        updated = update_tutor(
            db,
            tutor_id=tutor_id,
            name=payload.name,
            email=payload.email,
            phone_number=payload.phone_number,
            bio=payload.bio,
            is_active=payload.is_active,
        )
    except TutorNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, TUTOR_NOT_FOUND_ERROR) from exc
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc
    except TutorEmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except TutorPhoneNumberTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, PHONE_NUMBER_TAKEN_ERROR) from exc
    except TutorUniqueViolation as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, UNIQUE_VIOLATION_ERROR) from exc

    db.commit()

    return _read(updated)


@router.delete("/{tutor_id}", response_model=TutorRead)
def soft_delete(tutor_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> TutorRead:
    try:
        deactivated = deactivate_tutor(db, tutor_id=tutor_id)
    except TutorNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, TUTOR_NOT_FOUND_ERROR) from exc

    db.commit()

    return _read(deactivated)
