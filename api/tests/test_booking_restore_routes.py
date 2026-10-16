"""`PATCH /api/bookings/{id}` with `status: confirmed` on a Cancelled Booking — the restore.

Office only. A restore is judged as Change booking judges a future Booking (the row's own
values, itself excluded, the window gates on) plus Evaluation rules 8 and 9, which an edit
skips, under the same warning contract (#151).

The fixtures are `test_booking_write_routes`'s family: Bookings sit on `MONDAY`, one to seven
days out, so the window gates are met on any day the suite runs. "Already started" freezes the
clock instead, since that is the thing under test.
"""

import datetime
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    ExceptionStatus,
    UserRole,
)
from app.models.user import User
from app.routers.booking_status import (
    BOOKING_CHANGED_ERROR,
    ILLEGAL_TRANSITION_ERROR,
    OFFICE_ONLY_TRANSITION_ERROR,
    RESTORE_CHILD_ARCHIVED_ERROR,
    RESTORE_NOT_FUTURE_ERROR,
    RESTORE_STAFF_ARCHIVED_ERROR,
)
from app.routers.booking_writes import (
    BOOKING_OVERLAPS_ERROR,
    CHILD_ALREADY_EVALUATED_ERROR,
    CHILD_NOT_EVALUATED_ERROR,
    DATE_OUT_OF_WINDOW_ERROR,
    LIVE_EVALUATION_EXISTS_ERROR,
    REFERENCE_NOT_FOUND_ERROR,
)
from app.services import booking_write_service
from app.services.booking_status_service import IllegalTransition, change_status
from tests.test_booking_write_routes import (
    GAP,
    GRADE_CEILING,
    MONDAY,
    OUTSIDE_SLOT,
    TIME_OFF,
    TUTOR_CEILING,
    Family,
    _assert_detail,
    _assert_warnings,
    _auth,
    _clear_evaluated,
    _make_exception,
    _make_family,
    _make_user,
    _row,
    _set_level,
)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
EIGHT = datetime.time(8, 0)
# Far past any booking window the settings allow.
BEYOND_THE_WINDOW = MONDAY + datetime.timedelta(days=3650)


@pytest.fixture
def family(db: Session) -> Family:
    return _make_family(db)


# --- the happy path -------------------------------------------------------------------------


