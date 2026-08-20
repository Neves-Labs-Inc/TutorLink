"""User account CRUD, and the rules that keep `developer` out of an admin's reach.

Same transaction contract as `auth_service`: nothing here commits, the caller owns the
boundary.

**The developer boundary is three rules, not two.** #13 states the first two — an admin may
not create a `developer`, and may not change anyone's role to `developer`. Those alone leave
the boundary open, because `PATCH /api/users/{id}` can set a password: an admin who cannot
*become* a developer can still overwrite an existing developer's password and simply log in as
one. Deactivating them is the same hole in the other direction.

So an admin may not write to a developer account at all. A developer may do all of it.
"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import hash_password, password_is_encodable

MIN_PASSWORD_LENGTH = 8


class UserServiceError(Exception):
    """Base class for every failure this module reports."""


class UserNotFound(UserServiceError):
    """No user with that id."""


class EmailTaken(UserServiceError):
    """Another account already holds that email."""


class RoleNotPermitted(UserServiceError):
    """The actor may not create, become, or modify this role."""


class InvalidUserShape(UserServiceError):
    """A tutor account without a profile, a non-tutor with one, or an unusable password."""


def _visible(is_active: bool) -> Select[tuple[User]]:
    return select(User).where(User.is_active.is_(is_active))


def list_users(db: Session, *, is_active: bool, limit: int, offset: int) -> tuple[list[User], int]:
    """Rows for one page, plus the total matching before paging.

    Active by default and deactivated only behind `?is_active=false`, uniform across every
    resource (#21). `total` counts matches rather than returned rows — that difference is what
    the page envelope exists to report.
    """
    total = db.scalar(select(func.count()).select_from(_visible(is_active).subquery())) or 0
    users = list(
        db.scalars(_visible(is_active).order_by(User.email).limit(limit).offset(offset)).all()
    )

    return users, total


def get_user(db: Session, *, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)

    if user is None:
        raise UserNotFound

    return user


def create_user(
    db: Session,
    *,
    actor_role: UserRole,
    email: str,
    password: str,
    role: UserRole,
    tutor_id: uuid.UUID | None,
) -> User:
    normalized_email = email.strip().lower()

    if role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    _assert_password_usable(password)
    _assert_profile_matches_role(db, role=role, tutor_id=tutor_id)

    if db.scalars(select(User).where(User.email == normalized_email)).first() is not None:
        raise EmailTaken

    user = User(
        email=normalized_email,
        hashed_password=hash_password(password),
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


def update_user(
    db: Session,
    *,
    actor_role: UserRole,
    user_id: uuid.UUID,
    email: str | None,
    password: str | None,
    role: UserRole | None,
    is_active: bool | None,
) -> User:
    user = get_user(db, user_id=user_id)

    # Both directions. An admin may not promote anyone to developer (#13), and may not write to
    # an existing developer at all — otherwise setting their password is a way to become one.
    if actor_role is not UserRole.DEVELOPER and (
        role is UserRole.DEVELOPER or user.role is UserRole.DEVELOPER
    ):
        raise RoleNotPermitted

    if email is not None:
        normalized_email = email.strip().lower()
        clash = db.scalars(select(User).where(User.email == normalized_email)).first()

        if clash is not None and clash.id != user.id:
            raise EmailTaken

        user.email = normalized_email

    if password is not None:
        _assert_password_usable(password)
        user.hashed_password = hash_password(password)

    if role is not None:
        _assert_profile_matches_role(db, role=role, tutor_id=user.tutor_id)
        user.role = role

    if is_active is not None:
        user.is_active = is_active

    db.flush()

    return user


def deactivate_user(db: Session, *, actor_role: UserRole, user_id: uuid.UUID) -> User:
    """Soft delete. Same boundary as `update_user`: an admin cannot deactivate a developer,
    because locking the super-user out is the same breach as taking their password."""
    user = get_user(db, user_id=user_id)

    if user.role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    user.is_active = False
    db.flush()

    return user


def _assert_password_usable(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH or not password_is_encodable(password):
        raise InvalidUserShape


def _assert_profile_matches_role(
    db: Session, *, role: UserRole, tutor_id: uuid.UUID | None
) -> None:
    """A tutor account needs a profile; an admin or developer must not have one.

    `TutorScope` refuses a tutor whose `tutor_id` is NULL — the dependency calls that a data
    error that must fail loudly. Creating one through the API would be manufacturing exactly
    that row, so it is refused here instead.
    """
    if role is UserRole.TUTOR:
        if tutor_id is None or db.get(Tutor, tutor_id) is None:
            raise InvalidUserShape
    elif tutor_id is not None:
        raise InvalidUserShape
