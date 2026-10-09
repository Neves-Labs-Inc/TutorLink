"""`POST /api/bookings` — the rules by kind and Staff role, the warning contract, the window
gates and the conflicts.

Every negative case asserts the exact status **and** the exact body — `{"detail": "..."}`, or
`{"detail": ..., "warnings": [...]}` for the warning contract — as in `test_exception_routes.py`:
`status_code != 201` would pass on a 500 or on a 404 from a route that never mounted, and the
three status classes here are the contract's most amended surface. The 422s are 422 on purpose
(`docs/api-design.md`, `POST /api/bookings`) and a test asserting merely "not 201" would let
someone quietly fold them into 400.

The first half keeps the Tutor/Manager Regular booking's rules, with rules 1, 3, 4 and 5 now
the `outside_slot`, `gap`, `time_off` and `grade_ceiling` warnings the Office can confirm
(#151); the second half is the Evaluation, the Admin and In office (#130, #132, #133).

Two of these tests carry more weight than the rest:

- `test_a_tutor_with_no_assignment_for_the_subject_is_refused` — rule 5 written as a join turns
  the strongest possible violation into a success (#36).
- `test_the_constraint_refuses_a_duplicate_the_pre_checks_missed` — the only test that reaches
  `excl_bookings_live_overlap`, and the only one that would catch an insert assigned outside
  its savepoint, whose symptom is a correct-looking 409 followed by an unusable `Session`.

Dates are computed from today rather than fixed, because `booking_lookahead_days` and
`min_booking_lead_hours` are enforced against the wall clock: a hard-coded date passes until it
drifts out of the window and then fails for a reason that has nothing to do with the code.
"""

import datetime
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import OFFICE_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.enums import BookingKind, BookingLocation, BookingStatus, ExceptionStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.routers.booking_writes import (
    BOOKING_OVERLAPS_ERROR,
    DATE_OUT_OF_WINDOW_ERROR,
    GUARDIAN_NOT_LINKED_ERROR,
    HOME_NOT_LINKED_ERROR,
    LEAD_TIME_NOT_MET_ERROR,
    BOOKING_SHAPE_INVALID_ERROR,
    CHILD_ALREADY_EVALUATED_ERROR,
    LIVE_EVALUATION_EXISTS_ERROR,
    OUTSIDE_AVAILABILITY_ERROR,
    REFERENCE_NOT_FOUND_ERROR,
    STAFF_ROLE_NOT_ALLOWED_ERROR,
    UNCONFIRMED_WARNINGS_ERROR,
    WARNING_MESSAGES,
)
from app.security import create_access_token, hash_password
from app.services import booking_write_service, clock
from app.services.booking_write_service import WarningCode
from app.services.scheduling_service import MIN_BOOKING_LEAD_SETTING
from tests.fake_twilio import FakeTwilio

OUTSIDE_SLOT = WarningCode.OUTSIDE_SLOT.value
GAP = WarningCode.GAP.value
TIME_OFF = WarningCode.TIME_OFF.value
GRADE_CEILING = WarningCode.GRADE_CEILING.value

STAFF_ROLE_CASES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER]

CHILD_GRADE = 7
TUTOR_CEILING = 8


def _today() -> datetime.date:
    """The business clock the route reads, unfrozen; under the default `UTC` zone this is the
    UTC date, since every scheduling column is naive business wall-clock."""
    return clock.business_today()


def _upcoming(weekday: int) -> datetime.date:
    """The next date with that weekday, always between one and seven days out.

    `weekday()` is 0 = Monday … 6 = Sunday, the encoding `tutor_availability.day_of_week` uses.
    """
    today = _today()

    return today + datetime.timedelta(days=(weekday - today.weekday()) % 7 or 7)


MONDAY = _upcoming(0)
TUESDAY = MONDAY + datetime.timedelta(days=1)
SUNDAY = _upcoming(6)
# The date `business_evening` freezes, a Monday like `MONDAY`; UTC is already on the 29th.
BUSINESS_TODAY = datetime.date(2026, 9, 28)

NINE = "09:00:00"
TEN = "10:00:00"
TEN_TWENTY_NINE = "10:29:00"
TEN_THIRTY = "10:30:00"
ELEVEN = "11:00:00"
ELEVEN_TWENTY_NINE = "11:29:00"
ELEVEN_THIRTY = "11:30:00"
TWELVE = "12:00:00"


@dataclass(frozen=True, slots=True)
class Family:
    tutor: Tutor
    other_tutor: Tutor
    subject: Subject
    other_subject: Subject
    child: Child
    sibling: Child
    guardian: Guardian
    co_guardian: Guardian
    stranger_guardian: Guardian
    home: Home
    other_home: Home
    stranger_home: Home
    availability_id: uuid.UUID
    inactive_availability_id: uuid.UUID
    sunday_availability_id: uuid.UUID
    other_tutor_availability_id: uuid.UUID
    assignment: TutorSubject


@pytest.fixture
def family(db: Session) -> Family:
    return _make_family(db)


# --- the happy path and RBAC ----------------------------------------------------------------


@pytest.mark.parametrize("role", STAFF_ROLE_CASES)
def test_an_admin_creates_a_confirmed_booking(
    api: TestClient, db: Session, family: Family, role: UserRole
) -> None:
    user = _make_user(db, role=role)

    response = _post(
        api,
        user,
        family,
        booked_by_guardian_id=str(family.guardian.id),
        notes="ring the side door",
    )
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "confirmed"
    assert body["scheduled_date"] == MONDAY.isoformat()
    assert body["start_time"] == NINE
    assert body["end_time"] == TEN

    row = _row(db, uuid.UUID(body["id"]))
    assert row.status is BookingStatus.CONFIRMED
    assert row.home_id == family.home.id
    assert row.booked_by_guardian_id == family.guardian.id
    assert row.availability_id == family.availability_id
    assert row.notes == "ring the side door"


def test_a_tutor_token_is_403_and_writes_nothing(
    api: TestClient, db: Session, family: Family
) -> None:
    """Admin-only (`api-design.md:278`), and `AdminPrincipal` rather than `TutorScope`: an
    unread scope would arm the guard and 500 every query this route makes."""
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)

    response = _post(api, user, family)

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)
    assert _count(db) == 0


