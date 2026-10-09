import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.models.enums import UserRole
from app.models.login_attempt import LoginAttempt
from app.models.refresh_token import RefreshToken
from app.models.tutor import Tutor
from app.models.user import User
from app.routers import auth
from app.security import ACCESS_TOKEN_TYPE, REFRESH_TOKEN_TYPE, decode_token, hash_password
from app.services.rate_limit_service import EMAIL_BUCKET_PREFIX, IP_BUCKET_PREFIX

EMAIL = "admin@example.com"
DORMANT_EMAIL = "dormant@example.com"
# A Tutor the office created on the Tutors page: a user with no password at all.
NO_PASSWORD_EMAIL = "office-created@example.com"
PASSWORD = "correct horse battery staple"
COMMITTED_EMAIL_SUFFIX = "@committed.test"
TEST_CLIENT_PEER = "testclient"


def test_login_returns_a_token_pair_and_sets_the_refresh_cookie(
    api: TestClient, db: Session
) -> None:
    _make_user(db)

    response = _login(api)
    body = response.json()
    set_cookie = response.headers["set-cookie"]

    assert response.status_code == 200
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert set_cookie.startswith("refresh_token=")
    assert "HttpOnly" in set_cookie
    assert "SameSite=Lax" in set_cookie
    assert "Path=/auth" in set_cookie
    assert "Secure" not in set_cookie


