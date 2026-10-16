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

from app.dependencies import CREDENTIALS_ERROR, TUTOR_SCOPE_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import (
    AvailabilityMode,
    BookingKind,
    BookingLocation,
    BookingStatus,
    UserRole,
)
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.availability import (
    AVAILABILITY_NOT_FOUND_ERROR,
    DEVELOPER_FORBIDDEN_ERROR,
    NOT_YOUR_AVAILABILITY_ERROR,
    PEER_ADMIN_FORBIDDEN_ERROR,
    SLOT_TAKEN_ERROR,
    TUTOR_NOT_FOUND_ERROR,
)
from app.schemas.availability import MAX_WEEK_SLOTS
from app.security import create_access_token, hash_password
from app.services import availability_service
from tests.support import user_id_of

STAFF_ROLE_CASES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER]
ADMIN_ROLE_CASES = [UserRole.ADMIN, UserRole.DEVELOPER]
ALL_ROLE_CASES = [UserRole.TUTOR, *STAFF_ROLE_CASES]
WRITE_CASES = ["create", "update", "delete"]
WRITE_SUCCESS_STATUS = {"create": 201, "update": 200, "delete": 200}


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


# --- mode: where the bot may offer the slot --------------------------------------------------


def test_a_listed_slot_carries_its_mode(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    _make_slot(
        db,
        tutor_id=tutor.id,
        day_of_week=0,
        start_time=datetime.time(9, 0),
        mode=AvailabilityMode.ONLY_OFFICE,
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = api.get(f"/api/tutors/{tutor.id}/availability", headers=_bearer(user))

    assert response.json()["items"][0]["mode"] == "only_office"


def test_a_slot_created_without_mode_reads_back_anywhere(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability", json=_payload(), headers=_bearer(user)
    )

    assert response.status_code == 201
    assert response.json()["mode"] == "anywhere"


def test_a_slot_created_with_a_mode_reads_back_that_mode(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability",
        json=_payload(mode="only_office"),
        headers=_bearer(user),
    )

    assert response.status_code == 201
    assert response.json()["mode"] == "only_office"


def test_an_unknown_mode_is_400(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.post(
        f"/api/tutors/{tutor.id}/availability",
        json=_payload(mode="teleport"),
        headers=_bearer(user),
    )

    _assert_detail_shape(response, 400)
    assert _count_for(db, tutor.id) == 0


def test_patching_mode_changes_only_the_mode_and_leaves_bookings_alone(
    api: TestClient, db: Session
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(
        db,
        tutor_id=tutor.id,
        day_of_week=0,
        start_time=datetime.time(9, 0),
        mode=AvailabilityMode.ONLY_OFFICE,
    )
    booking = _make_booking(db, tutor_id=tutor.id, availability_id=row.id)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{row.id}", json={"mode": "traveler"}, headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert body["mode"] == "traveler"
    assert body["start_time"] == "09:00:00"
    assert body["end_time"] == "18:00:00"
    assert body["is_active"] is True
    db.expire_all()
    kept = db.get_one(Booking, booking.id)
    assert kept.availability_id == row.id
    assert kept.status == BookingStatus.CONFIRMED


def test_a_patch_without_mode_leaves_it_as_it_was(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(
        db,
        tutor_id=tutor.id,
        day_of_week=0,
        start_time=datetime.time(9, 0),
        mode=AvailabilityMode.ONLY_OFFICE,
    )
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/availability/{row.id}", json={"end_time": "11:00:00"}, headers=_bearer(user)
    )

    assert response.json()["mode"] == "only_office"


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


def test_deleting_an_unknown_slot_is_404(api: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.delete(f"/api/availability/{uuid.uuid4()}", headers=_bearer(user))

    _assert_detail(response, 404, AVAILABILITY_NOT_FOUND_ERROR)


def test_unauthenticated_delete_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))

    response = api.delete(f"/api/availability/{row.id}")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
def test_an_admin_role_reaches_every_write_on_a_tutors_slots(
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


# --- who may write: self, or an Admin role within the account boundary (#208) ---------------


@pytest.mark.parametrize("write", WRITE_CASES)
@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER])
def test_a_tutor_or_manager_writes_their_own_availability(
    api: TestClient, db: Session, role: UserRole, write: str
) -> None:
    own = _make_tutor(db)
    slot = _make_slot(db, tutor_id=own.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=role, tutor_id=own.id)

    response = _write(api, write, user=user, tutor_id=own.id, slot_id=slot.id)

    assert response.status_code == WRITE_SUCCESS_STATUS[write]
    assert response.json()["tutor_id"] == str(own.id)


@pytest.mark.parametrize("write", WRITE_CASES)
@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER])
def test_a_tutor_or_manager_on_another_tutors_availability_is_403(
    api: TestClient, db: Session, role: UserRole, write: str
) -> None:
    own = _make_tutor(db)
    user = _make_user(db, role=role, tutor_id=own.id)
    other = _make_tutor(db)
    slot = _make_slot(db, tutor_id=other.id, day_of_week=0, start_time=datetime.time(9, 0))

    response = _write(api, write, user=user, tutor_id=other.id, slot_id=slot.id)

    _assert_detail(response, 403, NOT_YOUR_AVAILABILITY_ERROR)
    _assert_untouched(db, tutor_id=other.id, slot_id=slot.id)