def test_no_token_is_401_and_writes_nothing(api: TestClient, db: Session, family: Family) -> None:
    response = api.post("/api/bookings", json=_payload(family))

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _count(db) == 0


# --- rule 1: the named availability range — 400 for the wrong range, a warning for the time --


@pytest.mark.parametrize(
    ("start_time", "end_time"),
    [("08:00:00", NINE), (ELEVEN_THIRTY, "12:30:00"), ("08:30:00", "12:30:00")],
)
def test_a_range_outside_the_named_availability_is_the_outside_slot_warning(
    api: TestClient, db: Session, family: Family, start_time: str, end_time: str
) -> None:
    """The slot stays required and must be this Staff member's; only the time falling outside
    it is confirmable (#151)."""
    user = _make_user(db)

    response = _post(api, user, family, start_time=start_time, end_time=end_time)

    _assert_warnings(response, [OUTSIDE_SLOT])
    assert _count(db) == 0


def test_an_availability_id_belonging_to_another_tutor_is_400(
    api: TestClient, db: Session, family: Family
) -> None:
    """The row is real, active, the right weekday and contains the time — it is simply not this
    tutor's. Accepting `availability_id` as an unchecked column would let a caller point at
    another tutor's slot (OQ-4)."""
    user = _make_user(db)

    response = _post(api, user, family, availability_id=str(family.other_tutor_availability_id))

    _assert_detail(response, 400, OUTSIDE_AVAILABILITY_ERROR)
    assert _count(db) == 0


def test_an_inactive_availability_range_is_400(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)

    response = _post(
        api,
        user,
        family,
        availability_id=str(family.inactive_availability_id),
        start_time="14:00:00",
        end_time="15:00:00",
    )

    _assert_detail(response, 400, OUTSIDE_AVAILABILITY_ERROR)
    assert _count(db) == 0


def test_the_right_times_on_the_wrong_weekday_is_the_outside_slot_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)

    response = _post(api, user, family, scheduled_date=TUESDAY.isoformat())

    _assert_warnings(response, [OUTSIDE_SLOT])
    assert _count(db) == 0


def test_a_manager_without_a_profile_cannot_take_a_regular_booking(
    api: TestClient, db: Session, family: Family
) -> None:
    """A migrated Manager has no teaching profile, so no range can be theirs: rule 1's hard
    half refuses whichever range is named (spec 01, "Existing Managers")."""
    user = _make_user(db, role=UserRole.MANAGER)

    response = _post(api, user, family, user_id=str(user.id))

    _assert_detail(response, 400, OUTSIDE_AVAILABILITY_ERROR)
    assert _count(db) == 0


def test_a_sunday_booking_is_accepted(api: TestClient, db: Session, family: Family) -> None:
    """`weekday()` is 0 = Monday, so Sunday is 6. Under `isoweekday()` or PostgreSQL's
    `EXTRACT(DOW)` this row would be a Saturday or a Monday and the booking would be refused."""
    user = _make_user(db)

    response = _post(
        api,
        user,
        family,
        scheduled_date=SUNDAY.isoformat(),
        availability_id=str(family.sunday_availability_id),
    )

    assert response.status_code == 201
    assert _row(db, uuid.UUID(response.json()["id"])).scheduled_date == SUNDAY


def test_a_booking_on_the_leftover_the_grid_strands_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """REQ-044.23. At 60/30 the grid over 09:00-12:00 emits 09:00-10:00 and 10:30-11:30 and
    strands 11:30-12:00; an admin may book it, because the grid is an offer mechanism and not
    an API constraint."""
    user = _make_user(db)

    response = _post(api, user, family, start_time=ELEVEN_THIRTY, end_time=TWELVE)

    assert response.status_code == 201


# --- rule 2: an overlapping live booking, 409 -----------------------------------------------


@pytest.mark.parametrize("live", [BookingStatus.PENDING, BookingStatus.CONFIRMED])
def test_an_overlapping_live_booking_is_409(
    api: TestClient, db: Session, family: Family, live: BookingStatus
) -> None:
    _book(db, family, start=datetime.time(9, 30), end=datetime.time(10, 30), status=live)
    user = _make_user(db)

    response = _post(api, user, family)

    _assert_detail(response, 409, BOOKING_OVERLAPS_ERROR)
    assert _count(db) == 1


def test_a_cancelled_booking_frees_its_range(api: TestClient, db: Session, family: Family) -> None:
    """The exclusion constraint's `WHERE` covers only pending and confirmed, and
    `LIVE_BOOKING_STATUSES` is what rules 2 and 3 read — so both layers agree that a cancelled
    booking counts for nothing."""
    _book(db, family, status=BookingStatus.CANCELLED)
    user = _make_user(db)

    response = _post(api, user, family)

    assert response.status_code == 201


# --- rule 3: the gap, the `gap` warning ------------------------------------------------------


def test_a_booking_abutting_another_is_the_gap_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    """It overlaps nothing, so this is rule 3 and not rule 2 — overlap is a hard 409 whatever is
    confirmed; the gap is a warning the Office may confirm."""
    _book(db, family)
    user = _make_user(db)

    response = _post(api, user, family, start_time=TEN, end_time=ELEVEN)

    _assert_warnings(response, [GAP])
    assert _count(db) == 1


def test_clearance_of_exactly_one_gap_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """Both inequalities in `overlaps_within_gap` are strict, and this is the case that pins it:
    a `<=` in either would refuse every second slot the grid offers, which is #44 item 1."""
    _book(db, family)
    user = _make_user(db)

    response = _post(api, user, family, start_time=TEN_THIRTY, end_time=ELEVEN_THIRTY)

    assert response.status_code == 201


def test_one_minute_short_of_the_gap_is_the_gap_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    _book(db, family)
    user = _make_user(db)

    response = _post(api, user, family, start_time=TEN_TWENTY_NINE, end_time=ELEVEN_TWENTY_NINE)

    _assert_warnings(response, [GAP])
    assert _count(db) == 1


# --- rule 4: approved exceptions, the `time_off` warning --------------------------------------


def test_an_approved_whole_day_exception_is_the_time_off_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    _make_exception(db, family, status=ExceptionStatus.APPROVED)
    user = _make_user(db)

    response = _post(api, user, family)

    _assert_warnings(response, [TIME_OFF])
    assert _count(db) == 0


