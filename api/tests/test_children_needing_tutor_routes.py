"""`GET /api/children?needs_tutor=true`: non-archived, Evaluated Children with no Assigned
Tutors, and the `children_needing_tutor` badge that totals the same list.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.enums import UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password

PASSWORD = "needs-tutor-password"
EVALUATED_AT = datetime.datetime(2026, 10, 1, 12, 0, tzinfo=datetime.UTC)


def test_an_evaluated_child_with_no_assigned_tutor_is_listed(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    waiting = _make_child(db, evaluator=admin)

    assert _needing_ids(api, admin) == [str(waiting.id)]


def test_a_child_with_an_assigned_tutor_is_not_listed(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)

    assert _needing_ids(api, admin) == []


def test_a_child_not_evaluated_or_archived_is_not_listed(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    _make_child(db, evaluator=None)
    _make_child(db, evaluator=admin, is_archived=True)

    assert _needing_ids(api, admin) == []


def test_a_child_appears_when_its_last_assignment_is_deleted(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)

    deleted = api.delete(
        f"/api/children/{child.id}/assigned-tutors/{tutor.id}", headers=_auth(admin)
    )

    assert deleted.status_code == 204
    assert _needing_ids(api, admin) == [str(child.id)]


def test_a_child_stays_unlisted_until_the_last_tutor_is_gone(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    first = _make_staff(db, role=UserRole.TUTOR)
    second = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, first.id)
    _assign(api, admin, child, second.id)

    api.delete(f"/api/children/{child.id}/assigned-tutors/{first.id}", headers=_auth(admin))

    assert _needing_ids(api, admin) == []


def test_a_child_appears_when_its_only_tutor_is_archived(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)

    archived = api.post(
        "/api/archive", json={"type": "staff", "id": str(tutor.id)}, headers=_auth(admin)
    )

    assert archived.status_code == 200
    assert _needing_ids(api, admin) == [str(child.id)]


def test_a_child_appears_when_its_only_tutor_is_promoted_to_admin(
    api: TestClient, db: Session
) -> None:
    admin = _make_staff(db)
    manager = _make_staff(db, role=UserRole.MANAGER)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, manager.id)

    promoted = api.patch(f"/api/users/{manager.id}", json={"role": "admin"}, headers=_auth(admin))

    assert promoted.status_code == 200
    assert _needing_ids(api, admin) == [str(child.id)]


def test_a_child_disappears_once_a_tutor_is_assigned(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    before = _needing_ids(api, admin)

    _assign(api, admin, child, tutor.id)

    assert (before, _needing_ids(api, admin)) == ([str(child.id)], [])


def test_the_filter_combines_with_search_and_keeps_name_order(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    zed = _make_child(db, evaluator=admin, name="Kid Zed")
    amy = _make_child(db, evaluator=admin, name="Kid Amy")
    _make_child(db, evaluator=admin, name="Other")

    listed = api.get("/api/children?needs_tutor=true&q=Kid", headers=_auth(admin)).json()

    assert [row["id"] for row in listed["items"]] == [str(amy.id), str(zed.id)]
    assert listed["total"] == 2


@pytest.mark.parametrize("other_filter", ["awaiting_evaluation", "evaluable"])
def test_the_filter_combined_with_an_unevaluated_tab_lists_nothing(
    api: TestClient, db: Session, other_filter: str
) -> None:
    admin = _make_staff(db)
    _make_child(db, evaluator=admin)
    _make_child(db, evaluator=None)

    response = api.get(f"/api/children?needs_tutor=true&{other_filter}=true", headers=_auth(admin))

    assert (response.status_code, response.json()["total"]) == (200, 0)


def test_the_filter_combines_with_the_subject_filter(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    taught = Subject(name=f"Taught {uuid.uuid4().hex[:8]}")
    other = Subject(name=f"Other {uuid.uuid4().hex[:8]}")
    db.add_all([taught, other])
    db.flush()
    with_level = _make_child(db, evaluator=admin)
    _make_child(db, evaluator=admin)
    db.add(ChildSubjectLevel(child_id=with_level.id, subject_id=taught.id, level=5, set_by=admin))
    db.flush()

    matching = api.get(
        f"/api/children?needs_tutor=true&subject_id={taught.id}", headers=_auth(admin)
    )
    elsewhere = api.get(
        f"/api/children?needs_tutor=true&subject_id={other.id}", headers=_auth(admin)
    )

    assert [row["id"] for row in matching.json()["items"]] == [str(with_level.id)]
    assert elsewhere.json()["total"] == 0


@pytest.mark.parametrize(("evaluated", "expected_total"), [("true", 1), ("false", 0)])
def test_the_filter_combines_with_the_evaluated_filter(
    api: TestClient, db: Session, evaluated: str, expected_total: int
) -> None:
    admin = _make_staff(db)
    _make_child(db, evaluator=admin)

    response = api.get(
        f"/api/children?needs_tutor=true&evaluated={evaluated}", headers=_auth(admin)
    )

    assert response.json()["total"] == expected_total


def test_asking_for_archived_children_still_lists_only_active_ones(
    api: TestClient, db: Session
) -> None:
    admin = _make_staff(db)
    active = _make_child(db, evaluator=admin)
    _make_child(db, evaluator=admin, is_archived=True)

    response = api.get("/api/children?needs_tutor=true&archived=true", headers=_auth(admin))

    assert [row["id"] for row in response.json()["items"]] == [str(active.id)]


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.MANAGER])
def test_the_count_equals_the_lists_total_for_each_office_role(
    api: TestClient, db: Session, role: UserRole
) -> None:
    admin = _make_staff(db)
    caller = _make_staff(db, role=role)
    for _ in range(2):
        _make_child(db, evaluator=admin)
    _make_child(db, evaluator=None)

    counts = api.get("/api/counts", headers=_auth(caller)).json()

    assert counts["children_needing_tutor"] == 2
    assert counts["children_needing_tutor"] == _total(api, caller)


# --- helpers ----------------------------------------------------------------------------------


def _total(api: TestClient, caller: User) -> int:
    response = api.get("/api/children?needs_tutor=true", headers=_auth(caller))
    assert response.status_code == 200
    total: int = response.json()["total"]
    return total


def _needing_ids(api: TestClient, caller: User) -> list[str]:
    response = api.get("/api/children?needs_tutor=true", headers=_auth(caller))
    assert response.status_code == 200
    return [row["id"] for row in response.json()["items"]]


def _assign(api: TestClient, caller: User, child: Child, user_id: uuid.UUID) -> Response:
    response = api.post(
        f"/api/children/{child.id}/assigned-tutors",
        json={"user_id": str(user_id)},
        headers=_auth(caller),
    )
    assert response.status_code == 200
    return response


def _make_staff(db: Session, *, role: UserRole = UserRole.ADMIN) -> User:
    suffix = uuid.uuid4().hex[:10]
    user = User(
        email=f"staff-{suffix}@example.com",
        name=f"Staff {suffix}",
        hashed_password=hash_password(PASSWORD),
        role=role,
    )
    db.add(user)
    if role in (UserRole.TUTOR, UserRole.MANAGER):
        db.add(Tutor(user=user, phone_number=f"+1{uuid.uuid4().int % 10**10:010d}"))
    db.flush()
    return user


def _make_child(
    db: Session, *, evaluator: User | None, name: str | None = None, is_archived: bool = False
) -> Child:
    child = Child(
        name=name or f"Child {uuid.uuid4().hex[:10]}",
        grade_level=7,
        school_name="Test School",
        is_archived=is_archived,
        evaluated_at=None if evaluator is None else EVALUATED_AT,
        evaluated_by_user_id=None if evaluator is None else evaluator.id,
    )
    db.add(child)
    db.flush()
    return child


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}
