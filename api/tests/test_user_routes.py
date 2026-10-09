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
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.users import INVALID_SHAPE_ERROR
from app.security import create_access_token, hash_password, verify_password

PASSWORD = "correct horse battery staple"
DISPLAY_NAME = "Ana Souza"
HIDDEN_CHARACTER_NAMES = {
    "nul": "Ana\x00",
    "newline": "Ana\nPay to IBAN X",
    "zero-width space": "Ana\u200bLopez",
    "bidi override": "Ana\u202eevil",
    "line separator": "Ana\u2028Lopez",
    "paragraph separator": "Ana\u2029Lopez",
}

_serials = itertools.count()


def _phone_number() -> str:
    return f"+1202555{100 + next(_serials) % 80:04d}"


def _make_tutor(db: Session, *, phone_number: str | None = None) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=phone_number or f"+1{suffix[:10]}",
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
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password(PASSWORD),
            role=role,
            is_active=is_active,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password(PASSWORD)
        user.role = role
        user.is_active = is_active
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _create_payload(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "email": f"user-{uuid.uuid4().hex[:12]}@example.com",
        "name": DISPLAY_NAME,
        "role": "tutor",
    }
    body.update(overrides)
    return body


def _profile(**overrides: object) -> dict[str, object]:
    # No name and no email: the profile's are the account's (one record per person).
    body: dict[str, object] = {"phone_number": _phone_number()}
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
        json={
            "email": "new@example.com",
            "name": DISPLAY_NAME,
            "role": "developer",
        },
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


def test_a_password_in_a_patch_is_ignored_and_a_developer_is_still_refused(
    api: TestClient, db: Session
) -> None:
    """Any write to a developer is refused for an admin, and a `password` key never lands."""
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
        json={
            "email": "dev2@example.com",
            "name": DISPLAY_NAME,
            "role": "developer",
        },
    )
    promoted = api.patch(f"/api/users/{other.id}", headers=headers, json={"is_active": True})

    assert created.status_code == 201
    assert created.json()["role"] == "developer"
    assert promoted.status_code == 200


# --- REQ-030: the rest of the surface -------------------------------------------------------


def test_creating_a_tutor_account_requires_a_profile_input(api: TestClient, db: Session) -> None:
    """A tutor with no profile is the data error `TutorScope` refuses on, so the API will not
    manufacture one; and `tutor_id` is refused outright — every profile has its user."""
    admin = _make_user(db)
    headers = _auth(admin)

    without = api.post(
        "/api/users",
        headers=headers,
        json={
            "email": "t1@example.com",
            "name": DISPLAY_NAME,
            "role": "tutor",
        },
    )
    unknown = api.post(
        "/api/users",
        headers=headers,
        json={
            "email": "t2@example.com",
            "name": DISPLAY_NAME,
            "role": "tutor",
            "tutor_id": str(uuid.uuid4()),
        },
    )

    assert without.status_code == 400
    assert unknown.status_code == 409


def test_tutor_id_is_refused_for_every_role(api: TestClient, db: Session) -> None:
    """The profile named already has its user; an Admin edits that user instead."""
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json={
            "email": "a@example.com",
            "name": DISPLAY_NAME,
            "role": "admin",
            "tutor_id": str(_make_tutor(db).id),
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "That tutor profile already has a user account"


def test_duplicate_email_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json={
            "email": admin.email,
            "name": DISPLAY_NAME,
            "role": "admin",
        },
    )

    assert response.status_code == 409


def test_email_is_normalised_on_create(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.post(
        "/api/users",
        headers=_auth(admin),
        json={
            "email": "  MiXeD@Example.COM ",
            "name": DISPLAY_NAME,
            "role": "admin",
        },
    ).json()

    assert body["email"] == "mixed@example.com"


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
        json={
            "email": "quiet@example.com",
            "name": DISPLAY_NAME,
            "role": "admin",
        },
    ).json()

    assert "password" not in body
    assert "hashed_password" not in body
    assert body["has_password"] is False
    assert PASSWORD not in str(body)