@pytest.mark.parametrize("inert", [ExceptionStatus.PENDING, ExceptionStatus.REJECTED])
def test_an_undecided_or_rejected_exception_blocks_nothing(
    api: TestClient, db: Session, family: Family, inert: ExceptionStatus
) -> None:
    """A tutor's own request lands `pending` and must not remove their availability before an
    admin rules on it; a rejected one never removes it at all."""
    _make_exception(db, family, status=inert)
    user = _make_user(db)

    response = _post(api, user, family)

    assert response.status_code == 201


def test_a_partial_day_exception_elsewhere_in_the_day_blocks_nothing(
    api: TestClient, db: Session, family: Family
) -> None:
    _make_exception(
        db,
        family,
        status=ExceptionStatus.APPROVED,
        start_time=datetime.time(11, 0),
        end_time=datetime.time(12, 0),
    )
    user = _make_user(db)

    response = _post(api, user, family)

    assert response.status_code == 201


def test_a_partial_day_exception_overlapping_the_booking_is_the_time_off_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    """Bare overlap, not gap-expanded: an exception ending at 09:00 would leave 09:00-10:00
    bookable, which is what step 2 of the slot query also does."""
    _make_exception(
        db,
        family,
        status=ExceptionStatus.APPROVED,
        start_time=datetime.time(9, 30),
        end_time=datetime.time(10, 30),
    )
    user = _make_user(db)

    response = _post(api, user, family)

    _assert_warnings(response, [TIME_OFF])
    assert _count(db) == 0


# --- rule 5: the per-subject ceiling against the Child's Subject level, the `grade_ceiling`
# warning ------------------------------------------------------------------------------------


def test_a_ceiling_below_the_childs_subject_level_is_the_grade_ceiling_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    _set_level(db, family, family.subject, level=6)
    family.assignment.max_grade_level = 5
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family)

    _assert_warnings(response, [GRADE_CEILING])
    assert _count(db) == 0


def test_a_ceiling_equal_to_the_childs_subject_level_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    _set_level(db, family, family.subject, level=5)
    family.assignment.max_grade_level = 5
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family)

    assert response.status_code == 201


def test_the_overall_grade_is_never_compared_against_the_ceiling(
    api: TestClient, db: Session, family: Family
) -> None:
    """Overall grade 7, Math level 5, ceiling 5: the level decides, so the booking lands."""
    _set_level(db, family, family.subject, level=5)
    family.child.grade_level = 7
    family.assignment.max_grade_level = 5
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family)

    assert response.status_code == 201


def test_a_child_with_no_level_for_the_subject_skips_the_ceiling(
    api: TestClient, db: Session, family: Family
) -> None:
    """Staff book the Evaluation session before any level exists, whatever the Overall grade."""
    family.child.grade_level = 12
    family.assignment.max_grade_level = 5
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family)

    assert response.status_code == 201


def test_a_level_in_another_subject_is_not_compared(
    api: TestClient, db: Session, family: Family
) -> None:
    _set_level(db, family, family.other_subject, level=12)
    family.assignment.max_grade_level = 5
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family)

    assert response.status_code == 201


def test_a_tutor_with_no_assignment_for_the_subject_is_refused(
    api: TestClient, db: Session, family: Family
) -> None:
    """The trap of the requirement (#36). Written as a join, "this tutor does not teach the
    subject at all" drops the row, reads as nothing to refuse, and returns 201."""
    db.delete(family.assignment)
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family)

    _assert_warnings(response, [GRADE_CEILING])
    assert _count(db) == 0


def test_a_tutor_qualified_in_a_different_subject_is_refused_for_this_one(
    api: TestClient, db: Session, family: Family
) -> None:
    """The ceiling is per subject and there is no tutor-wide grade to fall back on."""
    user = _make_user(db)

    response = _post(api, user, family, subject_id=str(family.other_subject.id))

    _assert_warnings(response, [GRADE_CEILING])
    assert _count(db) == 0


def test_a_child_with_a_level_is_still_refused_a_tutor_who_does_not_teach_the_subject(
    api: TestClient, db: Session, family: Family
) -> None:
    """A level never stands in for the assignment check (#36)."""
    _set_level(db, family, family.subject, level=1)
    db.delete(family.assignment)
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family)

    _assert_warnings(response, [GRADE_CEILING])
    assert _count(db) == 0


# --- rules 6 and 7: the home and the booking guardian, 422 ----------------------------------


def test_a_home_belonging_to_another_family_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)

    response = _post(api, user, family, home_id=str(family.stranger_home.id))

    _assert_detail(response, 422, HOME_NOT_LINKED_ERROR)
    assert _count(db) == 0


def test_a_guardian_booking_into_the_co_parents_home_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """Rules 6 and 7 are independent, and this is why. The home is checked against the child,
    never against the booking guardian — a rule phrased "the home must belong to the booking
    guardian" refuses exactly the case #37 and #38 exist to enable."""
    user = _make_user(db)

    response = _post(
        api,
        user,
        family,
        home_id=str(family.other_home.id),
        booked_by_guardian_id=str(family.guardian.id),
    )

    assert response.status_code == 201
    assert _row(db, uuid.UUID(response.json()["id"])).home_id == family.other_home.id


