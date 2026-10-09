"""A tutor's recurring weekly availability, exercised over HTTP.

Every negative case asserts the exact status **and** that the body is `{"detail": "<string>"}`,
never merely a non-200 (`_assert_detail`, mirroring `test_exception_routes.py`).

The two assertions that matter most: `test_the_constraint_answers_when_the_pre_check_does_not`
proves the `begin_nested` savepoint is really there and leaves the session usable, and
`test_patch_conflict_leaves_the_session_usable` proves the same for `PATCH` — both are the only
things `03-RESEARCH.md`'s duplicate-key idiom lets a test actually verify.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import OFFICE_REQUIRED_ERROR, CREDENTIALS_ERROR, TUTOR_SCOPE_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, UserRole
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.availability import (
    AVAILABILITY_NOT_FOUND_ERROR,
    SLOT_TAKEN_ERROR,
    TUTOR_NOT_FOUND_ERROR,
)
from app.security import create_access_token, hash_password
from app.services import availability_service

STAFF_ROLE_CASES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER]


# --- list: every slot, active and deactivated -----------------------------------------------


def test_tutor_lists_their_own_availability(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user))
    body = response.json()

    assert response.status_code == 200
    assert set(body) == {"items", "total", "page", "page_size"}
    assert body["total"] == 1
    assert body["page"] == 1
    assert body["page_size"] == 20
    assert [item["id"] for item in body["items"]] == [str(row.id)]


def test_a_deactivated_slot_still_appears_in_the_list(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    _make_slot(
        db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0), is_active=False
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user))
    body = response.json()

    assert body["total"] == 1
    assert body["items"][0]["is_active"] is False


def test_slots_are_ordered_by_day_then_start_time(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    late_monday = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(14, 0))
    early_monday = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    sunday = _make_slot(db, tutor_id=tutor.id, day_of_week=6, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user))
    body = response.json()

    assert [item["id"] for item in body["items"]] == [
        str(early_monday.id),
        str(late_monday.id),
        str(sunday.id),
    ]


def test_total_counts_slots_the_page_did_not_return(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    for hour in (9, 11, 14):
        _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(hour, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    body = api.get(f"/api/tutors/{tutor.id}/availability?page_size=2", headers=_bearer(user)).json()

    assert len(body["items"]) == 2
    assert body["total"] == 3
    assert body["page_size"] == 2


def test_a_sunday_slot_round_trips_as_six(api: TestClient, db: Session) -> None:
    """`weekday()` is 0=Monday…6=Sunday. A suite that only ever exercises a midweek day would
    not catch an `isoweekday()` or `EXTRACT(DOW)` mistake — this is that one Sunday case."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability",
        json={"day_of_week": 6, "start_time": "09:00:00", "end_time": "12:00:00"},
        headers=_bearer(user),
    )

    assert response.status_code == 201
    assert response.json()["day_of_week"] == 6