@pytest.mark.parametrize(
    ("role", "with_profile"),
    [("admin", False), ("manager", True), ("tutor", True)],
)
def test_every_created_role_has_no_password_and_no_invite_yet(
    api: TestClient, db: Session, role: str, with_profile: bool
) -> None:
    admin = _make_user(db)
    extra = {"tutor": _profile()} if with_profile else {}

    response = api.post(
        "/api/users", headers=_auth(admin), json=_create_payload(role=role, **extra)
    )

    body = response.json()
    assert response.status_code == 201
    assert body["has_password"] is False
    assert body["invite_expires_at"] is None
    assert db.get_one(User, uuid.UUID(body["id"])).hashed_password is None


def test_a_password_in_the_create_body_is_ignored(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(role="admin", password=PASSWORD),
    )

    assert response.status_code == 201
    assert response.json()["has_password"] is False
    assert db.get_one(User, uuid.UUID(response.json()["id"])).hashed_password is None


def test_a_password_in_a_patch_leaves_the_hash_alone(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    target = _make_user(db)
    passwordless = _make_user(db)
    passwordless.hashed_password = None
    db.flush()

    kept = api.patch(
        f"/api/users/{target.id}", headers=_auth(admin), json={"password": "new-password-123"}
    )
    still_none = api.patch(
        f"/api/users/{passwordless.id}",
        headers=_auth(admin),
        json={"password": "new-password-123"},
    )

    assert kept.status_code == 200
    assert still_none.status_code == 200
    db.refresh(target)
    db.refresh(passwordless)
    assert verify_password(PASSWORD, target.hashed_password)
    assert passwordless.hashed_password is None


def test_the_list_says_who_has_a_password(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    passwordless = _make_user(db)
    passwordless.hashed_password = None
    db.flush()

    items = api.get("/api/users?page_size=100", headers=_auth(admin)).json()["items"]
    by_id = {item["id"]: item["has_password"] for item in items}

    assert by_id[str(admin.id)] is True
    assert by_id[str(passwordless.id)] is False


# --- the two ways a tutor account names its profile -----------------------------------------


def test_a_tutor_account_brings_its_profile(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(tutor=_profile(phone_number="(202) 555-0180", bio="Algebra")),
    )

    assert response.status_code == 201
    body = response.json()
    profile = db.get(Tutor, uuid.UUID(body["tutor_id"]))
    assert profile is not None
    assert profile.user.id == uuid.UUID(body["id"])
    assert profile.user.name == DISPLAY_NAME
    assert profile.bio == "Algebra"
    assert profile.user.is_active is True
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
    assert db.get(Tutor, uuid.UUID(body["tutor_id"])).user.email == "mirror.me@example.com"


def test_an_existing_profile_cannot_be_linked_by_id(api: TestClient, db: Session) -> None:
    """The Tutors page creates the person and their profile together now, so the profile
    already has its user: a second account for it is a 409, and nothing is written."""
    admin = _make_user(db)
    existing = _make_tutor(db)
    payload = _create_payload(tutor_id=str(existing.id))

    response = api.post("/api/users", headers=_auth(admin), json=payload)

    assert response.status_code == 409
    assert response.json()["detail"] == "That tutor profile already has a user account"
    db.flush()
    assert db.scalars(select(User).where(User.email == payload["email"])).first() is None


def test_a_tutor_account_needs_a_profile_input_and_may_not_name_one(
    api: TestClient, db: Session
) -> None:
    """Neither is the Tutor with no profile `TutorScope` refuses (400); naming one by id is the
    409 above even when a profile input comes with it. Each carries `{"detail": "<string>"}`."""
    admin = _make_user(db)
    headers = _auth(admin)

    both = api.post(
        "/api/users",
        headers=headers,
        json=_create_payload(tutor_id=str(_make_tutor(db).id), tutor=_profile()),
    )
    neither = api.post("/api/users", headers=headers, json=_create_payload())

    assert both.status_code == 409
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
    assert db.scalars(select(User).where(User.email == payload["email"])).first() is None


def test_a_tutor_already_holding_that_email_is_409(api: TestClient, db: Session) -> None:
    """A Tutor the office created is a user already, so their email is taken like any other
    account's. Reported as a conflict rather than merged silently."""
    admin = _make_user(db)
    existing = _make_tutor(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(email=existing.user.email, tutor=_profile()),
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
    """Ordering, not luck. The account email is claimed before anything is inserted, so this
    409 cannot leave a profile behind — neither hanging off `taken` nor off a person that was
    never written.

    The `flush` is half the assertion: a profile added to the `Session` but not yet written
    would be sent by it, so finding nothing afterwards means nothing was ever staged.
    """
    admin = _make_user(db)
    taken = _make_user(db)

    response = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(email=taken.email, tutor=_profile()),
    )

    assert response.status_code == 409
    db.flush()
    assert db.scalar(select(func.count()).select_from(Tutor)) == 0


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


# --- Display name --------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["tutor", "manager", "admin"])
def test_a_name_is_required_on_create_for_every_role(
    api: TestClient, db: Session, role: str
) -> None:
    admin = _make_user(db)
    payload = _create_payload(role=role)
    del payload["name"]
    if role == "tutor":
        payload["tutor"] = _profile()

    response = api.post("/api/users", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert db.scalars(select(User).where(User.email == payload["email"])).first() is None


@pytest.mark.parametrize("name", ["", "   ", "x" * 256], ids=["empty", "blank", "long"])
def test_an_unusable_name_is_422_on_create(api: TestClient, db: Session, name: str) -> None:
    admin = _make_user(db)
    payload = _create_payload(name=name, tutor=_profile())

    response = api.post("/api/users", headers=_auth(admin), json=payload)

    assert response.status_code == 422
    assert db.scalars(select(User).where(User.email == payload["email"])).first() is None


@pytest.mark.parametrize("name", HIDDEN_CHARACTER_NAMES.values(), ids=HIDDEN_CHARACTER_NAMES.keys())
def test_a_name_with_control_or_invisible_characters_is_422_on_create(
    api: TestClient, db: Session, name: str
) -> None:
    admin = _make_user(db)
    payload = _create_payload(role="manager", name=name, tutor=_profile())

    response = api.post("/api/users", headers=_auth(admin), json=payload)

    assert response.status_code == 422
    assert "control or invisible characters" in response.json()["detail"]
    assert db.scalars(select(User).where(User.email == payload["email"])).first() is None


@pytest.mark.parametrize("name", HIDDEN_CHARACTER_NAMES.values(), ids=HIDDEN_CHARACTER_NAMES.keys())
def test_a_name_with_control_or_invisible_characters_is_422_on_update(
    api: TestClient, db: Session, name: str
) -> None:
    admin = _make_user(db)
    target = _make_user(db, role=UserRole.MANAGER)

    response = api.patch(f"/api/users/{target.id}", headers=_auth(admin), json={"name": name})

    assert response.status_code == 422
    assert "control or invisible characters" in response.json()["detail"]
    db.refresh(target)
    assert target.name == "Test User"


def test_an_accented_name_is_accepted_on_create_and_update(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    created = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(role="manager", name="José Núñez", tutor=_profile()),
    )
    updated = api.patch(
        f"/api/users/{created.json()['id']}",
        headers=_auth(admin),
        json={"name": "Zoë Ångström"},
    )

    assert (created.status_code, created.json()["name"]) == (201, "José Núñez")
    assert (updated.status_code, updated.json()["name"]) == (200, "Zoë Ångström")


def test_a_run_of_spaces_in_the_name_is_stored_as_one_on_create_and_update(
    api: TestClient, db: Session
) -> None:
    """WhatsApp refuses a template parameter with more than four consecutive spaces."""
    admin = _make_user(db)

    created = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(role="manager", name=" José      Núñez ", tutor=_profile()),
    )
    updated = api.patch(
        f"/api/users/{created.json()['id']}",
        headers=_auth(admin),
        json={"name": "Zoë     Ångström"},
    )

    assert (created.status_code, created.json()["name"]) == (201, "José Núñez")
    assert (updated.status_code, updated.json()["name"]) == (200, "Zoë Ångström")


def test_a_tutor_accounts_name_is_the_tutors_name(api: TestClient, db: Session) -> None:
    """One record per person: the name given here is what the Tutors page shows."""
    admin = _make_user(db)

    body = api.post(
        "/api/users", headers=_auth(admin), json=_create_payload(name="Nadia", tutor=_profile())
    ).json()
    listed = api.get(f"/api/tutors/{body['tutor_id']}", headers=_auth(admin)).json()

    assert body["name"] == "Nadia"
    assert listed["name"] == "Nadia"
    created = db.get(User, uuid.UUID(body["id"]))
    assert (created.name, created.name_is_default) == ("Nadia", False)


def test_the_name_is_listed_and_read_back(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    target = _make_user(db, role=UserRole.MANAGER)

    read = api.get(f"/api/users/{target.id}", headers=_auth(admin)).json()
    listed = api.get("/api/users?page_size=100", headers=_auth(admin)).json()["items"]

    assert read["name"] == "Test User"
    assert {"id": str(target.id), "name": "Test User"}.items() <= next(
        row for row in listed if row["id"] == str(target.id)
    ).items()


@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER])
def test_an_update_sets_the_name_and_clears_the_default_flag(
    api: TestClient, db: Session, role: UserRole
) -> None:
    admin = _make_user(db)
    tutor_id = _make_tutor(db).id if role is UserRole.TUTOR else None
    target = _make_user(db, role=role, tutor_id=tutor_id)
    target.name_is_default = True
    db.flush()

    response = api.patch(f"/api/users/{target.id}", headers=_auth(admin), json={"name": " Maria "})

    assert response.status_code == 200
    assert response.json()["name"] == "Maria"
    db.refresh(target)
    assert (target.name, target.name_is_default) == ("Maria", False)


@pytest.mark.parametrize("name", ["", "   ", "x" * 256], ids=["empty", "blank", "long"])
def test_an_unusable_name_is_422_on_update_and_changes_nothing(
    api: TestClient, db: Session, name: str
) -> None:
    admin = _make_user(db)
    target = _make_user(db, role=UserRole.MANAGER)

    response = api.patch(
        f"/api/users/{target.id}",
        headers=_auth(admin),
        json={"name": name, "email": "changed@example.com"},
    )

    assert response.status_code == 422
    db.refresh(target)
    assert (target.name, target.email) != (name, "changed@example.com")
    assert target.name == "Test User"


def test_an_update_without_a_name_leaves_it_alone(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    target = _make_user(db, role=UserRole.MANAGER)

    api.patch(f"/api/users/{target.id}", headers=_auth(admin), json={"is_active": True})

    db.refresh(target)
    assert target.name == "Test User"


def test_renaming_the_tutor_renames_the_account_and_back(api: TestClient, db: Session) -> None:
    """The two routes edit one row: a name or email written through either is read from both."""
    admin = _make_user(db)
    tutor = _make_tutor(db)
    account = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    via_tutor = api.patch(
        f"/api/tutors/{tutor.id}",
        headers=_auth(admin),
        json={"name": "Renamed Tutor", "email": "renamed@example.com"},
    )
    as_user = api.get(f"/api/users/{account.id}", headers=_auth(admin)).json()
    via_user = api.patch(
        f"/api/users/{account.id}",
        headers=_auth(admin),
        json={"name": "Renamed Again", "email": "again@example.com"},
    )
    as_tutor = api.get(f"/api/tutors/{tutor.id}", headers=_auth(admin)).json()

    assert via_tutor.status_code == 200
    assert (as_user["name"], as_user["email"]) == ("Renamed Tutor", "renamed@example.com")
    assert via_user.status_code == 200
    assert (as_tutor["name"], as_tutor["email"]) == ("Renamed Again", "again@example.com")


# --- Managers ---------------------------------------------------------------------------------


@pytest.mark.parametrize("actor_role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_admin_and_developer_run_a_managers_whole_lifecycle(
    api: TestClient, db: Session, actor_role: UserRole
) -> None:
    """Create, edit, promote to admin, demote back, deactivate (#108)."""
    actor = _make_user(db, role=actor_role)

    created = api.post(
        "/api/users", headers=_auth(actor), json=_create_payload(role="manager", tutor=_profile())
    )
    manager_id = created.json()["id"]
    path = f"/api/users/{manager_id}"
    edited = api.patch(path, headers=_auth(actor), json={"name": "Lead"})
    promoted = api.patch(path, headers=_auth(actor), json={"role": "admin"})
    demoted = api.patch(path, headers=_auth(actor), json={"role": "manager"})
    deactivated = api.delete(path, headers=_auth(actor))

    assert (created.status_code, created.json()["role"]) == (201, "manager")
    assert (edited.status_code, edited.json()["name"]) == (200, "Lead")
    assert (promoted.status_code, promoted.json()["role"]) == (200, "admin")
    assert (demoted.status_code, demoted.json()["role"]) == (200, "manager")
    assert (deactivated.status_code, deactivated.json()["is_active"]) == (200, False)


def test_a_manager_is_created_with_a_profile_and_listed_by_tutors(
    api: TestClient, db: Session
) -> None:
    """A Manager is a Tutor with extra privileges (#130): both rows, and the Tutors page
    lists them. Naming an existing profile is the same 409 it is for a Tutor."""
    admin = _make_user(db)
    tutor = _make_tutor(db)

    linked = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(role="manager", tutor_id=str(tutor.id)),
    )
    with_profile = api.post(
        "/api/users",
        headers=_auth(admin),
        json=_create_payload(role="manager", name="Lead", tutor=_profile()),
    )
    body = with_profile.json()
    tutors = api.get("/api/tutors?page_size=100", headers=_auth(admin)).json()["items"]

    assert linked.status_code == 409
    assert with_profile.status_code == 201
    assert body["role"] == "manager"
    assert db.get(Tutor, uuid.UUID(body["tutor_id"])).user_id == uuid.UUID(body["id"])
    assert {"id": body["tutor_id"], "name": "Lead"}.items() <= next(
        row for row in tutors if row["id"] == body["tutor_id"]
    ).items()


def test_a_tutor_may_become_a_manager_or_an_admin_and_keeps_the_profile(
    api: TestClient, db: Session
) -> None:
    """Promotion keeps the profile, bookings, availability and subjects, so demotion restores
    them; `tutor_id` stays on the user all the way."""
    admin = _make_user(db)
    profile = _make_tutor(db)
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=profile.id)
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()
    api.post(
        f"/api/tutors/{profile.id}/subjects",
        headers=_auth(admin),
        json={"subject_id": str(subject.id), "max_grade_level": 8},
    )
    api.post(
        f"/api/tutors/{profile.id}/availability",
        headers=_auth(admin),
        json={"day_of_week": 0, "start_time": "09:00:00", "end_time": "12:00:00"},
    )
    path = f"/api/users/{tutor.id}"

    manager = api.patch(path, headers=_auth(admin), json={"role": "manager"})
    promoted = api.patch(path, headers=_auth(admin), json={"role": "admin"})
    read = api.get(f"/api/tutors/{profile.id}", headers=_auth(admin)).json()
    availability = api.get(f"/api/tutors/{profile.id}/availability", headers=_auth(admin)).json()
    demoted = api.patch(path, headers=_auth(admin), json={"role": "tutor"})

    assert [(r.status_code, r.json()["role"]) for r in (manager, promoted, demoted)] == [
        (200, "manager"),
        (200, "admin"),
        (200, "tutor"),
    ]
    assert {r.json()["tutor_id"] for r in (manager, promoted, demoted)} == {str(profile.id)}
    assert [row["subject_id"] for row in read["subjects"]] == [str(subject.id)]
    assert availability["total"] == 1
    db.refresh(tutor)
    assert tutor.profile is not None and tutor.profile.id == profile.id