@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER])
def test_a_tutor_or_manager_naming_an_unknown_tutor_is_403_not_404(
    api: TestClient, db: Session, role: UserRole
) -> None:
    """Refused before the lookup, so the route is no oracle for which profile ids exist."""
    own = _make_tutor(db)
    user = _make_user(db, role=role, tutor_id=own.id)

    response = api.post(
        f"/api/tutors/{uuid.uuid4()}/availability", json=_payload(), headers=_bearer(user)
    )

    _assert_detail(response, 403, NOT_YOUR_AVAILABILITY_ERROR)


@pytest.mark.parametrize("write", WRITE_CASES)
@pytest.mark.parametrize(
    ("actor_role", "target_role"),
    [
        (UserRole.ADMIN, UserRole.TUTOR),
        (UserRole.ADMIN, UserRole.MANAGER),
        (UserRole.DEVELOPER, UserRole.TUTOR),
        (UserRole.DEVELOPER, UserRole.MANAGER),
        (UserRole.DEVELOPER, UserRole.ADMIN),
        (UserRole.DEVELOPER, UserRole.DEVELOPER),
    ],
    ids=lambda role: role.value,
)
def test_an_admin_role_writes_availability_inside_the_account_boundary(
    api: TestClient, db: Session, actor_role: UserRole, target_role: UserRole, write: str
) -> None:
    actor = _make_user(db, role=actor_role)
    target = _make_tutor(db)
    _make_user(db, role=target_role, tutor_id=target.id)
    slot = _make_slot(db, tutor_id=target.id, day_of_week=0, start_time=datetime.time(9, 0))

    response = _write(api, write, user=actor, tutor_id=target.id, slot_id=slot.id)

    assert response.status_code == WRITE_SUCCESS_STATUS[write]


@pytest.mark.parametrize("write", WRITE_CASES)
@pytest.mark.parametrize(
    ("target_role", "detail"),
    [
        (UserRole.ADMIN, PEER_ADMIN_FORBIDDEN_ERROR),
        (UserRole.DEVELOPER, DEVELOPER_FORBIDDEN_ERROR),
    ],
    ids=["peer-admin", "developer"],
)
def test_an_admin_on_a_peer_admins_or_developers_availability_is_403(
    api: TestClient, db: Session, target_role: UserRole, detail: str, write: str
) -> None:
    """The account boundary `/api/users` keeps (#173), seen from the schedule editor."""
    admin = _make_user(db, role=UserRole.ADMIN)
    target = _make_tutor(db)
    _make_user(db, role=target_role, tutor_id=target.id)
    slot = _make_slot(db, tutor_id=target.id, day_of_week=0, start_time=datetime.time(9, 0))

    response = _write(api, write, user=admin, tutor_id=target.id, slot_id=slot.id)

    _assert_detail(response, 403, detail)
    _assert_untouched(db, tutor_id=target.id, slot_id=slot.id)


@pytest.mark.parametrize("write", WRITE_CASES)
def test_an_admin_writes_their_own_kept_profiles_availability(
    api: TestClient, db: Session, write: str
) -> None:
    own = _make_tutor(db)
    admin = _make_user(db, role=UserRole.ADMIN, tutor_id=own.id)
    slot = _make_slot(db, tutor_id=own.id, day_of_week=0, start_time=datetime.time(9, 0))

    response = _write(api, write, user=admin, tutor_id=own.id, slot_id=slot.id)

    assert response.status_code == WRITE_SUCCESS_STATUS[write]


