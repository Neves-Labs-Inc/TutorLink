"""A Child's Assigned Tutors over HTTP: `POST /api/children/{id}/assigned-tutors`, `DELETE
/api/children/{id}/assigned-tutors/{user_id}`, how they read back on the Child and Staff reads,
and their removal when a Staff member is archived or promoted to Admin.
"""

import datetime
import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password

PASSWORD = "assigned-tutor-password"
EVALUATED_AT = datetime.datetime(2026, 10, 1, 12, 0, tzinfo=datetime.UTC)


@pytest.fixture
def statements(db: Session) -> Generator[list[str], None, None]:
    captured: list[str] = []

    def record(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        captured.append(statement)

    bind = db.get_bind()
    event.listen(bind, "before_cursor_execute", record)
    try:
        yield captured
    finally:
        event.remove(bind, "before_cursor_execute", record)


# --- POST -------------------------------------------------------------------------------------


@pytest.mark.parametrize("caller_role", [UserRole.ADMIN, UserRole.MANAGER])
@pytest.mark.parametrize("assignee_role", [UserRole.TUTOR, UserRole.MANAGER])
def test_the_office_assigns_a_tutor_or_manager_and_gets_the_list_back(
    api: TestClient, db: Session, caller_role: UserRole, assignee_role: UserRole
) -> None:
    caller = _make_staff(db, role=caller_role)
    assignee = _make_staff(db, role=assignee_role, name="Rosa Diaz")
    child = _make_child(db, evaluator=caller)

    response = _assign(api, caller, child, assignee.id)

    assert response.status_code == 200
    assert response.json() == [
        {"id": str(assignee.id), "name": "Rosa Diaz", "role": assignee_role.value}
    ]


def test_assigning_someone_already_assigned_changes_nothing(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)

    response = _assign(api, admin, child, tutor.id)

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(tutor.id)]
    assert _assigned_ids(api, admin, child) == [str(tutor.id)]


def test_the_list_is_ordered_by_name_then_id(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    child = _make_child(db, evaluator=admin)
    zoe = _make_staff(db, role=UserRole.TUTOR, name="Zoe")
    twins = sorted(
        (_make_staff(db, role=UserRole.TUTOR, name="Ana") for _ in range(2)),
        key=lambda user: str(user.id),
    )
    for user in (zoe, twins[1], twins[0]):
        _assign(api, admin, child, user.id)

    response = _assign(api, admin, child, zoe.id)
    detail = _detail(api, admin, child)

    expected = [str(twins[0].id), str(twins[1].id), str(zoe.id)]
    assert [row["id"] for row in response.json()] == expected
    assert [row["id"] for row in detail["assigned_tutors"]] == expected


@pytest.mark.parametrize(
    "kind", ["unknown", "archived", UserRole.ADMIN.value, UserRole.DEVELOPER.value]
)
def test_assigning_someone_who_is_not_an_active_tutor_or_manager_is_422(
    api: TestClient, db: Session, kind: str
) -> None:
    admin = _make_staff(db)
    child = _make_child(db, evaluator=admin)
    if kind == "unknown":
        user_id = uuid.uuid4()
    elif kind == "archived":
        user_id = _make_staff(db, role=UserRole.TUTOR, is_archived=True).id
    else:
        user_id = _make_staff(db, role=UserRole(kind)).id

    response = _assign(api, admin, child, user_id)

    assert response.status_code == 422
    assert _assigned_ids(api, admin, child) == []


def test_assigning_on_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)

    response = api.post(
        f"/api/children/{uuid.uuid4()}/assigned-tutors",
        json={"user_id": str(tutor.id)},
        headers=_auth(admin),
    )

    assert response.status_code == 404


def test_assigning_on_a_child_not_yet_evaluated_is_409(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=None)

    response = _assign(api, admin, child, tutor.id)

    assert response.status_code == 409
    assert _assigned_ids(api, admin, child) == []


# --- DELETE -----------------------------------------------------------------------------------


