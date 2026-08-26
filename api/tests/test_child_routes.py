"""`/api/children` over HTTP — REQ-034, and the replace semantics OQ-1 settles.

The frozen contract offers no `GET /api/children/{id}`, so most of what matters here is
invisible over HTTP and is asserted against the junction tables directly. Three things a
passing response body cannot show on its own:

- a link that falls out of a `PATCH` is **hard-deleted**, not deactivated;
- a link that stays keeps **its own row** — the junction primary key is what separates set
  replacement from delete-all-then-reinsert, which look identical in the response;
- an **absent** link array is not an empty one, or a rename would silently unlink every
  guardian a child has.

Guardians and homes are made through the ORM rather than through `POST /api/clients`, so
phone-number normalisation never runs and these tests do not inherit REQ-037's fixtures.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"


def _phone() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(name=f"Tutor {suffix}", phone_number=_phone(), email=f"t-{suffix}@example.com")
    db.add(tutor)
    db.flush()
    return tutor


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password(PASSWORD),
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_guardian(db: Session) -> Guardian:
    guardian = Guardian(name=f"Guardian {uuid.uuid4().hex[:8]}", phone_number=_phone())
    db.add(guardian)
    db.flush()
    return guardian


def _make_home(db: Session) -> Home:
    home = Home(address=f"{uuid.uuid4().hex[:6]} Elm Street", access_code="1234")
    db.add(home)
    db.flush()
    return home


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _payload(*, guardians: list[Guardian], homes: list[Home]) -> dict[str, object]:
    return {
        "guardian_ids": [str(one.id) for one in guardians],
        "home_ids": [str(one.id) for one in homes],
        "name": "Tommy Doe",
        "age": 12,
        "grade_level": 7,
        "school_name": "Lincoln Middle School",
    }


def _create_child(
    api: TestClient, admin: User, *, guardians: list[Guardian], homes: list[Home]
) -> uuid.UUID:
    response = api.post(
        "/api/children", headers=_auth(admin), json=_payload(guardians=guardians, homes=homes)
    )
    assert response.status_code == 201
    return uuid.UUID(response.json()["id"])


def _guardian_links(db: Session, child_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    """Guardian id → the junction row's own primary key, which is what pins set replacement."""
    return {
        link.guardian_id: link.id
        for link in db.scalars(select(ChildGuardian).where(ChildGuardian.child_id == child_id))
    }


def _home_links(db: Session, child_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    return {
        link.home_id: link.id
        for link in db.scalars(select(ChildHome).where(ChildHome.child_id == child_id))
    }


# --- REQ-034.6: the RBAC gate and the error envelope ----------------------------------------


def test_a_tutor_is_refused_on_both_routes(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    guardian, home = _make_guardian(db), _make_home(db)
    child_id = _create_child(api, admin, guardians=[guardian], homes=[home])

    created = api.post(
        "/api/children", headers=_auth(tutor), json=_payload(guardians=[guardian], homes=[home])
    )
    updated = api.patch(f"/api/children/{child_id}", headers=_auth(tutor), json={"name": "Nope"})

    assert created.status_code == 403
    assert updated.status_code == 403
    assert isinstance(created.json()["detail"], str)
    assert isinstance(updated.json()["detail"], str)


def test_no_token_is_401_not_403(api: TestClient, db: Session) -> None:
    guardian, home = _make_guardian(db), _make_home(db)

    response = api.post("/api/children", json=_payload(guardians=[guardian], homes=[home]))

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


def test_a_developer_may_create_and_update(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    guardian, home = _make_guardian(db), _make_home(db)
    child_id = _create_child(api, developer, guardians=[guardian], homes=[home])

    updated = api.patch(
        f"/api/children/{child_id}", headers=_auth(developer), json={"name": "Renamed"}
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed"


# --- REQ-034.1 and REQ-034.3: POST, and the ids it is given ---------------------------------


def test_post_links_every_guardian_and_home_it_is_given(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    guardians = [_make_guardian(db), _make_guardian(db)]
    home = _make_home(db)

    response = api.post(
        "/api/children", headers=_auth(admin), json=_payload(guardians=guardians, homes=[home])
    )

    body = response.json()
    child_id = uuid.UUID(body["id"])
    assert response.status_code == 201
    assert set(_guardian_links(db, child_id)) == {one.id for one in guardians}
    assert set(_home_links(db, child_id)) == {home.id}
    assert set(body["guardian_ids"]) == {str(one.id) for one in guardians}
    assert body["home_ids"] == [str(home.id)]
    assert body["grade_level"] == 7


def test_a_repeated_guardian_id_collapses_to_one_link(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    guardian, home = _make_guardian(db), _make_home(db)

    response = api.post(
        "/api/children",
        headers=_auth(admin),
        json=_payload(guardians=[guardian, guardian], homes=[home]),
    )

    assert response.status_code == 201
    assert list(_guardian_links(db, uuid.UUID(response.json()["id"]))) == [guardian.id]


@pytest.mark.parametrize("empty_field", ["guardian_ids", "home_ids"])
def test_post_requires_at_least_one_of_each_link(
    api: TestClient, db: Session, empty_field: str
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)], homes=[_make_home(db)])
    payload[empty_field] = []

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("unknown_field", ["guardian_ids", "home_ids"])
def test_an_unresolvable_link_id_is_400_and_leaves_no_child_behind(
    api: TestClient, db: Session, unknown_field: str
) -> None:
    """An orphan child is what validating before writing exists to prevent — the ERD has no
    room for a child with no guardian, and no later request through this surface could fix
    one."""
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)], homes=[_make_home(db)])
    payload[unknown_field] = [str(uuid.uuid4())]
    before = db.scalar(select(func.count()).select_from(Child))

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert db.scalar(select(func.count()).select_from(Child)) == before


def test_a_grade_level_label_is_refused_rather_than_coerced(api: TestClient, db: Session) -> None:
    """`grade_level` is stored as an integer; "Grade 7" is derived for display and never sent."""
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)], homes=[_make_home(db)])
    payload["grade_level"] = "Grade 7"

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_a_body_missing_a_required_field_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post("/api/children", headers=_auth(admin), json={"name": "Nobody"})

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


