"""Subject levels and Evaluated over HTTP: `PUT`/`DELETE /api/children/{id}/levels/{subject_id}`,
`POST`/`DELETE /api/children/{id}/evaluated`, and how both read back on the child routes.

Validation failures are 400 here, as everywhere in this API (`main.handle_validation_error`).
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services import clock

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
    assert row["archived"] is False
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
    evaluated = api.post(_evaluated_url(child), headers=_auth(manager), json=_tutors(db))
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
    retired = _make_subject(db, is_archived=True)

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
    math.is_archived = True
    db.flush()

    edited = api.put(_level_url(child, math), headers=_auth(admin), json={"level": 4})
    [row] = _levels(api, admin, child)
    removed = api.delete(_level_url(child, math), headers=_auth(admin))

    assert edited.status_code == 200
    assert (row["level"], row["archived"]) == (4, True)
    assert removed.status_code == 204


# --- Evaluated --------------------------------------------------------------------------------


def test_marking_evaluated_without_a_level_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)

    response = api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 409
    assert "level" in response.json()["detail"]
    assert detail["evaluated"] is None


def test_marking_evaluated_records_who_and_when(api: TestClient, db: Session) -> None:
    admin = _make_user(db, name="Marta")
    child = _make_child(db)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    before = datetime.datetime.now(tz=datetime.UTC)

    response = api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))
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
    original = api.post(_evaluated_url(child), headers=_auth(first), json=_tutors(db)).json()

    again = api.post(_evaluated_url(child), headers=_auth(second), json=_tutors(db))

    assert again.status_code == 200
    assert again.json() == original
    assert again.json()["by"]["name"] == "Marta"


def test_clearing_evaluated_keeps_the_levels(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))

    response = api.delete(_evaluated_url(child), headers=_auth(admin))
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 204
    assert detail["evaluated"] is None
    assert [row["level"] for row in detail["levels"]] == [5]


# --- levels on the list row, and the Evaluated filter ------------------------------------------


def test_the_list_row_levels_skip_archived_subjects_and_follow_subject_name(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db, name=f"Lv {_suffix()}")
    zoology = _make_subject(db, name=f"Zoology {_suffix()}")
    algebra = _make_subject(db, name=f"Algebra {_suffix()}")
    retired = _make_subject(db, name=f"Aaa {_suffix()}")
    for subject, level in [(zoology, 2), (algebra, 6), (retired, 9)]:
        api.put(_level_url(child, subject), headers=_auth(admin), json={"level": level})
    retired.is_archived = True
    db.flush()

    [row] = api.get(f"/api/children?q={child.name}", headers=_auth(admin)).json()["items"]
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert row["levels"] == [
        {"subject_id": str(algebra.id), "name": algebra.name, "level": 6},
        {"subject_id": str(zoology.id), "name": zoology.name, "level": 2},
    ]
    assert len(detail["levels"]) == 3


def test_evaluated_true_and_false_split_the_children(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    token = _suffix()
    done = _make_child(db, name=f"Done {token}")
    waiting = _make_child(db, name=f"Waiting {token}")
    api.put(_level_url(done, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(done), headers=_auth(admin), json=_tutors(db))

    def ids(query: str) -> list[str]:
        body = api.get(f"/api/children?q={token}{query}", headers=_auth(admin)).json()
        return [row["id"] for row in body["items"]]

    assert ids("&evaluated=true") == [str(done.id)]
    assert ids("&evaluated=false") == [str(waiting.id)]
    assert sorted(ids("")) == sorted([str(done.id), str(waiting.id)])
    assert ids("&awaiting_evaluation=true&evaluated=true") == []
    assert ids("&awaiting_evaluation=true&evaluated=false") == [str(waiting.id)]


# --- Evaluated and the Evaluation booking stay separate acts (#133) -------------------------


def test_marking_evaluated_leaves_a_live_evaluation_untouched(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    evaluation = _book_evaluation(api, admin, child)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(admin), json={"level": 5})

    response = api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))

    assert response.status_code == 200
    assert db.get_one(Booking, evaluation).status is BookingStatus.CONFIRMED


def test_clearing_evaluated_makes_a_new_evaluation_creatable(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))
    refused = api.post("/api/bookings", json=_evaluation_body(admin, child), headers=_auth(admin))

    cleared = api.delete(_evaluated_url(child), headers=_auth(admin))
    created = api.post("/api/bookings", json=_evaluation_body(admin, child), headers=_auth(admin))

    assert refused.status_code == 422
    assert cleared.status_code == 204
    assert created.status_code == 201


def test_completing_an_evaluation_does_not_mark_the_child_evaluated(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    evaluation = _book_evaluation(api, admin, child)

    response = api.patch(
        f"/api/bookings/{evaluation}", json={"status": "completed"}, headers=_auth(admin)
    )
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert detail["evaluated"] is None


def test_evaluated_on_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    url = f"/api/children/{uuid.uuid4()}/evaluated"

    assert api.post(url, headers=_auth(admin), json=_tutors(db)).status_code == 404
    assert api.delete(url, headers=_auth(admin)).status_code == 404


def test_removing_the_last_level_of_an_evaluated_child_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    math = _make_subject(db)
    api.put(_level_url(child, math), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))

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
    api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))

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
    marked = api.post(_evaluated_url(evaluated), headers=_auth(admin), json=_tutors(db)).json()

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
    _make_child(db, name=f"Mia {token}", created_days_ago=30, is_archived=True)
    api.put(_level_url(evaluated, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(evaluated), headers=_auth(admin), json=_tutors(db))

    body = api.get(f"/api/children?q={token}&awaiting_evaluation=true", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(oldest.id), str(newest.id)]
    assert body["total"] == 2
    first = body["items"][0]
    assert datetime.datetime.fromisoformat(first["created_at"]) == oldest.created_at
    assert first["grade_level"] == 7
    assert len(first["guardians"]) == 1


def test_evaluable_lists_active_children_with_no_evaluation_booked_or_done_oldest_first(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    token = _suffix()
    newest = _make_child(db, name=f"Ana {token}", created_days_ago=1)
    oldest = _make_child(db, name=f"Zoe {token}", created_days_ago=9)
    evaluated = _make_child(db, name=f"Luis {token}", created_days_ago=20)
    _make_child(db, name=f"Mia {token}", created_days_ago=30, is_archived=True)
    api.put(_level_url(evaluated, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    api.post(_evaluated_url(evaluated), headers=_auth(admin), json=_tutors(db))

    body = api.get(f"/api/children?q={token}&evaluable=true", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(oldest.id), str(newest.id)]
    assert body["total"] == 2


@pytest.mark.parametrize("status", [BookingStatus.PENDING, BookingStatus.CONFIRMED])
def test_evaluable_leaves_out_a_child_with_a_live_evaluation(
    api: TestClient, db: Session, status: BookingStatus
) -> None:
    admin = _make_user(db)
    token = _suffix()
    booked = _make_child(db, name=f"Ana {token}")
    free = _make_child(db, name=f"Zoe {token}")
    _set_status(db, _book_evaluation(api, admin, booked), status)

    body = api.get(f"/api/children?q={token}&evaluable=true", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(free.id)]


@pytest.mark.parametrize("status", [BookingStatus.COMPLETED, BookingStatus.CANCELLED])
def test_evaluable_keeps_a_child_whose_only_evaluation_is_over(
    api: TestClient, db: Session, status: BookingStatus
) -> None:
    admin = _make_user(db)
    token = _suffix()
    child = _make_child(db, name=f"Ana {token}")
    _set_status(db, _book_evaluation(api, admin, child), status)

    body = api.get(f"/api/children?q={token}&evaluable=true", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(child.id)]


def test_awaiting_evaluation_still_lists_a_child_with_a_live_evaluation(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    token = _suffix()
    booked = _make_child(db, name=f"Ana {token}")
    _book_evaluation(api, admin, booked)

    body = api.get(f"/api/children?q={token}&awaiting_evaluation=true", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(booked.id)]


def test_a_tutor_is_refused_the_evaluable_list(api: TestClient, db: Session) -> None:
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)

    response = api.get("/api/children?evaluable=true", headers=_auth(tutor_user))

    assert response.status_code == 403


# --- Mark Evaluated sets the Assigned Tutors ---------------------------------------------------


def _levelled_child(api: TestClient, db: Session, admin: User) -> Child:
    child = _make_child(db)
    api.put(_level_url(child, _make_subject(db)), headers=_auth(admin), json={"level": 5})
    return child


@pytest.mark.parametrize("body", [None, {}, {"tutor_ids": []}])
def test_marking_evaluated_without_tutors_is_422(
    api: TestClient, db: Session, body: dict[str, object] | None
) -> None:
    admin = _make_user(db)
    child = _levelled_child(api, db, admin)

    response = api.post(_evaluated_url(child), headers=_auth(admin), json=body)
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 422
    assert detail["evaluated"] is None


@pytest.mark.parametrize("kind", ["unknown", "archived", "admin"])
def test_marking_evaluated_with_a_non_assignable_id_is_422_and_changes_nothing(
    api: TestClient, db: Session, kind: str
) -> None:
    admin = _make_user(db)
    child = _levelled_child(api, db, admin)
    good = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    if kind == "unknown":
        bad = str(uuid.uuid4())
    elif kind == "archived":
        archived = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
        archived.is_archived = True
        db.flush()
        bad = str(archived.id)
    else:
        bad = str(_make_user(db).id)

    response = api.post(
        _evaluated_url(child), headers=_auth(admin), json={"tutor_ids": [str(good.id), bad]}
    )
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 422
    assert detail["evaluated"] is None
    assert detail["assigned_tutors"] == []


def test_marking_evaluated_sets_the_assigned_tutors_and_collapses_duplicates(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _levelled_child(api, db, admin)
    tutor = _make_user(db, name="Ana", role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    manager = _make_user(db, name="Zed", role=UserRole.MANAGER)

    response = api.post(
        _evaluated_url(child),
        headers=_auth(admin),
        json=_tutors(db, manager, tutor, tutor),
    )
    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert response.status_code == 200
    assert set(response.json()) == {"at", "by"}
    assert [row["id"] for row in detail["assigned_tutors"]] == [str(tutor.id), str(manager.id)]


def test_marking_evaluated_without_a_level_changes_no_assignments(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db)

    response = api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db))

    assert response.status_code == 409
    assert _assigned_ids(api, admin, child) == []


def test_marking_an_evaluated_child_again_leaves_the_assignments_alone(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _levelled_child(api, db, admin)
    first = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    other = _make_user(db, role=UserRole.MANAGER)
    original = api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db, first))

    again = api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db, other))

    assert again.json() == original.json()
    assert _assigned_ids(api, admin, child) == [str(first.id)]


def test_clearing_evaluated_keeps_the_assignments_and_marking_again_replaces_them(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _levelled_child(api, db, admin)
    first = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    second = _make_user(db, role=UserRole.MANAGER)
    api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db, first))

    api.delete(_evaluated_url(child), headers=_auth(admin))
    kept = _assigned_ids(api, admin, child)
    api.post(_evaluated_url(child), headers=_auth(admin), json=_tutors(db, second))

    assert kept == [str(first.id)]
    assert _assigned_ids(api, admin, child) == [str(second.id)]


# --- evaluation_run_by ------------------------------------------------------------------------


def _book_evaluation_on(
    db: Session, child: Child, staff: User, *, days: int, start: str, status: BookingStatus
) -> None:
    db.add(
        Booking(
            child_id=child.id,
            user_id=staff.id,
            kind=BookingKind.EVALUATION,
            location=BookingLocation.IN_OFFICE,
            status=status,
            scheduled_date=clock.business_today() + datetime.timedelta(days=days),
            start_time=datetime.time.fromisoformat(start),
            end_time=datetime.time.fromisoformat(start).replace(hour=23),
        )
    )
    db.flush()


def test_evaluation_run_by_is_the_staff_of_the_latest_non_cancelled_evaluation(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    earlier = _make_user(db, name="Early", role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    later = _make_user(db, name="Late", role=UserRole.MANAGER)
    cancelled = _make_user(db, name="Gone", role=UserRole.MANAGER)
    _book_evaluation_on(db, child, earlier, days=1, start="09:00", status=BookingStatus.COMPLETED)
    _book_evaluation_on(db, child, later, days=2, start="09:00", status=BookingStatus.CONFIRMED)
    _book_evaluation_on(db, child, cancelled, days=5, start="09:00", status=BookingStatus.CANCELLED)
    _book_evaluation_on(
        db, child, cancelled, days=6, start="09:00", status=BookingStatus.DIDNT_HAPPEN
    )

    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert detail["evaluation_run_by"] == {
        "id": str(later.id),
        "name": "Late",
        "role": "manager",
    }


def test_evaluation_run_by_breaks_a_date_tie_by_start_time(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    morning = _make_user(db, role=UserRole.MANAGER)
    afternoon = _make_user(db, name="Pm", role=UserRole.MANAGER)
    _book_evaluation_on(db, child, afternoon, days=2, start="14:00", status=BookingStatus.COMPLETED)
    _book_evaluation_on(db, child, morning, days=2, start="09:00", status=BookingStatus.CONFIRMED)

    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert detail["evaluation_run_by"]["id"] == str(afternoon.id)


def test_evaluation_run_by_is_null_without_an_evaluation(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    manager = _make_user(db, role=UserRole.MANAGER)
    _book_evaluation_on(db, child, manager, days=1, start="09:00", status=BookingStatus.CANCELLED)

    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert detail["evaluation_run_by"] is None


@pytest.mark.parametrize("kind", ["admin", "archived"])
def test_evaluation_run_by_is_null_when_that_staff_cannot_be_assigned(
    api: TestClient, db: Session, kind: str
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    staff = admin if kind == "admin" else _make_user(db, role=UserRole.MANAGER)
    staff.is_archived = kind == "archived"
    db.flush()
    _book_evaluation_on(db, child, staff, days=1, start="09:00", status=BookingStatus.CONFIRMED)

    detail = api.get(f"/api/children/{child.id}", headers=_auth(admin)).json()

    assert detail["evaluation_run_by"] is None


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


def _tutors(db: Session, *tutors: User) -> dict[str, list[str]]:
    """A Mark Evaluated body; with no `tutors`, one fresh Tutor."""
    chosen = tutors or (_make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id),)
    return {"tutor_ids": [str(tutor.id) for tutor in chosen]}


def _assigned_ids(api: TestClient, user: User, child: Child) -> list[str]:
    detail = api.get(f"/api/children/{child.id}", headers=_auth(user)).json()
    return [row["id"] for row in detail["assigned_tutors"]]


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
            is_archived=False,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("evaluation-password")
        user.role = role
        user.is_archived = False
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _evaluation_body(staff: User, child: Child) -> dict[str, object]:
    """An Evaluation In office with `staff`, three days out: inside the window, clear of the
    lead time, and on no one's schedule."""
    return {
        "child_id": str(child.id),
        "user_id": str(staff.id),
        "kind": "evaluation",
        "location": "in_office",
        "scheduled_date": (clock.business_today() + datetime.timedelta(days=3)).isoformat(),
        "start_time": "09:00:00",
        "end_time": "10:00:00",
    }


