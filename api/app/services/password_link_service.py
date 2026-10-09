"""The rows behind emailed password links: issue, look up, revoke.

Same transaction contract as `auth_service`: nothing here commits, the caller owns the
boundary. Only the SHA-256 of a token is stored; the plaintext is returned once, to the caller
that puts it in an email, and never read back from anywhere.

A link is **live** when `used_at IS NULL AND revoked_at IS NULL AND expires_at > now`. `now`
is passed in by the router (`datetime.now(UTC)`) rather than read here, so a test can freeze
time without a database clock. A user holds at most one live link per purpose: issuing a new
one revokes the others, so a resent Invite replaces the earlier email's link.
"""

import hashlib
import secrets
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, func, select, update
from sqlalchemy.orm import Session

from app.models.password_link import PasswordLink, PasswordLinkPurpose
from app.models.user import User

INVITE_TTL = timedelta(days=7)
RESET_TTL = timedelta(hours=48)
TOKEN_BYTES = 32

_TTL_BY_PURPOSE = {
    PasswordLinkPurpose.INVITE: INVITE_TTL,
    PasswordLinkPurpose.RESET: RESET_TTL,
}


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
    """The live link `token` names, or None: unknown, used, revoked and expired look alike."""
    return db.scalars(
        select(PasswordLink).where(PasswordLink.token_hash == hash_token(token), _is_live(now))
    ).first()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _is_live(now: datetime) -> ColumnElement[bool]:
    return (
        PasswordLink.used_at.is_(None)
        & PasswordLink.revoked_at.is_(None)
        & (PasswordLink.expires_at > now)
    )
