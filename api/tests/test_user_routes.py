"""`/api/users` over HTTP — REQ-030, #13's developer boundary, and #20's page envelope.

The first `/api/*` router in the project, so this module also pins the conventions the other
Phase 3 tracks inherit: the envelope shape on every list, `{"detail": "<string>"}` on every
failure, and status codes drawn only from 400 · 401 · 403 · 404 · 409.
"""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password, verify_password

PASSWORD = "correct horse battery staple"


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
    role: UserRole = UserRole.ADMIN,
    tutor_id: uuid.UUID | None = None,
    is_active: bool = True,
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password(PASSWORD),
        role=role,
        tutor_id=tutor_id,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


# --- the envelope and the RBAC gate ---------------------------------------------------------


def test_list_returns_the_page_envelope_never_a_bare_array(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.get("/api/users", headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1


def test_total_counts_matches_not_returned_rows(api: TestClient, db: Session) -> None:
    """The envelope's whole point: `total` is what the caller pages against."""
    admin = _make_user(db)
    for _ in range(4):
        _make_user(db)

    body = api.get("/api/users?page_size=2", headers=_auth(admin)).json()

    assert len(body["items"]) == 2
    assert body["total"] == 5
    assert body["page_size"] == 2


def test_deactivated_users_are_hidden_until_asked_for(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    dormant = _make_user(db, is_active=False)
    headers = _auth(admin)

    default = api.get("/api/users", headers=headers).json()
    asked = api.get("/api/users?is_active=false", headers=headers).json()

    assert dormant.email not in [row["email"] for row in default["items"]]
    assert [row["email"] for row in asked["items"]] == [dormant.email]


def test_total_respects_the_is_active_filter_even_when_the_page_truncates(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    for _ in range(2):
        _make_user(db, is_active=False)
    headers = _auth(admin)

    asked = api.get("/api/users?is_active=false&page_size=1", headers=headers).json()

    assert len(asked["items"]) == 1
    assert asked["total"] == 2


def test_a_deactivated_user_is_still_readable_by_id(api: TestClient, db: Session) -> None:
    """The by-id path takes no `?is_active` and deliberately does not filter, because the
    surface that deactivated a row has to be able to open it in order to reactivate it — a 404
    would make a soft delete indistinguishable from a hard one."""
    admin = _make_user(db)
    dormant = _make_user(db, is_active=False)

    response = api.get(f"/api/users/{dormant.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_malformed_is_active_query_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/users?is_active=sideways", headers=_auth(admin))

    assert response.status_code == 400
    assert "is_active" in response.json()["detail"]


def test_a_tutor_is_refused(api: TestClient, db: Session) -> None:
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)

    response = api.get("/api/users", headers=_auth(tutor))

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)


def test_no_token_is_401_not_403(api: TestClient) -> None:
    response = api.get("/api/users")

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


# --- #13: the developer boundary ------------------------------------------------------------


def test_an_admin_cannot_create_a_developer(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json={"email": "new@example.com", "password": PASSWORD, "role": "developer"},
    )

    assert response.status_code == 403
    assert db.scalars(select(User).where(User.email == "new@example.com")).first() is None


def test_an_admin_cannot_promote_anyone_to_developer(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    victim = _make_user(db)

    response = api.patch(
        f"/api/users/{victim.id}", headers=_auth(admin), json={"role": "developer"}
    )

    assert response.status_code == 403
    db.refresh(victim)
    assert victim.role is UserRole.ADMIN


def test_an_admin_cannot_promote_themselves(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(f"/api/users/{admin.id}", headers=_auth(admin), json={"role": "developer"})

    assert response.status_code == 403
    db.refresh(admin)
    assert admin.role is UserRole.ADMIN


def test_an_admin_cannot_set_a_developers_password(api: TestClient, db: Session) -> None:
    """The hole #13's wording leaves open. An admin who cannot *become* a developer could
    still overwrite one's password and log in as them, which defeats the boundary entirely."""
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)

    response = api.patch(
        f"/api/users/{developer.id}", headers=_auth(admin), json={"password": "hijacked-pw-123"}
    )

    assert response.status_code == 403
    db.refresh(developer)
    assert verify_password(PASSWORD, developer.hashed_password)
    assert not verify_password("hijacked-pw-123", developer.hashed_password)


def test_an_admin_cannot_deactivate_a_developer(api: TestClient, db: Session) -> None:
    """The same breach in the other direction: locking the super-user out."""
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)

    response = api.delete(f"/api/users/{developer.id}", headers=_auth(admin))

    assert response.status_code == 403
    db.refresh(developer)
    assert developer.is_active is True


def test_a_developer_may_do_all_of_it(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    other = _make_user(db, role=UserRole.DEVELOPER)
    headers = _auth(developer)

    created = api.post(
        "/api/users",
        headers=headers,
        json={"email": "dev2@example.com", "password": PASSWORD, "role": "developer"},
    )
    promoted = api.patch(f"/api/users/{other.id}", headers=headers, json={"password": PASSWORD})

    assert created.status_code == 201
    assert created.json()["role"] == "developer"
    assert promoted.status_code == 200


# --- REQ-030: the rest of the surface -------------------------------------------------------


def test_creating_a_tutor_account_requires_a_real_profile(api: TestClient, db: Session) -> None:
    """A tutor whose `tutor_id` is NULL is the data error `TutorScope` refuses on, so the API
    will not manufacture one."""
    admin = _make_user(db)
    headers = _auth(admin)

    without = api.post(
        "/api/users",
        headers=headers,
        json={"email": "t1@example.com", "password": PASSWORD, "role": "tutor"},
    )
    unknown = api.post(
        "/api/users",
        headers=headers,
        json={
            "email": "t2@example.com",
            "password": PASSWORD,
            "role": "tutor",
            "tutor_id": str(uuid.uuid4()),
        },
    )

    assert without.status_code == 400
    assert unknown.status_code == 400


def test_an_admin_account_may_not_carry_a_tutor_profile(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json={
            "email": "a@example.com",
            "password": PASSWORD,
            "role": "admin",
            "tutor_id": str(_make_tutor(db).id),
        },
    )

    assert response.status_code == 400


def test_duplicate_email_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json={"email": admin.email, "password": PASSWORD, "role": "admin"},
    )

    assert response.status_code == 409


def test_email_is_normalised_on_create(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.post(
        "/api/users",
        headers=_auth(admin),
        json={"email": "  MiXeD@Example.COM ", "password": PASSWORD, "role": "admin"},
    ).json()

    assert body["email"] == "mixed@example.com"


def test_short_password_is_400_not_422(api: TestClient, db: Session) -> None:
    """REQ-029: validation failures are 400, and the body is always {"detail": "<string>"}."""
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json={"email": "short@example.com", "password": "short", "role": "admin"},
    )

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_malformed_body_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users", headers=_auth(admin), json={"email": "no-at-sign", "role": "admin"}
    )

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_unknown_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/users/{uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 404


def test_delete_is_a_soft_delete(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    victim = _make_user(db)

    response = api.delete(f"/api/users/{victim.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert db.get(User, victim.id) is not None


def test_password_never_comes_back(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.post(
        "/api/users",
        headers=_auth(admin),
        json={"email": "quiet@example.com", "password": PASSWORD, "role": "admin"},
    ).json()

    assert "password" not in body
    assert "hashed_password" not in body
    assert PASSWORD not in str(body)
