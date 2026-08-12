"""Unit tests for password hashing and JWT primitives. No database, no fixtures."""

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from app.config import get_settings
from app.models.enums import UserRole
from app.security import (
    ACCESS_TOKEN_TYPE,
    DUMMY_PASSWORD_HASH,
    MAX_PASSWORD_BYTES,
    REFRESH_TOKEN_TYPE,
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    password_is_encodable,
    verify_password,
)


def _encode(claims: dict, *, key: str | None = None) -> str:
    settings = get_settings()
    return jwt.encode(claims, key or settings.secret_key, algorithm=settings.jwt_algorithm)


def _base_access_claims(**overrides: object) -> dict:
    now = datetime.now(UTC)
    claims = {
        "sub": str(uuid.uuid4()),
        "role": UserRole.ADMIN.value,
        "tutor_id": None,
        "typ": ACCESS_TOKEN_TYPE,
        "jti": str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=15)).timestamp()),
    }
    claims.update(overrides)
    return claims


def test_hash_verifies_against_its_own_plaintext() -> None:
    hashed = hash_password("correct horse battery staple")

    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("Correct horse battery staple", hashed) is False


def test_hashes_of_the_same_plaintext_differ_but_both_verify() -> None:
    first = hash_password("same-password")
    second = hash_password("same-password")

    assert first != second
    assert verify_password("same-password", first) is True
    assert verify_password("same-password", second) is True


def test_verify_password_returns_false_for_a_malformed_hash() -> None:
    assert verify_password("x", "not-a-hash") is False
    assert verify_password("x", "") is False


def test_dummy_hash_is_a_usable_bcrypt_hash_matching_nothing_obvious() -> None:
    assert DUMMY_PASSWORD_HASH.startswith("$2")
    assert verify_password("", DUMMY_PASSWORD_HASH) is False


def test_password_is_encodable_counts_bytes_not_characters() -> None:
    assert password_is_encodable("a" * MAX_PASSWORD_BYTES) is True
    assert password_is_encodable("a" * (MAX_PASSWORD_BYTES + 1)) is False

    # "é" is two bytes in UTF-8: 36 characters, 72 bytes.
    assert password_is_encodable("é" * 36) is True
    assert password_is_encodable("é" * 36 + "a") is False


def test_hash_password_rejects_an_over_long_password_rather_than_truncating() -> None:
    with pytest.raises(ValueError):
        hash_password("a" * (MAX_PASSWORD_BYTES + 1))


def test_access_token_round_trips_subject_role_and_tutor_id() -> None:
    user_id = uuid.uuid4()
    tutor_id = uuid.uuid4()

    claims = decode_token(
        create_access_token(user_id=user_id, role=UserRole.TUTOR, tutor_id=tutor_id),
        expected_type=ACCESS_TOKEN_TYPE,
    )

    assert claims.subject == user_id
    assert claims.role is UserRole.TUTOR
    assert claims.tutor_id == tutor_id
    assert claims.token_type == ACCESS_TOKEN_TYPE
    assert claims.family_id is None
    assert claims.expires_at > datetime.now(UTC)


def test_access_token_round_trips_a_null_tutor_id() -> None:
    user_id = uuid.uuid4()

    claims = decode_token(
        create_access_token(user_id=user_id, role=UserRole.ADMIN, tutor_id=None),
        expected_type=ACCESS_TOKEN_TYPE,
    )

    assert claims.subject == user_id
    assert claims.role is UserRole.ADMIN
    assert claims.tutor_id is None


def test_refresh_token_round_trips_jti_family_and_expiry() -> None:
    user_id, jti, family_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()

    token, expires_at = create_refresh_token(user_id=user_id, jti=jti, family_id=family_id)
    claims = decode_token(token, expected_type=REFRESH_TOKEN_TYPE)

    assert claims.subject == user_id
    assert claims.jti == jti
    assert claims.family_id == family_id
    assert claims.role is None
    assert expires_at.tzinfo is not None
    assert claims.expires_at == expires_at
    assert timedelta(days=6) < expires_at - datetime.now(UTC) <= timedelta(days=7)


def test_refresh_token_is_rejected_where_an_access_token_is_expected() -> None:
    token, _ = create_refresh_token(user_id=uuid.uuid4(), jti=uuid.uuid4(), family_id=uuid.uuid4())

    with pytest.raises(TokenError):
        decode_token(token, expected_type=ACCESS_TOKEN_TYPE)


def test_access_token_is_rejected_where_a_refresh_token_is_expected() -> None:
    token = create_access_token(user_id=uuid.uuid4(), role=UserRole.ADMIN, tutor_id=None)

    with pytest.raises(TokenError):
        decode_token(token, expected_type=REFRESH_TOKEN_TYPE)


def test_token_signed_with_another_secret_is_rejected() -> None:
    token = _encode(_base_access_claims(), key="a-different-secret-key")

    with pytest.raises(TokenError):
        decode_token(token, expected_type=ACCESS_TOKEN_TYPE)


def test_expired_token_is_rejected() -> None:
    past = datetime.now(UTC) - timedelta(minutes=30)
    token = _encode(
        _base_access_claims(
            iat=int(past.timestamp()),
            exp=int((past + timedelta(minutes=15)).timestamp()),
        )
    )

    with pytest.raises(TokenError):
        decode_token(token, expected_type=ACCESS_TOKEN_TYPE)


def test_garbage_string_is_rejected() -> None:
    with pytest.raises(TokenError):
        decode_token("not.a.token", expected_type=ACCESS_TOKEN_TYPE)


def test_token_missing_a_required_claim_is_rejected() -> None:
    claims = _base_access_claims()
    del claims["jti"]

    with pytest.raises(TokenError):
        decode_token(_encode(claims), expected_type=ACCESS_TOKEN_TYPE)


def test_token_with_an_unparseable_uuid_is_rejected() -> None:
    token = _encode(_base_access_claims(sub="not-a-uuid"))

    with pytest.raises(TokenError):
        decode_token(token, expected_type=ACCESS_TOKEN_TYPE)


def test_access_token_with_an_unknown_role_is_rejected() -> None:
    token = _encode(_base_access_claims(role="superuser"))

    with pytest.raises(TokenError):
        decode_token(token, expected_type=ACCESS_TOKEN_TYPE)


def test_refresh_token_missing_its_family_claim_is_rejected() -> None:
    now = datetime.now(UTC)
    token = _encode(
        {
            "sub": str(uuid.uuid4()),
            "typ": REFRESH_TOKEN_TYPE,
            "jti": str(uuid.uuid4()),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=7)).timestamp()),
        }
    )

    with pytest.raises(TokenError):
        decode_token(token, expected_type=REFRESH_TOKEN_TYPE)