@pytest.mark.parametrize("role", ["tutor", "manager"])
def test_a_user_without_a_profile_may_not_become_a_tutor_or_a_manager(
    api: TestClient, db: Session, role: str
) -> None:
    """The same refusal as a Tutor created without a profile: a `PATCH` never creates one."""
    admin = _make_user(db)
    target = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(f"/api/users/{target.id}", headers=_auth(admin), json={"role": role})

    assert response.status_code == 400
    assert response.json()["detail"] == INVALID_SHAPE_ERROR
    db.refresh(target)
    assert target.role is UserRole.ADMIN


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/users", None),
        ("GET", "/api/users/{id}", None),
        ("POST", "/api/users", "create"),
        ("PATCH", "/api/users/{id}", {"name": "Hijack"}),
        ("DELETE", "/api/users/{id}", None),
        ("GET", "/api/settings", None),
        ("PATCH", "/api/settings", {"updates": [{"key": "reminder_hour", "value": "5"}]}),
    ],
)
def test_a_manager_is_refused_users_and_settings(
    api: TestClient, db: Session, method: str, path: str, body: object
) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    target = _make_user(db, role=UserRole.ADMIN)
    payload = _create_payload(role="admin") if body == "create" else body

    response = api.request(method, path.format(id=target.id), headers=_auth(manager), json=payload)

    assert response.status_code == 403
    db.refresh(target)
    assert (target.name, target.is_active) == ("Test User", True)
