"""Auth service tests. These run against a live PostgreSQL via the `db` fixture, because
rotation, revocation, and reuse detection are database behaviour and cannot be proven against
metadata or a mock."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.refresh_token import RefreshToken
from app.models.tutor import Tutor
from app.models.user import User
from app.security import (
    ACCESS_TOKEN_TYPE,
    MAX_PASSWORD_BYTES,
    REFRESH_TOKEN_TYPE,
    decode_token,
    hash_password,
)
from app.services.auth_service import (
    InvalidCredentials,
    InvalidRefreshToken,
    RefreshTokenReused,
    authenticate_user,
    issue_token_pair,
    revoke_family_for_token,
    rotate_refresh_token,
)

PASSWORD = "correct horse battery staple"


def _make_tutor(db: Session, *, suffix: str = "a") -> Tutor:
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=f"+1555000{suffix}",
        email=f"tutor-{suffix}@example.com",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_user(
    db: Session,
    *,
    email: str = "admin@x.com",
    password: str = PASSWORD,
    role: UserRole = UserRole.ADMIN,
    tutor_id: uuid.UUID | None = None,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        display_name="Test User",
        hashed_password=hash_password(password),
        role=role,
        tutor_id=tutor_id,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def _family_of(refresh_token: str) -> uuid.UUID:
    family_id = decode_token(refresh_token, expected_type=REFRESH_TOKEN_TYPE).family_id
    assert family_id is not None
    return family_id


def _jti_of(refresh_token: str) -> uuid.UUID:
    return decode_token(refresh_token, expected_type=REFRESH_TOKEN_TYPE).jti


def _count_rows(db: Session, family_id: uuid.UUID, *, live_only: bool) -> int:
    """Counts rows by querying the database, never the identity map, so the assertion proves
    the UPDATE was actually emitted rather than that an attribute was set in Python."""
    db.expire_all()
    query = (
        select(func.count()).select_from(RefreshToken).where(RefreshToken.family_id == family_id)
    )
    if live_only:
        query = query.where(RefreshToken.revoked_at.is_(None))
    return db.execute(query).scalar_one()


# --- authenticate_user -------------------------------------------------------------------


def test_correct_credentials_return_the_user(db: Session) -> None:
    user = _make_user(db)

    assert authenticate_user(db, email="admin@x.com", password=PASSWORD).id == user.id


def test_wrong_password_unknown_email_and_inactive_user_raise_the_identical_type(
    db: Session,
) -> None:
    _make_user(db, email="admin@x.com")
    _make_user(db, email="dormant@x.com", is_active=False)

    raised = []
    for email, password in (
        ("admin@x.com", "not the password"),
        ("nobody@x.com", PASSWORD),
        ("dormant@x.com", PASSWORD),
    ):
        with pytest.raises(InvalidCredentials) as info:
            authenticate_user(db, email=email, password=password)
        raised.append(type(info.value))

    # One type for all three, so a caller cannot accidentally render three different responses.
    assert raised == [InvalidCredentials, InvalidCredentials, InvalidCredentials]


def test_email_lookup_ignores_case_and_surrounding_whitespace(db: Session) -> None:
    user = _make_user(db, email="admin@x.com")

    found = authenticate_user(db, email="  ADMIN@x.com ", password=PASSWORD)

    assert found.id == user.id


def test_password_over_the_byte_limit_is_rejected_rather_than_truncated(db: Session) -> None:
    at_limit = "a" * MAX_PASSWORD_BYTES
    over_limit = "a" * (MAX_PASSWORD_BYTES + 8)
    _make_user(db, email="long@x.com", password=at_limit)

    # The stored hash was produced from exactly 72 bytes, which is the prefix of `over_limit`.
    # bcrypt would match the two if it were handed the longer string; the service must not
    # give it the chance. (bcrypt 5 also refuses the long input — this keeps the rejection
    # deterministic and explicit rather than a library side effect.)
    with pytest.raises(InvalidCredentials):
        authenticate_user(db, email="long@x.com", password=over_limit)

    assert authenticate_user(db, email="long@x.com", password=at_limit).email == "long@x.com"


def test_a_password_longer_than_the_limit_can_never_be_stored() -> None:
    with pytest.raises(ValueError):
        hash_password("a" * (MAX_PASSWORD_BYTES + 1))


# --- issue_token_pair --------------------------------------------------------------------


def test_issue_token_pair_writes_exactly_one_live_row(db: Session) -> None:
    user = _make_user(db)

    issued = issue_token_pair(db, user=user)

    family_id = _family_of(issued.refresh_token)
    assert _count_rows(db, family_id, live_only=False) == 1
    assert _count_rows(db, family_id, live_only=True) == 1

    row = db.get(RefreshToken, _jti_of(issued.refresh_token))
    assert row is not None
    assert row.user_id == user.id
    assert row.family_id == family_id
    assert row.revoked_at is None
    assert row.replaced_by_id is None
    assert row.expires_at == issued.refresh_expires_at
    assert issued.refresh_expires_at.tzinfo is not None


def test_issued_access_token_carries_the_users_role_and_tutor_id(db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, email="t@x.com", role=UserRole.TUTOR, tutor_id=tutor.id)

    claims = decode_token(
        issue_token_pair(db, user=user).access_token, expected_type=ACCESS_TOKEN_TYPE
    )

    assert claims.subject == user.id
    assert claims.role is UserRole.TUTOR
    assert claims.tutor_id == tutor.id


# --- rotate_refresh_token ----------------------------------------------------------------


def test_a_single_rotation_revokes_the_old_row_and_links_it_to_the_new_one(
    db: Session,
) -> None:
    user = _make_user(db)
    first = issue_token_pair(db, user=user)

    second = rotate_refresh_token(db, presented=first.refresh_token)

    assert second.refresh_token != first.refresh_token
    assert second.access_token != first.access_token

    family_id = _family_of(first.refresh_token)
    assert _family_of(second.refresh_token) == family_id

    db.expire_all()
    old = db.get(RefreshToken, _jti_of(first.refresh_token))
    new = db.get(RefreshToken, _jti_of(second.refresh_token))
    assert old is not None and new is not None
    assert old.revoked_at is not None
    assert old.replaced_by_id == new.id
    assert new.revoked_at is None
    assert _count_rows(db, family_id, live_only=False) == 2
    assert _count_rows(db, family_id, live_only=True) == 1

    assert decode_token(second.access_token, expected_type=ACCESS_TOKEN_TYPE).role is user.role


def test_reuse_of_a_rotated_token_revokes_the_entire_family(db: Session) -> None:
    """REQ-02A. The assertions are on rows, not on the exception: a test that only asserted
    `pytest.raises(RefreshTokenReused)` would pass even if the family were never revoked."""
    user = _make_user(db)
    first = issue_token_pair(db, user=user)
    second = rotate_refresh_token(db, presented=first.refresh_token)
    third = rotate_refresh_token(db, presented=second.refresh_token)

    family_id = _family_of(first.refresh_token)
    # Three rows, and the newest is the one live token in the family.
    assert _count_rows(db, family_id, live_only=False) == 3
    assert _count_rows(db, family_id, live_only=True) == 1

    with pytest.raises(RefreshTokenReused):
        rotate_refresh_token(db, presented=first.refresh_token)

    # The whole chain is dead in the database, including `third`, which was live a moment ago.
    assert _count_rows(db, family_id, live_only=False) == 3
    assert _count_rows(db, family_id, live_only=True) == 0

    db.expire_all()
    for token in (first, second, third):
        row = db.get(RefreshToken, _jti_of(token.refresh_token))
        assert row is not None
        assert row.revoked_at is not None

    # And the sibling that was still valid before the replay no longer rotates.
    with pytest.raises(InvalidRefreshToken):
        rotate_refresh_token(db, presented=third.refresh_token)

    assert _count_rows(db, family_id, live_only=True) == 0


def test_independent_logins_are_independent_families(db: Session) -> None:
    user = _make_user(db)
    phone = issue_token_pair(db, user=user)
    laptop = issue_token_pair(db, user=user)

    phone_family = _family_of(phone.refresh_token)
    laptop_family = _family_of(laptop.refresh_token)
    assert phone_family != laptop_family

    revoke_family_for_token(db, presented=phone.refresh_token)

    assert _count_rows(db, phone_family, live_only=True) == 0
    assert _count_rows(db, laptop_family, live_only=True) == 1

    with pytest.raises(InvalidRefreshToken):
        rotate_refresh_token(db, presented=phone.refresh_token)

    # Logging out on the phone must not log the laptop out.
    assert rotate_refresh_token(db, presented=laptop.refresh_token).refresh_token


def test_burning_one_family_by_reuse_leaves_the_other_family_usable(db: Session) -> None:
    user = _make_user(db)
    phone = issue_token_pair(db, user=user)
    laptop = issue_token_pair(db, user=user)
    rotate_refresh_token(db, presented=phone.refresh_token)

    with pytest.raises(RefreshTokenReused):
        rotate_refresh_token(db, presented=phone.refresh_token)

    assert _count_rows(db, _family_of(phone.refresh_token), live_only=True) == 0
    assert _count_rows(db, _family_of(laptop.refresh_token), live_only=True) == 1
    assert rotate_refresh_token(db, presented=laptop.refresh_token).refresh_token


def test_an_access_token_is_not_a_refresh_token(db: Session) -> None:
    user = _make_user(db)
    issued = issue_token_pair(db, user=user)

    with pytest.raises(InvalidRefreshToken) as info:
        rotate_refresh_token(db, presented=issued.access_token)

    assert not isinstance(info.value, RefreshTokenReused)


@pytest.mark.parametrize("presented", ["", "not.a.token", "garbage"])
def test_rotate_rejects_a_malformed_token(db: Session, presented: str) -> None:
    with pytest.raises(InvalidRefreshToken):
        rotate_refresh_token(db, presented=presented)


def test_rotate_rejects_a_well_formed_token_with_no_row(db: Session) -> None:
    user = _make_user(db)
    issued = issue_token_pair(db, user=user)
    row = db.get(RefreshToken, _jti_of(issued.refresh_token))
    assert row is not None
    db.delete(row)
    db.flush()

    with pytest.raises(InvalidRefreshToken):
        rotate_refresh_token(db, presented=issued.refresh_token)


def test_rotate_rejects_a_deactivated_user(db: Session) -> None:
    user = _make_user(db)
    issued = issue_token_pair(db, user=user)

    user.is_active = False
    db.flush()

    with pytest.raises(InvalidRefreshToken):
        rotate_refresh_token(db, presented=issued.refresh_token)

    # Rejected, but not treated as a replay: the family is left alone.
    assert _count_rows(db, _family_of(issued.refresh_token), live_only=True) == 1


def test_rotate_rejects_a_row_that_has_expired_even_though_the_jwt_has_not(
    db: Session,
) -> None:
    user = _make_user(db)
    issued = issue_token_pair(db, user=user)
    row = db.get(RefreshToken, _jti_of(issued.refresh_token))
    assert row is not None
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.flush()

    # The signed `exp` is still seven days out, so this can only be the row check firing.
    with pytest.raises(InvalidRefreshToken):
        rotate_refresh_token(db, presented=issued.refresh_token)


# --- revoke_family_for_token -------------------------------------------------------------


@pytest.mark.parametrize("presented", ["", "garbage", "not.a.token"])
def test_revoke_family_for_token_is_a_silent_no_op_for_an_unusable_token(
    db: Session, presented: str
) -> None:
    assert revoke_family_for_token(db, presented=presented) is None


def test_revoke_family_for_token_is_a_silent_no_op_for_an_unknown_jti(db: Session) -> None:
    user = _make_user(db)
    issued = issue_token_pair(db, user=user)
    row = db.get(RefreshToken, _jti_of(issued.refresh_token))
    assert row is not None
    db.delete(row)
    db.flush()

    assert revoke_family_for_token(db, presented=issued.refresh_token) is None


def test_revoke_family_for_token_revokes_every_live_row_and_is_idempotent(
    db: Session,
) -> None:
    user = _make_user(db)
    first = issue_token_pair(db, user=user)
    second = rotate_refresh_token(db, presented=first.refresh_token)
    family_id = _family_of(first.refresh_token)

    assert revoke_family_for_token(db, presented=second.refresh_token) is None

    assert _count_rows(db, family_id, live_only=False) == 2
    assert _count_rows(db, family_id, live_only=True) == 0

    # A second logout with the same token changes nothing and still does not raise.
    assert revoke_family_for_token(db, presented=second.refresh_token) is None
    assert _count_rows(db, family_id, live_only=True) == 0

    with pytest.raises(InvalidRefreshToken):
        rotate_refresh_token(db, presented=second.refresh_token)