def test_login_marks_the_refresh_cookie_secure_when_cookie_secure_is_on(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    production = get_settings().model_copy(update={"cookie_secure": True})
    monkeypatch.setattr(auth, "get_settings", lambda: production)
    _make_user(db)

    set_cookie = _login(api).headers["set-cookie"]

    assert "Secure" in set_cookie
    assert "SameSite=Lax" in set_cookie
    assert "Path=/auth" in set_cookie


@pytest.mark.parametrize(
    ("email", "password"),
    [
        (EMAIL, "not the password"),
        ("nobody@example.com", PASSWORD),
        (DORMANT_EMAIL, PASSWORD),
        (NO_PASSWORD_EMAIL, PASSWORD),
    ],
)
def test_login_rejects_bad_credentials_with_one_indistinguishable_401(
    api: TestClient, db: Session, email: str, password: str
) -> None:
    _make_user(db, email=EMAIL)
    _make_user(db, email=DORMANT_EMAIL, is_active=False)
    _make_user(db, email=NO_PASSWORD_EMAIL, password=None)

    response = _login(api, email=email, password=password)

    assert response.status_code == 401
    assert response.json() == {"detail": "Incorrect email or password"}
    assert response.headers["www-authenticate"] == "Bearer"
    assert "set-cookie" not in response.headers


def test_a_tutors_access_token_carries_their_profile_id(api: TestClient, db: Session) -> None:
    """The claim comes from `tutors.user_id`, not from a column on the user."""
    user = _make_user(db, email="tutor@example.com")
    user.role = UserRole.TUTOR
    user.profile = Tutor(phone_number="+12025550199")
    db.flush()

    body = _login(api, email="tutor@example.com").json()

    claims = decode_token(body["access_token"], expected_type=ACCESS_TOKEN_TYPE)
    assert claims.tutor_id == user.profile.id


def test_login_with_a_json_body_returns_400_with_a_string_detail(api: TestClient) -> None:
    response = api.post("/auth/token", json={"username": EMAIL, "password": PASSWORD})
    detail = response.json()["detail"]

    assert response.status_code == 400
    assert isinstance(detail, str)
    assert PASSWORD not in detail


def test_refresh_with_the_cookie_returns_a_different_refresh_token(
    api: TestClient, db: Session
) -> None:
    _make_user(db)
    first = _login(api).json()["refresh_token"]

    response = api.post("/auth/refresh")
    body = response.json()

    assert response.status_code == 200
    assert body["token_type"] == "bearer"
    assert body["refresh_token"] != first
    assert "Path=/auth" in response.headers["set-cookie"]


def test_refresh_with_a_json_body_and_no_cookie_returns_a_new_pair(
    api: TestClient, db: Session
) -> None:
    _make_user(db)
    first = _login(api).json()["refresh_token"]
    api.cookies.clear()

    response = api.post("/auth/refresh", json={"refresh_token": first})

    assert response.status_code == 200
    assert response.json()["refresh_token"] != first


@pytest.mark.parametrize(
    "payload",
    [None, {"refresh_token": "not-a-jwt"}],
    ids=["no cookie and no body", "a forged token"],
)
def test_refresh_rejects_an_unusable_token_with_401(
    api: TestClient, payload: dict[str, str] | None
) -> None:
    response = api.post("/auth/refresh", json=payload)

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid refresh token"}


def test_refresh_replaying_a_rotated_token_kills_the_whole_family(
    api: TestClient, db: Session
) -> None:
    _make_user(db)
    first = _login(api).json()["refresh_token"]
    second = api.post("/auth/refresh").json()["refresh_token"]
    api.cookies.clear()

    replay = api.post("/auth/refresh", json={"refresh_token": first})
    after_replay = api.post("/auth/refresh", json={"refresh_token": second})

    assert replay.status_code == 401
    assert replay.json() == {"detail": "Invalid refresh token"}
    assert after_replay.status_code == 401


def test_logout_clears_the_cookie_and_kills_the_refresh_token(api: TestClient, db: Session) -> None:
    _make_user(db)
    refresh_token = _login(api).json()["refresh_token"]

    response = api.post("/auth/logout")
    set_cookie = response.headers["set-cookie"]
    api.cookies.clear()
    reuse = api.post("/auth/refresh", json={"refresh_token": refresh_token})

    assert response.status_code == 204
    assert set_cookie.startswith("refresh_token=")
    assert "Path=/auth" in set_cookie
    assert "SameSite=Lax" in set_cookie
    assert "HttpOnly" in set_cookie
    assert reuse.status_code == 401


def test_logout_is_idempotent(api: TestClient, db: Session) -> None:
    _make_user(db)
    refresh_token = _login(api).json()["refresh_token"]

    first = api.post("/auth/logout")
    second = api.post("/auth/logout", json={"refresh_token": refresh_token})

    assert first.status_code == 204
    assert second.status_code == 204


@pytest.mark.parametrize(
    "payload",
    [None, {"refresh_token": "not-a-jwt"}],
    ids=["no cookie and no body", "a forged token"],
)
def test_logout_returns_204_for_an_unusable_token(
    api: TestClient, payload: dict[str, str] | None
) -> None:
    response = api.post("/auth/logout", json=payload)

    assert response.status_code == 204
    assert response.content == b""


def test_reuse_revocation_is_committed_before_the_401_is_raised(
    session_per_request_api: TestClient, committed_sessions: sessionmaker[Session]
) -> None:
    email = f"reuse{COMMITTED_EMAIL_SUFFIX}"
    _make_committed_user(committed_sessions, email)
    first = _login(session_per_request_api, email=email).json()["refresh_token"]
    rotated = session_per_request_api.post("/auth/refresh").json()["refresh_token"]
    session_per_request_api.cookies.clear()

    replay = session_per_request_api.post("/auth/refresh", json={"refresh_token": first})
    live = _live_row_count(committed_sessions, _family_of(first))
    after_replay = session_per_request_api.post("/auth/refresh", json={"refresh_token": rotated})

    assert replay.status_code == 401
    assert live == 0
    assert after_replay.status_code == 401


def test_logout_revocation_is_committed_before_the_204_is_returned(
    session_per_request_api: TestClient, committed_sessions: sessionmaker[Session]
) -> None:
    email = f"logout{COMMITTED_EMAIL_SUFFIX}"
    _make_committed_user(committed_sessions, email)
    refresh_token = _login(session_per_request_api, email=email).json()["refresh_token"]

    logout = session_per_request_api.post("/auth/logout")
    live = _live_row_count(committed_sessions, _family_of(refresh_token))
    session_per_request_api.cookies.clear()
    reuse = session_per_request_api.post("/auth/refresh", json={"refresh_token": refresh_token})

    assert logout.status_code == 204
    assert live == 0
    assert reuse.status_code == 401


def test_a_wrong_password_commits_one_reservation_row_per_armed_bucket(
    session_per_request_api: TestClient, committed_sessions: sessionmaker[Session]
) -> None:
    """The reservation is the recorded failure, so it has to survive the 401.

    The 401 is raised without a commit. Only the commit `login` makes straight after reserving
    keeps the row; drop it and this failure is rolled back with the request and never counted.
    """
    email = f"wrong{COMMITTED_EMAIL_SUFFIX}"
    _make_committed_user(committed_sessions, email)

    response = _login(session_per_request_api, email=email, password="not the password")
    reserved = _committed_rows_reserved_alongside(committed_sessions, EMAIL_BUCKET_PREFIX + email)

    assert response.status_code == 401
    assert reserved == [EMAIL_BUCKET_PREFIX + email, IP_BUCKET_PREFIX + TEST_CLIENT_PEER]


def test_a_correct_password_leaves_none_of_its_own_reservation_rows(
    session_per_request_api: TestClient, committed_sessions: sessionmaker[Session]
) -> None:
    email = f"right{COMMITTED_EMAIL_SUFFIX}"
    _make_committed_user(committed_sessions, email)

    response = _login(session_per_request_api, email=email)
    reserved = _committed_rows_reserved_alongside(committed_sessions, EMAIL_BUCKET_PREFIX + email)

    assert response.status_code == 200
    assert reserved == []


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> Generator[sessionmaker[Session], None, None]:
    factory = sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)
    try:
        yield factory
    finally:
        with factory() as cleanup:
            owners = select(User.id).where(User.email.like(f"%{COMMITTED_EMAIL_SUFFIX}"))
            cleanup.execute(delete(RefreshToken).where(RefreshToken.user_id.in_(owners)))
            cleanup.execute(delete(User).where(User.email.like(f"%{COMMITTED_EMAIL_SUFFIX}")))
            cleanup.commit()