def test_two_siblings_at_the_shared_home_are_both_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """Each passes rule 6 on its own `child_homes` row."""
    user = _make_user(db)

    first = _post(api, user, family, booked_by_guardian_id=str(family.guardian.id))
    second = _post(
        api,
        user,
        family,
        child_id=str(family.sibling.id),
        booked_by_guardian_id=str(family.guardian.id),
        start_time=TEN_THIRTY,
        end_time=ELEVEN_THIRTY,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert _count(db) == 2


def test_a_guardian_not_linked_to_the_child_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    """The `child_guardians` link is the only thing separating the co-parent case above from a
    stranger booking for someone else's child."""
    user = _make_user(db)

    response = _post(api, user, family, booked_by_guardian_id=str(family.stranger_guardian.id))

    _assert_detail(response, 422, GUARDIAN_NOT_LINKED_ERROR)
    assert _count(db) == 0


def test_a_null_booking_guardian_is_the_admin_path(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)

    response = _post(api, user, family, booked_by_guardian_id=None)

    assert response.status_code == 201
    assert _row(db, uuid.UUID(response.json()["id"])).booked_by_guardian_id is None


# --- REQ-045: the conflict, both layers -----------------------------------------------------


def test_an_ordinary_duplicate_is_409(api: TestClient, db: Session, family: Family) -> None:
    user = _make_user(db)

    assert _post(api, user, family).status_code == 201
    _assert_detail(_post(api, user, family), 409, BOOKING_OVERLAPS_ERROR)
    assert _count(db) == 1


def test_the_constraint_refuses_a_duplicate_the_pre_checks_missed(
    api: TestClient, db: Session, family: Family, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The only test that reaches `excl_bookings_live_overlap`, standing in for the race a
    read-then-write check cannot see.

    Both pre-checks are stubbed, not just rule 2's: rule 3 reads the same rows and would refuse
    the duplicate first, with the gap message, leaving the constraint unreachable.

    The last assertion is the one that matters. An insert assigned outside its savepoint
    produces this same 409 and leaves the `Session` unusable, so the next request 500s — which
    is the defect this repository has shipped three times, and "the next request succeeds" is
    the only assertion that catches it.
    """
    user = _make_user(db)
    assert _post(api, user, family).status_code == 201

    monkeypatch.setattr(booking_write_service, "_overlapping_booking", lambda *a, **k: False)
    monkeypatch.setattr(booking_write_service, "_gap_encroached", lambda *a, **k: False)

    _assert_detail(_post(api, user, family), 409, BOOKING_OVERLAPS_ERROR)

    follow_up = _post(api, user, family, start_time=TEN_THIRTY, end_time=ELEVEN_THIRTY)

    assert follow_up.status_code == 201
    assert _count(db) == 2


# --- REQ-044.22: the booking window -------------------------------------------------------


@pytest.mark.parametrize("days", [-1, 120])
def test_a_date_outside_the_booking_window_is_400(
    api: TestClient, db: Session, family: Family, days: int
) -> None:
    """The window gates run ahead of the rules, so neither of these depends on the weekday of
    the date they name."""
    user = _make_user(db)
    date = _today() + datetime.timedelta(days=days)

    response = _post(api, user, family, scheduled_date=date.isoformat())

    _assert_detail(response, 400, DATE_OUT_OF_WINDOW_ERROR)
    assert _count(db) == 0


def test_the_business_date_is_inside_the_window_even_once_utc_is_on_the_next_day(
    api: TestClient, db: Session, family: Family, business_evening: datetime.datetime
) -> None:
    """Past the window gate, so the refusal is the lead time: 09:00 has already gone by 22:00."""
    user = _make_user(db)

    response = _post(api, user, family, scheduled_date=BUSINESS_TODAY.isoformat())

    _assert_detail(response, 400, LEAD_TIME_NOT_MET_ERROR)


def test_the_day_before_the_business_date_is_out_of_the_window(
    api: TestClient, db: Session, family: Family, business_evening: datetime.datetime
) -> None:
    user = _make_user(db)
    yesterday = BUSINESS_TODAY - datetime.timedelta(days=1)

    response = _post(api, user, family, scheduled_date=yesterday.isoformat())

    _assert_detail(response, 400, DATE_OUT_OF_WINDOW_ERROR)


def test_a_start_inside_the_minimum_lead_time_is_400(
    api: TestClient,
    db: Session,
    family: Family,
    set_int_setting: Callable[[str, int], None],
) -> None:
    """Read at request time: the setting is edited through this test's own session and the
    request under test sees it, which is what proves nothing memoized it at import."""
    set_int_setting(MIN_BOOKING_LEAD_SETTING, 24 * 30)
    user = _make_user(db)

    response = _post(api, user, family)

    _assert_detail(response, 400, LEAD_TIME_NOT_MET_ERROR)
    assert _count(db) == 0


# --- REQ-044.24 and the request shape -------------------------------------------------------


@pytest.mark.parametrize(
    "field",
    [
        "child_id",
        "user_id",
        "subject_id",
        "availability_id",
        "home_id",
        "booked_by_guardian_id",
    ],
)
def test_an_id_that_names_no_row_is_400(
    api: TestClient, db: Session, family: Family, field: str
) -> None:
    """Ahead of rule 1, so a mistyped id never comes back as a confusing rule failure about a
    row the caller never named."""
    user = _make_user(db)

    response = _post(api, user, family, **{field: str(uuid.uuid4())})

    _assert_detail(response, 400, REFERENCE_NOT_FOUND_ERROR)
    assert _count(db) == 0


@pytest.mark.parametrize("reference", ["tutor", "subject", "home", "guardian", "child"])
def test_a_reference_an_admin_has_retired_is_400(
    api: TestClient, db: Session, family: Family, reference: str
) -> None:
    """A soft delete keeps the row, so an existence check alone confirms a session against a
    tutor `GET /api/slots/available` stopped offering the moment `DELETE /api/tutors/{id}` ran —
    the write path more permissive than the offer path, #44 item 1 in reverse.

    400 and not 422: the 422s refuse a *combination* of two individually valid rows, and a
    retired row is a property of one reference — the class rule 1 already answers with a 400
    for an inactive availability range.

    `child` is a case from migration 0016 on (P7C-1, REQ-114): an inactive child is refused with
    the same `detail` as a missing one.
    """
    _retire(getattr(family, reference))
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family, booked_by_guardian_id=str(family.guardian.id))

    _assert_detail(response, 400, REFERENCE_NOT_FOUND_ERROR)
    assert _count(db) == 0


def test_a_reactivated_child_can_be_booked_again(
    api: TestClient, db: Session, family: Family
) -> None:
    """Reactivation goes through `PATCH /api/children/{id}`, the path an admin actually takes
    (P7C-P), rather than flipping the column behind the service's back."""
    family.child.is_active = False
    db.flush()
    user = _make_user(db)
    refused = _post(api, user, family)

    reactivated = api.patch(
        f"/api/children/{family.child.id}", json={"is_active": True}, headers=_auth(user)
    )
    accepted = _post(api, user, family)

    _assert_detail(refused, 400, REFERENCE_NOT_FOUND_ERROR)
    assert reactivated.status_code == 200
    assert reactivated.json()["is_active"] is True
    assert accepted.status_code == 201
    assert _count(db) == 1


def test_a_booking_naming_only_active_references_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    """The retirement check reads the five ids the request names and no others — retiring every
    unnamed tutor, subject, home, client and child in the fixture leaves this booking untouched."""
    for name in ("other_tutor", "other_subject", "stranger_home", "stranger_guardian", "sibling"):
        _retire(getattr(family, name))
    db.flush()
    user = _make_user(db)

    response = _post(api, user, family, booked_by_guardian_id=str(family.guardian.id))

    assert response.status_code == 201
    assert _row(db, uuid.UUID(response.json()["id"])).booked_by_guardian_id == family.guardian.id


@pytest.mark.parametrize(("start_time", "end_time"), [(TEN, TEN), (TEN, NINE)])
def test_an_end_time_at_or_before_the_start_is_400(
    api: TestClient, db: Session, family: Family, start_time: str, end_time: str
) -> None:
    """Never a 500: unvalidated, an inverted range fails `tsrange` construction itself with a
    `DataError`, which the conflict handler is not watching for."""
    user = _make_user(db)

    response = _post(api, user, family, start_time=start_time, end_time=end_time)

    assert response.status_code == 400
    assert "end_time" in response.json()["detail"]
    assert _count(db) == 0


def test_a_body_without_home_id_is_refused(api: TestClient, db: Session, family: Family) -> None:
    """`home_id` is absent from the documented example body and required by the prose rules,
    which are the contract (amendment P4-1). It is optional in the schema since #130 (an office
    session has none), so the refusal is the service's: a home Location names a home."""
    user = _make_user(db)
    body = _payload(family)
    del body["home_id"]

    response = api.post("/api/bookings", json=body, headers=_auth(user))

    _assert_detail(response, 422, BOOKING_SHAPE_INVALID_ERROR)
    assert _count(db) == 0


# --- the Evaluation: an Admin's or a Manager's, no Subject, no slot (#130, #133) -------------


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.MANAGER])
@pytest.mark.parametrize("location", ["home", "in_office"])
def test_an_evaluation_with_an_admin_or_manager_lands_confirmed(
    api: TestClient, db: Session, family: Family, role: UserRole, location: str
) -> None:
    staff = _make_user(db, role=role)
    user = _make_user(db)

    response = _post_evaluation(api, user, family, staff, location=location)
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "confirmed"
    row = _row(db, uuid.UUID(body["id"]))
    assert row.kind is BookingKind.EVALUATION
    assert row.location.value == location
    assert row.user_id == staff.id
    assert row.subject_id is None
    assert row.availability_id is None
    assert row.home_id == (family.home.id if location == "home" else None)


