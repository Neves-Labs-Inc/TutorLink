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
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.routers import auth
from app.security import REFRESH_TOKEN_TYPE, decode_token, hash_password
from tests.conftest import FakeRedis

EMAIL = "admin@example.com"
DORMANT_EMAIL = "dormant@example.com"
PASSWORD = "correct horse battery staple"
COMMITTED_EMAIL_SUFFIX = "@committed.test"


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


def test_login_marks_the_refresh_cookie_secure_when_debug_is_off(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    production = get_settings().model_copy(update={"debug": False})
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
    ],
)
def test_login_rejects_bad_credentials_with_one_indistinguishable_401(
    api: TestClient, db: Session, email: str, password: str
) -> None:
    _make_user(db, email=EMAIL)
    _make_user(db, email=DORMANT_EMAIL, is_active=False)

    response = _login(api, email=email, password=password)

    assert response.status_code == 401
    assert response.json() == {"detail": "Incorrect email or password"}
    assert response.headers["www-authenticate"] == "Bearer"
    assert "set-cookie" not in response.headers


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
    redis_double: FakeRedis,
) -> Generator[TestClient, None, None]:
    # Takes `redis_double` for its side effect: it is what puts the `get_redis` override on the
    # app, and without it these two tests would log in against whatever the live Redis holds.
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


def _make_user(
    db: Session,
    *,
    email: str = EMAIL,
    password: str = PASSWORD,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        hashed_password=hash_password(password),
        role=UserRole.ADMIN,
        tutor_id=None,
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
