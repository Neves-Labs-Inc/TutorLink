"""`PUT /api/bookings/{id}` — the dashboard Reschedule, editing a live booking in place.

Same id, same kind, same status; every create rule re-run against the new values, under the
same warning contract (#151), with the booking itself left out of its own neighbours. The
fixtures are `test_booking_write_routes`'s family, so an edit is judged against exactly the
rows a create is.

Every negative case asserts the exact status **and** the exact body, for the reason given at
the top of `test_booking_write_routes.py`.

Dates are computed from today, as there, so the window gates are met on any day the suite runs;
the correction-mode tests freeze the clock instead, since "already past" is the thing under test.
"""

import datetime
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import OFFICE_REQUIRED_ERROR
from app.models.booking import NOTES_MAX_LENGTH, Booking
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.user import User
from app.routers.booking_status import BOOKING_NOT_FOUND_ERROR
from app.routers.booking_writes import (
    BOOKING_KIND_IMMUTABLE_ERROR,
    BOOKING_NOT_LIVE_ERROR,
    BOOKING_OVERLAPS_ERROR,
    BOOKING_SHAPE_INVALID_ERROR,
    DATE_OUT_OF_WINDOW_ERROR,
    HOME_NOT_LINKED_ERROR,
    LEAD_TIME_NOT_MET_ERROR,
    STAFF_ROLE_NOT_ALLOWED_ERROR,
)
from app.services import booking_write_service
from tests.fake_twilio import FakeTwilio
from tests.test_booking_write_routes import (
    ELEVEN,
    MONDAY,
    OUTSIDE_SLOT,
    TEN,
    TWELVE,
    Family,
    _assert_detail,
    _assert_warnings,
    _auth,
    _make_family,
    _make_user,
    _mark_evaluated,
    _row,
)

ONE_PM = "13:00:00"
SEVEN = "07:00:00"
EIGHT = "08:00:00"

LIVE_STATUSES = [BookingStatus.PENDING, BookingStatus.CONFIRMED]
ENDED_STATUSES = [BookingStatus.COMPLETED, BookingStatus.CANCELLED]


@pytest.fixture
def family(db: Session) -> Family:
    return _make_family(db)


# --- the happy path: same id, same status, `updated_at` bumped -------------------------------


@pytest.mark.parametrize("live", LIVE_STATUSES)
def test_editing_a_live_regular_bookings_time_keeps_its_id_and_status(
    api: TestClient, db: Session, family: Family, live: BookingStatus
) -> None:
    booking = _book(db, family, status=live)
    before = booking.updated_at
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)
    body = response.json()

    assert response.status_code == 200
    assert body["id"] == str(booking.id)
    assert body["status"] == live.value
    assert body["start_time"] == TEN
    assert body["end_time"] == ELEVEN
    row = _row(db, booking.id)
    assert row.status is live
    assert row.start_time == datetime.time(10, 0)
    assert datetime.datetime.fromisoformat(body["updated_at"]) == row.updated_at
    assert row.updated_at > before


# --- the booking is not its own neighbour (rules 2 and 3) -----------------------------------


def test_restating_the_current_time_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """It does not overlap itself, and `updated_at` still bumps on a restatement."""
    booking = _book(db, family)
    before = booking.updated_at
    user = _make_user(db)

    response = _put(api, user, booking, family)

    assert response.status_code == 200
    assert _row(db, booking.id).updated_at > before


def test_moving_onto_another_live_booking_of_the_same_staff_member_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _book(db, family)
    _book(db, family, start=datetime.time(11, 0), end=datetime.time(12, 0))
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=ELEVEN, end_time=TWELVE)

    _assert_detail(response, 409, BOOKING_OVERLAPS_ERROR)
    assert _row(db, booking.id).start_time == datetime.time(9, 0)


