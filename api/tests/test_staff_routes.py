"""`GET /api/staff` over HTTP — the bookable people, readable by every Office role.

The list is the booking form's and the Bookings Staff filter's one source for "who can a
Booking be with": active Tutors, Managers and Admins, each with the `id` that
`POST /api/bookings.user_id` takes and the `tutor_id` that `GET /api/tutors/{id}/availability`
takes. A Developer is never listed, and only `users.is_active` decides who is active.
"""

import uuid

from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import CREDENTIALS_ERROR, OFFICE_REQUIRED_ERROR
from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.schemas.common import DEFAULT_PAGE_SIZE
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"
ITEM_FIELDS = {"id", "name", "role", "tutor_id"}


def _make_user(
    db: Session,
    *,
    role: UserRole = UserRole.ADMIN,
    name: str | None = None,
    is_active: bool = True,
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name=name or f"User {uuid.uuid4().hex[:12]}",
        hashed_password=hash_password(PASSWORD),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.flush()
    return user


def _make_tutor(
    db: Session,
    *,
    role: UserRole = UserRole.TUTOR,
    name: str | None = None,
    is_active: bool = True,
) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(
            email=f"tutor-{suffix}@example.com",
            name=name or f"Tutor {suffix}",
            hashed_password=hash_password(PASSWORD),
            role=role,
            is_active=is_active,
        ),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


def _ids(body: dict[str, object]) -> list[str]:
    items = body["items"]
    assert isinstance(items, list)
    return [row["id"] for row in items]


# --- the gate ---------------------------------------------------------------------------------


def test_an_admin_and_a_manager_list_the_active_tutors_managers_and_admins(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db, role=UserRole.ADMIN, name="Admin Person")
    manager = _make_tutor(db, role=UserRole.MANAGER, name="Manager Person")
    tutor = _make_tutor(db, name="Tutor Person")
    expected = {str(admin.id), str(manager.user_id), str(tutor.user_id)}

    for caller in (admin, manager.user):
        body = api.get("/api/staff", headers=_auth(caller)).json()

        assert set(body) == {"items", "total", "page", "page_size"}
        assert expected <= set(_ids(body))
        assert all(set(row) == ITEM_FIELDS for row in body["items"])


def test_a_developer_token_is_200(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    response = api.get("/api/staff", headers=_auth(developer))

    assert response.status_code == 200


def test_a_tutor_token_is_403(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.get("/api/staff", headers=_auth(tutor.user))

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)


def test_no_token_is_401(api: TestClient) -> None:
    response = api.get("/api/staff")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


# --- who is listed --------------------------------------------------------------------------


def test_a_developer_user_is_never_listed(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    body = api.get("/api/staff?page_size=100", headers=_auth(developer)).json()

    assert str(developer.id) not in _ids(body)


def test_an_inactive_tutor_is_absent(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    retired = _make_tutor(db, is_active=False)

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    assert str(retired.user_id) not in _ids(body)


def test_a_manager_with_no_profile_has_a_null_tutor_id(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    manager = _make_user(db, role=UserRole.MANAGER, name="Migrated Manager")

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    assert {
        "id": str(manager.id),
        "name": "Migrated Manager",
        "role": "manager",
        "tutor_id": None,
    } in body["items"]


def test_a_tutor_with_a_profile_carries_its_tutors_id(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db, name="Sarah Miller")

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    assert {
        "id": str(tutor.user_id),
        "name": "Sarah Miller",
        "role": "tutor",
        "tutor_id": str(tutor.id),
    } in body["items"]


# --- ordering and paging --------------------------------------------------------------------


def test_items_are_ordered_by_name(api: TestClient, db: Session) -> None:
    admin = _make_user(db, name="Zed Admin")
    _make_tutor(db, name="Bea Tutor")
    _make_user(db, role=UserRole.MANAGER, name="Abe Manager")
    _make_tutor(db, name="Cal Tutor")

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    names = [row["name"] for row in body["items"]]
    assert names == sorted(names)


def test_total_counts_beyond_the_page(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    for _ in range(DEFAULT_PAGE_SIZE):
        _make_tutor(db)

    body = api.get("/api/staff", headers=_auth(admin)).json()

    assert len(body["items"]) == DEFAULT_PAGE_SIZE
    assert body["total"] > DEFAULT_PAGE_SIZE
    assert body["page"] == 1
    assert body["page_size"] == DEFAULT_PAGE_SIZE
