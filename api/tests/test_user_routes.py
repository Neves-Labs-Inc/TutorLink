"""`/api/users` over HTTP — REQ-030, #13's developer boundary, and #20's page envelope.

The first `/api/*` router in the project, so this module also pins the conventions the other
Phase 3 tracks inherit: the envelope shape on every list, `{"detail": "<string>"}` on every
failure, and status codes drawn only from 400 · 401 · 403 · 404 · 409.

`POST` also creates tutor profiles now, so the last section drives both ways a tutor account
can name one and every way that can fail. Its phone numbers come from the reserved
`202-555-01xx` range, per `03-RESEARCH.md`'s normative fixture table and
`test_tutor_routes.py`'s docstring: a payload's number is canonicalised by
`normalize_phone_number`, which calls `phonenumbers.is_valid_number`, so a made-up number is a
400 here by design. `_make_tutor` writes straight to the column and bypasses that check, which
is why it is the fixtures rather than the payloads that carry arbitrary strings.
"""

import itertools
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password, verify_password

PASSWORD = "correct horse battery staple"

_serials = itertools.count()


def _phone_number() -> str:
    return f"+1202555{100 + next(_serials) % 80:04d}"


def _make_tutor(db: Session, *, phone_number: str | None = None) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=phone_number or f"+1{suffix[:10]}",
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


def _create_payload(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "email": f"user-{uuid.uuid4().hex[:12]}@example.com",
        "password": PASSWORD,
        "role": "tutor",
    }
    body.update(overrides)
    return body


def _profile(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "name": f"Tutor {uuid.uuid4().hex[:12]}",
        "phone_number": _phone_number(),
    }
    body.update(overrides)
    return body


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


# --- the two ways a tutor account names its profile -----------------------------------------


def test_a_tutor_account_may_bring_its_own_profile(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(
            tutor=_profile(name="Nadia Okafor", phone_number="(202) 555-0180", bio="Algebra")
        ),
    )

    assert response.status_code == 201
    body = response.json()
    profile = db.get(Tutor, uuid.UUID(body["tutor_id"]))
    assert profile is not None
    assert profile.name == "Nadia Okafor"
    assert profile.bio == "Algebra"
    assert profile.is_active is True
    # Canonicalised on the way in, like every other write path: `phone_service` owns the form.
    assert profile.phone_number == "+12025550180"


def test_the_new_profile_takes_the_accounts_own_email(api: TestClient, db: Session) -> None:
    """One address for both, by construction. The payload carries no tutor email at all, so the
    address a tutor logs in with and the one their profile is found by cannot drift apart."""
    admin = _make_user(db)

    body = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(email="  Mirror.Me@Example.COM ", tutor=_profile()),
    ).json()

    assert body["email"] == "mirror.me@example.com"
    assert db.get(Tutor, uuid.UUID(body["tutor_id"])).email == "mirror.me@example.com"


def test_an_existing_profile_is_still_linked_by_id(api: TestClient, db: Session) -> None:
    """The Tutors page creates tutors before their login exists, so `tutor_id` stays the way an
    account joins one of those."""
    admin = _make_user(db)
    existing = _make_tutor(db)

    response = api.post(
        "/api/users", headers=_auth(admin), json=_create_payload(tutor_id=str(existing.id))
    )

    assert response.status_code == 201
    assert response.json()["tutor_id"] == str(existing.id)


def test_a_tutor_account_names_its_profile_exactly_once(api: TestClient, db: Session) -> None:
    """Both is two answers to which profile the account belongs to, and neither is the NULL
    `tutor_id` row `TutorScope` refuses. Each is a 400 carrying `{"detail": "<string>"}`."""
    admin = _make_user(db)
    headers = _auth(admin)

    both = api.post(
        "/api/users",
        headers=headers,
        json=_create_payload(tutor_id=str(_make_tutor(db).id), tutor=_profile()),
    )
    neither = api.post("/api/users", headers=headers, json=_create_payload())

    assert both.status_code == 400
    assert isinstance(both.json()["detail"], str)
    assert neither.status_code == 400
    assert isinstance(neither.json()["detail"], str)


@pytest.mark.parametrize("role", ["admin", "developer"])
def test_a_non_tutor_account_may_not_bring_a_profile(
    api: TestClient, db: Session, role: str
) -> None:
    """A developer token, so `role=developer` is refused for its shape rather than by #13's
    boundary — which answers first and would hide this."""
    developer = _make_user(db, role=UserRole.DEVELOPER)
    payload = _create_payload(role=role, tutor=_profile())

    response = api.post("/api/users", headers=_auth(developer), json=payload)

    assert response.status_code == 400
    db.flush()
    assert db.scalars(select(Tutor).where(Tutor.email == payload["email"])).first() is None


def test_a_profile_already_holding_that_email_is_409(api: TestClient, db: Session) -> None:
    """The profile exists and the account does not, which is what `tutor_id` is for. Reported
    as a conflict rather than linked to silently: the caller did not name that row."""
    admin = _make_user(db)
    existing = _make_tutor(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(email=existing.email, tutor=_profile()),
    )

    assert response.status_code == 409
    assert isinstance(response.json()["detail"], str)


def test_a_profile_already_holding_that_phone_number_is_409(api: TestClient, db: Session) -> None:
    """In another format, so this also pins that the number is canonicalised *before* the
    uniqueness check — the two sides of that comparison are produced by the same code."""
    admin = _make_user(db)
    _make_tutor(db, phone_number="+12025550181")

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(tutor=_profile(phone_number="202-555-0181")),
    )

    assert response.status_code == 409
    assert isinstance(response.json()["detail"], str)


def test_an_undialable_profile_phone_number_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(tutor=_profile(phone_number="555-123-4567")),
    )

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_a_taken_account_email_leaves_no_profile_behind(api: TestClient, db: Session) -> None:
    """Ordering, not luck. The account email is claimed before `create_tutor` inserts anything,
    so this 409 cannot leave a profile holding that same email — which the obvious retry would
    then collide with on `tutors.email`, reporting a conflict with a row the failed request had
    created.

    The `flush` is half the assertion: a profile added to the `Session` but not yet written
    would be sent by it, so finding nothing afterwards means nothing was ever staged.
    """
    admin = _make_user(db)
    taken = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(email=taken.email, tutor=_profile(name="Orphan")),
    )

    assert response.status_code == 409
    db.flush()
    assert db.scalars(select(Tutor).where(Tutor.email == taken.email)).first() is None


def test_a_refused_profile_leaves_no_account_behind(api: TestClient, db: Session) -> None:
    """The same property from the other side: the account is inserted last, so nothing it could
    have been linked to failing leaves a login pointing at a profile that was rolled back."""
    admin = _make_user(db)
    _make_tutor(db, phone_number="+12025550182")
    payload = _create_payload(tutor=_profile(phone_number="+12025550182"))

    response = api.post("/api/users", headers=_auth(admin), json=payload)

    assert response.status_code == 409
    db.flush()
    assert db.scalars(select(User).where(User.email == payload["email"])).first() is None