@pytest.mark.parametrize("caller_role", [UserRole.ADMIN, UserRole.MANAGER])
def test_the_office_removes_an_assigned_tutor_even_the_last_one(
    api: TestClient, db: Session, caller_role: UserRole
) -> None:
    caller = _make_staff(db, role=caller_role)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=caller)
    _assign(api, caller, child, tutor.id)

    response = _unassign(api, caller, child.id, tutor.id)

    assert response.status_code == 204
    assert _assigned_ids(api, caller, child) == []


def test_removing_someone_not_assigned_is_404(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)

    response = _unassign(api, admin, child.id, tutor.id)

    assert response.status_code == 404


def test_removing_on_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)

    response = _unassign(api, admin, uuid.uuid4(), tutor.id)

    assert response.status_code == 404


def test_removing_on_a_child_no_longer_evaluated_is_409(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)
    api.delete(f"/api/children/{child.id}/evaluated", headers=_auth(admin))

    response = _unassign(api, admin, child.id, tutor.id)

    assert response.status_code == 409
    assert _assigned_ids(api, admin, child) == [str(tutor.id)]


# --- the RBAC gate ----------------------------------------------------------------------------


@pytest.mark.parametrize("method", ["POST", "DELETE"])
def test_a_tutor_is_refused_with_403(api: TestClient, db: Session, method: str) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)
    url = f"/api/children/{child.id}/assigned-tutors"
    if method == "DELETE":
        url = f"{url}/{tutor.id}"

    response = api.request(method, url, json={"user_id": str(tutor.id)}, headers=_auth(tutor))

    assert response.status_code == 403
    assert _assigned_ids(api, admin, child) == [str(tutor.id)]


# --- reads ------------------------------------------------------------------------------------


def test_list_rows_carry_their_assigned_tutors(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    token = uuid.uuid4().hex[:10]
    assigned = _make_child(db, evaluator=admin, name=f"Assigned {token}")
    unassigned = _make_child(db, evaluator=admin, name=f"Unassigned {token}")
    manager = _make_staff(db, role=UserRole.MANAGER, name="Maria")
    _assign(api, admin, assigned, manager.id)

    body = api.get(f"/api/children?q={token}", headers=_auth(admin)).json()

    by_id = {row["id"]: row["assigned_tutors"] for row in body["items"]}
    assert by_id == {
        str(assigned.id): [{"id": str(manager.id), "name": "Maria", "role": "manager"}],
        str(unassigned.id): [],
    }


def test_the_list_loads_assigned_tutors_in_one_batch_per_page(
    api: TestClient, db: Session, statements: list[str]
) -> None:
    admin = _make_staff(db)
    token = uuid.uuid4().hex[:10]
    for index in range(5):
        child = _make_child(db, evaluator=admin, name=f"Child {index} {token}")
        for _ in range(2):
            _assign(api, admin, child, _make_staff(db, role=UserRole.TUTOR).id)
    # The first request after a commit opens a fresh savepoint; keep it out of the counts.
    api.get("/api/children", headers=_auth(admin))
    counts = []

    for page_size in (1, 5):
        db.expire_all()
        statements.clear()
        body = api.get(
            f"/api/children?q={token}&page_size={page_size}", headers=_auth(admin)
        ).json()

        assert all(len(row["assigned_tutors"]) == 2 for row in body["items"])
        counts.append(len(statements))

    assert counts[0] == counts[1]


def test_staff_reads_carry_the_children_they_are_assigned_to(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    zara = _make_child(db, evaluator=admin, name="Zara")
    twins = sorted(
        (_make_child(db, evaluator=admin, name="Abe") for _ in range(2)),
        key=lambda child: str(child.id),
    )
    for child in (zara, twins[1], twins[0]):
        _assign(api, admin, child, tutor.id)

    detail = api.get(f"/api/staff/{tutor.id}", headers=_auth(admin)).json()

    assert detail["assigned_children"] == [
        {"id": str(twins[0].id), "name": "Abe"},
        {"id": str(twins[1].id), "name": "Abe"},
        {"id": str(zara.id), "name": "Zara"},
    ]


def test_staff_with_no_assignment_reads_an_empty_list(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)

    detail = api.get(f"/api/staff/{tutor.id}", headers=_auth(admin)).json()

    assert detail["assigned_children"] == []


# --- archive and promotion --------------------------------------------------------------------


def test_archiving_staff_removes_their_assignments_and_restore_does_not_bring_them_back(
    api: TestClient, db: Session
) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    other = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)
    _assign(api, admin, child, other.id)

    archived = _archive_action(api, admin, "archive", tutor.id)
    after_archive = _assigned_ids(api, admin, child)
    restored = _archive_action(api, admin, "restore", tutor.id)

    assert (archived.status_code, restored.status_code) == (200, 200)
    assert after_archive == [str(other.id)]
    assert _assigned_ids(api, admin, child) == [str(other.id)]
    staff = api.get(f"/api/staff/{tutor.id}", headers=_auth(admin)).json()
    assert staff["assigned_children"] == []


def test_promoting_staff_to_admin_removes_their_assignments(api: TestClient, db: Session) -> None:
    admin = _make_staff(db)
    manager = _make_staff(db, role=UserRole.MANAGER)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, manager.id)

    response = api.patch(f"/api/users/{manager.id}", json={"role": "admin"}, headers=_auth(admin))

    assert response.status_code == 200
    assert _assigned_ids(api, admin, child) == []


