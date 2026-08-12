"""The auth dependency and the tutor-scoping rule, exercised over HTTP.

The probe routes below are the point of this module: `app.dependencies` is only proven if a
real request actually reaches a real dependency and comes back with the right status code and
body. Phase 2 ships **zero** `/api/*` endpoints (REQ-024, scope note), so these routes live on
a throwaway app defined here and are never mounted on `app.main.app`.

Every negative case asserts the exact status **and** that the body is `{"detail": "<string>"}`.
`status_code != 200` would pass on a 404 or a 500, and a cross-tutor request answered with a
404 or an empty 200 instead of a 403 is precisely the failure this task exists to prevent.

The `/probe/leak/*` routes are the second half of that: they are written the way a careless
Phase 3 router would be written — they take `TutorScope`, never read it, and query anyway —
and the tests assert that such a route cannot answer with rows at all.
"""

from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.dependencies import (
    ADMIN_REQUIRED_ERROR,
    CREDENTIALS_ERROR,
    TUTOR_SCOPE_ERROR,
    AdminPrincipal,
    Principal,
    TutorScope,
    TutorScopeNotApplied,
    assert_can_access_tutor,
)
from app.models.enums import UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import (
    ACCESS_TOKEN_TYPE,
    create_access_token,
    create_refresh_token,
    hash_password,
)

DbSession = Annotated[Session, Depends(get_db)]

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
def probe_tutors_unscoped(scope: TutorScope) -> dict[str, str | None]:
    resolved = scope.tutor_id
    return {"scope": str(resolved) if resolved is not None else None}


@probe_app.get("/probe/tutors/{tutor_id}")
def probe_tutors_scoped(scope: TutorScope) -> dict[str, str | None]:
    # No `tutor_id` parameter here on purpose: the dependency declares it, and this route
    # proves it binds from the path segment rather than from the query string.
    resolved = scope.tutor_id
    return {"scope": str(resolved) if resolved is not None else None}


@probe_app.get("/probe/rows")
def probe_row_owner(user: Principal, owner_tutor_id: uuid.UUID | None = None) -> dict[str, bool]:
    assert_can_access_tutor(user, owner_tutor_id)
    return {"ok": True}


@probe_app.get("/probe/users")
def probe_users_scoped(scope: TutorScope, db: DbSession) -> dict[str, list[str]]:
    """The correct shape: the scope is read, and its value narrows the query."""
    statement = select(User)
    resolved = scope.tutor_id
    if resolved is not None:
        statement = statement.where(User.tutor_id == resolved)
    return {"emails": sorted(user.email for user in db.execute(statement).scalars())}


@probe_app.get("/probe/leak/users")
def probe_leak_users(scope: TutorScope, db: DbSession) -> dict[str, list[str]]:
    """The bug this module exists to make impossible: scope taken, scope never applied."""
    return {"emails": sorted(user.email for user in db.execute(select(User)).scalars())}


@probe_app.get("/probe/leak/tutors")
def probe_leak_tutors(scope: TutorScope, db: DbSession) -> dict[str, list[str]]:
    """`tutors` carries no `tutor_id` column — its own primary key is the scoped one."""
    return {"names": sorted(tutor.name for tutor in db.execute(select(Tutor)).scalars())}


@probe_app.get("/probe/leak/deactivate")
def probe_leak_deactivate(scope: TutorScope, db: DbSession) -> dict[str, int]:
    """A mass write is the same breach in the other direction, so the guard covers it too."""
    result = db.execute(
        update(User).values(is_active=False).execution_options(synchronize_session=False)
    )
    return {"rows": result.rowcount}


@probe_app.get("/probe/leak/subjects")
def probe_leak_subjects(scope: TutorScope, db: DbSession) -> dict[str, int]:
    """`subjects` belongs to no tutor, so an unscoped read of it is not a breach."""
    return {"count": len(db.execute(select(Subject)).scalars().all())}


@pytest.fixture
def probe(db: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db

    probe_app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(probe_app)
    finally:
        del probe_app.dependency_overrides[get_db]


@pytest.fixture
def probe_over_http(db: Session) -> Generator[TestClient, None, None]:
    """`probe`, but returning the 500 a real client would see instead of re-raising.

    Needed to assert on the *response* of a route that ignored its scope: the default
    `TestClient` re-raises the server-side exception, which proves the raise but not that the
    caller was left with nothing.
    """

    def override_get_db() -> Generator[Session, None, None]:
        yield db

    probe_app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(probe_app, raise_server_exceptions=False)
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


# --- TutorScope / get_tutor_scope ----------------------------------------------------------


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


def test_requested_tutor_id_binds_from_the_query_string_too(probe: TestClient, db: Session) -> None:
    """The dependency declares `tutor_id`, so a route with no `{tutor_id}` segment still
    honours `?tutor_id=` — and still refuses a cross-tutor reach."""
    own = _make_tutor(db)
    other = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)
    headers = _bearer(user)

    allowed = probe.get(f"/probe/tutors?tutor_id={own.id}", headers=headers)
    assert allowed.status_code == 200
    assert allowed.json() == {"scope": str(own.id)}

    _assert_detail(
        probe.get(f"/probe/tutors?tutor_id={other.id}", headers=headers), 403, TUTOR_SCOPE_ERROR
    )