@pytest.mark.parametrize("write", ["update", "delete"])
@pytest.mark.parametrize("role", ALL_ROLE_CASES)
def test_an_unknown_slot_is_404_for_every_role(
    api: TestClient, db: Session, role: UserRole, write: str
) -> None:
    own = _make_tutor(db)
    user = _make_user(db, role=role, tutor_id=own.id)

    response = _write(api, write, user=user, tutor_id=own.id, slot_id=uuid.uuid4())

    _assert_detail(response, 404, AVAILABILITY_NOT_FOUND_ERROR)


# --- replace the whole week: PUT ------------------------------------------------------------


def test_put_keeps_the_id_of_a_slot_submitted_unchanged(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    kept = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(
        api, user=user, tutor_id=tutor.id, slots=[_week_slot(0, "09:00", "18:00", "traveler")]
    )
    body = response.json()

    assert response.status_code == 200
    assert set(body) == {"items", "total", "page", "page_size"}
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [str(kept.id)]


def test_put_deactivates_an_active_slot_left_out_of_the_week(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    kept = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    dropped = _make_slot(db, tutor_id=tutor.id, day_of_week=2, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(
        api, user=user, tutor_id=tutor.id, slots=[_week_slot(0, "09:00", "18:00", "traveler")]
    )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(kept.id)]
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(kept.id): ("09:00:00", "18:00:00", True),
        str(dropped.id): ("09:00:00", "18:00:00", False),
    }


def test_put_creates_new_slots_and_answers_in_the_lists_order(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    kept = _make_slot(db, tutor_id=tutor.id, day_of_week=1, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(
        api,
        user=user,
        tutor_id=tutor.id,
        slots=[
            _week_slot(4, "14:00", "16:00", "only_office"),
            _week_slot(1, "09:00", "18:00", "traveler"),
            _week_slot(0, "10:00", "11:00"),
        ],
    )
    items = response.json()["items"]

    assert response.status_code == 200
    assert [(item["day_of_week"], item["start_time"], item["mode"]) for item in items] == [
        (0, "10:00:00", "anywhere"),
        (1, "09:00:00", "traveler"),
        (4, "14:00:00", "only_office"),
    ]
    assert items[1]["id"] == str(kept.id)
    assert str(kept.id) not in {items[0]["id"], items[2]["id"]}
    assert all(item["is_active"] for item in items)


def test_put_changes_a_slots_end_and_mode_in_place(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(
        api, user=user, tutor_id=tutor.id, slots=[_week_slot(0, "09:00", "12:00", "only_office")]
    )
    items = response.json()["items"]

    assert response.status_code == 200
    assert [(item["id"], item["end_time"], item["mode"]) for item in items] == [
        (str(row.id), "12:00:00", "only_office")
    ]
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(row.id): ("09:00:00", "12:00:00", True)
    }


def test_put_restores_a_deactivated_slot_with_the_same_start(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(
        db, tutor_id=tutor.id, day_of_week=3, start_time=datetime.time(9, 0), is_active=False
    )
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(api, user=user, tutor_id=tutor.id, slots=[_week_slot(3, "09:00", "10:00")])

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == [str(row.id)]
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(row.id): ("09:00:00", "10:00:00", True)
    }


def test_put_with_no_slots_deactivates_the_whole_week(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    first = _make_slot(db, tutor_id=tutor.id, day_of_week=0, start_time=datetime.time(9, 0))
    second = _make_slot(db, tutor_id=tutor.id, day_of_week=5, start_time=datetime.time(8, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(api, user=user, tutor_id=tutor.id, slots=[])

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(first.id): ("09:00:00", "18:00:00", False),
        str(second.id): ("08:00:00", "18:00:00", False),
    }


def test_put_allows_slots_that_only_touch(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(
        api,
        user=user,
        tutor_id=tutor.id,
        slots=[_week_slot(0, "09:00", "10:00"), _week_slot(0, "10:00", "11:00")],
    )

    assert response.status_code == 200
    assert response.json()["total"] == 2


@pytest.mark.parametrize(
    "ranges",
    [
        [(0, "09:00", "11:00"), (0, "10:30", "12:00")],
        [(2, "09:00", "10:00"), (2, "09:00", "11:00")],
        [(2, "08:00", "12:00"), (2, "09:00", "10:00")],
    ],
    ids=["intersecting", "same-start", "contained"],
)
def test_put_refuses_an_overlapping_week_and_changes_nothing(
    api: TestClient, db: Session, ranges: list[tuple[int, str, str]]
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=4, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    slots = [_week_slot(day, start, end) for day, start, end in ranges]

    response = _put_week(api, user=user, tutor_id=tutor.id, slots=slots)

    _assert_detail(response, 409, SLOT_TAKEN_ERROR)
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(row.id): ("09:00:00", "18:00:00", True)
    }


@pytest.mark.parametrize(
    ("start", "end"), [("12:00", "12:00"), ("12:00", "09:00")], ids=["equal", "inverted"]
)
def test_put_refuses_a_non_positive_range_and_changes_nothing(
    api: TestClient, db: Session, start: str, end: str
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=4, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(
        api,
        user=user,
        tutor_id=tutor.id,
        slots=[_week_slot(1, "09:00", "10:00"), _week_slot(2, start, end)],
    )

    # The request-validation handler answers 400, not FastAPI's default 422, exactly as for POST.
    _assert_detail(response, 400, "slots.1: Value error, end_time must be after start_time")
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(row.id): ("09:00:00", "18:00:00", True)
    }


def test_put_refuses_more_slots_than_a_week_can_hold_and_changes_nothing(
    api: TestClient, db: Session
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=4, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)
    # One slot per minute from midnight Monday: none overlap, so only the cap refuses them.
    slots = [
        _week_slot(0, _clock(minute), _clock(minute + 1)) for minute in range(MAX_WEEK_SLOTS + 1)
    ]

    response = _put_week(api, user=user, tutor_id=tutor.id, slots=slots)

    _assert_detail_shape(response, 400)
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(row.id): ("09:00:00", "18:00:00", True)
    }


@pytest.mark.parametrize(
    ("start", "end"),
    [("09:00:30", "10:00:00"), ("09:00:00", "10:00:00.000001")],
    ids=["seconds", "microseconds"],
)
def test_put_refuses_a_time_finer_than_a_minute_and_changes_nothing(
    api: TestClient, db: Session, start: str, end: str
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=4, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(api, user=user, tutor_id=tutor.id, slots=[_week_slot(1, start, end)])

    _assert_detail_shape(response, 400)
    assert "whole minute" in response.json()["detail"]
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(row.id): ("09:00:00", "18:00:00", True)
    }


@pytest.mark.parametrize(
    "slots",
    [
        [("09:00Z", "10:00Z")],
        [("09:00", "10:00"), ("10:00+02:00", "11:00+02:00")],
    ],
    ids=["utc-marked", "mixed-with-naive"],
)
def test_put_refuses_a_timezone_marked_time_and_changes_nothing(
    api: TestClient, db: Session, slots: list[tuple[str, str]]
) -> None:
    tutor = _make_tutor(db)
    row = _make_slot(db, tutor_id=tutor.id, day_of_week=4, start_time=datetime.time(9, 0))
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)

    response = _put_week(
        api, user=user, tutor_id=tutor.id, slots=[_week_slot(1, start, end) for start, end in slots]
    )

    _assert_detail_shape(response, 400)
    assert "time zone" in response.json()["detail"]
    assert _listed_week(api, user=user, tutor_id=tutor.id) == {
        str(row.id): ("09:00:00", "18:00:00", True)
    }


@pytest.mark.parametrize("role", [UserRole.MANAGER, *ADMIN_ROLE_CASES])
def test_put_is_open_to_the_profiles_owner_of_any_role(
    api: TestClient, db: Session, role: UserRole
) -> None:
    tutor = _make_tutor(db)
    user = _make_user(db, role=role, tutor_id=tutor.id)

    response = _put_week(api, user=user, tutor_id=tutor.id, slots=[_week_slot(0, "09:00", "10:00")])

    assert response.status_code == 200


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
def test_an_admin_role_puts_a_tutors_week(api: TestClient, db: Session, role: UserRole) -> None:
    tutor = _make_tutor(db)
    admin = _make_user(db, role=role)

    response = _put_week(
        api, user=admin, tutor_id=tutor.id, slots=[_week_slot(0, "09:00", "10:00")]
    )

    assert response.status_code == 200
    assert [item["tutor_id"] for item in response.json()["items"]] == [str(tutor.id)]


@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER])
def test_a_tutor_or_manager_putting_another_tutors_week_is_403(
    api: TestClient, db: Session, role: UserRole
) -> None:
    own = _make_tutor(db)
    user = _make_user(db, role=role, tutor_id=own.id)
    other = _make_tutor(db)
    row = _make_slot(db, tutor_id=other.id, day_of_week=0, start_time=datetime.time(9, 0))
    admin = _make_user(db, role=UserRole.ADMIN)

    response = _put_week(api, user=user, tutor_id=other.id, slots=[])

    _assert_detail(response, 403, NOT_YOUR_AVAILABILITY_ERROR)
    assert _listed_week(api, user=admin, tutor_id=other.id) == {
        str(row.id): ("09:00:00", "18:00:00", True)
    }


def test_a_tutor_putting_an_unknown_profiles_week_is_403_not_404(
    api: TestClient, db: Session
) -> None:
    own = _make_tutor(db)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=own.id)

    response = _put_week(api, user=user, tutor_id=uuid.uuid4(), slots=[])

    _assert_detail(response, 403, NOT_YOUR_AVAILABILITY_ERROR)


def test_an_admin_putting_an_unknown_profiles_week_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)

    response = _put_week(api, user=admin, tutor_id=uuid.uuid4(), slots=[])

    _assert_detail(response, 404, TUTOR_NOT_FOUND_ERROR)


