"""The rows behind emailed password links: issue, look up, revoke.

Same transaction contract as `auth_service`: nothing here commits, the caller owns the
boundary. Only the SHA-256 of a token is stored; the plaintext is returned once, to the caller
that puts it in an email, and never read back from anywhere.

A link is **live** when `used_at IS NULL AND revoked_at IS NULL AND expires_at > now`. `now`
is passed in by the router (`datetime.now(UTC)`) rather than read here, so a test can freeze
time without a database clock. A user holds at most one live link per purpose: issuing a new
one revokes the others, so a resent Invite replaces the earlier email's link.

**Lock order: the user row, then the link rows.** `user_service.invite_user` and `update_user`
lock the user `FOR UPDATE` before touching their links, and `set_password_with_link` does the
same, so two of them running at once queue on the user row instead of deadlocking on each
other's link rows.
"""

import hashlib
import logging
import secrets
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.orm import Session

from app.models.password_link import PasswordLink, PasswordLinkPurpose
from app.models.user import User
from app.security import MIN_PASSWORD_LENGTH, hash_password, password_is_encodable
from app.services.auth_service import revoke_all_refresh_tokens_for_user

INVITE_TTL = timedelta(days=7)
RESET_TTL = timedelta(hours=48)
TOKEN_BYTES = 32

_TTL_BY_PURPOSE = {
    PasswordLinkPurpose.INVITE: INVITE_TTL,
    PasswordLinkPurpose.RESET: RESET_TTL,
}

logger = logging.getLogger(__name__)


class PasswordLinkError(Exception):
    """Base class for every failure this module reports."""


class InvalidPassword(PasswordLinkError):
    """The chosen password is too short or too long to store."""


class InvalidLink(PasswordLinkError):
    """No live link for that token, or its user may no longer use it.

    Deliberately one type for every refusal (unknown, used, revoked, expired, inactive user,
    address changed since the send): the router turns it into a single 400 with a single
    message, so the response never says whether a token exists.
    """


def issue_link(
    db: Session, *, user: User, purpose: PasswordLinkPurpose, now: datetime
) -> tuple[PasswordLink, str]:
    """A new live link for `user`, replacing their other live links of that purpose.

    Returns the row and the plaintext token, which exists nowhere else.
    """
    revoke_links_for_user(db, user_id=user.id, now=now, purpose=purpose)

    token = secrets.token_urlsafe(TOKEN_BYTES)
    link = PasswordLink(
        user_id=user.id,
        purpose=purpose,
        token_hash=hash_token(token),
        email=user.email,
        expires_at=now + _TTL_BY_PURPOSE[purpose],
    )
    db.add(link)
    db.flush()

    return link, token


def live_invite_expiry(db: Session, *, user_id: uuid.UUID, now: datetime) -> datetime | None:
    """When the user's live Invite expires, or None when they hold none."""
    return live_invite_expiries(db, user_ids=[user_id], now=now).get(user_id)


def live_invite_expiries(
    db: Session, *, user_ids: Iterable[uuid.UUID], now: datetime
) -> dict[uuid.UUID, datetime]:
    """The live Invite expiry of every user in `user_ids` that holds one, in one query."""
    ids = list(user_ids)

    if not ids:
        return {}

    rows = db.execute(
        select(PasswordLink.user_id, func.max(PasswordLink.expires_at))
        .where(
            PasswordLink.user_id.in_(ids),
            PasswordLink.purpose == PasswordLinkPurpose.INVITE,
            _is_live(now),
        )
        .group_by(PasswordLink.user_id)
    ).all()

    return {user_id: expires_at for user_id, expires_at in rows}


def revoke_links_for_user(
    db: Session,
    *,
    user_id: uuid.UUID,
    now: datetime,
    purpose: PasswordLinkPurpose | None = None,
) -> None:
    """Revoke the user's live links: of one purpose, or of both when `purpose` is None."""
    statement = (
        update(PasswordLink)
        .where(PasswordLink.user_id == user_id, _is_live(now))
        .values(revoked_at=now)
    )

    if purpose is not None:
        statement = statement.where(PasswordLink.purpose == purpose)

    db.execute(statement)


def find_live_link(db: Session, *, token: str, now: datetime) -> PasswordLink | None:
    """The live link `token` names, locked for the transaction, or None: unknown, used, revoked
    and expired look alike.

    `FOR UPDATE` so that two submits of one token run one after the other: the second waits
    on the row, then re-checks the liveness predicate against the first's commit and sees
    `used_at` set.
    """
    return db.scalars(
        select(PasswordLink)
        .where(PasswordLink.token_hash == hash_token(token), _is_live(now))
        .with_for_update()
    ).first()


def set_password_with_link(db: Session, *, token: str, password: str, now: datetime) -> User:
    """Spend the link `token` names and store `password` on its user; returns that user.

    The password is checked before the link is looked up, so a refused password spends
    nothing. A reset signs the user out everywhere else (every refresh token revoked); an
    Invite's user has no sessions, so the same call is a no-op there.
    """
    if len(password) < MIN_PASSWORD_LENGTH or not password_is_encodable(password):
        raise InvalidPassword

    # The user row is locked before the link row (module docstring), found through the hash
    # without a lock first. Nothing is decided from this read: `find_live_link` re-reads the
    # row under its lock.
    user_id = db.scalar(
        select(PasswordLink.user_id).where(PasswordLink.token_hash == hash_token(token))
    )
    user = (
        db.scalars(select(User).where(User.id == user_id).with_for_update()).first()
        if user_id is not None
        else None
    )
    link = find_live_link(db, token=token, now=now)

    if link is None or user is None:
        logger.warning("password_link.set_password: no live link for the token")
        raise InvalidLink

    if not user.is_active:
        logger.warning("password_link.set_password: user %s is inactive", user.id)
        raise InvalidLink

    # The address changed since the mail went out: whoever reads the old inbox is not the user.
    if user.email != link.email:
        logger.warning("password_link.set_password: link %s was sent to an old address", link.id)
        raise InvalidLink

    user.hashed_password = hash_password(password)
    link.used_at = now
    db.flush()
    revoke_links_for_user(db, user_id=user.id, now=now, purpose=link.purpose)

    if link.purpose is PasswordLinkPurpose.RESET:
        revoke_all_refresh_tokens_for_user(db, user_id=user.id)

    return user


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _is_live(now: datetime) -> ColumnElement[bool]:
    return (
        PasswordLink.used_at.is_(None)
        & PasswordLink.revoked_at.is_(None)
        & (PasswordLink.expires_at > now)
    )
