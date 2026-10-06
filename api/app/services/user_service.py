"""User account CRUD, and the rules that keep `developer` out of an admin's reach.

Same transaction contract as `auth_service`: nothing here commits, the caller owns the
boundary.

**The developer boundary is three rules, not two.** #13 states the first two — an admin may
not create a `developer`, and may not change anyone's role to `developer`. Those alone leave
the boundary open, because `PATCH /api/users/{id}` can set a password: an admin who cannot
*become* a developer can still overwrite an existing developer's password and simply log in as
one. Deactivating them is the same hole in the other direction.

So an admin may not write to a developer account at all. A developer may do all of it.

**A tutor account names its profile one of two ways.** `tutor_id` links a profile the Tutors
page already created — tutors exist there before their login does — and `tutor` creates one
here, from the account's own email. Exactly one of the two: neither is the NULL `tutor_id` row
`TutorScope` refuses, and both is two answers to which profile the account belongs to.

The ordering inside `create_user` is the no-orphan guarantee, and a caller cannot restore it
from outside. Every check that can fail runs before the first INSERT, and the profile and the
account are written to the caller's one transaction — so a refused request has written nothing
at all, and a failure between the two writes is one rollback rather than a profile no login
points at or an account whose profile never landed.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import hash_password, password_is_encodable
from app.services.tutor_service import create_tutor

MIN_PASSWORD_LENGTH = 8


@dataclass(frozen=True, slots=True)
class TutorProfileInput:
    """The profile `create_user` is asked to create, carrying no email — see the module
    docstring: it takes the account's."""

    name: str
    phone_number: str
    bio: str | None


@dataclass(frozen=True, slots=True)
class DisplayName:
    """A new account's Display name, and whether it is the email's local part."""

    value: str
    is_default: bool


class UserServiceError(Exception):
    """Base class for every failure this module reports."""


class UserNotFound(UserServiceError):
    """No user with that id."""


class EmailTaken(UserServiceError):
    """Another account already holds that email."""


class RoleNotPermitted(UserServiceError):
    """The actor may not create, become, or modify this role."""


class InvalidUserShape(UserServiceError):
    """A tutor account with no profile or with two ways of naming one, a non-tutor carrying
    either, or an unusable password."""


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
    tutor: TutorProfileInput | None,
    display_name: str | None = None,
) -> User:
    """The account, and the tutor profile too when `tutor` is given rather than `tutor_id`.

    The order of the two writes is deliberate. The account email is claimed *before*
    `create_tutor` inserts anything, so the 409 a duplicate account email produces cannot leave
    a profile behind — which matters because that profile would hold the same email, and the
    obvious retry would then collide with it on `tutors.email` instead, reporting a conflict
    with a row the failed request had created. The account's INSERT is last because it is the
    only one of the two that can still fail, and rolling it back takes the profile with it.

    The profile's email is the account's normalised one, not a second field: one address for
    both is an invariant here rather than something a caller has to keep true.
    """
    normalized_email = email.strip().lower()

    if role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    _assert_password_usable(password)
    _assert_tutor_input_matches_role(role=role, tutor_id=tutor_id, tutor=tutor)

    if db.scalars(select(User).where(User.email == normalized_email)).first() is not None:
        raise EmailTaken

    profile_id = tutor_id

    if tutor is not None:
        profile_id = create_tutor(
            db,
            name=tutor.name,
            email=normalized_email,
            phone_number=tutor.phone_number,
            bio=tutor.bio,
        ).id

    _assert_profile_matches_role(db, role=role, tutor_id=profile_id)
    profile = db.get(Tutor, profile_id) if profile_id is not None else None

    name = resolve_display_name(
        display_name=display_name,
        email=normalized_email,
        tutor_name=profile.name if profile else None,
    )
    user = User(
        email=normalized_email,
        display_name=name.value,
        display_name_is_default=name.is_default,
        hashed_password=hash_password(password),
        role=role,
        tutor_id=profile_id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


def default_display_name(*, email: str, tutor_name: str | None) -> str:
    """The Display name for an account created without one: the tutor's name, else the email's
    local part. A stopgap until every creation path requires a Display name."""
    name = email.split("@", 1)[0]
    if tutor_name:
        name = tutor_name

    return name


def resolve_display_name(
    *, display_name: str | None, email: str, tutor_name: str | None
) -> DisplayName:
    """The given name, else `default_display_name`'s, flagged when it came from the email.

    The flag is what keeps an email-derived name from ever reaching a Guardian (#109): a
    takeover by such a holder sends the nameless notice instead.
    """
    is_from_email = not display_name and not tutor_name

    return DisplayName(
        value=display_name or default_display_name(email=email, tutor_name=tutor_name),
        is_default=is_from_email,
    )


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


def _assert_tutor_input_matches_role(
    *, role: UserRole, tutor_id: uuid.UUID | None, tutor: TutorProfileInput | None
) -> None:
    """Which of the two ways of naming a profile a `create` used — the half of the rule that
    needs no database, and create-only, since `PATCH` offers neither field.

    Exactly one, for a tutor: neither leaves the NULL `tutor_id` row the helper below
    describes, and both would have this pick one of them, linking the account to a profile the
    caller did not choose while silently dropping — or, worse, creating — the other.

    An admin or developer sends no `tutor`; `_assert_profile_matches_role` refuses them a
    `tutor_id` below, on the id this resolves to.
    """
    if role is UserRole.TUTOR:
        if (tutor_id is None) == (tutor is None):
            raise InvalidUserShape
    elif tutor is not None:
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