def test_the_constraint_refuses_an_edit_the_pre_checks_missed(
    api: TestClient, db: Session, family: Family, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The edit-side constraint seam, mirroring the create's: `excl_bookings_live_overlap`
    standing in for the race the rules cannot see. The follow-up is the assertion that matters —
    an UPDATE flushed outside the savepoint gives this same 409 and leaves the `Session`
    unusable, so the next request 500s."""
    booking = _book(db, family)
    _book(db, family, start=datetime.time(11, 0), end=datetime.time(12, 0))
    user = _make_user(db)
    monkeypatch.setattr(booking_write_service, "_overlapping_booking", lambda *a, **k: False)
    monkeypatch.setattr(booking_write_service, "_gap_encroached", lambda *a, **k: False)

    refused = _put(api, user, booking, family, start_time=ELEVEN, end_time=TWELVE)
    follow_up = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)

    _assert_detail(refused, 409, BOOKING_OVERLAPS_ERROR)
    assert follow_up.status_code == 200
    assert _row(db, booking.id).start_time == datetime.time(10, 0)


def test_moving_inside_the_gap_of_its_own_old_time_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """10:00 abuts the old 09:00-10:00; against any other booking that is the `gap` warning."""
    booking = _book(db, family)
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)

    assert response.status_code == 200


# --- changing the Staff member: the new role's rules apply (#130) ---------------------------


def test_a_tutor_to_admin_change_keeping_the_slot_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _book(db, family)
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    response = _put(api, user, booking, family, user_id=str(admin.id))

    _assert_detail(response, 422, BOOKING_SHAPE_INVALID_ERROR)
    assert _row(db, booking.id).user_id == family.tutor.user_id


def test_a_tutor_to_admin_change_without_the_slot_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """The Admin column's rules: a time outside the old slot is no warning for an Admin."""
    booking = _book(db, family)
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    response = _put(
        api,
        user,
        booking,
        family,
        user_id=str(admin.id),
        availability_id=None,
        start_time=TWELVE,
        end_time=ONE_PM,
    )

    assert response.status_code == 200
    assert response.json()["staff"]["id"] == str(admin.id)
    row = _row(db, booking.id)
    assert row.user_id == admin.id
    assert row.availability_id is None


def test_an_admin_to_tutor_change_needs_a_slot_of_that_tutor(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    booking = _book(db, family, user_id=admin.id, availability_id=None)
    user = _make_user(db)

    without_slot = _put(api, user, booking, family, user_id=str(family.tutor.user_id))
    with_slot = _put(
        api,
        user,
        booking,
        family,
        user_id=str(family.tutor.user_id),
        availability_id=str(family.availability_id),
    )

    _assert_detail(without_slot, 422, BOOKING_SHAPE_INVALID_ERROR)
    assert with_slot.status_code == 200
    assert _row(db, booking.id).availability_id == family.availability_id


# --- changing the Location (#130, #132) -----------------------------------------------------


def test_a_home_to_in_office_change_drops_the_home(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _book(db, family)
    user = _make_user(db)

    response = _put(api, user, booking, family, location="in_office", home_id=None)

    assert response.status_code == 200
    assert response.json()["home"] is None
    row = _row(db, booking.id)
    assert row.location is BookingLocation.IN_OFFICE
    assert row.home_id is None


def test_a_home_not_the_childs_is_422(api: TestClient, db: Session, family: Family) -> None:
    booking = _book(db, family)
    user = _make_user(db)

    response = _put(api, user, booking, family, home_id=str(family.stranger_home.id))

    _assert_detail(response, 422, HOME_NOT_LINKED_ERROR)
    assert _row(db, booking.id).home_id == family.home.id


# --- editing an Evaluation (#133) ------------------------------------------------------------


def test_an_evaluations_new_time_is_accepted(api: TestClient, db: Session, family: Family) -> None:
    """The Evaluation is its own only live Evaluation, and rule 9 leaves it out."""
    evaluation = _book_evaluation(db, family)
    user = _make_user(db)

    response = _put(api, user, evaluation, family, start_time=ELEVEN, end_time=TWELVE)

    assert response.status_code == 200
    assert response.json()["kind"] == "evaluation"
    assert _row(db, evaluation.id).start_time == datetime.time(11, 0)


def test_an_evaluation_of_an_evaluated_child_is_still_editable(
    api: TestClient, db: Session, family: Family
) -> None:
    """Rule 8 is skipped on an edit (answers.md, planner 3): the Evaluation already exists."""
    evaluation = _book_evaluation(db, family)
    _mark_evaluated(db, family.child, by=evaluation.staff)
    user = _make_user(db)

    response = _put(api, user, evaluation, family, start_time=ELEVEN, end_time=TWELVE)

    assert response.status_code == 200


def test_an_evaluation_with_a_tutor_as_staff_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    evaluation = _book_evaluation(db, family)
    user = _make_user(db)

    response = _put(api, user, evaluation, family, user_id=str(family.tutor.user_id))

    _assert_detail(response, 422, STAFF_ROLE_NOT_ALLOWED_ERROR)


def test_an_evaluation_given_a_subject_is_422(api: TestClient, db: Session, family: Family) -> None:
    evaluation = _book_evaluation(db, family)
    user = _make_user(db)

    response = _put(api, user, evaluation, family, subject_id=str(family.subject.id))

    _assert_detail(response, 422, BOOKING_SHAPE_INVALID_ERROR)


def test_a_body_naming_another_kind_is_422(api: TestClient, db: Session, family: Family) -> None:
    """`kind` may be omitted or equal; a booking never changes kind."""
    evaluation = _book_evaluation(db, family)
    user = _make_user(db)

    refused = _put(api, user, evaluation, family, kind="regular")
    restated = _put(api, user, evaluation, family, kind="evaluation")

    _assert_detail(refused, 422, BOOKING_KIND_IMMUTABLE_ERROR)
    assert restated.status_code == 200


# --- the warning contract (#151) ------------------------------------------------------------


def test_a_tutor_booking_moved_outside_its_slot_is_the_outside_slot_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _book(db, family)
    user = _make_user(db)

    refused = _put(api, user, booking, family, start_time=TWELVE, end_time=ONE_PM)
    confirmed = _put(
        api,
        user,
        booking,
        family,
        start_time=TWELVE,
        end_time=ONE_PM,
        confirm_warnings=[OUTSIDE_SLOT],
    )

    _assert_warnings(refused, [OUTSIDE_SLOT])
    assert confirmed.status_code == 200
    assert _row(db, booking.id).start_time == datetime.time(12, 0)


# --- correction mode: a session already started may be moved into the past -----------------


def test_a_past_booking_may_be_moved_to_another_past_time(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    """11:00 on the day: the 09:00 session has started, so the window and lead-time gates are
    skipped and 10:00 — also past — is accepted. Inside the slot, so no warning either."""
    booking = _book(db, family)
    freeze_business_clock(datetime.datetime.combine(MONDAY, datetime.time(11, 0)))
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)

    assert response.status_code == 200
    assert _row(db, booking.id).start_time == datetime.time(10, 0)


def test_a_future_booking_moved_into_the_past_is_400(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    """08:30 on the day: the 09:00 session is still ahead, so the lead-time gate holds."""
    booking = _book(db, family)
    freeze_business_clock(datetime.datetime.combine(MONDAY, datetime.time(8, 30)))
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=SEVEN, end_time=EIGHT)

    _assert_detail(response, 400, LEAD_TIME_NOT_MET_ERROR)
    assert _row(db, booking.id).start_time == datetime.time(9, 0)


def test_a_future_booking_moved_beyond_the_window_is_400(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _book(db, family)
    user = _make_user(db)
    far = MONDAY + datetime.timedelta(days=120)

    response = _put(api, user, booking, family, scheduled_date=far.isoformat())

    _assert_detail(response, 400, DATE_OUT_OF_WINDOW_ERROR)


# --- what an edit keeps: the booking guardian is neither accepted nor re-judged -------------


def test_a_booking_made_by_a_since_deactivated_guardian_can_still_be_edited(
    api: TestClient, db: Session, family: Family
) -> None:
    """The guardian is not editable here, so it is not re-validated: a Guardian the Office
    deactivated after the booking must not pin it in place with a 400 naming an id the body
    cannot carry."""
    booking = _book(db, family)
    booking.booked_by_guardian_id = family.guardian.id
    family.guardian.is_active = False
    db.flush()
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)

    assert response.status_code == 200
    row = _row(db, booking.id)
    assert row.booked_by_guardian_id == family.guardian.id
    assert row.start_time == datetime.time(10, 0)


# --- notes: omitted keeps, null clears, a string replaces ------------------------------------


def test_notes_are_replaced_by_an_edit(api: TestClient, db: Session, family: Family) -> None:
    booking = _book(db, family, notes="bring the workbook")
    user = _make_user(db)

    response = _put(api, user, booking, family, notes="skip chapter 3")

    assert response.status_code == 200
    assert response.json()["notes"] == "skip chapter 3"
    assert _row(db, booking.id).notes == "skip chapter 3"


def test_omitting_notes_keeps_them(api: TestClient, db: Session, family: Family) -> None:
    """A client that does not name notes has nothing to say about them."""
    booking = _book(db, family, notes="bring the workbook")
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)

    assert response.status_code == 200
    assert response.json()["notes"] == "bring the workbook"
    assert _row(db, booking.id).notes == "bring the workbook"


def test_null_notes_clears_them(api: TestClient, db: Session, family: Family) -> None:
    booking = _book(db, family, notes="bring the workbook")
    user = _make_user(db)

    response = _put(api, user, booking, family, notes=None)

    assert response.status_code == 200
    assert response.json()["notes"] is None
    assert _row(db, booking.id).notes is None


def test_notes_at_the_limit_are_accepted_on_an_edit(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _book(db, family)
    user = _make_user(db)

    response = _put(api, user, booking, family, notes="x" * NOTES_MAX_LENGTH)

    assert response.status_code == 200
    assert _row(db, booking.id).notes == "x" * NOTES_MAX_LENGTH


def test_notes_over_the_limit_are_400_and_change_nothing(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _book(db, family, notes="bring the workbook")
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=TEN, notes="x" * (NOTES_MAX_LENGTH + 1))

    assert response.status_code == 400
    assert "notes" in response.json()["detail"]
    row = _row(db, booking.id)
    assert row.notes == "bring the workbook"
    assert row.start_time == datetime.time(9, 0)


@pytest.mark.parametrize("field", ["child_id", "booked_by_guardian_id"])
def test_a_body_naming_a_field_an_edit_cannot_change_is_refused(
    api: TestClient, db: Session, family: Family, field: str
) -> None:
    """Refused rather than silently ignored, so a client that believes it changed the Child
    learns it did not."""
    booking = _book(db, family)
    user = _make_user(db)

    response = _put(api, user, booking, family, **{field: str(family.sibling.id)})

    assert response.status_code == 400
    assert field in response.json()["detail"]
    assert _row(db, booking.id).child_id == family.child.id


# --- which bookings, and who ----------------------------------------------------------------


@pytest.mark.parametrize("ended", ENDED_STATUSES)
def test_a_completed_or_cancelled_booking_is_409(
    api: TestClient, db: Session, family: Family, ended: BookingStatus
) -> None:
    booking = _book(db, family, status=ended)
    user = _make_user(db)

    response = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)

    _assert_detail(response, 409, BOOKING_NOT_LIVE_ERROR)
    assert _row(db, booking.id).start_time == datetime.time(9, 0)


def test_a_tutors_token_is_403(api: TestClient, db: Session, family: Family) -> None:
    booking = _book(db, family)
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)

    response = _put(api, tutor, booking, family, start_time=TEN, end_time=ELEVEN)

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)
    assert _row(db, booking.id).start_time == datetime.time(9, 0)