# --- the discarded scope: a route that takes TutorScope and never reads it -----------------


def test_route_that_discards_the_scope_cannot_read_tutor_owned_rows(
    probe: TestClient, db: Session
) -> None:
    """The core guarantee. A tutor who requested no `tutor_id` is the case where nothing
    raises on its own — the decision table hands back their own id and a careless route drops
    it. The query must not run."""
    own = _make_tutor(db)
    _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    with pytest.raises(TutorScopeNotApplied):
        probe.get("/probe/leak/users", headers=_bearer(user))


def test_discarded_scope_leaves_the_caller_with_no_rows(
    probe_over_http: TestClient, db: Session
) -> None:
    """Loud, not silent: a 500 and nothing else — not a 200 carrying another tutor's rows."""
    own = _make_tutor(db)
    other_user = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = probe_over_http.get("/probe/leak/users", headers=_bearer(user))

    assert response.status_code == 500
    assert other_user.email not in response.text
    assert user.email not in response.text


def test_admin_route_that_discards_the_scope_also_fails(probe: TestClient, db: Session) -> None:
    """An admin's scope is `None`, which is a legitimate "no filter" — but a route that never
    read it did not decide that, and the same bug must not pass review because of who called
    it."""
    user = _make_user(db, role=UserRole.ADMIN)

    with pytest.raises(TutorScopeNotApplied):
        probe.get("/probe/leak/users", headers=_bearer(user))


def test_discarded_scope_also_guards_the_tutors_table(probe: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    with pytest.raises(TutorScopeNotApplied):
        probe.get("/probe/leak/tutors", headers=_bearer(user))


def test_discarded_scope_also_blocks_an_unscoped_mass_update(
    probe: TestClient, db: Session
) -> None:
    own = _make_tutor(db)
    victim = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    with pytest.raises(TutorScopeNotApplied):
        probe.get("/probe/leak/deactivate", headers=_bearer(user))

    db.refresh(victim)
    assert victim.is_active is True


def test_applying_the_scope_lets_the_query_run_and_narrows_it(
    probe: TestClient, db: Session
) -> None:
    own = _make_tutor(db)
    other_user = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = probe.get("/probe/users", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json() == {"emails": [user.email]}
    assert other_user.email not in response.text


def test_admin_applying_the_scope_sees_every_tutor(probe: TestClient, db: Session) -> None:
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    admin = _make_user(db, role=UserRole.ADMIN)

    response = probe.get("/probe/users", headers=_bearer(admin))

    assert response.status_code == 200
    assert tutor_user.email in response.json()["emails"]


def test_a_table_no_tutor_owns_is_not_guarded(probe: TestClient, db: Session) -> None:
    """The guard must not be so blunt that Phase 3 routes around it: an unscoped read of a
    table with no `tutor_id` is legitimate and stays legal."""
    own = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = probe.get("/probe/leak/subjects", headers=_bearer(user))

    assert response.status_code == 200


def test_the_guard_is_per_request_and_does_not_leak_across_them(
    probe: TestClient, db: Session
) -> None:
    """The listener is bound to the request's scope and removed on the way out. A request that
    applied its scope must not leave the next one disarmed, and a request that failed must not
    leave a stale listener behind that breaks the next one."""
    own = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)
    headers = _bearer(user)

    assert probe.get("/probe/users", headers=headers).status_code == 200

    with pytest.raises(TutorScopeNotApplied):
        probe.get("/probe/leak/users", headers=headers)

    assert probe.get("/probe/users", headers=headers).status_code == 200


def test_cross_tutor_reach_is_still_403_before_the_guard_can_matter(
    probe: TestClient, db: Session
) -> None:
    """Ordering: the 403 comes from dependency resolution, so a leaky route never runs at all
    and the caller gets the constitution's 403 body, not a 500."""
    own = _make_tutor(db)
    other = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = probe.get(f"/probe/leak/users?tutor_id={other.id}", headers=_bearer(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


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