def test_an_admin_putting_a_peer_admins_week_is_403(api: TestClient, db: Session) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    target = _make_tutor(db)
    _make_user(db, role=UserRole.ADMIN, tutor_id=target.id)

    response = _put_week(api, user=admin, tutor_id=target.id, slots=[])

    _assert_detail(response, 403, PEER_ADMIN_FORBIDDEN_ERROR)


def test_unauthenticated_put_is_401(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.put(f"/api/tutors/{tutor.id}/availability", json={"slots": []})

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def _write(
    api: TestClient, write: str, *, user: User, tutor_id: uuid.UUID, slot_id: uuid.UUID
) -> Response:
    headers = _bearer(user)

    if write == "create":
        response = api.post(
            f"/api/tutors/{tutor_id}/availability",
            json=_payload(start_time="13:00:00", end_time="15:00:00"),
            headers=headers,
        )
    elif write == "update":
        response = api.patch(
            f"/api/availability/{slot_id}", json={"end_time": "10:00:00"}, headers=headers
        )
    else:
        response = api.delete(f"/api/availability/{slot_id}", headers=headers)
    return response


def _put_week(
    api: TestClient, *, user: User, tutor_id: uuid.UUID, slots: list[dict[str, object]]
) -> Response:
    return api.put(
        f"/api/tutors/{tutor_id}/availability", json={"slots": slots}, headers=_bearer(user)
    )


def _week_slot(day_of_week: int, start: str, end: str, mode: str = "anywhere") -> dict[str, object]:
    return {"day_of_week": day_of_week, "start_time": start, "end_time": end, "mode": mode}


def _clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _listed_week(
    api: TestClient, *, user: User, tutor_id: uuid.UUID
) -> dict[str, tuple[str, str, bool]]:
    """Every stored slot as GET answers it: id to (start, end, is_active)."""
    response = api.get(f"/api/tutors/{tutor_id}/availability", headers=_bearer(user))
    assert response.status_code == 200
    return {
        item["id"]: (item["start_time"], item["end_time"], item["is_active"])
        for item in response.json()["items"]
    }


def _assert_untouched(db: Session, *, tutor_id: uuid.UUID, slot_id: uuid.UUID) -> None:
    row = _row(db, slot_id)
    assert _count_for(db, tutor_id) == 1
    assert (row.end_time, row.is_active) == (datetime.time(18, 0), True)


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
    mode: AvailabilityMode = AvailabilityMode.TRAVELER,
) -> TutorAvailability:
    row = TutorAvailability(
        tutor_id=tutor_id,
        day_of_week=day_of_week,
        start_time=start_time,
        end_time=end_time,
        is_active=is_active,
        mode=mode,
    )
    db.add(row)
    db.flush()
    return row


def _make_booking(db: Session, *, tutor_id: uuid.UUID, availability_id: uuid.UUID) -> Booking:
    home = Home(label="Home", address="1 Main St", directions="1234")
    child = Child(name="Kid", grade_level=5, school_name="Test School")
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add_all([home, child, subject])
    db.flush()

    booking = Booking(
        user_id=user_id_of(db, tutor_id),
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
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
