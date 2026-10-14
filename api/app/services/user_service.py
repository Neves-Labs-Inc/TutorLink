"""User account CRUD, and the rules that keep `developer` out of an admin's reach.

Same transaction contract as `auth_service`: nothing here commits, the caller owns the
boundary.

**The developer boundary is three rules.** An admin may not create a `developer`, may not
change anyone's role to `developer`, and may not write to an existing developer account at all
(email, name, role, active flag, and later invites). A developer may do all of it.

**Peer admins are developer-only too (#173).** An admin may not update, deactivate or send a
reset link to another admin. Otherwise an admin could set a peer's email to an address they
control, send a reset link there and take the account over. The check reads the target's
*current* role, so demoting the peer to Tutor, editing them and promoting them back is refused at
its first step. An Invite to a peer admin is allowed: it only works for an account that has never
had a password, and goes to an address the inviter can no longer change, so it is no takeover;
and it keeps "admins create admins" workable. Promoting a Tutor or Manager to Admin is still
allowed, since that target is not an admin yet.

**An admin may not change their own role or deactivate themselves.** Their own email and name are
theirs to edit, and re-sending an unchanged role while staying active passes (the dashboard sends
every field). With peer admins out of reach, an admin demoting or deactivating themselves could
leave the office with no admin at all. Developers are exempt.

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
from app.services.mail_templates import (
    ACTOR_NAME_PLACEHOLDER,
    LINK_PLACEHOLDER,
    NAME_PLACEHOLDER,
    TemplateKind,
    render_email,
)
from app.services.name_rules import normalize_name
from app.services.password_link_service import issue_link, revoke_links_for_user
from app.services.settings_service import read_email_template
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


class PeerAdminNotPermitted(UserServiceError):
    """An admin writing to another admin's account; only a developer may (#173)."""


class SelfChangeNotPermitted(UserServiceError):
    """An admin changing their own role or deactivating themselves (#173)."""


class ProfileAlreadyLinked(UserServiceError):
    """`tutor_id` named a profile; every profile already has its user."""


class InvalidUserShape(UserServiceError):
    """A Tutor or Manager with no profile, or an Admin or Developer with one."""


class UserHasPassword(UserServiceError):
    """An Invite for a user who can already sign in."""


class UserInactive(UserServiceError):
    """An Invite or reset link for a deactivated user (answers 04 #3)."""


class UserHasNoPassword(UserServiceError):
    """A reset link for a user who has never set a password: an Invite is their way in."""


def _visible(is_archived: bool) -> Select[tuple[User]]:
    return select(User).where(User.is_archived.is_(is_archived))


