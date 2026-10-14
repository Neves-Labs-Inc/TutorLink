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

import hashlib
import itertools
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.password_link import PasswordLink
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.users import INVALID_SHAPE_ERROR
from app.security import create_access_token, hash_password, verify_password
from tests.fake_mail import FakeMail, token_from

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
    is_archived: bool = False,
) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password(PASSWORD),
            role=role,
            is_archived=is_archived,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password(PASSWORD)
        user.role = role
        user.is_archived = is_archived
    db.flush()
    return user


def _make_tutor_user(db: Session, *, is_archived: bool = False) -> User:
    """A target an admin may still write to: since #173 another admin is developer-only."""
    return _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id, is_archived=is_archived)


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
    dormant = _make_user(db, is_archived=True)
    headers = _auth(admin)

    default = api.get("/api/users", headers=headers).json()
    asked = api.get("/api/users?archived=true", headers=headers).json()

    assert dormant.email not in [row["email"] for row in default["items"]]
    assert [row["email"] for row in asked["items"]] == [dormant.email]


def test_total_respects_the_is_active_filter_even_when_the_page_truncates(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    for _ in range(2):
        _make_user(db, is_archived=True)
    headers = _auth(admin)

    asked = api.get("/api/users?archived=true&page_size=1", headers=headers).json()

    assert len(asked["items"]) == 1
    assert asked["total"] == 2


def test_a_deactivated_user_is_still_readable_by_id(api: TestClient, db: Session) -> None:
    """The by-id path takes no `?is_active` and deliberately does not filter, because the
    surface that deactivated a row has to be able to open it in order to reactivate it — a 404
    would make a soft delete indistinguishable from a hard one."""
    admin = _make_user(db)
    dormant = _make_user(db, is_archived=True)

    response = api.get(f"/api/users/{dormant.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["archived"] is True


def test_malformed_archived_query_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/users?archived=sideways", headers=_auth(admin))

    assert response.status_code == 400
    assert "archived" in response.json()["detail"]


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
    assert developer.is_archived is False


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
    victim = _make_tutor_user(db)

    response = api.delete(f"/api/users/{victim.id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["archived"] is True
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
    target = _make_tutor_user(db)
    passwordless = _make_tutor_user(db)
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
    assert profile.user.is_archived is False
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
    """Create, edit, promote to admin, demote back, deactivate (#108). Once promoted the
    manager is an admin, so a developer demotes them whoever the actor is (#173)."""
    actor = _make_user(db, role=actor_role)
    developer = _make_user(db, role=UserRole.DEVELOPER)

    created = api.post(
        "/api/users", headers=_auth(actor), json=_create_payload(role="manager", tutor=_profile())
    )
    manager_id = created.json()["id"]
    path = f"/api/users/{manager_id}"
    edited = api.patch(path, headers=_auth(actor), json={"name": "Lead"})
    promoted = api.patch(path, headers=_auth(actor), json={"role": "admin"})
    demoted = api.patch(path, headers=_auth(developer), json={"role": "manager"})
    deactivated = api.delete(path, headers=_auth(actor))

    assert (created.status_code, created.json()["role"]) == (201, "manager")
    assert (edited.status_code, edited.json()["name"]) == (200, "Lead")
    assert (promoted.status_code, promoted.json()["role"]) == (200, "admin")
    assert (demoted.status_code, demoted.json()["role"]) == (200, "manager")
    assert (deactivated.status_code, deactivated.json()["archived"]) == (200, True)


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
    them; `tutor_id` stays on the user all the way. A developer demotes: the promoted user is
    an admin by then (#173)."""
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)
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
    demoted = api.patch(path, headers=_auth(developer), json={"role": "tutor"})

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
    developer = _make_user(db, role=UserRole.DEVELOPER)
    target = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(f"/api/users/{target.id}", headers=_auth(developer), json={"role": role})

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
    assert (target.name, target.is_archived) == ("Test User", False)


# --- invites ---------------------------------------------------------------------------------

INVITE_DAYS = 7
# How far a route's own `datetime.now(UTC)` may drift from the test's reading of the clock.
CLOCK_SLACK = timedelta(minutes=1)


def _make_invitee(
    db: Session, *, role: UserRole = UserRole.ADMIN, is_archived: bool = False
) -> User:
    has_profile = role in (UserRole.TUTOR, UserRole.MANAGER)
    tutor_id = _make_tutor(db).id if has_profile else None
    user = _make_user(db, role=role, tutor_id=tutor_id, is_archived=is_archived)
    user.hashed_password = None
    db.flush()
    return user


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _links(db: Session, user: User) -> list[PasswordLink]:
    return list(
        db.scalars(
            select(PasswordLink)
            .where(PasswordLink.user_id == user.id)
            .order_by(PasswordLink.created_at, PasswordLink.id)
        ).all()
    )


def _live_links(db: Session, user: User) -> list[PasswordLink]:
    now = datetime.now(UTC)
    return [
        link
        for link in _links(db, user)
        if link.used_at is None and link.revoked_at is None and link.expires_at > now
    ]


def test_inviting_a_user_without_a_login_emails_a_single_use_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    admin.name = "Rita Admin"
    invitee = _make_invitee(db)

    response = api.post(f"/api/users/{invitee.id}/invite", headers=_auth(admin))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(invitee.id)
    assert body["has_password"] is False
    expires_at = datetime.fromisoformat(body["invite_expires_at"])
    expected = datetime.now(UTC) + timedelta(days=INVITE_DAYS)
    assert abs(expires_at - expected) < CLOCK_SLACK

    assert len(fake_mail.sent) == 1
    email = fake_mail.sent[0]
    assert email.to == invitee.email
    assert email.subject == "Rita Admin invited you to TutorLink"
    assert "Rita Admin" in email.text
    assert "http://testserver/set-password?token=" in email.text
    assert "expires in 7 days" in email.text
    assert email.html is not None and "http://testserver/set-password?token=" in email.html

    token = token_from(email)
    (link,) = _links(db, invitee)
    assert link.token_hash == _sha256(token)
    assert link.email == invitee.email
    # The plaintext lives in the email alone: no column of the row carries it.
    stored_values = [str(value) for value in vars(link).values() if value is not None]
    assert not any(token in value for value in stored_values)


def test_a_second_invite_replaces_the_first_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    invitee = _make_invitee(db)
    headers = _auth(admin)

    first = api.post(f"/api/users/{invitee.id}/invite", headers=headers)
    second = api.post(f"/api/users/{invitee.id}/invite", headers=headers)

    assert (first.status_code, second.status_code) == (200, 200)
    by_hash = {link.token_hash: link for link in _links(db, invitee)}
    older = by_hash[_sha256(token_from(fake_mail.sent[0]))]
    newer = by_hash[_sha256(token_from(fake_mail.sent[1]))]
    assert older.revoked_at is not None
    assert newer.revoked_at is None
    assert _live_links(db, invitee) == [newer]


def test_a_user_with_a_password_cannot_be_invited(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    target = _make_tutor_user(db)

    response = api.post(f"/api/users/{target.id}/invite", headers=_auth(admin))

    assert response.status_code == 409
    assert response.json()["detail"] == "That user already has a password"
    assert fake_mail.sent == []
    assert _links(db, target) == []


def test_a_deactivated_user_cannot_be_invited(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    dormant = _make_invitee(db, is_archived=True)

    response = api.post(f"/api/users/{dormant.id}/invite", headers=_auth(admin))

    assert response.status_code == 409
    assert response.json()["detail"] == "Deactivated users cannot be invited"
    assert fake_mail.sent == []
    assert _links(db, dormant) == []


def test_only_a_developer_may_invite_a_developer(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)
    target = _make_invitee(db, role=UserRole.DEVELOPER)

    refused = api.post(f"/api/users/{target.id}/invite", headers=_auth(admin))
    allowed = api.post(f"/api/users/{target.id}/invite", headers=_auth(developer))

    assert refused.status_code == 403
    assert allowed.status_code == 200
    assert len(fake_mail.sent) == 1


def test_a_manager_may_not_invite(api: TestClient, db: Session, fake_mail: FakeMail) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    target = _make_invitee(db)

    response = api.post(f"/api/users/{target.id}/invite", headers=_auth(manager))

    assert response.status_code == 403
    assert fake_mail.sent == []


def test_inviting_an_unknown_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(f"/api/users/{uuid.uuid4()}/invite", headers=_auth(admin))

    assert response.status_code == 404


def test_a_failed_send_keeps_no_link_and_the_user_is_not_invited(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    invitee = _make_invitee(db)
    headers = _auth(admin)
    fake_mail.fail_next()

    response = api.post(f"/api/users/{invitee.id}/invite", headers=headers)

    assert response.status_code == 502
    assert response.json()["detail"] == "Could not send the invite email. Try again."
    assert fake_mail.sent == []
    assert _links(db, invitee) == []
    shown = api.get(f"/api/users/{invitee.id}", headers=headers).json()
    assert shown["invite_expires_at"] is None
    assert shown["has_password"] is False


def test_a_failed_resend_keeps_the_earlier_link_live(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    """The savepoint unwinds the revocation too: a resend that never went out changes nothing."""
    admin = _make_user(db)
    invitee = _make_invitee(db)
    headers = _auth(admin)
    api.post(f"/api/users/{invitee.id}/invite", headers=headers)
    fake_mail.fail_next()

    response = api.post(f"/api/users/{invitee.id}/invite", headers=headers)

    assert response.status_code == 502
    (live,) = _live_links(db, invitee)
    assert live.token_hash == _sha256(token_from(fake_mail.sent[0]))


def test_changing_the_email_revokes_every_live_link(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    invitee = _make_invitee(db, role=UserRole.TUTOR)
    headers = _auth(admin)
    api.post(f"/api/users/{invitee.id}/invite", headers=headers)

    response = api.patch(
        f"/api/users/{invitee.id}", headers=headers, json={"email": "moved@example.com"}
    )

    assert response.status_code == 200
    assert response.json()["invite_expires_at"] is None
    assert _live_links(db, invitee) == []


def test_echoing_the_same_email_in_any_casing_leaves_the_links_alone(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    invitee = _make_invitee(db, role=UserRole.TUTOR)
    headers = _auth(admin)
    api.post(f"/api/users/{invitee.id}/invite", headers=headers)

    response = api.patch(
        f"/api/users/{invitee.id}", headers=headers, json={"email": invitee.email.upper()}
    )

    assert response.status_code == 200
    assert response.json()["invite_expires_at"] is not None
    assert len(_live_links(db, invitee)) == 1


def test_the_list_shows_an_expiry_only_for_a_live_invite(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    invited = _make_invitee(db)
    lapsed = _make_invitee(db)
    never = _make_invitee(db)
    headers = _auth(admin)
    api.post(f"/api/users/{invited.id}/invite", headers=headers)
    api.post(f"/api/users/{lapsed.id}/invite", headers=headers)
    (stale,) = _links(db, lapsed)
    stale.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.flush()

    items = api.get("/api/users?page_size=100", headers=headers).json()["items"]

    by_id = {item["id"]: item["invite_expires_at"] for item in items}
    assert by_id[str(invited.id)] is not None
    assert by_id[str(lapsed.id)] is None
    assert by_id[str(never.id)] is None
    assert by_id[str(admin.id)] is None


# --- password reset links --------------------------------------------------------------------

RESET_HOURS = 48
NEW_PASSWORD = "a brand new password"


def _send_reset(api: TestClient, target: User, *, actor: User) -> Response:
    return api.post(f"/api/users/{target.id}/password-reset", headers=_auth(actor))


def _login(api: TestClient, user: User, *, password: str = PASSWORD) -> Response:
    return api.post("/auth/token", data={"username": user.email, "password": password})


def _set_password(api: TestClient, *, token: str) -> Response:
    return api.post("/auth/password/set", json={"token": token, "password": NEW_PASSWORD})


def _refresh(api: TestClient, refresh_token: str) -> Response:
    # The body, not a cookie: each call names exactly the session it tests.
    api.cookies.clear()
    return api.post("/auth/refresh", json={"refresh_token": refresh_token})


def test_an_admin_emails_a_user_a_reset_link_that_sets_their_password(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    target = _make_tutor_user(db)

    response = _send_reset(api, target, actor=admin)

    assert response.status_code == 204
    assert response.content == b""
    (email,) = fake_mail.sent
    assert email.to == target.email
    (link,) = _live_links(db, target)
    expected = datetime.now(UTC) + timedelta(hours=RESET_HOURS)
    assert abs(link.expires_at - expected) < CLOCK_SLACK

    completed = _set_password(api, token=token_from(email))

    assert completed.status_code == 200
    assert _login(api, target, password=NEW_PASSWORD).status_code == 200
    assert _login(api, target).status_code == 401


def test_a_second_reset_link_revokes_the_first(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    target = _make_tutor_user(db)

    first = _send_reset(api, target, actor=admin)
    second = _send_reset(api, target, actor=admin)

    assert (first.status_code, second.status_code) == (204, 204)
    older, newer = (token_from(email) for email in fake_mail.sent)
    assert _set_password(api, token=older).status_code == 400
    assert _set_password(api, token=newer).status_code == 200


def test_a_failed_reset_send_is_502_and_keeps_no_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    target = _make_tutor_user(db)
    fake_mail.fail_next()

    response = _send_reset(api, target, actor=admin)

    assert response.status_code == 502
    assert response.json()["detail"] == "Could not send the reset email. Try again."
    assert fake_mail.sent == []
    assert _links(db, target) == []


def test_only_a_developer_may_send_a_developer_a_reset_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)
    target = _make_user(db, role=UserRole.DEVELOPER)

    refused = _send_reset(api, target, actor=admin)
    allowed = _send_reset(api, target, actor=developer)

    assert refused.status_code == 403
    assert refused.json()["detail"] == "Only a developer may create or modify a developer account"
    assert allowed.status_code == 204
    assert len(fake_mail.sent) == 1


def test_a_deactivated_user_cannot_be_sent_a_reset_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    dormant = _make_tutor_user(db, is_archived=True)

    response = _send_reset(api, dormant, actor=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == "Deactivated users cannot be sent a reset link"
    assert fake_mail.sent == []
    assert _links(db, dormant) == []


def test_a_user_without_a_password_is_pointed_to_an_invite(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    invitee = _make_invitee(db, role=UserRole.TUTOR)

    response = _send_reset(api, invitee, actor=admin)

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "That user has not set a password yet. Send an invite instead."
    )
    assert fake_mail.sent == []
    assert _links(db, invitee) == []


def test_sending_a_reset_link_to_an_unknown_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(f"/api/users/{uuid.uuid4()}/password-reset", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json()["detail"] == "User not found"


def test_a_manager_may_not_send_a_reset_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    target = _make_user(db)

    response = _send_reset(api, target, actor=manager)

    assert response.status_code == 403
    assert fake_mail.sent == []


def test_sending_a_reset_link_keeps_sessions_and_completing_it_ends_them(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    target = _make_tutor_user(db)
    session = _login(api, target).json()["refresh_token"]

    _send_reset(api, target, actor=admin)
    after_send = _refresh(api, session)
    rotated = after_send.json()["refresh_token"]
    _set_password(api, token=token_from(fake_mail.sent[0]))
    after_reset = _refresh(api, rotated)

    assert after_send.status_code == 200
    assert after_reset.status_code == 401


def test_each_sent_reset_link_is_logged_by_user_id_without_the_address(
    api: TestClient, db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    admin = _make_user(db)
    target = _make_tutor_user(db)

    with caplog.at_level("INFO", logger="app.services.user_service"):
        _send_reset(api, target, actor=admin)

    sent = [record for record in caplog.records if "reset link sent" in record.getMessage()]
    assert len(sent) == 1
    assert str(target.id) in sent[0].getMessage()
    assert not any(target.email in record.getMessage() for record in caplog.records)


# --- #173: peer admins are developer-only, and an admin can't demote or deactivate themselves --

PEER_ADMIN_FORBIDDEN = "Only a developer may modify another admin's account"
SELF_CHANGE_FORBIDDEN = "You cannot change your own role or deactivate your own account"


def _snapshot(db: Session, user: User) -> tuple[object, ...]:
    db.refresh(user)
    links = tuple(
        (link.id, link.used_at, link.revoked_at, link.expires_at) for link in _links(db, user)
    )
    return (user.email, user.name, user.role, user.is_archived, user.hashed_password, links)


def _peer_with_a_live_reset_link(api: TestClient, db: Session) -> User:
    """A peer admin holding a live link, so a refused write can be seen not to revoke it."""
    developer = _make_user(db, role=UserRole.DEVELOPER)
    peer = _make_user(db)
    assert _send_reset(api, peer, actor=developer).status_code == 204
    return peer


@pytest.mark.parametrize(
    "change",
    [
        {"email": "taken-over@example.com"},
        {"name": "Someone Else"},
        {"role": "tutor"},
        {"is_active": False},
    ],
    ids=["email", "name", "role", "is_active"],
)
def test_an_admin_cannot_patch_a_peer_admin(
    api: TestClient, db: Session, fake_mail: FakeMail, change: dict[str, object]
) -> None:
    admin = _make_user(db)
    peer = _peer_with_a_live_reset_link(api, db)
    fake_mail.sent.clear()
    before = _snapshot(db, peer)

    response = api.patch(f"/api/users/{peer.id}", headers=_auth(admin), json=change)

    assert response.status_code == 403
    assert response.json()["detail"] == PEER_ADMIN_FORBIDDEN
    assert _snapshot(db, peer) == before
    assert len(_live_links(db, peer)) == 1
    assert fake_mail.sent == []


def test_an_admin_cannot_patch_a_peer_admin_even_with_a_no_op(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    peer = _make_user(db)

    response = api.patch(f"/api/users/{peer.id}", headers=_auth(admin), json={})

    assert response.status_code == 403
    assert response.json()["detail"] == PEER_ADMIN_FORBIDDEN


def test_demoting_a_peer_admin_is_refused_at_the_first_step(api: TestClient, db: Session) -> None:
    """The bypass: demote to tutor, edit the tutor, promote back. The first PATCH must fail."""
    admin = _make_user(db)
    peer = _make_user(db, role=UserRole.ADMIN, tutor_id=_make_tutor(db).id)

    response = api.patch(f"/api/users/{peer.id}", headers=_auth(admin), json={"role": "tutor"})

    assert response.status_code == 403
    assert response.json()["detail"] == PEER_ADMIN_FORBIDDEN
    db.refresh(peer)
    assert peer.role is UserRole.ADMIN


def test_an_admin_cannot_deactivate_a_peer_admin(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    peer = _peer_with_a_live_reset_link(api, db)
    fake_mail.sent.clear()
    before = _snapshot(db, peer)

    response = api.delete(f"/api/users/{peer.id}", headers=_auth(admin))

    assert response.status_code == 403
    assert response.json()["detail"] == PEER_ADMIN_FORBIDDEN
    assert _snapshot(db, peer) == before
    assert fake_mail.sent == []


def test_an_admin_cannot_send_a_peer_admin_a_reset_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    peer = _peer_with_a_live_reset_link(api, db)
    fake_mail.sent.clear()
    before = _snapshot(db, peer)

    response = _send_reset(api, peer, actor=admin)

    assert response.status_code == 403
    assert response.json()["detail"] == PEER_ADMIN_FORBIDDEN
    assert _snapshot(db, peer) == before
    assert fake_mail.sent == []


def test_an_admin_may_invite_a_peer_admin_who_never_set_a_password(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    peer = _make_invitee(db, role=UserRole.ADMIN)

    response = api.post(f"/api/users/{peer.id}/invite", headers=_auth(admin))

    assert response.status_code == 200
    (email,) = fake_mail.sent
    assert email.to == peer.email
    assert len(_live_links(db, peer)) == 1


def test_inviting_a_peer_admin_with_a_password_is_still_409(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    peer = _make_user(db)

    response = api.post(f"/api/users/{peer.id}/invite", headers=_auth(admin))

    assert response.status_code == 409
    assert response.json()["detail"] == "That user already has a password"
    assert fake_mail.sent == []


def test_a_developer_may_do_everything_to_an_admin(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    headers = _auth(developer)
    edited = _make_user(db)
    invitee = _make_invitee(db, role=UserRole.ADMIN)
    reset_target = _make_user(db)
    deactivated = _make_user(db)

    patched = api.patch(
        f"/api/users/{edited.id}",
        headers=headers,
        json={"email": "moved@example.com", "name": "Moved Admin", "is_active": True},
    )
    invited = api.post(f"/api/users/{invitee.id}/invite", headers=headers)
    reset = _send_reset(api, reset_target, actor=developer)
    deleted = api.delete(f"/api/users/{deactivated.id}", headers=headers)

    assert patched.status_code == 200
    assert patched.json()["email"] == "moved@example.com"
    assert invited.status_code == 200
    assert reset.status_code == 204
    assert deleted.status_code == 200
    assert deleted.json()["archived"] is True
    assert [email.to for email in fake_mail.sent] == [invitee.email, reset_target.email]


@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER])
def test_an_admin_still_runs_a_tutor_or_manager_account(
    api: TestClient, db: Session, fake_mail: FakeMail, role: UserRole
) -> None:
    admin = _make_user(db)
    headers = _auth(admin)
    target = _make_user(db, role=role, tutor_id=_make_tutor(db).id)
    invitee = _make_user(db, role=role, tutor_id=_make_tutor(db).id)
    invitee.hashed_password = None
    db.flush()

    # The reset first: once promoted, the target is a peer admin.
    reset = _send_reset(api, target, actor=admin)
    patched = api.patch(
        f"/api/users/{target.id}", headers=headers, json={"name": "Renamed", "role": "admin"}
    )
    invited = api.post(f"/api/users/{invitee.id}/invite", headers=headers)
    deleted = api.delete(f"/api/users/{invitee.id}", headers=headers)

    assert patched.status_code == 200
    assert patched.json()["role"] == "admin"
    assert reset.status_code == 204
    assert invited.status_code == 200
    assert deleted.status_code == 200


def test_an_admin_may_still_create_an_admin(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post("/api/users", headers=_auth(admin), json=_create_payload(role="admin"))

    assert response.status_code == 201
    assert response.json()["role"] == "admin"


def test_an_admin_may_change_their_own_email_and_name(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(
        f"/api/users/{admin.id}",
        headers=_auth(admin),
        json={"email": "me-now@example.com", "name": "New Me"},
    )

    assert response.status_code == 200
    db.refresh(admin)
    assert admin.email == "me-now@example.com"
    assert admin.name == "New Me"


def test_an_admin_may_resave_their_own_form_unchanged(api: TestClient, db: Session) -> None:
    """The dashboard sends every field, so an unchanged role and `is_active=true` must pass."""
    admin = _make_user(db)

    response = api.patch(
        f"/api/users/{admin.id}",
        headers=_auth(admin),
        json={"email": admin.email, "name": "Same Me", "role": "admin", "is_active": True},
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Same Me"


@pytest.mark.parametrize(
    "change",
    [{"role": "tutor"}, {"is_active": False}, {"name": "Sneaky", "is_active": False}],
    ids=["role", "is_active", "name-and-is_active"],
)
def test_an_admin_cannot_change_their_own_role_or_deactivate_themselves(
    api: TestClient, db: Session, change: dict[str, object]
) -> None:
    admin = _make_user(db, role=UserRole.ADMIN, tutor_id=_make_tutor(db).id)
    before = _snapshot(db, admin)

    response = api.patch(f"/api/users/{admin.id}", headers=_auth(admin), json=change)

    assert response.status_code == 403
    assert response.json()["detail"] == SELF_CHANGE_FORBIDDEN
    assert _snapshot(db, admin) == before


def test_an_admin_cannot_delete_themselves(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    before = _snapshot(db, admin)

    response = api.delete(f"/api/users/{admin.id}", headers=_auth(admin))

    assert response.status_code == 403
    assert response.json()["detail"] == SELF_CHANGE_FORBIDDEN
    assert _snapshot(db, admin) == before


def test_an_admin_may_still_send_themselves_a_reset_link(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)

    response = _send_reset(api, admin, actor=admin)

    assert response.status_code == 204
    assert [email.to for email in fake_mail.sent] == [admin.email]


def test_a_developer_may_still_change_their_own_role_and_deactivate_themselves(
    api: TestClient, db: Session
) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    other = _make_user(db, role=UserRole.DEVELOPER)

    demoted = api.patch(
        f"/api/users/{developer.id}", headers=_auth(developer), json={"role": "admin"}
    )
    deleted = api.delete(f"/api/users/{other.id}", headers=_auth(other))

    assert demoted.status_code == 200
    assert demoted.json()["role"] == "admin"
    assert deleted.status_code == 200
    assert deleted.json()["archived"] is True
