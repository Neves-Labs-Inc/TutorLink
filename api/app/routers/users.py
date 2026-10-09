"""`/api/users` — admin only (a Manager is 403), and the one router that guards the developer
boundary.

A thin HTTP shell over `user_service`, matching `auth.py`: the service raises domain
exceptions, this maps them to status codes and owns the commit.

`POST` can write two rows — an account, and the profile a Tutor or Manager's payload carries
as `tutor`. The single `db.commit()` below is what makes that one event: every failure path
leaves this function by `raise`, so neither row is ever committed without the other.
"""

import logging
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.user import User
from app.dependencies import AdminPrincipal
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.user import TutorProfileCreate, UserCreate, UserRead, UserUpdate
from app.services.mail_service import MailServiceError
from app.services.name_rules import InvalidName
from app.services.password_link_service import live_invite_expiries, live_invite_expiry
from app.services.phone_service import InvalidPhoneNumber
from app.services.tutor_service import TutorPhoneNumberTaken, TutorUniqueViolation
from app.services.user_service import (
    EmailTaken,
    InvalidUserShape,
    ProfileAlreadyLinked,
    RoleNotPermitted,
    TutorProfileInput,
    UserHasPassword,
    UserInactive,
    UserNotFound,
    create_user,
    deactivate_user,
    get_user,
    invite_user,
    list_users,
    update_user,
)

EMAIL_TAKEN_ERROR = "A user with that email already exists"
USER_NOT_FOUND_ERROR = "User not found"
DEVELOPER_FORBIDDEN_ERROR = "Only a developer may create or modify a developer account"
INVALID_SHAPE_ERROR = (
    "A tutor or manager account requires a tutor profile, any other role must have none"
)
PROFILE_ALREADY_LINKED_ERROR = "That tutor profile already has a user account"
TUTOR_PHONE_NUMBER_TAKEN_ERROR = "A tutor with that phone number already exists"
TUTOR_UNIQUE_VIOLATION_ERROR = "A tutor with that email or phone number already exists"
INVALID_PHONE_NUMBER_ERROR = "tutor.phone_number is not a phone number that can be dialled"
USER_HAS_PASSWORD_ERROR = "That user already has a password"
USER_INACTIVE_ERROR = "Deactivated users cannot be invited"
INVITE_SEND_FAILED_ERROR = "Could not send the invite email. Try again."

logger = logging.getLogger(__name__)

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
    # One query for the page, not one per row.
    expiries = live_invite_expiries(db, user_ids=[row.id for row in users], now=datetime.now(UTC))

    return Page[UserRead](
        items=[_read(row, invite_expires_at=expiries.get(row.id)) for row in users],
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

    return _read_with_invite(db, found)


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create(payload: UserCreate, user: AdminPrincipal, db: DbSession) -> UserRead:
    try:
        created = create_user(
            db,
            actor_role=user.role,
            email=payload.email,
            role=payload.role,
            tutor_id=payload.tutor_id,
            tutor=_tutor_profile_input(payload.tutor),
            name=payload.name,
        )
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc
    except EmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except ProfileAlreadyLinked as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, PROFILE_ALREADY_LINKED_ERROR) from exc
    except InvalidUserShape as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_SHAPE_ERROR) from exc
    except InvalidName as exc:
        # The service's message says which rule the name broke.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc
    except TutorPhoneNumberTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, TUTOR_PHONE_NUMBER_TAKEN_ERROR) from exc
    except TutorUniqueViolation as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, TUTOR_UNIQUE_VIOLATION_ERROR) from exc

    db.commit()

    return _read(created, invite_expires_at=None)


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
            role=payload.role,
            is_active=payload.is_active,
            name=payload.name,
            now=datetime.now(UTC),
        )
    except UserNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR) from exc
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc
    except EmailTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN_ERROR) from exc
    except InvalidUserShape as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_SHAPE_ERROR) from exc
    except InvalidName as exc:
        # The service's message says which rule the name broke.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    db.commit()

    return _read_with_invite(db, updated)


@router.delete("/{user_id}", response_model=UserRead)
def soft_delete(user_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> UserRead:
    try:
        deactivated = deactivate_user(db, actor_role=user.role, user_id=user_id)
    except UserNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR) from exc
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc

    db.commit()

    return _read_with_invite(db, deactivated)


@router.post("/{user_id}/invite", response_model=UserRead)
def invite(user_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> UserRead:
    """Email the user a single-use link to choose a password; they show as Invited until it is
    used, replaced, revoked or expired. Nothing is committed unless the email went out."""
    actor = get_user(db, user_id=user.id)
    now = datetime.now(UTC)

    try:
        invited = invite_user(
            db, actor_role=user.role, actor_name=actor.name, user_id=user_id, now=now
        )
    except UserNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND_ERROR) from exc
    except RoleNotPermitted as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, DEVELOPER_FORBIDDEN_ERROR) from exc
    except UserHasPassword as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, USER_HAS_PASSWORD_ERROR) from exc
    except UserInactive as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, USER_INACTIVE_ERROR) from exc
    except MailServiceError as exc:
        # The service unwound the link row; the user is not Invited. No address in the log.
        logger.error("invite email for user %s not sent: %s", user_id, exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, INVITE_SEND_FAILED_ERROR) from exc

    db.commit()

    return _read_with_invite(db, invited, now=now)


def _read_with_invite(db: Session, user: User, *, now: datetime | None = None) -> UserRead:
    expiry = live_invite_expiry(db, user_id=user.id, now=now or datetime.now(UTC))

    return _read(user, invite_expires_at=expiry)


def _read(user: User, *, invite_expires_at: datetime | None) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        tutor_id=user.profile_id,
        is_active=user.is_active,
        has_password=user.hashed_password is not None,
        invite_expires_at=invite_expires_at,
    )


def _tutor_profile_input(tutor: TutorProfileCreate | None) -> TutorProfileInput | None:
    return (
        None if tutor is None else TutorProfileInput(phone_number=tutor.phone_number, bio=tutor.bio)
    )