# --- REQ-034.4: PATCH replaces a link set ---------------------------------------------------


def test_patch_replaces_the_guardian_set_without_rewriting_the_links_that_stay(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    kept, dropped = _make_guardian(db), _make_guardian(db)
    child_id = _create_child(api, admin, guardians=[kept, dropped], homes=[_make_home(db)])
    before = _guardian_links(db, child_id)

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"guardian_ids": [str(kept.id)]}
    )

    after = _guardian_links(db, child_id)
    assert response.status_code == 200
    assert response.json()["guardian_ids"] == [str(kept.id)]
    assert set(after) == {kept.id}
    assert after[kept.id] == before[kept.id]


def test_patch_adding_a_home_leaves_the_existing_home_link_alone(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    first, second = _make_home(db), _make_home(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)], homes=[first])
    before = _home_links(db, child_id)

    response = api.patch(
        f"/api/children/{child_id}",
        headers=_auth(admin),
        json={"home_ids": [str(first.id), str(second.id)]},
    )

    after = _home_links(db, child_id)
    assert response.status_code == 200
    assert set(after) == {first.id, second.id}
    assert after[first.id] == before[first.id]


@pytest.mark.parametrize("empty_field", ["guardian_ids", "home_ids"])
def test_patch_refuses_an_empty_link_array(api: TestClient, db: Session, empty_field: str) -> None:
    admin = _make_user(db)
    guardian, home = _make_guardian(db), _make_home(db)
    child_id = _create_child(api, admin, guardians=[guardian], homes=[home])

    response = api.patch(f"/api/children/{child_id}", headers=_auth(admin), json={empty_field: []})

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert set(_guardian_links(db, child_id)) == {guardian.id}
    assert set(_home_links(db, child_id)) == {home.id}


def test_patch_omitting_the_link_arrays_leaves_every_link_alone(
    api: TestClient, db: Session
) -> None:
    """Absent is not empty. Treating them alike would unlink every guardian on a rename."""
    admin = _make_user(db)
    guardians = [_make_guardian(db), _make_guardian(db)]
    home = _make_home(db)
    child_id = _create_child(api, admin, guardians=guardians, homes=[home])
    before_guardians, before_homes = _guardian_links(db, child_id), _home_links(db, child_id)

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"name": "Renamed"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    assert _guardian_links(db, child_id) == before_guardians
    assert _home_links(db, child_id) == before_homes


def test_a_patch_that_fails_validation_writes_none_of_its_other_fields(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    guardian, home = _make_guardian(db), _make_home(db)
    child_id = _create_child(api, admin, guardians=[guardian], homes=[home])

    response = api.patch(
        f"/api/children/{child_id}",
        headers=_auth(admin),
        json={"name": "Renamed", "guardian_ids": [str(uuid.uuid4())]},
    )

    assert response.status_code == 400
    assert db.scalar(select(Child.name).where(Child.id == child_id)) == "Tommy Doe"
    assert set(_guardian_links(db, child_id)) == {guardian.id}


def test_patch_may_change_grade_level(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)], homes=[_make_home(db)])

    response = api.patch(f"/api/children/{child_id}", headers=_auth(admin), json={"grade_level": 8})

    assert response.status_code == 200
    assert response.json()["grade_level"] == 8
    assert db.scalar(select(Child.grade_level).where(Child.id == child_id)) == 8


def test_patch_on_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(
        f"/api/children/{uuid.uuid4()}", headers=_auth(admin), json={"name": "Ghost"}
    )

    assert response.status_code == 404
    assert isinstance(response.json()["detail"], str)


# --- REQ-034.5: nothing here soft-deletes ---------------------------------------------------


def test_a_child_carries_no_is_active_and_has_no_delete_route(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    body = api.post(
        "/api/children",
        headers=_auth(admin),
        json=_payload(guardians=[_make_guardian(db)], homes=[_make_home(db)]),
    ).json()

    assert "is_active" not in body
    assert api.delete(f"/api/children/{body['id']}", headers=_auth(admin)).status_code == 405
