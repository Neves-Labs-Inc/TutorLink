"""Subject levels and Evaluated over HTTP: `PUT`/`DELETE /api/children/{id}/levels/{subject_id}`,
`POST`/`DELETE /api/children/{id}/evaluated`, and how both read back on the child routes.

Validation failures are 400 here, as everywhere in this API (`main.handle_validation_error`).
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password

# --- levels -----------------------------------------------------------------------------------


def test_setting_a_level_records_it_and_who_set_it(api: TestClient, db: Session) -> None:
    admin = _make_user(db, name="Marta")
    child = _make_child(db)
    math = _make_subject(db, name=f"Math {_suffix()}")

    response = api.put(_level_url(child, math), headers=_auth(admin), json={"level": 5})
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 200
    assert response.json()["level"] == 5
    [row] = detail["levels"]
    assert row["subject_id"] == str(math.id)
    assert row["name"] == math.name
    assert row["is_active"] is True
    assert row["level"] == 5
    assert row["set_by"] == {"id": str(admin.id), "name": "Marta"}
    assert row["updated_at"] is not None


def test_a_manager_sets_a_level_and_marks_evaluated_under_their_name(
    api: TestClient, db: Session
) -> None:
    manager = _make_user(db, name="Rosa", role=UserRole.MANAGER)
    child = _make_child(db)
    math = _make_subject(db)

    level = api.put(_level_url(child, math), headers=_auth(manager), json={"level": 3})
    evaluated = api.post(f"/api/children/{child.id}/evaluated", headers=_auth(manager))
    detail = api.get(f"/api/children/{child.id}", headers=_auth(manager)).json()

    assert (level.status_code, evaluated.status_code) == (200, 200)
    assert detail["levels"][0]["set_by"] == {"id": str(manager.id), "name": "Rosa"}
    assert evaluated.json()["by"] == {"id": str(manager.id), "name": "Rosa"}


def test_editing_a_level_replaces_it_and_the_setter(api: TestClient, db: Session) -> None:
    first = _make_user(db, name="Marta")
    second = _make_user(db, name="Luis")
    child = _make_child(db)
    math = _make_subject(db)
    api.put(_level_url(child, math), headers=_auth(first), json={"level": 5})

    response = api.put(_level_url(child, math), headers=_auth(second), json={"level": 0})
    detail = api.get(f"/api/children/{child.id}", headers=_auth(second)).json()

    assert response.status_code == 200
    [row] = detail["levels"]
    assert row["level"] == 0
    assert row["set_by"]["name"] == "Luis"


@pytest.mark.parametrize("level", [-1, 13])
def test_a_level_outside_k_to_12_is_refused(api: TestClient, db: Session, level: int) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math = _make_subject(db)

    response = api.put(_level_url(child, math), headers=_auth(admin), json={"level": level})

    assert response.status_code == 400
    assert "level" in response.json()["detail"]
    assert _levels(api, admin, child) == []


def test_removing_a_level_deletes_it(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math = _make_subject(db)
    api.put(_level_url(child, math), headers=_auth(admin), json={"level": 5})

    response = api.delete(_level_url(child, math), headers=_auth(admin))

    assert response.status_code == 204
    assert _levels(api, admin, child) == []


def test_removing_a_level_that_does_not_exist_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)

    response = api.delete(_level_url(child, _make_subject(db)), headers=_auth(admin))

    assert response.status_code == 404


def test_a_level_on_an_unknown_child_or_subject_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math = _make_subject(db)

    unknown_child = api.put(
        f"/api/children/{uuid.uuid4()}/levels/{math.id}", headers=_auth(admin), json={"level": 3}
    )
    unknown_subject = api.put(
        f"/api/children/{child.id}/levels/{uuid.uuid4()}", headers=_auth(admin), json={"level": 3}
    )

    assert unknown_child.status_code == 404
    assert unknown_subject.status_code == 404


def test_an_inactive_subject_gets_no_new_level(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    retired = _make_subject(db, is_active=False)

    response = api.put(_level_url(child, retired), headers=_auth(admin), json={"level": 3})

    assert response.status_code == 409
    assert "inactive" in response.json()["detail"]
    assert _levels(api, admin, child) == []


def test_an_existing_level_on_a_retired_subject_shows_inactive_and_stays_editable(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math = _make_subject(db)
    api.put(_level_url(child, math), headers=_auth(admin), json={"level": 3})
    math.is_active = False
    db.flush()

    edited = api.put(_level_url(child, math), headers=_auth(admin), json={"level": 4})
    [row] = _levels(api, admin, child)
    removed = api.delete(_level_url(child, math), headers=_auth(admin))

    assert edited.status_code == 200
    assert (row["level"], row["is_active"]) == (4, False)
    assert removed.status_code == 204


# --- Evaluated --------------------------------------------------------------------------------


def test_marking_evaluated_without_a_level_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)

    response = api.post(_evaluated_url(child), headers=_auth(admin))
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 409
    assert "level" in response.json()["detail"]
    assert detail["evaluated"] is None


def test_marking_evaluated_records_who_and_when(api: TestClient, db: Session) -> None:
    admin = _make_user(db, name="Marta")
    child = _make_child(db)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    before = datetime.datetime.now(tz=datetime.UTC)

    response = api.post(_evaluated_url(child), headers=_auth(admin))
    evaluated = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()["evaluated"]

    assert response.status_code == 200
    assert evaluated["by"] == {"id": str(admin.id), "name": "Marta"}
    assert datetime.datetime.fromisoformat(evaluated["at"]) >= before - datetime.timedelta(
        seconds=5
    )
    assert response.json() == evaluated


def test_marking_twice_keeps_the_first_who_and_when(api: TestClient, db: Session) -> None:
    first = _make_user(db, name="Marta")
    second = _make_user(db, name="Luis")
    child = _make_child(db)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(first), json={"level": 5})
    original = api.post(_evaluated_url(child), headers=_auth(first)).json()

    again = api.post(_evaluated_url(child), headers=_auth(second))

    assert again.status_code == 200
    assert again.json() == original
    assert again.json()["by"]["name"] == "Marta"


def test_clearing_evaluated_keeps_the_levels(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(child), headers=_auth(admin))

    response = api.delete(_evaluated_url(child), headers=_auth(admin))
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 204
    assert detail["evaluated"] is None
    assert [row["level"] for row in detail["levels"]] == [5]


def test_evaluated_on_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    url = f"/api/children/{uuid.uuid4()}/evaluated"

    assert api.post(url, headers=_auth(admin)).status_code == 404
    assert api.delete(url, headers=_auth(admin)).status_code == 404


def test_removing_the_last_level_of_an_evaluated_child_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math = _make_subject(db)
    api.put(_level_url(child, math), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(child), headers=_auth(admin))

    response = api.delete(_level_url(child, math), headers=_auth(admin))

    assert response.status_code == 409
    assert "Evaluated" in response.json()["detail"]
    assert [row["level"] for row in _levels(api, admin, child)] == [5]


def test_removing_a_non_last_level_of_an_evaluated_child_is_fine(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math, science = _make_subject(db), _make_subject(db)
    api.put(_level_url(child, math), headers=_auth(admin), json={"level": 5})
    api.put(_level_url(child, science), headers=_auth(admin), json={"level": 6})
    api.post(_evaluated_url(child), headers=_auth(admin))

    response = api.delete(_level_url(child, math), headers=_auth(admin))

    assert response.status_code == 204
    assert [row["level"] for row in _levels(api, admin, child)] == [6]


def test_removing_the_last_level_of_a_child_not_evaluated_is_fine(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math = _make_subject(db)
    api.put(_level_url(child, math), headers=_auth(admin), json={"level": 5})

    response = api.delete(_level_url(child, math), headers=_auth(admin))

    assert response.status_code == 204


# --- the Children list ------------------------------------------------------------------------


def test_the_list_row_carries_the_evaluated_summary(api: TestClient, db: Session) -> None:
    admin = _make_user(db, name="Marta")
    token = _suffix()
    evaluated = _make_child(db, name=f"Ana {token}")
    _make_child(db, name=f"Luis {token}")
    api.put(_level_url(evaluated, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    marked = api.post(_evaluated_url(evaluated), headers=_auth(admin)).json()

    body = api.get(f"/api/children?q={token}", headers=_auth(admin)).json()

    assert [row["evaluated"] for row in body["items"]] == [marked, None]
    assert marked["by"]["name"] == "Marta"


def test_awaiting_evaluation_lists_active_children_not_evaluated_oldest_first(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    token = _suffix()
    newest = _make_child(db, name=f"Ana {token}", created_days_ago=1)
    oldest = _make_child(db, name=f"Zoe {token}", created_days_ago=9)
    evaluated = _make_child(db, name=f"Luis {token}", created_days_ago=20)
    _make_child(db, name=f"Mia {token}", created_days_ago=30, is_active=False)
    api.put(_level_url(evaluated, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(evaluated), headers=_auth(admin))

    body = api.get(f"/api/children?q={token}&awaiting_evaluation=true", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(oldest.id), str(newest.id)]
    assert body["total"] == 2
    first = body["items"][0]
    assert datetime.datetime.fromisoformat(first["created_at"]) == oldest.created_at
    assert first["grade_level"] == 7
    assert len(first["guardians"]) == 1


# --- the RBAC gate ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("PUT", "/api/children/{child}/levels/{subject}"),
        ("DELETE", "/api/children/{child}/levels/{subject}"),
        ("POST", "/api/children/{child}/evaluated"),
        ("DELETE", "/api/children/{child}/evaluated"),
    ],
)
def test_a_tutor_is_refused_with_403(api: TestClient, db: Session, method: str, path: str) -> None:
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    url = path.format(child=_make_child(db).id, subject=_make_subject(db).id)

    response = api.request(method, url, headers=_auth(tutor_user), json={"level": 3})

    assert response.status_code == 403


# --- helpers ----------------------------------------------------------------------------------


def _suffix() -> str:
    return uuid.uuid4().hex[:10]


def _level_url(child: Child, subject: Subject) -> str:
    return f"/api/children/{child.id}/levels/{subject.id}"


def _evaluated_url(child: Child) -> str:
    return f"/api/children/{child.id}/evaluated"


def _levels(api: TestClient, user: User, child: Child) -> list[dict[str, object]]:
    levels: list[dict[str, object]] = api.get(
        f"/api/children/{child.id}", headers=_auth(user)
    ).json()["levels"]
    return levels


def _make_user(
    db: Session,
    *,
    name: str = "Test User",
    role: UserRole = UserRole.ADMIN,
    tutor_id: uuid.UUID | None = None,
) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{_suffix()}@example.com",
            name=name,
            hashed_password=hash_password("evaluation-password"),
            role=role,
            is_active=True,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("evaluation-password")
        user.role = role
        user.is_active = True
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _make_tutor(db: Session) -> Tutor:
    suffix = _suffix()
    tutor = Tutor(
        user=User(email=f"t-{suffix}@x.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_subject(db: Session, *, name: str | None = None, is_active: bool = True) -> Subject:
    subject = Subject(name=name or f"Subject {_suffix()}", is_active=is_active)
    db.add(subject)
    db.flush()
    return subject


def _make_child(
    db: Session, *, name: str | None = None, is_active: bool = True, created_days_ago: int = 0
) -> Child:
    guardian = Guardian(
        name=f"Guardian {_suffix()}", phone_number=f"+1{uuid.uuid4().int % 10**10:010d}"
    )
    home = Home(address=f"{_suffix()} Main St", access_code="1234")
    child = Child(
        name=name or f"Child {_suffix()}",
        grade_level=7,
        school_name="Test School",
        is_active=is_active,
        created_at=datetime.datetime.now(tz=datetime.UTC)
        - datetime.timedelta(days=created_days_ago),
    )
    db.add_all([guardian, home, child])
    db.flush()
    db.add_all(
        [
            ChildGuardian(child_id=child.id, guardian_id=guardian.id),
            ChildHome(child_id=child.id, home_id=home.id),
        ]
    )
    db.flush()
    return child
