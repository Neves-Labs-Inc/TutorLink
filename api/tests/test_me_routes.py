"""`PATCH /api/me`: every signed-in user, Tutors included, renames themselves and nobody else.

The caller is the token's user and nothing in the request can name another one: an `id` in the
body is not a field the route reads.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token

ORIGINAL_NAME = "Original Name"
# Control (Cc), invisible format (Cf) and line or paragraph separator (Zl, Zp) characters a
# Display name may not carry: NUL breaks the write, a line break breaks the WhatsApp template,
# and zero-width and bidi characters make a name look blank or read backwards.
HIDDEN_CHARACTER_NAMES = {
    "nul": "Ana\x00",
    "newline": "Ana\nPay to IBAN X",
    "zero-width space": "Ana\u200bLopez",
    "bidi override": "Ana\u202eevil",
    "line separator": "Ana\u2028Lopez",
    "paragraph separator": "Ana\u2029Lopez",
}
NEW_NAME = "Maria Lopez"
MAX_NAME_LENGTH = 255
OFFICE_PHONE_NUMBER = "+15551234567"


def test_each_role_renames_its_own_row(api: TestClient, db: Session) -> None:
    for role in UserRole:
        caller = _make_user(db, role=role)
        bystander = _make_user(db, role=role)

        response = api.patch("/api/me", headers=_auth(caller), json={"name": NEW_NAME})

        assert response.status_code == 200, (role, response.text)
        assert response.json() == {
            "id": str(caller.id),
            "email": caller.email,
            "role": role.value,
            "name": NEW_NAME,
            "tutor_id": None if caller.profile_id is None else str(caller.profile_id),
            "office_phone": None,
            "welcome_seen": False,
        }
        db.refresh(caller)
        db.refresh(bystander)
        assert (caller.name, bystander.name) == (NEW_NAME, ORIGINAL_NAME)


def test_the_new_name_is_what_get_me_returns(api: TestClient, db: Session) -> None:
    caller = _make_user(db, role=UserRole.TUTOR)

    api.patch("/api/me", headers=_auth(caller), json={"name": NEW_NAME})

    assert api.get("/api/me", headers=_auth(caller)).json()["name"] == NEW_NAME


def test_naming_another_user_in_the_body_changes_only_the_caller(
    api: TestClient, db: Session
) -> None:
    caller = _make_user(db, role=UserRole.MANAGER)
    target = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        "/api/me",
        headers=_auth(caller),
        json={"id": str(target.id), "name": NEW_NAME},
    )

    assert response.json()["id"] == str(caller.id)
    db.refresh(target)
    assert target.name == ORIGINAL_NAME


def test_setting_a_name_clears_the_default_flag(api: TestClient, db: Session) -> None:
    caller = _make_user(db, role=UserRole.ADMIN, is_default=True)

    api.patch("/api/me", headers=_auth(caller), json={"name": NEW_NAME})

    db.refresh(caller)
    assert caller.name_is_default is False


def test_the_name_is_stored_trimmed(api: TestClient, db: Session) -> None:
    caller = _make_user(db, role=UserRole.ADMIN)

    response = api.patch("/api/me", headers=_auth(caller), json={"name": "  Ana  "})

    assert response.json()["name"] == "Ana"


def test_a_run_of_spaces_inside_the_name_is_stored_as_one(api: TestClient, db: Session) -> None:
    """WhatsApp refuses a template parameter with more than four consecutive spaces."""
    caller = _make_user(db, role=UserRole.MANAGER)

    response = api.patch("/api/me", headers=_auth(caller), json={"name": "Ana      Maria  Lopez"})

    assert (response.status_code, response.json()["name"]) == (200, "Ana Maria Lopez")


@pytest.mark.parametrize(
    "name",
    ["", "   ", "x" * (MAX_NAME_LENGTH + 1)],
    ids=["empty", "blank", "too long"],
)
def test_an_unusable_name_is_refused_and_changes_nothing(
    api: TestClient, db: Session, name: str
) -> None:
    caller = _make_user(db, role=UserRole.MANAGER)

    response = api.patch("/api/me", headers=_auth(caller), json={"name": name})

    assert response.status_code == 422
    db.refresh(caller)
    assert caller.name == ORIGINAL_NAME


@pytest.mark.parametrize("name", HIDDEN_CHARACTER_NAMES.values(), ids=HIDDEN_CHARACTER_NAMES.keys())
def test_a_name_with_control_or_invisible_characters_is_422(
    api: TestClient, db: Session, name: str
) -> None:
    caller = _make_user(db, role=UserRole.TUTOR)

    response = api.patch("/api/me", headers=_auth(caller), json={"name": name})

    assert response.status_code == 422
    assert "control or invisible characters" in response.json()["detail"]
    db.refresh(caller)
    assert caller.name == ORIGINAL_NAME


def test_an_accented_name_is_accepted(api: TestClient, db: Session) -> None:
    caller = _make_user(db, role=UserRole.MANAGER)

    response = api.patch("/api/me", headers=_auth(caller), json={"name": "José Núñez"})

    assert (response.status_code, response.json()["name"]) == (200, "José Núñez")


@pytest.mark.parametrize("body", [{}, {"name": None}], ids=["missing", "null"])
def test_a_body_without_a_name_is_a_malformed_request(
    api: TestClient, db: Session, body: dict[str, None]
) -> None:
    """The project answers a schema failure with 400 (`main.py`); 422 is for a well-formed
    name the rules refuse."""
    caller = _make_user(db, role=UserRole.TUTOR)

    response = api.patch("/api/me", headers=_auth(caller), json=body)

    assert response.status_code == 400


def test_a_name_of_exactly_the_limit_is_accepted(api: TestClient, db: Session) -> None:
    caller = _make_user(db, role=UserRole.MANAGER)
    longest = "x" * MAX_NAME_LENGTH

    response = api.patch("/api/me", headers=_auth(caller), json={"name": longest})

    assert response.status_code == 200


def test_no_token_is_401(api: TestClient) -> None:
    response = api.patch("/api/me", json={"name": NEW_NAME})

    assert response.status_code == 401


def test_get_me_carries_the_callers_own_tutor_id(api: TestClient, db: Session) -> None:
    tutor = _make_user(db, role=UserRole.TUTOR)
    manager = _make_user(db, role=UserRole.MANAGER, has_profile=True)
    admin = _make_user(db, role=UserRole.ADMIN)

    tutor_ids = [
        api.get("/api/me", headers=_auth(caller)).json()["tutor_id"]
        for caller in (tutor, manager, admin)
    ]

    assert tutor.profile_id is not None and manager.profile_id is not None
    assert tutor_ids == [str(tutor.profile_id), str(manager.profile_id), None]


def test_patch_me_carries_the_callers_own_tutor_id(api: TestClient, db: Session) -> None:
    manager = _make_user(db, role=UserRole.MANAGER, has_profile=True)

    response = api.patch("/api/me", headers=_auth(manager), json={"name": NEW_NAME})

    assert manager.profile_id is not None
    assert response.json()["tutor_id"] == str(manager.profile_id)


def test_a_tutor_reads_the_office_phone_an_admin_saved(api: TestClient, db: Session) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    tutor = _make_user(db, role=UserRole.TUTOR)

    saved = api.patch(
        "/api/settings",
        headers=_auth(admin),
        json={"updates": [{"key": "office_phone", "value": OFFICE_PHONE_NUMBER}]},
    )
    response = api.get("/api/me", headers=_auth(tutor))

    assert saved.status_code == 200
    assert response.json()["office_phone"] == OFFICE_PHONE_NUMBER


@pytest.mark.parametrize("value", ["", "   "], ids=["empty", "whitespace"])
def test_a_cleared_office_phone_reads_as_null(api: TestClient, db: Session, value: str) -> None:
    admin_headers = _auth(_make_user(db, role=UserRole.ADMIN))
    tutor = _make_user(db, role=UserRole.TUTOR)
    for phone in (OFFICE_PHONE_NUMBER, value):
        api.patch(
            "/api/settings",
            headers=admin_headers,
            json={"updates": [{"key": "office_phone", "value": phone}]},
        )

    response = api.get("/api/me", headers=_auth(tutor))

    assert response.json()["office_phone"] is None


def test_a_new_user_has_not_seen_the_welcome_and_posting_marks_it_seen(
    api: TestClient, db: Session
) -> None:
    for role in UserRole:
        caller = _make_user(db, role=role)
        assert api.get("/api/me", headers=_auth(caller)).json()["welcome_seen"] is False

        first = api.post("/api/me/welcome-seen", headers=_auth(caller))
        db.refresh(caller)
        first_seen_at = caller.welcome_seen_at
        second = api.post("/api/me/welcome-seen", headers=_auth(caller))
        db.refresh(caller)

        assert (first.status_code, second.status_code) == (204, 204), role
        assert api.get("/api/me", headers=_auth(caller)).json()["welcome_seen"] is True
        assert first_seen_at is not None
        assert caller.welcome_seen_at == first_seen_at


def test_patch_me_carries_welcome_seen(api: TestClient, db: Session) -> None:
    caller = _make_user(db, role=UserRole.MANAGER)
    api.post("/api/me/welcome-seen", headers=_auth(caller))

    response = api.patch("/api/me", headers=_auth(caller), json={"name": NEW_NAME})

    assert response.json()["welcome_seen"] is True


def test_marking_the_welcome_seen_touches_only_the_caller(api: TestClient, db: Session) -> None:
    caller = _make_user(db, role=UserRole.ADMIN)
    bystander = _make_user(db, role=UserRole.ADMIN)

    api.post("/api/me/welcome-seen", headers=_auth(caller))

    db.refresh(bystander)
    assert bystander.welcome_seen_at is None


def test_welcome_seen_without_a_token_is_401(api: TestClient) -> None:
    assert api.post("/api/me/welcome-seen").status_code == 401


def _make_user(
    db: Session, *, role: UserRole, is_default: bool = False, has_profile: bool = False
) -> User:
    user = User(
        email=f"me-{uuid.uuid4().hex[:12]}@example.com",
        name=ORIGINAL_NAME,
        name_is_default=is_default,
        hashed_password="not-a-real-hash",
        role=role,
        is_archived=False,
    )
    if role is UserRole.TUTOR or has_profile:
        # One record per person: the Tutor is this user, with a profile hanging off it.
        user.profile = Tutor(phone_number=f"+1{uuid.uuid4().hex[:10]}")
    db.add(user)
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}
