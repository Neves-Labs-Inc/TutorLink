"""Credential checking and the refresh-token lifecycle.

Every rule about logging in, rotating, and revoking lives here so that the `/auth` router is a
thin HTTP shell. This module knows nothing about FastAPI, status codes, or cookies; it raises
the domain exceptions below and the router maps them.

**Transaction contract — read this before calling.** Nothing here commits: the caller owns the
transaction boundary. That includes the failure paths. `rotate_refresh_token` writes the
family revocation *and then raises* `RefreshTokenReused`, so a caller that only commits on the
success path will roll the revocation back and the whole reuse defence silently does nothing.
`revoke_family_for_token` likewise writes and returns without committing.
"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import (
    DUMMY_PASSWORD_HASH,
    REFRESH_TOKEN_TYPE,
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    password_is_encodable,
    verify_password,
)


class AuthError(Exception):
    """Base class for every failure this module reports."""


class InvalidCredentials(AuthError):
    """Unknown account, wrong password, inactive account, or an unusable password.

    Deliberately one type for all four: the router turns it into a single 401 with a single
    message, so the response never distinguishes "no such account" from "wrong password".
    """


class InvalidRefreshToken(AuthError):
    """The presented refresh token was malformed, unknown, expired, or its user is gone."""


class RefreshTokenReused(InvalidRefreshToken):
    """An already-rotated refresh token was presented; its whole family has been revoked."""


@dataclass(frozen=True)
class IssuedTokens:
    access_token: str
    refresh_token: str
    refresh_expires_at: datetime


def normalise_email(email: str) -> str:
    """The one spelling of an address that identifies an account.

    D-028: the users.email unique constraint is case-sensitive, so normalising here is what
    makes "Admin@X" and "admin@x" the same account. The seed command normalises identically.

    A function rather than an expression inlined below because `rate_limit_service` has to
    bucket failed attempts under exactly this spelling. A second copy of `.strip().lower()`
    there would be free to drift, and the day it did, varying the casing would give an attacker
    a fresh per-account budget for every spelling they cared to type.
    """
    return email.strip().lower()


def authenticate_user(db: Session, *, email: str, password: str) -> User:
    if not password_is_encodable(password):
        # bcrypt consumes only the first 72 bytes of a password. Without this guard a longer
        # password could authenticate on its prefix alone, so anyone knowing the first 72
        # bytes would be in. Rejected before any hash is computed.
        raise InvalidCredentials("password exceeds the maximum encodable length")

    normalised = normalise_email(email)
    user = db.execute(select(User).where(User.email == normalised)).scalar_one_or_none()

    if user is None:
        # Verify against a throwaway hash anyway. Skipping the bcrypt round on a miss makes
        # "no such account" measurably faster than "wrong password" and turns the login
        # endpoint into an account-enumeration oracle. This is not optional.
        verify_password(password, DUMMY_PASSWORD_HASH)
        raise InvalidCredentials("no account for that email")

    # Checked before is_active so that an inactive account costs the same bcrypt round as an
    # active one and the two stay indistinguishable from outside. A user with no password (a
    # Tutor the office created without a login) pays the same round against the dummy hash
    # and fails like a wrong password.
    if not verify_password(password, user.hashed_password or DUMMY_PASSWORD_HASH):
        raise InvalidCredentials("password does not match")

    if user.hashed_password is None:
        raise InvalidCredentials("account has no password")

    if not user.is_active:
        raise InvalidCredentials("account is not active")

    return user


def issue_token_pair(db: Session, *, user: User) -> IssuedTokens:
    """Start a new token family. Each independent login gets its own, so a logout on one
    device leaves the other devices' families untouched."""
    _row, issued = _mint(db, user=user, family_id=uuid.uuid4())
    return issued


def rotate_refresh_token(db: Session, *, presented: str) -> IssuedTokens:
    try:
        claims = decode_token(presented, expected_type=REFRESH_TOKEN_TYPE)
    except TokenError as exc:
        raise InvalidRefreshToken(str(exc)) from exc

    # Locked for the rest of the transaction: two concurrent refreshes presenting the same
    # token would otherwise both read revoked_at IS NULL and both rotate, leaving two live
    # tokens in one family and no replay to detect. The second waiter sees the revoked row.
    row = db.execute(
        select(RefreshToken).where(RefreshToken.id == claims.jti).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        raise InvalidRefreshToken("no such refresh token")

    if row.revoked_at is not None:
        # This token has already been rotated past. Either the legitimate holder replayed an
        # old token, or an attacker stole one and the legitimate holder has since rotated.
        # The two are indistinguishable from here, so the safe action is to invalidate the
        # whole chain and force a fresh login — the OAuth 2.0 BCP response, and the reason
        # the revocation table exists at all.
        _revoke_family(db, family_id=row.family_id)
        raise RefreshTokenReused("refresh token replayed; family revoked")

    if row.expires_at <= datetime.now(UTC):
        # decode_token already enforced the signed `exp`; the row is the authority on liveness.
        raise InvalidRefreshToken("refresh token has expired")

    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        # What makes deactivating an account stop it refreshing, rather than letting it
        # survive for the remaining seven days of the refresh lifetime.
        raise InvalidRefreshToken("account is missing or not active")

    # The new access token is minted from the user's current role and profile, re-read here,
    # never carried over from the presented token — a refresh token carries no role for
    # exactly this reason.
    new_row, issued = _mint(db, user=user, family_id=row.family_id)

    # Ordered after the insert: replaced_by_id is a foreign key onto the row just written.
    row.revoked_at = datetime.now(UTC)
    row.replaced_by_id = new_row.id
    db.flush()

    return issued


def revoke_family_for_token(db: Session, *, presented: str) -> None:
    """Best-effort logout: revoke the presented token's whole family.

    Never raises. An absent, malformed, expired, or unknown token is a silent no-op, because
    logout must be idempotent and must not tell an unauthenticated caller whether the token it
    supplied was real.
    """
    try:
        claims = decode_token(presented, expected_type=REFRESH_TOKEN_TYPE)
    except TokenError:
        claims = None

    row = db.get(RefreshToken, claims.jti) if claims is not None else None

    if row is not None:
        _revoke_family(db, family_id=row.family_id)


def revoke_all_refresh_tokens_for_user(db: Session, *, user_id: uuid.UUID) -> None:
    """Sign the user out everywhere: every live refresh token of theirs, across all families.

    What a password reset does to the sessions the old password opened. Access tokens already
    issued run to their own expiry; only refresh is cut off.
    """
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
        .execution_options(synchronize_session="fetch")
    )
    db.flush()


def _mint(db: Session, *, user: User, family_id: uuid.UUID) -> tuple[RefreshToken, IssuedTokens]:
    jti = uuid.uuid4()
    refresh_token, refresh_expires_at = create_refresh_token(
        user_id=user.id, jti=jti, family_id=family_id
    )
    row = RefreshToken(
        id=jti,
        user_id=user.id,
        family_id=family_id,
        expires_at=refresh_expires_at,
    )
    db.add(row)
    db.flush()

    access_token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return row, IssuedTokens(
        access_token=access_token,
        refresh_token=refresh_token,
        refresh_expires_at=refresh_expires_at,
    )


def _revoke_family(db: Session, *, family_id: uuid.UUID) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
        .execution_options(synchronize_session="fetch")
    )
    db.flush()