def test_an_evaluation_with_a_tutor_is_422(api: TestClient, db: Session, family: Family) -> None:
    user = _make_user(db)

    response = _post_evaluation(api, user, family, family.tutor.user)

    _assert_detail(response, 422, STAFF_ROLE_NOT_ALLOWED_ERROR)
    assert _count(db) == 0


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param(lambda f: {"subject_id": str(f.subject.id)}, id="subject"),
        pytest.param(lambda f: {"availability_id": str(f.availability_id)}, id="slot"),
        pytest.param(
            lambda f: {"location": "in_office", "home_id": str(f.home.id)}, id="home_in_office"
        ),
        pytest.param(lambda f: {"home_id": None}, id="no_home_at_home"),
    ],
)
def test_an_evaluation_of_the_wrong_shape_is_422(
    api: TestClient, db: Session, family: Family, overrides: Callable[[Family], dict[str, Any]]
) -> None:
    """Refused before any read, for what it is: a Subject on an Evaluation is a shape error
    even when the Subject exists."""
    staff = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    response = _post_evaluation(api, user, family, staff, **overrides(family))

    _assert_detail(response, 422, BOOKING_SHAPE_INVALID_ERROR)
    assert _count(db) == 0


def test_an_evaluation_for_an_evaluated_child_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    staff = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)
    _mark_evaluated(db, family.child, by=staff)

    response = _post_evaluation(api, user, family, staff)

    _assert_detail(response, 422, CHILD_ALREADY_EVALUATED_ERROR)
    assert _count(db) == 0


def test_a_second_live_evaluation_for_the_child_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    """Another Staff member at another time, so only rule 9 can refuse it."""
    first, second = _make_user(db, role=UserRole.ADMIN), _make_user(db, role=UserRole.MANAGER)
    user = _make_user(db)
    assert _post_evaluation(api, user, family, first).status_code == 201

    response = _post_evaluation(api, user, family, second, start_time=ELEVEN, end_time=TWELVE)

    _assert_detail(response, 409, LIVE_EVALUATION_EXISTS_ERROR)
    assert _count(db) == 1


@pytest.mark.parametrize("ended", [BookingStatus.COMPLETED, BookingStatus.CANCELLED])
def test_a_completed_or_cancelled_evaluation_does_not_count(
    api: TestClient, db: Session, family: Family, ended: BookingStatus
) -> None:
    staff = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)
    earlier = _row(db, uuid.UUID(_post_evaluation(api, user, family, staff).json()["id"]))
    earlier.status = ended
    db.flush()

    response = _post_evaluation(api, user, family, staff, start_time=ELEVEN, end_time=TWELVE)

    assert response.status_code == 201
    assert _count(db) == 2