def test_restoring_a_future_cancelled_booking_with_a_free_slot_confirms_it(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _cancelled(db, family)

    response = _restore(api, _make_user(db), booking)
    body = response.json()

    assert response.status_code == 200
    assert body["id"] == str(booking.id)
    assert body["status"] == "confirmed"
    assert _row(db, booking.id).status is BookingStatus.CONFIRMED


def test_a_restored_booking_has_no_clash_acknowledgement(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _cancelled(db, family)
    booking.clash_acknowledged_by = admin.id
    booking.clash_acknowledged_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()

    response = _restore(api, admin, booking)

    assert response.status_code == 200
    row = _row(db, booking.id)
    assert row.clash_acknowledged_by is None
    assert row.clash_acknowledged_at is None


# --- refused before anything else -----------------------------------------------------------


@pytest.mark.parametrize("now_time", [NINE, datetime.time(9, 30), ELEVEN])
def test_a_started_or_past_cancelled_booking_is_409(
    api: TestClient,
    db: Session,
    family: Family,
    freeze_business_clock: Callable[[datetime.datetime], None],
    now_time: datetime.time,
) -> None:
    booking = _cancelled(db, family)
    freeze_business_clock(datetime.datetime.combine(MONDAY, now_time))

    response = _restore(api, _make_user(db), booking)

    _assert_detail(response, 409, RESTORE_NOT_FUTURE_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_a_booking_of_an_archived_child_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _cancelled(db, family)
    family.child.is_archived = True
    db.flush()

    response = _restore(api, _make_user(db), booking)

    _assert_detail(response, 409, RESTORE_CHILD_ARCHIVED_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_a_booking_of_an_archived_staff_member_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _cancelled(db, family)
    family.tutor.user.is_archived = True
    db.flush()

    response = _restore(api, _make_user(db), booking)

    _assert_detail(response, 409, RESTORE_STAFF_ARCHIVED_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_a_tutor_is_403(api: TestClient, db: Session, family: Family) -> None:
    booking = _cancelled(db, family)
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)

    response = _restore(api, tutor, booking)

    _assert_detail(response, 403, OFFICE_ONLY_TRANSITION_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_an_internal_caller_never_restores(db: Session, family: Family) -> None:
    booking = _cancelled(db, family)

    with pytest.raises(IllegalTransition):
        change_status(db, booking_id=booking.id, target=BookingStatus.CONFIRMED)


def test_a_stale_expected_updated_at_is_409(api: TestClient, db: Session, family: Family) -> None:
    booking = _cancelled(db, family)
    stale = booking.updated_at - datetime.timedelta(minutes=1)

    response = _restore(api, _make_user(db), booking, expected_updated_at=stale.isoformat())

    _assert_detail(response, 409, BOOKING_CHANGED_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_restoring_an_already_restored_booking_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _cancelled(db, family)
    user = _make_user(db)

    first = _restore(api, user, booking)
    second = _restore(api, user, booking)

    assert first.status_code == 200
    expected = ILLEGAL_TRANSITION_ERROR.format(current="confirmed", target="confirmed")
    _assert_detail(second, 409, expected)


# --- Change booking's checks on a future Booking ------------------------------------------


def test_a_slot_now_taken_is_409_overlap(api: TestClient, db: Session, family: Family) -> None:
    booking = _cancelled(db, family)
    _book(db, family, status=BookingStatus.CONFIRMED)

    response = _restore(api, _make_user(db), booking)

    _assert_detail(response, 409, BOOKING_OVERLAPS_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_the_constraint_refuses_a_restore_the_pre_checks_missed(
    api: TestClient, db: Session, family: Family, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`excl_bookings_live_overlap` standing in for a race the rules cannot see. The follow-up
    request proves the refusal stayed inside the savepoint and the `Session` is usable."""
    booking = _cancelled(db, family)
    _book(db, family, status=BookingStatus.CONFIRMED)
    other = _cancelled(db, family, start=ELEVEN, end=datetime.time(12, 0))
    user = _make_user(db)
    monkeypatch.setattr(booking_write_service, "_overlapping_booking", lambda *a, **k: False)
    monkeypatch.setattr(booking_write_service, "_gap_encroached", lambda *a, **k: False)

    refused = _restore(api, user, booking)
    follow_up = _restore(api, user, other)

    _assert_detail(refused, 409, BOOKING_OVERLAPS_ERROR)
    assert follow_up.status_code == 200
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_a_booking_beyond_the_window_is_400(api: TestClient, db: Session, family: Family) -> None:
    booking = _cancelled(db, family, on=BEYOND_THE_WINDOW)

    response = _restore(api, _make_user(db), booking)

    _assert_detail(response, 400, DATE_OUT_OF_WINDOW_ERROR)


def test_a_booking_at_an_archived_home_is_refused(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _cancelled(db, family)
    family.home.is_archived = True
    db.flush()

    response = _restore(api, _make_user(db), booking)

    _assert_detail(response, 400, REFERENCE_NOT_FOUND_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


def test_a_tutoring_booking_of_a_child_not_evaluated_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    booking = _cancelled(db, family)
    _clear_evaluated(db, family.child)

    response = _restore(api, _make_user(db), booking)

    _assert_detail(response, 422, CHILD_NOT_EVALUATED_ERROR)
    assert _row(db, booking.id).status is BookingStatus.CANCELLED


# --- Evaluation rules 8 and 9, which an edit skips ------------------------------------------


def test_an_evaluation_of_an_already_evaluated_child_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    evaluation = _cancelled_evaluation(db, family)

    response = _restore(api, _make_user(db), evaluation)

    _assert_detail(response, 422, CHILD_ALREADY_EVALUATED_ERROR)
    assert _row(db, evaluation.id).status is BookingStatus.CANCELLED


def test_an_evaluation_with_another_live_evaluation_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    _clear_evaluated(db, family.child)
    evaluation = _cancelled_evaluation(db, family)
    _evaluation(db, family, status=BookingStatus.CONFIRMED, start=ELEVEN, end=datetime.time(12, 0))

    response = _restore(api, _make_user(db), evaluation)

    _assert_detail(response, 409, LIVE_EVALUATION_EXISTS_ERROR)
    assert _row(db, evaluation.id).status is BookingStatus.CANCELLED


def test_an_evaluation_of_a_child_not_yet_evaluated_is_restored(
    api: TestClient, db: Session, family: Family
) -> None:
    _clear_evaluated(db, family.child)
    evaluation = _cancelled_evaluation(db, family)

    response = _restore(api, _make_user(db), evaluation)

    assert response.status_code == 200
    assert _row(db, evaluation.id).status is BookingStatus.CONFIRMED


# --- the warning contract (#151) ------------------------------------------------------------


def _time_off(db: Session, family: Family) -> Booking:
    _make_exception(db, family, status=ExceptionStatus.APPROVED)

    return _cancelled(db, family)


def _gap(db: Session, family: Family) -> Booking:
    # 10:00 abuts the 09:00-10:00 restored Booking: inside the travel gap, not overlapping.
    _book(db, family, status=BookingStatus.CONFIRMED, start=TEN, end=ELEVEN)

    return _cancelled(db, family)


def _outside_slot(db: Session, family: Family) -> Booking:
    # The family's slot is 09:00-12:00.
    return _cancelled(db, family, start=EIGHT, end=NINE)


def _grade_ceiling(db: Session, family: Family) -> Booking:
    _set_level(db, family, family.subject, level=TUTOR_CEILING + 1)

    return _cancelled(db, family)


@pytest.mark.parametrize(
    ("arrange", "code"),
    [
        (_time_off, TIME_OFF),
        (_gap, GAP),
        (_outside_slot, OUTSIDE_SLOT),
        (_grade_ceiling, GRADE_CEILING),
    ],
)
def test_a_warning_is_409_until_confirmed(
    api: TestClient,
    db: Session,
    family: Family,
    arrange: Callable[[Session, Family], Booking],
    code: str,
) -> None:
    booking = arrange(db, family)
    user = _make_user(db)

    refused = _restore(api, user, booking)
    still_cancelled = _row(db, booking.id).status
    confirmed = _restore(api, user, booking, confirm_warnings=[code])

    _assert_warnings(refused, [code])
    assert still_cancelled is BookingStatus.CANCELLED
    assert confirmed.status_code == 200
    assert _row(db, booking.id).status is BookingStatus.CONFIRMED


# --- helpers --------------------------------------------------------------------------------


def _restore(
    api: TestClient,
    user: User,
    booking: Booking,
    *,
    confirm_warnings: list[str] | None = None,
    expected_updated_at: str | None = None,
) -> Response:
    body: dict[str, object] = {"status": "confirmed"}
    if confirm_warnings is not None:
        body["confirm_warnings"] = confirm_warnings
    if expected_updated_at is not None:
        body["expected_updated_at"] = expected_updated_at

    return api.patch(f"/api/bookings/{booking.id}", json=body, headers=_auth(user))


def _book(
    db: Session,
    family: Family,
    *,
    status: BookingStatus,
    start: datetime.time = NINE,
    end: datetime.time = TEN,
    on: datetime.date = MONDAY,
) -> Booking:
    """A Regular home Booking with the family's tutor and slot."""
    booking = Booking(
        child_id=family.child.id,
        user_id=family.tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=family.subject.id,
        availability_id=family.availability_id,
        home_id=family.home.id,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()
    db.refresh(booking)

    return booking


def _cancelled(
    db: Session,
    family: Family,
    *,
    start: datetime.time = NINE,
    end: datetime.time = TEN,
    on: datetime.date = MONDAY,
) -> Booking:
    return _book(db, family, status=BookingStatus.CANCELLED, start=start, end=end, on=on)


def _evaluation(
    db: Session,
    family: Family,
    *,
    status: BookingStatus,
    start: datetime.time = NINE,
    end: datetime.time = TEN,
) -> Booking:
    """An Evaluation at the child's home with a fresh Admin."""
    booking = Booking(
        child_id=family.child.id,
        user_id=_make_user(db, role=UserRole.ADMIN).id,
        kind=BookingKind.EVALUATION,
        location=BookingLocation.HOME,
        subject_id=None,
        availability_id=None,
        home_id=family.home.id,
        scheduled_date=MONDAY,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()
    db.refresh(booking)

    return booking


def _cancelled_evaluation(db: Session, family: Family) -> Booking:
    return _evaluation(db, family, status=BookingStatus.CANCELLED)