@pytest.fixture
def session_per_request_api(
    committed_sessions: sessionmaker[Session],
) -> Generator[TestClient, None, None]:
    from app.db import get_db
    from app.main import app

    def open_and_close_one_session_per_request() -> Generator[Session, None, None]:
        session = committed_sessions()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = open_and_close_one_session_per_request
    try:
        yield TestClient(app)
    finally:
        del app.dependency_overrides[get_db]
        _delete_committed_reservations(committed_sessions)


def _make_user(
    db: Session,
    *,
    email: str = EMAIL,
    password: str | None = PASSWORD,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        name="Test User",
        hashed_password=None if password is None else hash_password(password),
        role=UserRole.ADMIN,
        is_active=is_active,
    )
    db.add(user)
    db.flush()

    return user


def _make_committed_user(sessions: sessionmaker[Session], email: str) -> None:
    with sessions() as setup:
        _make_user(setup, email=email)
        setup.commit()


def _login(api: TestClient, *, email: str = EMAIL, password: str = PASSWORD) -> Response:
    return api.post("/auth/token", data={"username": email, "password": password})


def _family_of(refresh_token: str) -> uuid.UUID:
    family_id = decode_token(refresh_token, expected_type=REFRESH_TOKEN_TYPE).family_id
    assert family_id is not None

    return family_id


def _live_row_count(sessions: sessionmaker[Session], family_id: uuid.UUID) -> int:
    with sessions() as observer:
        return observer.execute(
            select(func.count())
            .select_from(RefreshToken)
            .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        ).scalar_one()


def _committed_rows_reserved_alongside(sessions: sessionmaker[Session], key: str) -> list[str]:
    attempt_ids = select(LoginAttempt.attempt_id).where(LoginAttempt.bucket_key == key)

    with sessions() as observer:
        return list(
            observer.execute(
                select(LoginAttempt.bucket_key)
                .where(LoginAttempt.attempt_id.in_(attempt_ids))
                .order_by(LoginAttempt.bucket_key)
            ).scalars()
        )


def _delete_committed_reservations(sessions: sessionmaker[Session]) -> None:
    # Logging in through committed sessions commits real reservations. Removed by the attempt
    # ids of this module's own email buckets, so the IP rows those attempts wrote under the
    # shared "testclient" peer go with them and nobody else's rows in that bucket do.
    own_buckets = LoginAttempt.bucket_key.like(f"{EMAIL_BUCKET_PREFIX}%{COMMITTED_EMAIL_SUFFIX}")
    attempt_ids = select(LoginAttempt.attempt_id).where(own_buckets)

    with sessions() as cleanup:
        cleanup.execute(delete(LoginAttempt).where(LoginAttempt.attempt_id.in_(attempt_ids)))
        cleanup.commit()