def test_a_role_change_between_tutor_and_manager_keeps_the_assignments(
    api: TestClient, db: Session
) -> None:
    admin = _make_staff(db)
    tutor = _make_staff(db, role=UserRole.TUTOR)
    child = _make_child(db, evaluator=admin)
    _assign(api, admin, child, tutor.id)

    response = api.patch(f"/api/users/{tutor.id}", json={"role": "manager"}, headers=_auth(admin))

    assert response.status_code == 200
    assert _detail(api, admin, child)["assigned_tutors"] == [
        {"id": str(tutor.id), "name": tutor.name, "role": "manager"}
    ]


# --- helpers ----------------------------------------------------------------------------------


def _assign(api: TestClient, caller: User, child: Child, user_id: uuid.UUID) -> Response:
    return api.post(
        f"/api/children/{child.id}/assigned-tutors",
        json={"user_id": str(user_id)},
        headers=_auth(caller),
    )


def _unassign(api: TestClient, caller: User, child_id: uuid.UUID, user_id: uuid.UUID) -> Response:
    return api.delete(f"/api/children/{child_id}/assigned-tutors/{user_id}", headers=_auth(caller))


def _archive_action(api: TestClient, caller: User, action: str, user_id: uuid.UUID) -> Response:
    return api.post(
        f"/api/{action}", json={"type": "staff", "id": str(user_id)}, headers=_auth(caller)
    )


def _detail(api: TestClient, caller: User, child: Child) -> dict[str, object]:
    response = api.get(f"/api/children/{child.id}", headers=_auth(caller))
    assert response.status_code == 200
    body: dict[str, object] = response.json()
    return body


def _assigned_ids(api: TestClient, caller: User, child: Child) -> list[str]:
    rows = _detail(api, caller, child)["assigned_tutors"]
    assert isinstance(rows, list)
    return [row["id"] for row in rows]


def _make_staff(
    db: Session,
    *,
    role: UserRole = UserRole.ADMIN,
    name: str | None = None,
    is_archived: bool = False,
) -> User:
    """A Tutor or Manager comes with a teaching profile, as `POST /api/users` makes them."""
    suffix = uuid.uuid4().hex[:10]
    user = User(
        email=f"staff-{suffix}@example.com",
        name=name or f"Staff {suffix}",
        hashed_password=hash_password(PASSWORD),
        role=role,
        is_archived=is_archived,
    )
    db.add(user)
    if role in (UserRole.TUTOR, UserRole.MANAGER):
        db.add(Tutor(user=user, phone_number=f"+1{uuid.uuid4().int % 10**10:010d}"))
    db.flush()
    return user


def _make_child(db: Session, *, evaluator: User | None, name: str | None = None) -> Child:
    child = Child(
        name=name or f"Child {uuid.uuid4().hex[:10]}",
        grade_level=7,
        school_name="Test School",
        evaluated_at=None if evaluator is None else EVALUATED_AT,
        evaluated_by_user_id=None if evaluator is None else evaluator.id,
    )
    db.add(child)
    db.flush()
    return child


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}
