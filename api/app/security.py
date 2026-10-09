import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from app.config import get_settings
from app.models.enums import UserRole

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"

# bcrypt only consumes the first 72 bytes of a password; anything beyond is silently
# discarded, which would make two different long passwords interchangeable. We reject instead.
MAX_PASSWORD_BYTES = 72
# The floor every password a user chooses (CLI seed, Invite, reset) must clear.
MIN_PASSWORD_LENGTH = 8


class TokenError(Exception):
    pass


@dataclass(frozen=True)
class TokenClaims:
    subject: uuid.UUID
    token_type: str
    jti: uuid.UUID
    expires_at: datetime
    role: UserRole | None = None
    tutor_id: uuid.UUID | None = None
    family_id: uuid.UUID | None = None


def hash_password(plain: str) -> str:
    if not password_is_encodable(plain):
        raise ValueError(f"password exceeds {MAX_PASSWORD_BYTES} bytes")
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        matches = bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # A corrupt or non-bcrypt hash is a failed login, not a 500.
        matches = False

    return matches


def password_is_encodable(plain: str) -> bool:
    return len(plain.encode("utf-8")) <= MAX_PASSWORD_BYTES


# Verified against when a login names an unknown user, so that the response time does not
# reveal whether the account exists. The plaintext is arbitrary and matches no real password.
DUMMY_PASSWORD_HASH = hash_password("tutorlink-dummy-password")


def create_access_token(*, user_id: uuid.UUID, role: UserRole, tutor_id: uuid.UUID | None) -> str:
    settings = get_settings()
    issued_at = datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=settings.access_token_expire_minutes)
    claims = {
        "sub": str(user_id),
        "role": role.value,
        "tutor_id": str(tutor_id) if tutor_id is not None else None,
        "typ": ACCESS_TOKEN_TYPE,
        "jti": str(uuid.uuid4()),
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return _encode(claims)


def create_refresh_token(
    *, user_id: uuid.UUID, jti: uuid.UUID, family_id: uuid.UUID
) -> tuple[str, datetime]:
    settings = get_settings()
    issued_at = datetime.now(UTC)
    expires_at = issued_at + timedelta(days=settings.refresh_token_expire_days)
    claims = {
        "sub": str(user_id),
        "typ": REFRESH_TOKEN_TYPE,
        "jti": str(jti),
        "fid": str(family_id),
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    # The expiry is returned rather than re-derived: the revocation row and the cookie
    # Max-Age must agree with the signed `exp` exactly.
    return _encode(claims), datetime.fromtimestamp(claims["exp"], tz=UTC)


def decode_token(token: str, *, expected_type: str) -> TokenClaims:
    settings = get_settings()
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["sub", "exp", "iat", "typ", "jti"]},
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc

    token_type = payload["typ"]
    if token_type != expected_type:
        # Without this, a seven-day refresh token would be accepted as an access token.
        raise TokenError(f"expected a {expected_type} token, got {token_type}")

    subject = _require_uuid(payload["sub"], "sub")
    jti = _require_uuid(payload["jti"], "jti")
    expires_at = datetime.fromtimestamp(payload["exp"], tz=UTC)

    if token_type == ACCESS_TOKEN_TYPE:
        claims = TokenClaims(
            subject=subject,
            token_type=token_type,
            jti=jti,
            expires_at=expires_at,
            role=_require_role(payload.get("role")),
            tutor_id=_optional_uuid(payload.get("tutor_id"), "tutor_id"),
        )
    else:
        claims = TokenClaims(
            subject=subject,
            token_type=token_type,
            jti=jti,
            expires_at=expires_at,
            family_id=_require_uuid(payload.get("fid"), "fid"),
        )

    return claims


def _encode(claims: dict[str, Any]) -> str:
    settings = get_settings()
    return jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)


def _require_uuid(value: Any, claim: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except (ValueError, AttributeError, TypeError) as exc:
        raise TokenError(f"claim {claim} is not a UUID") from exc


def _optional_uuid(value: Any, claim: str) -> uuid.UUID | None:
    if value is None:
        parsed = None
    else:
        parsed = _require_uuid(value, claim)

    return parsed


def _require_role(value: Any) -> UserRole:
    try:
        return UserRole(value)
    except ValueError as exc:
        raise TokenError("claim role is not a known role") from exc
