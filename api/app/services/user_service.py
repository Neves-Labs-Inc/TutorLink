"""User account CRUD, and the rules that keep `developer` out of an admin's reach.

Same transaction contract as `auth_service`: nothing here commits, the caller owns the
boundary.

**The developer boundary is three rules.** An admin may not create a `developer`, may not
change anyone's role to `developer`, and may not write to an existing developer account at all
(email, name, role, active flag, and later invites). A developer may do all of it.

**Nobody sets a password here.** Accounts are created with no password (`hashed_password` is
NULL) and get one through an Invite: `invite_user` emails a single-use link, and a user shows
as Invited while that link is live. The send happens before the caller commits, inside a
savepoint with the link row, so a refused send leaves no link behind (answers 04 #7): Invited
only ever shows when a mail went out. Changing a user's email revokes every live link they
hold, since each was sent to the old address.
Managers are ordinary accounts on this boundary: an admin or developer creates, edits, promotes,
demotes and deactivates them (#108). A Manager never reaches this module, since `/api/users` is
admin-only.

**Every account has a Display name**, given on create and never derived. It is the one name
the person has: a Tutor's profile carries no name of its own, so renaming here renames them on
the Tutors page too.

**A Tutor or Manager is created with a profile, an Admin or Developer without.** The `tutor`
input carries what only the profile holds (phone, bio); the account's email and name are the
person's. `tutor_id` is refused: every profile already has its user (0030), so an Admin edits
that user rather than creating a second one for it.

**A role change keeps the profile.** Promoting a Tutor to Admin leaves their bookings,
availability and subjects where they are, so demotion restores them; they are simply no longer
offered. Changing to Tutor or Manager requires a profile to exist.

The ordering inside `create_user` is the no-orphan guarantee, and a caller cannot restore it
from outside. Every check that can fail runs before the first INSERT, and the profile and the
account are written to the caller's one transaction — so a refused request has written nothing
at all, and a failure between the two writes is one rollback rather than a person with no
profile or a profile whose person never landed.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.enums import UserRole
from app.models.password_link import PasswordLinkPurpose
from app.models.user import User
from app.services.auth_service import normalise_email
from app.services.mail_service import public_url, send_email
from app.services.mail_templates import invite_email
from app.services.name_rules import normalize_name
from app.services.password_link_service import issue_link, revoke_links_for_user
from app.services.tutor_service import PROFILE_ROLES, create_profile

SET_PASSWORD_PATH = "/set-password"

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class TutorProfileInput:
    """The profile `create_user` is asked to create. No name and no email: both are the
    account's — see the module docstring."""

    phone_number: str
    bio: str | None


class UserServiceError(Exception):
    """Base class for every failure this module reports."""


class UserNotFound(UserServiceError):
    """No user with that id."""


class EmailTaken(UserServiceError):
    """Another account already holds that email."""


class RoleNotPermitted(UserServiceError):
    """The actor may not create, become, or modify this role."""


class ProfileAlreadyLinked(UserServiceError):
    """`tutor_id` named a profile; every profile already has its user."""


class InvalidUserShape(UserServiceError):
    """A Tutor or Manager with no profile, or an Admin or Developer with one."""


class UserHasPassword(UserServiceError):
    """An Invite for a user who can already sign in."""


class UserInactive(UserServiceError):
    """An Invite for a deactivated user (answers 04 #3)."""


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
        db.scalars(
            _visible(is_active)
            .options(selectinload(User.profile))
            .order_by(User.email)
            .limit(limit)
            .offset(offset)
        ).all()
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
    role: UserRole,
    tutor_id: uuid.UUID | None,
    tutor: TutorProfileInput | None,
    name: str,
) -> User:
    """The account, and the profile too for a Tutor or Manager.

    Every check runs before the first INSERT: the developer boundary, the name,
    the role/profile pairing and the email. `create_profile` then checks the phone number and
    writes the account and the profile inside one savepoint, so nothing is left behind by a
    refusal on either side.
    """
    normalized_email = email.strip().lower()

    if role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    if tutor_id is not None:
        raise ProfileAlreadyLinked

    cleaned_name = normalize_name(name)
    _assert_create_shape(role=role, has_profile_input=tutor is not None)

    if db.scalars(select(User).where(User.email == normalized_email)).first() is not None:
        raise EmailTaken

    user = User(
        email=normalized_email,
        name=cleaned_name,
        name_is_default=False,
        hashed_password=None,
        role=role,
        is_active=True,
    )

    if tutor is None:
        db.add(user)
        db.flush()
    else:
        create_profile(db, user=user, phone_number=tutor.phone_number, bio=tutor.bio)

    return user