def test_the_index_refuses_a_second_live_evaluation_the_pre_check_missed(
    api: TestClient, db: Session, family: Family, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`uq_bookings_one_live_evaluation_per_child` standing in for two creates racing on a
    Child read only `FOR SHARE` (#133). Told apart from the overlap EXCLUDE by SQLSTATE, so the
    second Evaluation is with another Staff member at another time, where only the index can
    fire. The follow-up proves the `Session` survived the savepoint rollback."""
    first, second = _make_user(db, role=UserRole.ADMIN), _make_user(db, role=UserRole.MANAGER)
    user = _make_user(db)
    assert _post_evaluation(api, user, family, first).status_code == 201
    monkeypatch.setitem(
        booking_write_service._HARD_RULES,
        BookingKind.EVALUATION,
        tuple(
            rule
            for rule in booking_write_service._HARD_RULES[BookingKind.EVALUATION]
            if rule is not booking_write_service._rule_9_no_live_evaluation
        ),
    )

    refused = _post_evaluation(api, user, family, second, start_time=ELEVEN, end_time=TWELVE)
    follow_up = _post_evaluation(
        api,
        user,
        family,
        second,
        child_id=str(family.sibling.id),
        start_time=ELEVEN,
        end_time=TWELVE,
    )

    _assert_detail(refused, 409, LIVE_EVALUATION_EXISTS_ERROR)
    assert follow_up.status_code == 201
    assert _count(db) == 2


def test_an_evaluation_overlapping_the_staff_members_booking_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    """Rule 2 is every kind's and every role's: a Manager's teaching session and their
    Evaluation cannot share a minute."""
    manager = _make_user(db, role=UserRole.MANAGER, tutor_id=family.tutor.id)
    _book(db, family)
    user = _make_user(db)

    response = _post_evaluation(
        api, user, family, manager, start_time="09:30:00", end_time=TEN_THIRTY
    )

    _assert_detail(response, 409, BOOKING_OVERLAPS_ERROR)
    assert _count(db) == 1


def test_an_evaluation_at_a_home_not_the_childs_is_422(
    api: TestClient, db: Session, family: Family
) -> None:
    staff = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    response = _post_evaluation(api, user, family, staff, home_id=str(family.stranger_home.id))

    _assert_detail(response, 422, HOME_NOT_LINKED_ERROR)
    assert _count(db) == 0


@pytest.mark.parametrize("days", [-1, 120])
def test_an_evaluation_outside_the_booking_window_is_400(
    api: TestClient, db: Session, family: Family, days: int
) -> None:
    """The window is a hard block for every kind (answers.md 01.9)."""
    staff = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)
    date = _today() + datetime.timedelta(days=days)

    response = _post_evaluation(api, user, family, staff, scheduled_date=date.isoformat())

    _assert_detail(response, 400, DATE_OUT_OF_WINDOW_ERROR)
    assert _count(db) == 0


def test_an_evaluation_inside_the_minimum_lead_time_is_400(
    api: TestClient,
    db: Session,
    family: Family,
    set_int_setting: Callable[[str, int], None],
) -> None:
    set_int_setting(MIN_BOOKING_LEAD_SETTING, 24 * 30)
    staff = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    response = _post_evaluation(api, user, family, staff)

    _assert_detail(response, 400, LEAD_TIME_NOT_MET_ERROR)
    assert _count(db) == 0


# --- a Regular booking with an Admin: overlap only (#130) ------------------------------------


def test_a_regular_booking_with_an_admin_lands_with_no_slot(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    response = _post(api, user, family, user_id=str(admin.id), availability_id=None)

    assert response.status_code == 201
    row = _row(db, uuid.UUID(response.json()["id"]))
    assert row.kind is BookingKind.REGULAR
    assert row.user_id == admin.id
    assert row.availability_id is None


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param(lambda f: {"subject_id": None, "availability_id": None}, id="no_subject"),
        pytest.param(lambda f: {"availability_id": str(f.availability_id)}, id="slot"),
    ],
)
def test_a_regular_booking_with_an_admin_of_the_wrong_shape_is_422(
    api: TestClient, db: Session, family: Family, overrides: Callable[[Family], dict[str, Any]]
) -> None:
    """An Admin has no profile to offer a range, so naming one is a shape error, not a slot
    that happens not to be theirs."""
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    response = _post(api, user, family, user_id=str(admin.id), **overrides(family))

    _assert_detail(response, 422, BOOKING_SHAPE_INVALID_ERROR)
    assert _count(db) == 0


def test_a_regular_booking_overlapping_the_admins_evaluation_is_409(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)
    assert _post_evaluation(api, user, family, admin).status_code == 201

    response = _post(
        api,
        user,
        family,
        user_id=str(admin.id),
        availability_id=None,
        child_id=str(family.sibling.id),
        start_time="09:30:00",
        end_time=TEN_THIRTY,
    )

    _assert_detail(response, 409, BOOKING_OVERLAPS_ERROR)
    assert _count(db) == 1


def test_a_regular_booking_adjacent_to_the_admins_evaluation_needs_no_gap(
    api: TestClient, db: Session, family: Family
) -> None:
    """No gap, no time off, no ceiling: an Admin is checked for overlap and the Location only."""
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)
    assert _post_evaluation(api, user, family, admin).status_code == 201

    response = _post(
        api,
        user,
        family,
        user_id=str(admin.id),
        availability_id=None,
        child_id=str(family.sibling.id),
        start_time=TEN,
        end_time=ELEVEN,
    )

    assert response.status_code == 201
    assert _count(db) == 2


def test_an_admins_approved_time_off_does_not_block_a_regular_booking(
    api: TestClient, db: Session, family: Family
) -> None:
    """A Tutor promoted to Admin keeps their profile and its time off (spec 01); as an Admin
    neither is consulted."""
    _make_exception(db, family, status=ExceptionStatus.APPROVED)
    promoted = _make_user(db, role=UserRole.ADMIN, tutor_id=family.tutor.id)
    user = _make_user(db)

    response = _post(api, user, family, user_id=str(promoted.id), availability_id=None)

    assert response.status_code == 201


# --- a Manager with a profile is a Tutor for a Regular booking (#130) ------------------------


def test_a_manager_with_a_profile_is_checked_like_a_tutor(
    api: TestClient, db: Session, family: Family
) -> None:
    _make_user(db, role=UserRole.MANAGER, tutor_id=family.tutor.id)
    _book(db, family)
    user = _make_user(db)

    warned = _post(api, user, family, start_time=TEN, end_time=ELEVEN)
    accepted = _post(api, user, family, start_time=TEN_THIRTY, end_time=ELEVEN_THIRTY)

    _assert_warnings(warned, [GAP])
    assert accepted.status_code == 201
    assert _row(db, uuid.UUID(accepted.json()["id"])).availability_id == family.availability_id


# --- who is bookable as Staff, and the Location shape (#130) ---------------------------------


def test_a_developer_as_staff_is_400(api: TestClient, db: Session, family: Family) -> None:
    """Not bookable (answers.md 01.6): refused like an unknown id, not as a role against a
    kind, since no kind takes a Developer."""
    developer = _make_user(db, role=UserRole.DEVELOPER)
    user = _make_user(db)

    response = _post(api, user, family, user_id=str(developer.id), availability_id=None)

    _assert_detail(response, 400, REFERENCE_NOT_FOUND_ERROR)
    assert _count(db) == 0


def test_an_inactive_admin_as_staff_is_400(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    admin.is_active = False
    db.flush()
    user = _make_user(db)

    response = _post_evaluation(api, user, family, admin)

    _assert_detail(response, 400, REFERENCE_NOT_FOUND_ERROR)
    assert _count(db) == 0


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"location": "in_office"}, id="home_in_office"),
        pytest.param({"location": "home", "home_id": None}, id="no_home_at_home"),
    ],
)
def test_a_home_against_the_location_is_422(
    api: TestClient, db: Session, family: Family, overrides: dict[str, Any]
) -> None:
    user = _make_user(db)

    response = _post(api, user, family, **overrides)

    _assert_detail(response, 422, BOOKING_SHAPE_INVALID_ERROR)
    assert _count(db) == 0


# --- In office: no travel gap between two office sessions (#132) ----------------------------


def test_two_in_office_bookings_back_to_back_are_both_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)

    first = _post(api, user, family, location="in_office", home_id=None)
    second = _post(
        api,
        user,
        family,
        location="in_office",
        home_id=None,
        child_id=str(family.sibling.id),
        start_time=TEN,
        end_time=ELEVEN,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    row = _row(db, uuid.UUID(second.json()["id"]))
    assert row.location is BookingLocation.IN_OFFICE
    assert row.home_id is None


def test_an_in_office_booking_inside_the_gap_of_a_home_booking_is_the_gap_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    """The gap is travel: a home visit on either side needs the full `session_gap_minutes`."""
    _book(db, family)
    user = _make_user(db)

    response = _post(
        api, user, family, location="in_office", home_id=None, start_time=TEN, end_time=ELEVEN
    )

    _assert_warnings(response, [GAP])
    assert _count(db) == 1


def test_an_in_office_booking_inside_the_gap_of_an_admins_home_booking_is_accepted(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)
    assert _post_evaluation(api, user, family, admin).status_code == 201

    response = _post(
        api,
        user,
        family,
        user_id=str(admin.id),
        availability_id=None,
        location="in_office",
        home_id=None,
        child_id=str(family.sibling.id),
        start_time=TEN,
        end_time=ELEVEN,
    )

    assert response.status_code == 201


def test_a_home_booking_inside_the_gap_of_an_in_office_booking_is_the_gap_warning(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)
    assert _post(api, user, family, location="in_office", home_id=None).status_code == 201

    response = _post(
        api, user, family, child_id=str(family.sibling.id), start_time=TEN, end_time=ELEVEN
    )

    _assert_warnings(response, [GAP])
    assert _count(db) == 1


# --- the warning contract (#151) ------------------------------------------------------------


def _warn_three_ways(db: Session, family: Family) -> dict[str, Any]:
    """A booking that is outside its range, inside another's gap and under approved time off:
    08:00-09:00 against a 09:00-12:00 range, a 09:00 booking and a whole-day exception."""
    _book(db, family)
    _make_exception(db, family, status=ExceptionStatus.APPROVED)

    return {"start_time": "08:00:00", "end_time": NINE}


def test_every_failing_warning_is_reported_at_once(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)
    overrides = _warn_three_ways(db, family)

    response = _post(api, user, family, **overrides)

    _assert_warnings(response, [OUTSIDE_SLOT, GAP, TIME_OFF])
    assert _count(db) == 1


def test_confirming_every_warning_lands_the_booking(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db)
    overrides = _warn_three_ways(db, family)

    response = _post(api, user, family, confirm_warnings=[OUTSIDE_SLOT, GAP, TIME_OFF], **overrides)

    assert response.status_code == 201
    assert _count(db) == 2


def test_confirming_some_warnings_refuses_again_listing_the_rest(
    api: TestClient, db: Session, family: Family
) -> None:
    """A warning the client did not confirm — a new one, or one it left out — refuses again
    with a fresh `warnings[]` naming exactly what is still unconfirmed."""
    user = _make_user(db)
    overrides = _warn_three_ways(db, family)

    response = _post(api, user, family, confirm_warnings=[OUTSIDE_SLOT, GAP], **overrides)

    _assert_warnings(response, [TIME_OFF])
    assert _count(db) == 1


def test_a_hard_block_refuses_whatever_is_confirmed(
    api: TestClient, db: Session, family: Family
) -> None:
    """Overlap is never a warning: confirmed codes do not reach it, and the body has no
    `warnings[]`."""
    _book(db, family)
    user = _make_user(db)

    response = _post(
        api, user, family, confirm_warnings=[OUTSIDE_SLOT, GAP, TIME_OFF, GRADE_CEILING]
    )

    _assert_detail(response, 409, BOOKING_OVERLAPS_ERROR)
    assert _count(db) == 1


def test_an_unknown_warning_code_is_400(api: TestClient, db: Session, family: Family) -> None:
    user = _make_user(db)

    response = _post(api, user, family, confirm_warnings=["overlap"])

    assert response.status_code == 400
    assert "confirm_warnings" in response.json()["detail"]
    assert _count(db) == 0


# --- no WhatsApp on a dashboard create (map decision) ---------------------------------------


def test_no_message_is_sent_on_a_dashboard_create_of_either_kind(
    api: TestClient, db: Session, family: Family, fake_twilio: FakeTwilio
) -> None:
    admin = _make_user(db, role=UserRole.ADMIN)
    user = _make_user(db)

    regular = _post(api, user, family, booked_by_guardian_id=str(family.guardian.id))
    evaluation = _post_evaluation(
        api,
        user,
        family,
        admin,
        child_id=str(family.sibling.id),
        start_time=ELEVEN,
        end_time=TWELVE,
    )

    assert regular.status_code == 201
    assert evaluation.status_code == 201
    assert fake_twilio.sent == []


# --- helpers --------------------------------------------------------------------------------


def _payload(family: Family, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "child_id": str(family.child.id),
        "user_id": str(family.tutor.user_id),
        "kind": "regular",
        "location": "home",
        "subject_id": str(family.subject.id),
        "availability_id": str(family.availability_id),
        "home_id": str(family.home.id),
        "scheduled_date": MONDAY.isoformat(),
        "start_time": NINE,
        "end_time": TEN,
        "booked_by_guardian_id": None,
        "notes": None,
    }
    body.update(overrides)

    return body


def _post(api: TestClient, user: User, family: Family, **overrides: Any) -> Response:
    return api.post("/api/bookings", json=_payload(family, **overrides), headers=_auth(user))


def _post_evaluation(
    api: TestClient, user: User, family: Family, staff: User, **overrides: Any
) -> Response:
    """An Evaluation at the child's home with `staff`: no Subject, no slot."""
    body = _payload(
        family, user_id=str(staff.id), kind="evaluation", subject_id=None, availability_id=None
    )
    body.update(overrides)
    if body["location"] == "in_office" and "home_id" not in overrides:
        body["home_id"] = None

    return api.post("/api/bookings", json=body, headers=_auth(user))


def _mark_evaluated(db: Session, child: Child, *, by: User) -> None:
    child.evaluated_at = datetime.datetime.now(tz=datetime.UTC)
    child.evaluated_by_user_id = by.id
    db.flush()


def _make_family(db: Session) -> Family:
    guardian = _make_guardian(db)
    co_guardian = _make_guardian(db)
    home = _make_home(db, guardian)
    other_home = _make_home(db, co_guardian)
    child = _make_child(db, guardians=[guardian, co_guardian], homes=[home, other_home])
    sibling = _make_child(db, guardians=[guardian], homes=[home])
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    assignment = TutorSubject(
        tutor_id=tutor.id, subject_id=subject.id, max_grade_level=TUTOR_CEILING
    )
    db.add(assignment)
    db.flush()
    other_tutor = _make_tutor(db)

    return Family(
        tutor=tutor,
        other_tutor=other_tutor,
        subject=subject,
        other_subject=_make_subject(db),
        child=child,
        sibling=sibling,
        guardian=guardian,
        co_guardian=co_guardian,
        stranger_guardian=_make_guardian(db),
        home=home,
        other_home=other_home,
        stranger_home=_make_home(db, _make_guardian(db)),
        availability_id=_make_availability(db, tutor.id, day=MONDAY.weekday()),
        inactive_availability_id=_make_availability(
            db,
            tutor.id,
            day=MONDAY.weekday(),
            start=datetime.time(14, 0),
            end=datetime.time(16, 0),
            is_active=False,
        ),
        sunday_availability_id=_make_availability(db, tutor.id, day=SUNDAY.weekday()),
        other_tutor_availability_id=_make_availability(db, other_tutor.id, day=MONDAY.weekday()),
        assignment=assignment,
    )


def _set_level(db: Session, family: Family, subject: Subject, *, level: int) -> None:
    db.add(
        ChildSubjectLevel(
            child_id=family.child.id,
            subject_id=subject.id,
            level=level,
            set_by_user_id=_make_user(db).id,
        )
    )
    db.flush()


def _make_guardian(db: Session) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(name=f"Guardian {suffix}", phone_number=f"+1{suffix[:10]}")
    db.add(guardian)
    db.flush()

    return guardian


def _make_home(db: Session, guardian: Guardian) -> Home:
    home = Home(label="Home", address=f"{uuid.uuid4().hex[:6]} Main St", access_code="1234")
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=guardian.id, home_id=home.id))
    db.flush()

    return home