def _book_evaluation(api: TestClient, staff: User, child: Child) -> uuid.UUID:
    response = api.post("/api/bookings", json=_evaluation_body(staff, child), headers=_auth(staff))
    assert response.status_code == 201, response.json()
    return uuid.UUID(response.json()["id"])


def _set_status(db: Session, booking_id: uuid.UUID, status: BookingStatus) -> None:
    db.get_one(Booking, booking_id).status = status
    db.flush()


def _make_tutor(db: Session) -> Tutor:
    suffix = _suffix()
    tutor = Tutor(
        user=User(email=f"t-{suffix}@x.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_subject(db: Session, *, name: str | None = None, is_archived: bool = False) -> Subject:
    subject = Subject(name=name or f"Subject {_suffix()}", is_archived=is_archived)
    db.add(subject)
    db.flush()
    return subject


def _make_child(
    db: Session, *, name: str | None = None, is_archived: bool = False, created_days_ago: int = 0
) -> Child:
    guardian = Guardian(
        name=f"Guardian {_suffix()}", phone_number=f"+1{uuid.uuid4().int % 10**10:010d}"
    )
    home = Home(address=f"{_suffix()} Main St", directions="1234")
    child = Child(
        name=name or f"Child {_suffix()}",
        grade_level=7,
        school_name="Test School",
        is_archived=is_archived,
        created_at=datetime.datetime.now(tz=datetime.UTC)
        - datetime.timedelta(days=created_days_ago),
    )
    db.add_all([guardian, home, child])
    db.flush()
    db.add_all(
        [
            ChildGuardian(child_id=child.id, guardian_id=guardian.id),
            GuardianHome(guardian_id=guardian.id, home_id=home.id),
        ]
    )
    db.flush()
    return child
