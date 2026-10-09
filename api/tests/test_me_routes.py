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


def _make_user(db: Session, *, role: UserRole, is_default: bool = False) -> User:
    user = User(
        email=f"me-{uuid.uuid4().hex[:12]}@example.com",
        name=ORIGINAL_NAME,
        name_is_default=is_default,
        hashed_password="not-a-real-hash",
        role=role,
        is_active=True,
    )
    if role is UserRole.TUTOR:
        # One record per person: the Tutor is this user, with a profile hanging off it.
        user.profile = Tutor(phone_number=f"+1{uuid.uuid4().hex[:10]}")
    db.add(user)
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}