def _make_child(db: Session, *, guardians: list[Guardian], homes: list[Home]) -> Child:
    child = Child(
        name=f"Child {uuid.uuid4().hex[:8]}",
        grade_level=CHILD_GRADE,
        school_name="Test School",
    )
    db.add(child)
    db.flush()
    db.add_all([ChildGuardian(child_id=child.id, guardian_id=one.id) for one in guardians])
    db.add_all([ChildHome(child_id=child.id, home_id=one.id) for one in homes])
    db.flush()

    return child


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()

    return tutor


def _make_subject(db: Session) -> Subject:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:8]}")
    db.add(subject)
    db.flush()

    return subject


def _make_availability(
    db: Session,
    tutor_id: uuid.UUID,
    *,
    day: int,
    start: datetime.time = datetime.time(9, 0),
    end: datetime.time = datetime.time(12, 0),
    is_active: bool = True,
) -> uuid.UUID:
    availability = TutorAvailability(
        tutor_id=tutor_id,
        day_of_week=day,
        start_time=start,
        end_time=end,
        is_active=is_active,
    )
    db.add(availability)
    db.flush()

    return availability.id


def _make_exception(
    db: Session,
    family: Family,
    *,
    status: ExceptionStatus,
    start_time: datetime.time | None = None,
    end_time: datetime.time | None = None,
) -> TutorAvailabilityException:
    row = TutorAvailabilityException(
        tutor_id=family.tutor.id,
        start_date=MONDAY,
        end_date=MONDAY,
        start_time=start_time,
        end_time=end_time,
        reason="vacation",
        status=status,
    )
    db.add(row)
    db.flush()

    return row