def test_tutor_listing_another_tutors_availability_is_403(api: TestClient, db: Session) -> None:
    own = _make_tutor(db)
    other = _make_tutor(db)
    _make_slot(db, tutor_id=other.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = api.get(f"/api/tutors/{other.id}/availability", headers=_bearer(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_tutor_with_null_tutor_id_cannot_list(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=None)

    response = api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


@pytest.mark.parametrize("role", STAFF_ROLE_CASES)
def test_admin_lists_any_tutors_availability(api: TestClient, db: Session, role: UserRole) -> None:
    tutor = _make_tutor(db)
    other = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    _make_slot(db, tutor_id=other.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=role)

    response = api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user))
    body = response.json()

    assert response.status_code == 200
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [str(row.id)]


def test_unauthenticated_list_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.get(f"/api/tutors/{tutor.id}/availability")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


# --- create: admin only, one slot at a time -------------------------------------------------


def test_admin_creates_a_slot(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability", json=_payload(), headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 201
    assert body["tutor_id"] == str(tutor.id)
    assert body["day_of_week"] == 0
    assert body["start_time"] == "09:00:00"
    assert body["end_time"] == "12:00:00"
    assert body["is_active"] is True


def test_tutor_cannot_create_a_slot(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)


def test_admin_creating_for_an_unknown_tutor_is_404(api: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{uuid.uuid4()}/availability", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 404, TUTOR_NOT_FOUND_ERROR)


def test_duplicate_slot_is_409_and_only_one_row_exists(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    first = api.post(f"/api/tutors/{tutor.id}/availability", json=_payload(), headers=_bearer(user))
    second = api.post(
        f"/api/tutors/{tutor.id}/availability", json=_payload(), headers=_bearer(user)
    )

    assert first.status_code == 201
    _assert_detail(second, 409, SLOT_TAKEN_ERROR)
    assert _count_for(db, tutor.id) == 1


def test_the_constraint_answers_when_the_pre_check_does_not(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-check produces the message; the constraint is what survives a race. Stubbing it
    out is the only way this second layer becomes reachable, and the session must still work
    for the request right after — that is what proves `begin_nested` is really there."""
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)
    assert (
        api.post(
            f"/api/tutors/{tutor.id}/availability", json=_payload(), headers=_bearer(user)
        ).status_code
        == 201
    )

    monkeypatch.setattr(availability_service, "_slot_taken", lambda *_, **__: False)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 409, SLOT_TAKEN_ERROR)
    assert api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user)).status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [
        {"start_time": "12:00:00", "end_time": "12:00:00"},
        {"start_time": "12:00:00", "end_time": "09:00:00"},
    ],
    ids=["equal-times", "inverted-times"],
)
def test_a_non_positive_range_is_400(
    api: TestClient, db: Session, overrides: dict[str, str]
) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability", json=_payload(**overrides), headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)
    assert _count_for(db, tutor.id) == 0


@pytest.mark.parametrize("day_of_week", [-1, 7])
def test_an_out_of_range_day_is_400(api: TestClient, db: Session, day_of_week: int) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability",
        json=_payload(day_of_week=day_of_week),
        headers=_bearer(user),
    )

    _assert_detail_shape(response, 400)
    assert _count_for(db, tutor.id) == 0


def test_unauthenticated_create_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.post(f"/api/tutors/{tutor.id}/availability", json=_payload())

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _count_for(db, tutor.id) == 0


# --- update: admin only, time or active status ----------------------------------------------


def test_admin_updates_only_end_time(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{row.id}", json={"end_time": "11:00:00"}, headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert body["end_time"] == "11:00:00"
    assert body["start_time"] == "09:00:00"


def test_end_time_at_or_before_the_stored_start_time_is_400(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{row.id}", json={"end_time": "08:00:00"}, headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)
    assert _row(db, row.id).end_time == datetime.time(18, 0)


def test_moving_start_time_onto_another_slot_is_409(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(14, 0))
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{row.id}", json={"start_time": "14:00:00"}, headers=_bearer(user)
    )

    _assert_detail(response, 409, SLOT_TAKEN_ERROR)
    assert _row(db, row.id).start_time == datetime.time(9, 0)


def test_moving_start_time_onto_its_own_current_value_is_a_no_op(
    api: TestClient, db: Session
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{row.id}", json={"start_time": "09:00:00"}, headers=_bearer(user)
    )

    assert response.status_code == 200
    assert response.json()["start_time"] == "09:00:00"


def test_patch_conflict_leaves_the_session_usable(api: TestClient, db: Session) -> None:
    """The `_take_snapshot` defect: assigning fields before `begin_nested` produces a
    correct-looking 409 and an unusable `Session`. Only the next request proves it wrong."""
    tutor = _make_tutor(db)
    _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(14, 0))
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    conflict = api.patch(
        f"/api/availability/{row.id}", json={"start_time": "14:00:00"}, headers=_bearer(user)
    )
    assert conflict.status_code == 409

    following = api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user))

    assert following.status_code == 200


def test_patch_body_carrying_day_of_week_is_ignored(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{row.id}",
        json={"day_of_week": 3, "end_time": "11:00:00"},
        headers=_bearer(user),
    )

    assert response.status_code == 200
    assert response.json()["day_of_week"] == 0
    assert _row(db, row.id).day_of_week == 0


def test_tutor_cannot_update_a_slot(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.patch(
        f"/api/availability/{row.id}", json={"end_time": "11:00:00"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)


def test_updating_an_unknown_slot_is_404(api: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{uuid.uuid4()}", json={"end_time": "11:00:00"}, headers=_bearer(user)
    )

    _assert_detail(response, 404, AVAILABILITY_NOT_FOUND_ERROR)


def test_unauthenticated_update_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))

    response = api.patch(f"/api/availability/{row.id}", json={"end_time": "11:00:00"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)


# --- delete: a soft delete only --------------------------------------------------------------


def test_admin_deactivates_a_slot(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.delete(f"/api/availability/{row.id}", headers=_bearer(user))

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert _row(db, row.id).is_active is False


def test_deactivating_twice_is_200_both_times(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.ADMIN)

    first = api.delete(f"/api/availability/{row.id}", headers=_bearer(user))
    second = api.delete(f"/api/availability/{row.id}", headers=_bearer(user))

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["is_active"] is False


def test_a_referencing_booking_survives_deactivation(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    booking = _make_booking(db, tutor_id=tutor.id, availability_id=row.id)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.delete(f"/api/availability/{row.id}", headers=_bearer(user))

    assert response.status_code == 200
    db.expire_all()
    assert db.get_one(Booking, booking.id).availability_id == row.id


def test_tutor_cannot_delete_a_slot(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.delete(f"/api/availability/{row.id}", headers=_bearer(user))

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)


def test_deleting_an_unknown_slot_is_404(api: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.delete(f"/api/availability/{uuid.uuid4()}", headers=_bearer(user))

    _assert_detail(response, 404, AVAILABILITY_NOT_FOUND_ERROR)


def test_unauthenticated_delete_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))

    response = api.delete(f"/api/availability/{row.id}")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


@pytest.mark.parametrize("role", STAFF_ROLE_CASES)
def test_developer_reaches_every_admin_only_route(
    api: TestClient, db: Session, role: UserRole
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=role)

    created = api.post(
        f"/api/tutors/{tutor.id}/availability",
        json=_payload(start_time="13:00:00", end_time="15:00:00"),
        headers=_bearer(user),
    )
    patched = api.patch(
        f"/api/availability/{row.id}", json={"end_time": "10:00:00"}, headers=_bearer(user)
    )
    deleted = api.delete(f"/api/availability/{row.id}", headers=_bearer(user))

    assert created.status_code == 201
    assert patched.status_code == 200
    assert deleted.status_code == 200


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "day_of_week": 0,
        "start_time": "09:00:00",
        "end_time": "12:00:00",
    }
    payload.update(overrides)
    return payload


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_user(db: Session, *, role: UserRole, tutor_id: uuid.UUID | None = None) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password("availability-password"),
            role=role,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("availability-password")
        user.role = role
    db.flush()
    return user


def _make_slot(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    day_of_week: int,
    start_time: datetime.time,
    end_time: datetime.time = datetime.time(18, 0),
    is_active: bool = True,
) -> TutorAvailability:
    row = TutorAvailability(
        tutor_id=tutor_id,
        day_of_week=day_of_week,
        start_time=start_time,
        end_time=end_time,
        is_active=is_active,
    )
    db.add(row)
    db.flush()
    return row


def _make_booking(db: Session, *, tutor_id: uuid.UUID, availability_id: uuid.UUID) -> Booking:
    home = Home(label="Home", address="1 Main St", access_code="1234")
    child = Child(name="Kid", grade_level=5, school_name="Test School")
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add_all([home, child, subject])
    db.flush()

    booking = Booking(
        tutor_id=tutor_id,
        child_id=child.id,
        availability_id=availability_id,
        home_id=home.id,
        subject_id=subject.id,
        scheduled_date=datetime.date(2026, 9, 7),
        start_time=datetime.time(9, 0),
        end_time=datetime.time(10, 0),
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()
    return booking


def _row(db: Session, availability_id: uuid.UUID) -> TutorAvailability:
    db.expire_all()
    return db.get_one(TutorAvailability, availability_id)


def _count_for(db: Session, tutor_id: uuid.UUID) -> int:
    from sqlalchemy import func, select

    return db.execute(
        select(func.count())
        .select_from(TutorAvailability)
        .where(TutorAvailability.tutor_id == tutor_id)
    ).scalar_one()


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)


def _assert_detail_shape(response: Response, expected_status: int) -> None:
    assert response.status_code == expected_status
    body = response.json()
    assert set(body) == {"detail"}
    assert isinstance(body["detail"], str)
