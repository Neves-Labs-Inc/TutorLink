"""`/api/users` — admin only, and the one router that guards the developer boundary.

A thin HTTP shell over `user_service`, matching `auth.py`: the service raises domain
exceptions, this maps them to status codes and owns the commit.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.user_service import (
    EmailTaken,
    InvalidUserShape,
    RoleNotPermitted,
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
    "A tutor account requires an existing tutor_id, an admin or developer must not have one, "
    "and a password must be at least 8 characters"
)

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
        )
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc
    except EmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except InvalidUserShape as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_SHAPE_ERROR) from exc

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
        )
    except UserNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR) from exc
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc
    except EmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except InvalidUserShape as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_SHAPE_ERROR) from exc

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