def test_an_unknown_id_is_404(api: TestClient, db: Session, family: Family) -> None:
    booking = _book(db, family)
    user = _make_user(db)

    response = api.put(
        f"/api/bookings/{uuid.uuid4()}", json=_payload(family, booking), headers=_auth(user)
    )

    _assert_detail(response, 404, BOOKING_NOT_FOUND_ERROR)


def test_no_message_is_sent_on_an_edit_of_either_kind(
    api: TestClient, db: Session, family: Family, fake_twilio: FakeTwilio
) -> None:
    booking = _book(db, family)
    evaluation = _book_evaluation(db, family, child_id=family.sibling.id)
    user = _make_user(db)

    regular = _put(api, user, booking, family, start_time=TEN, end_time=ELEVEN)
    moved = _put(api, user, evaluation, family, start_time=ELEVEN, end_time=TWELVE)

    assert regular.status_code == 200
    assert moved.status_code == 200
    assert fake_twilio.sent == []


# --- helpers --------------------------------------------------------------------------------


def _payload(family: Family, booking: Booking, **overrides: Any) -> dict[str, Any]:
    """The booking's own current values, so a test names only what it changes."""
    body: dict[str, Any] = {
        "user_id": str(booking.user_id),
        "location": booking.location.value,
        "subject_id": None if booking.subject_id is None else str(booking.subject_id),
        "availability_id": (
            None if booking.availability_id is None else str(booking.availability_id)
        ),
        "home_id": None if booking.home_id is None else str(booking.home_id),
        "scheduled_date": booking.scheduled_date.isoformat(),
        "start_time": booking.start_time.isoformat(),
        "end_time": booking.end_time.isoformat(),
    }
    body.update(overrides)

    return body


