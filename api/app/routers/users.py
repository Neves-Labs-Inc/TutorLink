"""`/api/users` — admin only (a Manager is 403), and the one router that guards the developer
boundary.

A thin HTTP shell over `user_service`, matching `auth.py`: the service raises domain
exceptions, this maps them to status codes and owns the commit.

`POST` can write two rows — an account, and the tutor profile it links to when the payload
carries `tutor` instead of `tutor_id`. The single `db.commit()` below is what makes that one
event: every failure path leaves this function by `raise`, so neither row is ever committed
without the other.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.user import TutorProfileCreate, UserCreate, UserRead, UserUpdate
from app.services.phone_service import InvalidPhoneNumber
from app.services.tutor_service import (
    TutorEmailTaken,
    TutorPhoneNumberTaken,
    TutorUniqueViolation,
)
from app.services.user_service import (
    EmailTaken,
    InvalidDisplayName,
    InvalidUserShape,
    RoleNotPermitted,
    TutorProfileInput,
    UserNotFound,
    create_user,
    deactivate_user,
    get_user,
    list_users,
    update_user,
)

EMAIL_TAKEN_ERROR = "A user with that email already exists"
USER_NOT_FOUND_ERROR = "User not found"
DEVELOPER_FORBIDDEN_ERROR = "Only a developer may create or modify a developer account"
INVALID_SHAPE_ERROR = (
    "A tutor account requires exactly one of tutor_id and tutor, any other role must have "
    "neither, and a password must be at least 8 characters"
)
TUTOR_EMAIL_TAKEN_ERROR = (
    "A tutor profile already holds that email — link it with tutor_id instead of sending tutor"
)
TUTOR_PHONE_NUMBER_TAKEN_ERROR = "A tutor with that phone number already exists"
TUTOR_UNIQUE_VIOLATION_ERROR = "A tutor with that email or phone number already exists"
INVALID_PHONE_NUMBER_ERROR = "tutor.phone_number is not a phone number that can be dialled"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=Page[UserRead])
def list_all(
    user: AdminPrincipal,
    db: DbSession,
    is_active: bool = True,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[UserRead]:
    users, total = list_users(
        db, is_active=is_active, limit=page_size, offset=(page - 1) * page_size
    )

    return Page[UserRead](
        items=[UserRead.model_validate(row) for row in users],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{user_id}", response_model=UserRead)
def read_one(user_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> UserRead:
    try:
        found = get_user(db, user_id=user_id)
    except UserNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR) from exc

    return UserRead.model_validate(found)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create(payload: UserCreate, user: AdminPrincipal, db: DbSession) -> UserRead:
    try:
        created = create_user(
            db,
            actor_role=user.role,
            email=payload.email,
            password=payload.password,
            role=payload.role,
            tutor_id=payload.tutor_id,
            tutor=_tutor_profile_input(payload.tutor),
            display_name=payload.display_name,
        )
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc
    except EmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except InvalidUserShape as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_SHAPE_ERROR) from exc
    except InvalidDisplayName as exc:
        # The service's message says which rule the name broke.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc
    except TutorEmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, TUTOR_EMAIL_TAKEN_ERROR) from exc
    except TutorPhoneNumberTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, TUTOR_PHONE_NUMBER_TAKEN_ERROR) from exc
    except TutorUniqueViolation as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, TUTOR_UNIQUE_VIOLATION_ERROR) from exc

    db.commit()

    return UserRead.model_validate(created)


@router.patch("/{user_id}", response_model=UserRead)
def update(
    user_id: uuid.UUID, payload: UserUpdate, user: AdminPrincipal, db: DbSession
) -> UserRead:
    try:
        updated = update_user(
            db,
            actor_role=user.role,
            user_id=user_id,
            email=payload.email,
            password=payload.password,
            role=payload.role,
            is_active=payload.is_active,
            display_name=payload.display_name,
        )
    except UserNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR) from exc
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc
    except EmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except InvalidUserShape as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_SHAPE_ERROR) from exc
    except InvalidDisplayName as exc:
        # The service's message says which rule the name broke.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    db.commit()

    return UserRead.model_validate(updated)


@router.delete("/{user_id}", response_model=UserRead)
def soft_delete(user_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> UserRead:
    try:
        deactivated = deactivate_user(db, actor_role=user.role, user_id=user_id)
    except UserNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR) from exc
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc

    db.commit()

    return UserRead.model_validate(deactivated)


def _tutor_profile_input(tutor: TutorProfileCreate | None) -> TutorProfileInput | None:
    return (
        None
        if tutor is None
        else TutorProfileInput(name=tutor.name, phone_number=tutor.phone_number, bio=tutor.bio)
    )