def _book(
    db: Session,
    family: Family,
    *,
    start: datetime.time = datetime.time(9, 0),
    end: datetime.time = datetime.time(10, 0),
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> Booking:
    booking = Booking(
        child_id=family.child.id,
        user_id=family.tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=family.subject.id,
        availability_id=family.availability_id,
        home_id=family.home.id,
        scheduled_date=MONDAY,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password("booking-write-password"),
            role=role,
            is_active=True,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("booking-write-password")
        user.role = role
        user.is_active = True
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _row(db: Session, booking_id: uuid.UUID) -> Booking:
    db.expire_all()

    return db.execute(select(Booking).where(Booking.id == booking_id)).scalar_one()


def _retire(row: object) -> None:
    """Soft-delete a reference. A Tutor is retired through their user: `tutors.is_active` decides
    nothing (#130)."""
    target = row.user if isinstance(row, Tutor) else row
    target.is_active = False  # type: ignore[attr-defined]


def _count(db: Session) -> int:
    db.expire_all()

    return db.execute(select(func.count()).select_from(Booking)).scalar_one()


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)


def _assert_warnings(response: Response, codes: list[str]) -> None:
    """The warning contract's 409: `detail` plus `warnings[]` with exactly these codes, in rule
    order, each carrying the same message its hard refusal would."""
    assert response.status_code == 409
    assert response.json() == {
        "detail": UNCONFIRMED_WARNINGS_ERROR,
        "warnings": [
            {"code": code, "message": WARNING_MESSAGES[WarningCode(code)]} for code in codes
        ],
    }