def _put(
    api: TestClient, user: User, booking: Booking, family: Family, **overrides: Any
) -> Response:
    return api.put(
        f"/api/bookings/{booking.id}",
        json=_payload(family, booking, **overrides),
        headers=_auth(user),
    )


def _book(
    db: Session,
    family: Family,
    *,
    start: datetime.time = datetime.time(9, 0),
    end: datetime.time = datetime.time(10, 0),
    status: BookingStatus = BookingStatus.CONFIRMED,
    user_id: uuid.UUID | None = None,
    availability_id: uuid.UUID | None = None,
    notes: str | None = None,
) -> Booking:
    """A Regular home booking on `MONDAY`, with the family's tutor and their slot unless a
    Staff member (and their slot, or none for an Admin) is named."""
    booking = Booking(
        child_id=family.child.id,
        user_id=family.tutor.user_id if user_id is None else user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=family.subject.id,
        availability_id=family.availability_id if user_id is None else availability_id,
        home_id=family.home.id,
        scheduled_date=MONDAY,
        start_time=start,
        end_time=end,
        status=status,
        notes=notes,
    )
    db.add(booking)
    db.flush()
    db.refresh(booking)

    return booking


def _book_evaluation(db: Session, family: Family, *, child_id: uuid.UUID | None = None) -> Booking:
    """A confirmed Evaluation at the child's home with a fresh Admin, 09:00-10:00 on `MONDAY`."""
    booking = Booking(
        child_id=family.child.id if child_id is None else child_id,
        user_id=_make_user(db, role=UserRole.ADMIN).id,
        kind=BookingKind.EVALUATION,
        location=BookingLocation.HOME,
        subject_id=None,
        availability_id=None,
        home_id=family.home.id,
        scheduled_date=MONDAY,
        start_time=datetime.time(9, 0),
        end_time=datetime.time(10, 0),
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()
    db.refresh(booking)

    return booking