def rename_user(db: Session, *, user_id: uuid.UUID, name: str) -> User:
    """Set a chosen Display name. Clears `name_is_default`, so the next Takeover or
    Transfer notice names this user (#109)."""
    name = normalize_name(name)
    user = get_user(db, user_id=user_id)

    user.name = name
    user.name_is_default = False
    db.flush()

    return user


def update_user(
    db: Session,
    *,
    actor_role: UserRole,
    user_id: uuid.UUID,
    email: str | None,
    role: UserRole | None,
    is_active: bool | None,
    name: str | None,
    now: datetime,
) -> User:
    """`now` dates the revocation of the user's links when `email` changes address."""
    user = get_user(db, user_id=user_id)

    # Both directions. An admin may not promote anyone to developer (#13), and may not write to
    # an existing developer at all.
    if actor_role is not UserRole.DEVELOPER and (
        role is UserRole.DEVELOPER or user.role is UserRole.DEVELOPER
    ):
        raise RoleNotPermitted

    # Validated before anything is written, so a refused name leaves the row untouched.
    name = normalize_name(name) if name is not None else None

    if email is not None:
        normalized_email = normalise_email(email)
        clash = db.scalars(select(User).where(User.email == normalized_email)).first()

        if clash is not None and clash.id != user.id:
            raise EmailTaken

        # Every live link was sent to the old address; an unchanged address is not a change.
        if normalized_email != user.email:
            revoke_links_for_user(db, user_id=user.id, now=now)

        user.email = normalized_email

    if name is not None:
        user.name = name
        user.name_is_default = False

    if role is not None:
        _assert_role_fits_profile(role=role, has_profile=user.profile is not None)
        user.role = role

    if is_active is not None:
        user.is_active = is_active

    db.flush()

    return user


def deactivate_user(db: Session, *, actor_role: UserRole, user_id: uuid.UUID) -> User:
    """Soft delete. Same boundary as `update_user`: an admin cannot deactivate a developer,
    because locking the super-user out is the same breach as editing them."""
    user = get_user(db, user_id=user_id)

    if user.role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    user.is_active = False
    db.flush()

    return user


def invite_user(
    db: Session, *, actor_role: UserRole, actor_name: str, user_id: uuid.UUID, now: datetime
) -> User:
    """Issue the user a single-use Invite link and email it, naming `actor_name` as the sender.

    Every check runs before anything is written. The link row and the send share a savepoint:
    a send that raises (`MailServiceError`) unwinds the row and the revocation of the older
    links, and the exception reaches the caller with nothing kept.

    The user row is locked for the transaction, so two Invites at once (a double-clicked
    Resend, two Admins) run one after the other and the second revokes the first's link: at
    most one live Invite, as `password_link_service` promises.
    """
    user = db.scalars(select(User).where(User.id == user_id).with_for_update()).first()

    if user is None:
        raise UserNotFound

    if user.role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    if user.hashed_password is not None:
        raise UserHasPassword

    if not user.is_active:
        raise UserInactive

    with db.begin_nested():
        _link, token = issue_link(db, user=user, purpose=PasswordLinkPurpose.INVITE, now=now)
        rendered = invite_email(
            name=user.name,
            actor_name=actor_name,
            link=public_url(f"{SET_PASSWORD_PATH}?token={token}"),
        )
        send_email(to=user.email, subject=rendered.subject, text=rendered.text, html=rendered.html)

    return user


def _assert_create_shape(*, role: UserRole, has_profile_input: bool) -> None:
    """Exactly: a Tutor or Manager comes with a `tutor` input, any other role without one.
    `TutorScope` refuses a Tutor with no profile, and that row must not be manufactured here."""
    if (role in PROFILE_ROLES) != has_profile_input:
        raise InvalidUserShape


def _assert_role_fits_profile(*, role: UserRole, has_profile: bool) -> None:
    """A change to Tutor or Manager needs the profile to be there already: a `PATCH` never
    creates one. A change to Admin or Developer keeps the profile the person has, so the
    bookings, availability and subjects on it survive a demotion back (#130)."""
    if role in PROFILE_ROLES and not has_profile:
        raise InvalidUserShape
