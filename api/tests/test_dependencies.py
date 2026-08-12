"""The auth dependency and the tutor-scoping rule, exercised over HTTP.

The probe routes below are the point of this module: `app.dependencies` is only proven if a
real request actually reaches a real dependency and comes back with the right status code and
body. Phase 2 ships **zero** `/api/*` endpoints (REQ-024, scope note), so these routes live on
a throwaway app defined here and are never mounted on `app.main.app`.

Every negative case asserts the exact status **and** that the body is `{"detail": "<string>"}`.
`status_code != 200` would pass on a 404 or a 500, and a cross-tutor request answered with a
404 or an empty 200 instead of a 403 is precisely the failure this task exists to prevent.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.dependencies import (
    ADMIN_REQUIRED_ERROR,
    CREDENTIALS_ERROR,
    TUTOR_SCOPE_ERROR,
    AdminPrincipal,
    Principal,
    assert_can_access_tutor,
    resolve_tutor_scope,
)
from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import (
    ACCESS_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    hash_password,
)

probe_app = FastAPI()


@probe_app.get("/probe/any")
def probe_any(user: Principal) -> dict[str, str | None]:
    return {
        "id": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "tutor_id": str(user.tutor_id) if user.tutor_id is not None else None,
    }


@probe_app.get("/probe/admin")
def probe_admin(user: AdminPrincipal) -> dict[str, str]:
    return {"id": str(user.id)}


@probe_app.get("/probe/tutors")
def probe_tutors_unscoped(user: Principal) -> dict[str, str | None]:
    scope = resolve_tutor_scope(user, None)
    return {"scope": str(scope) if scope is not None else None}


@probe_app.get("/probe/tutors/{tutor_id}")
def probe_tutors_scoped(user: Principal, tutor_id: uuid.UUID) -> dict[str, str | None]:
    scope = resolve_tutor_scope(user, tutor_id)
    return {"scope": str(scope) if scope is not None else None}


@probe_app.get("/probe/rows")
def probe_row_owner(user: Principal, owner_tutor_id: uuid.UUID | None = None) -> dict[str, bool]:
    assert_can_access_tutor(user, owner_tutor_id)
    return {"ok": True}


@pytest.fixture
def probe(db: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db

    probe_app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(probe_app)
    finally:
        del probe_app.dependency_overrides[get_db]


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_user(
    db: Session,
    *,
    role: UserRole,
    tutor_id: uuid.UUID | None = None,
    is_active: bool = True,
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password("probe-password"),
        role=role,
        tutor_id=tutor_id,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _expired_bearer(user: User) -> dict[str, str]:
    settings = get_settings()
    issued_at = datetime.now(UTC) - timedelta(hours=2)
    expires_at = issued_at + timedelta(minutes=15)
    claims = {
        "sub": str(user.id),
        "role": user.role.value,
        "tutor_id": None,
        "typ": ACCESS_TOKEN_TYPE,
        "jti": str(uuid.uuid4()),
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)
    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response, expected_status: int, expected_detail: str) -> None:
    """The status, and a body that is exactly `{"detail": "<string>"}` — nothing else."""
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)


# --- 401: authentication ------------------------------------------------------------------


def test_no_authorization_header_is_401_with_challenge(probe: TestClient) -> None:
    response = probe.get("/probe/any")

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_garbage_token_is_401(probe: TestClient) -> None:
    response = probe.get("/probe/any", headers={"Authorization": "Bearer garbage"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_refresh_token_is_rejected_as_an_access_token(probe: TestClient, db: Session) -> None:
    """`typ` is enforced at the dependency, not only inside `decode_token`."""
    user = _make_user(db, role=UserRole.ADMIN)
    refresh_token, _ = create_refresh_token(
        user_id=user.id, jti=uuid.uuid4(), family_id=uuid.uuid4()
    )

    response = probe.get("/probe/any", headers={"Authorization": f"Bearer {refresh_token}"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_expired_access_token_is_401(probe: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = probe.get("/probe/any", headers=_expired_bearer(user))

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_token_signed_with_another_secret_is_401(probe: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)
    settings = get_settings()
    now = datetime.now(UTC)
    forged = jwt.encode(
        {
            "sub": str(user.id),
            "role": user.role.value,
            "tutor_id": None,
            "typ": ACCESS_TOKEN_TYPE,
            "jti": str(uuid.uuid4()),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=15)).timestamp()),
        },
        settings.secret_key + "-not-the-signing-key",
        algorithm=settings.jwt_algorithm,
    )

    response = probe.get("/probe/any", headers={"Authorization": f"Bearer {forged}"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_valid_token_for_a_deleted_user_is_401(probe: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)
    headers = _bearer(user)

    db.delete(user)
    db.flush()
    db.expunge_all()

    response = probe.get("/probe/any", headers=headers)

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_deactivation_takes_effect_on_the_next_request(probe: TestClient, db: Session) -> None:
    """D-023: the `users` row is read per request, so `is_active = false` is immediate."""
    user = _make_user(db, role=UserRole.ADMIN)
    headers = _bearer(user)

    assert probe.get("/probe/any", headers=headers).status_code == 200

    user.is_active = False
    db.flush()

    _assert_detail(probe.get("/probe/any", headers=headers), 401, CREDENTIALS_ERROR)


def test_principal_carries_the_row_not_the_orm_object(probe: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = probe.get("/probe/any", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json() == {
        "id": str(user.id),
        "email": user.email,
        "role": "tutor",
        "tutor_id": str(tutor.id),
    }


# --- 403: require_admin -------------------------------------------------------------------


def test_admin_passes_both_probes(probe: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)
    headers = _bearer(user)

    assert probe.get("/probe/any", headers=headers).status_code == 200
    assert probe.get("/probe/admin", headers=headers).status_code == 200


def test_tutor_on_admin_probe_is_403(probe: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    _assert_detail(probe.get("/probe/admin", headers=_bearer(user)), 403, ADMIN_REQUIRED_ERROR)


def test_admin_probe_without_a_token_is_401_not_403(probe: TestClient) -> None:
    """`require_admin` depends on `get_current_user`, so authentication fails first."""
    response = probe.get("/probe/admin")

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert response.headers["WWW-Authenticate"] == "Bearer"


# --- resolve_tutor_scope ------------------------------------------------------------------


def test_tutor_requesting_own_id_is_scoped_to_it(probe: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = probe.get(f"/probe/tutors/{tutor.id}", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json() == {"scope": str(tutor.id)}


def test_tutor_requesting_another_tutor_is_403_with_a_detail_body(
    probe: TestClient, db: Session
) -> None:
    """The failure this task exists to prevent: not 404, not an empty 200."""
    own = _make_tutor(db)
    other = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = probe.get(f"/probe/tutors/{other.id}", headers=_bearer(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_tutor_requesting_nothing_is_forced_to_own_scope(probe: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = probe.get("/probe/tutors", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json() == {"scope": str(tutor.id)}


def test_tutor_with_null_tutor_id_is_403_unscoped(probe: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    _assert_detail(probe.get("/probe/tutors", headers=_bearer(user)), 403, TUTOR_SCOPE_ERROR)


def test_tutor_with_null_tutor_id_is_403_for_any_requested_id(
    probe: TestClient, db: Session
) -> None:
    other = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    response = probe.get(f"/probe/tutors/{other.id}", headers=_bearer(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_admin_requesting_nothing_gets_no_filter(probe: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = probe.get("/probe/tutors", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json() == {"scope": None}


def test_admin_requesting_another_tutor_passes_through_unchanged(
    probe: TestClient, db: Session
) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = probe.get(f"/probe/tutors/{tutor.id}", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json() == {"scope": str(tutor.id)}


# --- assert_can_access_tutor --------------------------------------------------------------


def test_admin_may_access_any_row(probe: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = probe.get(f"/probe/rows?owner_tutor_id={tutor.id}", headers=_bearer(user))

    assert response.status_code == 200


def test_tutor_may_access_own_row(probe: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = probe.get(f"/probe/rows?owner_tutor_id={tutor.id}", headers=_bearer(user))

    assert response.status_code == 200


def test_tutor_reaching_another_tutors_row_is_403(probe: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    other = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = probe.get(f"/probe/rows?owner_tutor_id={other.id}", headers=_bearer(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_tutor_reaching_an_unowned_row_is_403(probe: TestClient, db: Session) -> None:
    """An unowned row belongs to no tutor, so it is not this tutor's."""
    own = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    _assert_detail(probe.get("/probe/rows", headers=_bearer(user)), 403, TUTOR_SCOPE_ERROR)


def test_tutor_with_null_tutor_id_may_access_no_row(probe: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    _assert_detail(probe.get("/probe/rows", headers=_bearer(user)), 403, TUTOR_SCOPE_ERROR)