def list_users(
    db: Session, *, is_archived: bool, limit: int, offset: int
) -> tuple[list[User], int]:
    """Rows for one page, plus the total matching before paging.

    Active by default and archived only when asked for, uniform across every
    resource (#21). `total` counts matches rather than returned rows — that difference is what
    the page envelope exists to report.
    """
    total = db.scalar(select(func.count()).select_from(_visible(is_archived).subquery())) or 0
    users = list(
        db.scalars(
            _visible(is_archived)
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
        is_archived=False,
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
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
    email: str | None,
    role: UserRole | None,
    is_archived: bool | None,
    name: str | None,
    now: datetime,
) -> User:
    """`now` dates the revocation of the user's links when `email` changes address.

    The user row is locked first, as `invite_user` does, so an edit and an Invite running at
    once take the user row and then the link rows in the same order rather than deadlocking.
    """
    user = _lock_user(db, user_id=user_id)

    # An admin may not promote anyone to developer (#13); the target's side is checked below.
    if role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    _assert_may_write(actor_role=actor_role, actor_id=actor_id, target=user)

    is_self_admin = actor_role is UserRole.ADMIN and user.id == actor_id
    changes_own_role = role is not None and role is not user.role

    if is_self_admin and (changes_own_role or is_archived is True):
        logger.warning("user_service.update_user: admin %s changing own role or active", actor_id)
        raise SelfChangeNotPermitted

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

    if is_archived is not None:
        user.is_archived = is_archived

    db.flush()

    return user


def deactivate_user(
    db: Session, *, actor_role: UserRole, actor_id: uuid.UUID, user_id: uuid.UUID
) -> User:
    """Soft delete. Same boundary as `update_user`: an admin cannot deactivate a developer or a
    peer admin, because locking someone out is the same breach as editing them, and cannot
    deactivate themselves.

    The row is locked like `update_user`'s, so a concurrent promotion cannot land between the
    role check and the write."""
    user = _lock_user(db, user_id=user_id)

    _assert_may_write(actor_role=actor_role, actor_id=actor_id, target=user)

    if actor_role is UserRole.ADMIN and user.id == actor_id:
        logger.warning("user_service.deactivate_user: admin %s deactivating self", actor_id)
        raise SelfChangeNotPermitted

    user.is_archived = True
    db.flush()

    return user


def invite_user(
    db: Session,
    *,
    actor_role: UserRole,
    actor_id: uuid.UUID,
    actor_name: str,
    user_id: uuid.UUID,
    now: datetime,
) -> User:
    """Issue the user a single-use Invite link and email it, naming `actor_name` as the sender.

    Every check runs before anything is written. The link row and the send share a savepoint:
    a send that raises (`MailServiceError`) unwinds the row and the revocation of the older
    links, and the exception reaches the caller with nothing kept.

    The user row is locked for the transaction, so two Invites at once (a double-clicked
    Resend, two Admins) run one after the other and the second revokes the first's link: at
    most one live Invite, as `password_link_service` promises.
    """
    user = _lock_user(db, user_id=user_id)

    # A peer admin may be invited: see the module docstring.
    _assert_may_write(actor_role=actor_role, actor_id=actor_id, target=user, allows_peer_admin=True)

    if user.hashed_password is not None:
        raise UserHasPassword

    if user.is_archived:
        raise UserInactive

    template = read_email_template(db, kind=TemplateKind.INVITE)

    with db.begin_nested():
        _link, token = issue_link(db, user=user, purpose=PasswordLinkPurpose.INVITE, now=now)
        rendered = render_email(
            TemplateKind.INVITE,
            subject=template.subject,
            body=template.body,
            values={
                NAME_PLACEHOLDER: user.name,
                ACTOR_NAME_PLACEHOLDER: actor_name,
                LINK_PLACEHOLDER: public_url(f"{SET_PASSWORD_PATH}?token={token}"),
            },
            brand_color=template.brand_color,
        )
        send_email(to=user.email, subject=rendered.subject, text=rendered.text, html=rendered.html)

    return user


def send_password_reset(
    db: Session, *, actor_role: UserRole, actor_id: uuid.UUID, user_id: uuid.UUID, now: datetime
) -> User:
    """Issue the user a password reset link and email it, for an Admin helping them back in.

    Same shape as `invite_user`: the row is locked, every check runs before anything is
    written, and the link row and the send share a savepoint, so a `MailServiceError` reaches
    the caller with no link kept. Sending signs nobody out; completing the reset does
    (`set_password_with_link`).
    """
    user = _lock_user(db, user_id=user_id)

    _assert_may_write(actor_role=actor_role, actor_id=actor_id, target=user)

    if user.hashed_password is None:
        raise UserHasNoPassword

    if user.is_archived:
        raise UserInactive

    template = read_email_template(db, kind=TemplateKind.PASSWORD_RESET)

    with db.begin_nested():
        _link, token = issue_link(db, user=user, purpose=PasswordLinkPurpose.RESET, now=now)
        rendered = render_email(
            TemplateKind.PASSWORD_RESET,
            subject=template.subject,
            body=template.body,
            values={
                NAME_PLACEHOLDER: user.name,
                LINK_PLACEHOLDER: public_url(f"{SET_PASSWORD_PATH}?token={token}"),
            },
            brand_color=template.brand_color,
        )
        send_email(to=user.email, subject=rendered.subject, text=rendered.text, html=rendered.html)

    # The id, never the address.
    logger.info("user_service.send_password_reset: reset link sent to user %s", user.id)

    return user


def _lock_user(db: Session, *, user_id: uuid.UUID) -> User:
    """The user, locked `FOR NO KEY UPDATE` for the rest of the transaction.

    Not `FOR UPDATE`: that would block the `FOR KEY SHARE` a concurrent `refresh_tokens` insert
    takes on the user row and could deadlock against `/auth/refresh` (see
    `password_link_service`'s module docstring).
    """
    user = db.scalars(
        select(User).where(User.id == user_id).with_for_update(key_share=True)
    ).first()

    if user is None:
        raise UserNotFound

    return user


def _assert_may_write(
    *, actor_role: UserRole, actor_id: uuid.UUID, target: User, allows_peer_admin: bool = False
) -> None:
    """The developer boundary, then the peer-admin rule, both on the target's current role.
    `allows_peer_admin` is for the Invite only (see the module docstring)."""
    if target.role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise RoleNotPermitted

    is_peer_admin = (
        actor_role is UserRole.ADMIN and target.role is UserRole.ADMIN and target.id != actor_id
    )

    if is_peer_admin and not allows_peer_admin:
        logger.warning("user_service: admin %s refused a write to admin %s", actor_id, target.id)
        raise PeerAdminNotPermitted


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
