"""`GET /api/slots/available` — the three-step availability check, over HTTP.

Every failure this endpoint can have is silent: a wrong inequality deletes every second slot,
a bare overlap in step 3 offers a slot `POST /api/bookings` then refuses with a 409, an
`isoweekday()` shifts the whole week by one day, and a `total` computed after the cap makes
"showing 5 of 8" impossible. None of those raise anything. The tests below are named for the
mistake each one catches rather than for the branch it covers.

Three of them are load-bearing beyond their own assertion:

- `test_an_off_grid_booking_drops_every_slot_it_overlaps` is #44 item 1. A suite built only
  from bookings that land on the grid passes with bare overlap in place.
- `test_a_sunday_query_reads_the_sunday_rows_and_not_the_monday_ones` is OB-10. The 0=Monday
  convention is invisible on every weekday except the two ends of the week.
- `test_a_tutor_with_no_assignment_for_the_subject_is_never_offered` is #36 at the offer
  surface, where a missing `tutor_subjects` row has to be a refusal rather than a pass.

Every negative case asserts the status **and** the exact `{"detail": "<string>"}` body, as in
`test_exception_routes.py`: `status_code != 200` would pass on a 500, and a 500 is precisely
what a `TutorScope` on this admin-only route would produce.
"""

import datetime
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, ExceptionStatus, UserRole
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.routers.booking_writes import REFERENCE_NOT_FOUND_ERROR
from app.routers.slots import DATE_OUT_OF_WINDOW_ERROR
from app.security import create_access_token, hash_password
from app.services import clock
from app.services.scheduling_service import (
    MAX_SLOTS_OFFERED_SETTING,
    MIN_BOOKING_LEAD_SETTING,
    SESSION_LENGTH_SETTING,
)

type SetIntSetting = Callable[[str, int], None]

ADMIN_ROLE_CASES = [UserRole.ADMIN, UserRole.DEVELOPER]

NINE = datetime.time(9, 0)
NINE_THIRTY = datetime.time(9, 30)
TEN = datetime.time(10, 0)
TEN_FIFTEEN = datetime.time(10, 15)
TEN_THIRTY = datetime.time(10, 30)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)
TWELVE_THIRTY = datetime.time(12, 30)
THIRTEEN = datetime.time(13, 0)
FOURTEEN = datetime.time(14, 0)
SEVENTEEN = datetime.time(17, 0)
TWENTY_ONE = datetime.time(21, 0)

# The worked example from `docs/api-design.md:1004-1006`: a 09:00-12:00 range at length 60 and
# gap 30 strides by 90, so 11:30-12:00 is leftover and is never offered.
DEFAULT_GRID = [("09:00:00", "10:00:00"), ("10:30:00", "11:30:00")]
SHORTER_GRID = [("09:00:00", "09:45:00"), ("10:15:00", "11:00:00")]


@dataclass(frozen=True, slots=True)
class SlotWorld:
    """One qualified tutor with one 09:00-12:00 range, and the rows a booking needs."""

    tutor_id: uuid.UUID
    tutor_name: str
    subject_id: uuid.UUID
    availability_id: uuid.UUID
    child_id: uuid.UUID
    home_id: uuid.UUID
    date: datetime.date


def _today() -> datetime.date:
    """The business clock the route reads, unfrozen; under the default `UTC` zone this is the
    UTC date, since every scheduling column is naive business wall-clock."""
    return clock.business_today()


def _upcoming(weekday: int) -> datetime.date:
    """The next `weekday` at least a week out — inside the 90-day window, never today.

    Derived rather than hardcoded: a literal date drifts out of `booking_lookahead_days` and
    turns every test in this module into a 400 some months after it was written.
    """
    today = _today()

    return today + datetime.timedelta(days=(weekday - today.weekday()) % 7 + 7)


DATE = _upcoming(2)
# The date `business_evening` freezes; UTC is already on the 29th.
BUSINESS_TODAY = datetime.date(2026, 9, 28)
SUNDAY = _upcoming(6)
MONDAY = _upcoming(0)


@pytest.fixture
def admin(db: Session) -> User:
    return _make_user(db, role=UserRole.ADMIN)


@pytest.fixture
def world(db: Session) -> SlotWorld:
    return _make_world(db, date=DATE)


# --- step 1: the grid ------------------------------------------------------------------------


def test_the_grid_strides_by_length_plus_gap_and_leaves_the_remainder_unoffered(
    api: TestClient, world: SlotWorld, admin: User
) -> None:
    response = api.get(_url(world), headers=_bearer(admin))

    assert response.status_code == 200
    assert _windows(response) == DEFAULT_GRID
    assert ("11:30:00", "12:00:00") not in _windows(response)


def test_an_offered_slot_carries_the_six_documented_fields(
    api: TestClient, world: SlotWorld, admin: User
) -> None:
    body = api.get(_url(world), headers=_bearer(admin)).json()

    assert body["items"][0] == {
        "tutor_id": str(world.tutor_id),
        "tutor_name": world.tutor_name,
        "availability_id": str(world.availability_id),
        "date": DATE.isoformat(),
        "start_time": "09:00:00",
        "end_time": "10:00:00",
    }


def test_shortening_the_session_re_cuts_the_grid_on_the_very_next_request(
    api: TestClient,
    world: SlotWorld,
    admin: User,
    set_int_setting: SetIntSetting,
) -> None:
    """OB-11, inside one test on purpose. A grid cut from a value read at import would be
    identical before and after, and no amount of separate test runs would show it."""
    url = _url(world)
    before = _windows(api.get(url, headers=_bearer(admin)))

    set_int_setting(SESSION_LENGTH_SETTING, 45)
    after = _windows(api.get(url, headers=_bearer(admin)))

    assert before == DEFAULT_GRID
    assert after == SHORTER_GRID


def test_a_deactivated_availability_row_is_never_offered(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """#44 item 3. Deactivating a range is a soft delete, so the row is still there to be
    offered by a query that forgot to filter it — and rule 1 of `POST /api/bookings` then
    refuses the booking it produced."""
    db.get_one(TutorAvailability, world.availability_id).is_active = False
    db.flush()

    response = api.get(_url(world), headers=_bearer(admin))

    assert response.status_code == 200
    assert _windows(response) == []


def test_a_sunday_query_reads_the_sunday_rows_and_not_the_monday_ones(
    api: TestClient, db: Session, admin: User
) -> None:
    """OB-10. `day_of_week` is 0 = Monday … 6 = Sunday, from `date.weekday()`. `isoweekday()`
    would look for 7 and find nothing; PostgreSQL's `EXTRACT(DOW)` would look for 0 and find
    the Monday range below."""
    world = _make_world(db, date=SUNDAY)
    _make_availability(db, world.tutor_id, date=MONDAY, start=FOURTEEN, end=SEVENTEEN)

    response = api.get(_url(world), headers=_bearer(admin))

    assert _windows(response) == DEFAULT_GRID


# --- step 2: approved exceptions, by bare overlap ---------------------------------------------


@pytest.mark.parametrize(
    ("exception_status", "expected"),
    [
        (ExceptionStatus.APPROVED, [("10:30:00", "11:30:00")]),
        (ExceptionStatus.PENDING, DEFAULT_GRID),
        (ExceptionStatus.REJECTED, DEFAULT_GRID),
    ],
)
def test_only_an_approved_exception_subtracts_from_availability(
    api: TestClient,
    db: Session,
    world: SlotWorld,
    admin: User,
    exception_status: ExceptionStatus,
    expected: list[tuple[str, str]],
) -> None:
    """#24: a pending request is a tutor asking for time off and blocks nothing until an admin
    rules on it; a rejected one blocks nothing ever.

    The window ends at 10:15, which is what makes this a bare-overlap assertion as well: the
    10:30 slot clears it by 15 minutes, so a step 2 that gap-expanded by `session_gap_minutes`
    the way step 3 does would wrongly drop it too.
    """
    _make_exception(
        db,
        tutor_id=world.tutor_id,
        start_date=DATE,
        end_date=DATE,
        start_time=NINE,
        end_time=TEN_FIFTEEN,
        status=exception_status,
    )

    response = api.get(_url(world), headers=_bearer(admin))

    assert _windows(response) == expected


def test_a_whole_day_exception_blocks_the_middle_of_its_range(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """A NULL time pair blocks the whole day, and the date comparison is inclusive at both
    ends, so a range covers the days between its bounds and not only the bounds."""
    _make_exception(
        db,
        tutor_id=world.tutor_id,
        start_date=DATE - datetime.timedelta(days=1),
        end_date=DATE + datetime.timedelta(days=1),
        status=ExceptionStatus.APPROVED,
    )

    response = api.get(_url(world), headers=_bearer(admin))

    assert response.status_code == 200
    assert _windows(response) == []


# --- step 3: live bookings, by gap-expanded overlap -------------------------------------------


def test_a_booking_filling_the_first_grid_slot_leaves_the_second_offered(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """The strict-inequality boundary. The stride is length + gap, so consecutive grid slots
    are exactly one gap apart; a `<=` in either comparison would delete every second slot."""
    _make_booking(db, world, start=NINE, end=TEN)

    response = api.get(_url(world), headers=_bearer(admin))

    assert _windows(response) == [("10:30:00", "11:30:00")]


def test_an_off_grid_booking_drops_every_slot_it_overlaps(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """#44 item 1, and the single most important test in this module.

    An admin may book 10:00-11:00 directly; it lands on no grid boundary. Bare overlap keeps
    09:00-10:00 — the two merely abut — and the bot then offers a slot rule 3 of
    `POST /api/bookings` refuses with a 409, because 09:00-10:00 is not
    `session_gap_minutes` clear of it. The 13:00 range is here so the expected answer is a
    targeted subtraction rather than an empty page that any blanket failure would also produce.
    """
    _make_availability(db, world.tutor_id, date=DATE, start=THIRTEEN, end=FOURTEEN)
    _make_booking(db, world, start=TEN, end=ELEVEN)

    windows = _windows(api.get(_url(world), headers=_bearer(admin)))

    assert ("09:00:00", "10:00:00") not in windows
    assert windows == [("13:00:00", "14:00:00")]


def test_an_off_grid_booking_drops_both_slots_it_straddles(
    api: TestClient,
    db: Session,
    world: SlotWorld,
    admin: User,
    set_int_setting: SetIntSetting,
) -> None:
    """The #19 equality-matching regression. At length 45 the grid is 09:00-09:45 and
    10:15-11:00, and a 09:30-10:30 booking starts at neither; a step 3 that compared start
    times would find nothing to remove and offer both, double-booking the tutor."""
    set_int_setting(SESSION_LENGTH_SETTING, 45)
    _make_availability(db, world.tutor_id, date=DATE, start=THIRTEEN, end=FOURTEEN)
    _make_booking(db, world, start=NINE_THIRTY, end=TEN_THIRTY)

    windows = _windows(api.get(_url(world), headers=_bearer(admin)))

    assert ("09:00:00", "09:45:00") not in windows
    assert ("10:15:00", "11:00:00") not in windows
    assert windows == [("13:00:00", "13:45:00")]


@pytest.mark.parametrize("booking_status", [BookingStatus.CANCELLED, BookingStatus.COMPLETED])
def test_a_booking_that_is_no_longer_live_frees_its_slot(
    api: TestClient,
    db: Session,
    world: SlotWorld,
    admin: User,
    booking_status: BookingStatus,
) -> None:
    _make_booking(db, world, start=NINE, end=TEN, status=booking_status)

    response = api.get(_url(world), headers=_bearer(admin))

    assert _windows(response) == DEFAULT_GRID


def test_another_tutors_booking_does_not_subtract_from_this_tutors_grid(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    other = _make_world(db, date=DATE, subject_id=world.subject_id)
    _make_booking(db, other, start=NINE, end=TEN)

    response = api.get(_url(world, tutor_id=world.tutor_id), headers=_bearer(admin))

    assert _windows(response) == DEFAULT_GRID


# --- the tutor set: subject and grade ceiling --------------------------------------------------


@pytest.mark.parametrize(
    ("grade_level", "expected"),
    [(3, DEFAULT_GRID), (8, DEFAULT_GRID), (9, [])],
)
def test_the_grade_ceiling_is_a_comparison_and_not_a_membership_test(
    api: TestClient,
    world: SlotWorld,
    admin: User,
    grade_level: int,
    expected: list[tuple[str, str]],
) -> None:
    """#36: `max_grade_level` is a ceiling, so 8 covers every grade at or below it and refuses
    the one above."""
    response = api.get(_url(world, grade_level=grade_level), headers=_bearer(admin))

    assert _windows(response) == expected


def test_omitting_grade_level_offers_a_tutor_whatever_their_ceiling(
    api: TestClient, db: Session, admin: User
) -> None:
    """A child with no grade yet is offered every active tutor who teaches the subject: the
    lowest possible ceiling refuses grade 2, but without a grade there is nothing to compare."""
    world = _make_world(db, date=DATE, max_grade_level=1)

    graded = api.get(_url(world, grade_level=2), headers=_bearer(admin))
    ungraded = api.get(_url(world, grade_level=None), headers=_bearer(admin))

    assert _windows(graded) == []
    assert ungraded.status_code == 200
    assert _windows(ungraded) == DEFAULT_GRID


def test_omitting_grade_level_still_never_offers_a_tutor_who_does_not_teach_the_subject(
    api: TestClient, db: Session, admin: User
) -> None:
    world = _make_world(db, date=DATE)
    unassigned = _make_subject(db)

    response = api.get(
        _url(world, subject_id=unassigned.id, grade_level=None), headers=_bearer(admin)
    )

    assert response.status_code == 200
    assert _windows(response) == []


def test_a_tutor_with_no_assignment_for_the_subject_is_never_offered(
    api: TestClient, db: Session, admin: User
) -> None:
    """#36's strongest violation, at the offer surface: a tutor who does not teach the subject
    at all. There is no ceiling to compare against, so the tutor is not in the set — "no row"
    must never read as "nothing to refuse"."""
    world = _make_world(db, date=DATE)
    unassigned = _make_subject(db)

    response = api.get(_url(world, subject_id=unassigned.id), headers=_bearer(admin))

    assert response.status_code == 200
    assert _windows(response) == []


def test_a_tutor_is_not_offered_for_the_subject_whose_ceiling_is_lower(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """The ceiling is per subject: grade 12 maths and grade 5 French is one tutor, and the
    French ceiling must not be widened by the maths one."""
    lower = _make_subject(db)
    _assign(db, tutor_id=world.tutor_id, subject_id=lower.id, max_grade_level=5)

    assert _windows(api.get(_url(world, grade_level=8), headers=_bearer(admin))) == DEFAULT_GRID
    assert (
        _windows(api.get(_url(world, subject_id=lower.id, grade_level=8), headers=_bearer(admin)))
        == []
    )


def test_a_retired_subject_is_never_offered(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """#44 item 1 in its original direction: a soft-deleted `subject` must yield no qualified
    tutors here, the same empty `Page` a subject nobody is assigned to already yields, rather
    than a booking `POST /api/bookings` now refuses with a 400."""
    db.get_one(Subject, world.subject_id).is_active = False
    db.flush()

    response = api.get(_url(world), headers=_bearer(admin))

    assert response.status_code == 200
    assert _windows(response) == []


def test_a_deactivated_tutor_is_never_offered(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    db.get_one(Tutor, world.tutor_id).is_active = False
    db.flush()

    response = api.get(_url(world), headers=_bearer(admin))

    assert _windows(response) == []


# --- ordering, filtering and the cap ----------------------------------------------------------


def test_omitting_tutor_id_interleaves_several_tutors_by_start_time(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    other = _make_world(db, date=DATE, subject_id=world.subject_id, start=TEN, end=THIRTEEN)

    body = api.get(_url(world), headers=_bearer(admin)).json()

    assert [(item["start_time"], item["tutor_id"]) for item in body["items"]] == [
        ("09:00:00", str(world.tutor_id)),
        ("10:00:00", str(other.tutor_id)),
        ("10:30:00", str(world.tutor_id)),
        ("11:30:00", str(other.tutor_id)),
    ]


def test_tutor_id_narrows_the_answer_to_one_tutor(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    _make_world(db, date=DATE, subject_id=world.subject_id, start=TEN, end=THIRTEEN)

    body = api.get(_url(world, tutor_id=world.tutor_id), headers=_bearer(admin)).json()

    assert {item["tutor_id"] for item in body["items"]} == {str(world.tutor_id)}
    assert body["total"] == 2


def test_two_tutors_offering_the_same_time_come_back_in_a_stable_order(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """REQ-042.12. Ordering by `start_time` alone leaves a tie the database is free to break
    either way, so the same query could answer differently twice."""
    other = _make_world(db, date=DATE, subject_id=world.subject_id)
    by_tutor = sorted([str(world.tutor_id), str(other.tutor_id)])

    body = api.get(_url(world), headers=_bearer(admin)).json()

    assert [(item["start_time"], item["tutor_id"]) for item in body["items"]] == [
        ("09:00:00", by_tutor[0]),
        ("09:00:00", by_tutor[1]),
        ("10:30:00", by_tutor[0]),
        ("10:30:00", by_tutor[1]),
    ]


def test_the_cap_slices_the_page_while_total_counts_every_match(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """REQ-043.1 and REQ-043.2. `total` is computed before the cap, which is the only way the
    bot can say "showing 5 of 8"; `len(items)` would make it always at most the cap."""
    _make_availability(db, world.tutor_id, date=DATE, start=TWELVE_THIRTY, end=TWENTY_ONE)

    body = api.get(_url(world), headers=_bearer(admin)).json()

    assert body["total"] == 8
    assert len(body["items"]) == 5
    assert body["page"] == 1
    assert body["page_size"] == 5
    assert [item["start_time"] for item in body["items"]] == [
        "09:00:00",
        "10:30:00",
        "12:30:00",
        "14:00:00",
        "15:30:00",
    ]


def test_lowering_the_cap_narrows_the_page_without_moving_total(
    api: TestClient,
    db: Session,
    world: SlotWorld,
    admin: User,
    set_int_setting: SetIntSetting,
) -> None:
    """REQ-043.4: the cap is a `system_settings` row read at request time, not the literal 5."""
    _make_availability(db, world.tutor_id, date=DATE, start=TWELVE_THIRTY, end=TWENTY_ONE)
    set_int_setting(MAX_SLOTS_OFFERED_SETTING, 2)

    body = api.get(_url(world), headers=_bearer(admin)).json()

    assert len(body["items"]) == 2
    assert body["total"] == 8
    assert body["page_size"] == 2


def test_an_empty_result_is_a_page_envelope_and_never_a_404(
    api: TestClient, db: Session, admin: User
) -> None:
    subject = _make_subject(db)

    response = api.get(_url(None, subject_id=subject.id, date=DATE), headers=_bearer(admin))

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 5}


def test_an_empty_result_reports_the_applied_cap_and_not_zero(
    api: TestClient, db: Session, admin: User, set_int_setting: SetIntSetting
) -> None:
    """`page_size` is the cap the search applied, not `len(items)` — the two agree whenever
    items is non-empty, so only an empty page with a non-default cap tells them apart."""
    subject = _make_subject(db)
    set_int_setting(MAX_SLOTS_OFFERED_SETTING, 2)

    response = api.get(_url(None, subject_id=subject.id, date=DATE), headers=_bearer(admin))

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 2}


# --- the offer surface agrees with the write surface ------------------------------------------


def test_a_retired_subject_offered_by_neither_surface(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """The divergence #44 item 1 exists to close: the same retired `subject_id` the offer
    surface now declines to offer must also be the one `POST /api/bookings` refuses, so the
    two surfaces cannot drift apart again without both of these assertions failing."""
    db.get_one(Subject, world.subject_id).is_active = False
    db.flush()

    offered = api.get(_url(world), headers=_bearer(admin))
    booked = api.post(
        "/api/bookings",
        json={
            "child_id": str(world.child_id),
            "tutor_id": str(world.tutor_id),
            "subject_id": str(world.subject_id),
            "availability_id": str(world.availability_id),
            "home_id": str(world.home_id),
            "scheduled_date": world.date.isoformat(),
            "start_time": "09:00:00",
            "end_time": "10:00:00",
            "booked_by_guardian_id": None,
            "notes": None,
        },
        headers=_bearer(admin),
    )

    assert _windows(offered) == []
    _assert_detail(booked, 400, REFERENCE_NOT_FOUND_ERROR)


# --- the window and lead-time gates -----------------------------------------------------------


@pytest.mark.parametrize("days_out", [-1, -30, 400])
def test_a_date_outside_the_booking_window_is_400(
    api: TestClient, world: SlotWorld, admin: User, days_out: int
) -> None:
    date = _today() + datetime.timedelta(days=days_out)

    response = api.get(_url(world, date=date), headers=_bearer(admin))

    _assert_detail(response, 400, DATE_OUT_OF_WINDOW_ERROR)


def test_today_is_inside_the_window_and_is_not_refused(
    api: TestClient, db: Session, admin: User
) -> None:
    world = _make_world(db, date=_today())

    response = api.get(_url(world), headers=_bearer(admin))

    assert response.status_code == 200


def test_raising_the_minimum_lead_withholds_the_slots_inside_it(
    api: TestClient,
    world: SlotWorld,
    admin: User,
    set_int_setting: SetIntSetting,
) -> None:
    url = _url(world)
    before = _windows(api.get(url, headers=_bearer(admin)))

    set_int_setting(MIN_BOOKING_LEAD_SETTING, 24 * 400)
    after = _windows(api.get(url, headers=_bearer(admin)))

    assert before == DEFAULT_GRID
    assert after == []


def test_a_slot_earlier_today_is_withheld_once_the_lead_covers_it(
    api: TestClient, db: Session, admin: User, set_int_setting: SetIntSetting
) -> None:
    """Today's 09:00-12:00 range is entirely inside a 24-hour lead whatever time the suite
    runs at, so this pins the gate without depending on the wall clock."""
    world = _make_world(db, date=_today())
    set_int_setting(MIN_BOOKING_LEAD_SETTING, 24)

    response = api.get(_url(world), headers=_bearer(admin))

    assert response.status_code == 200
    assert _windows(response) == []


def test_the_business_date_is_inside_the_window_even_once_utc_is_on_the_next_day(
    api: TestClient, db: Session, admin: User, business_evening: datetime.datetime
) -> None:
    """At 22:00 the 09:00-12:00 range has already passed, so it is in the window but withheld
    by the lead time measured on the same business clock."""
    world = _make_world(db, date=BUSINESS_TODAY)

    response = api.get(_url(world), headers=_bearer(admin))

    assert response.status_code == 200
    assert _windows(response) == []


def test_the_day_before_the_business_date_is_out_of_the_window(
    api: TestClient, db: Session, admin: User, business_evening: datetime.datetime
) -> None:
    world = _make_world(db, date=BUSINESS_TODAY - datetime.timedelta(days=1))

    response = api.get(_url(world), headers=_bearer(admin))

    _assert_detail(response, 400, DATE_OUT_OF_WINDOW_ERROR)


# --- RBAC and the request envelope ------------------------------------------------------------


@pytest.mark.parametrize("role", ADMIN_ROLE_CASES)
def test_an_admin_and_a_developer_may_both_query_slots(
    api: TestClient, db: Session, world: SlotWorld, role: UserRole
) -> None:
    user = _make_user(db, role=role)

    response = api.get(_url(world), headers=_bearer(user))

    assert response.status_code == 200
    assert _windows(response) == DEFAULT_GRID


def test_a_tutor_token_is_403_and_never_500(api: TestClient, db: Session, world: SlotWorld) -> None:
    """The `TutorScopeNotApplied` regression. This route is admin-only and reads five
    tutor-owned mappers, so a `TutorScope` on it would arm the unapplied-scope guard and answer
    a populated query with a 500 — which `status_code != 200` would happily accept."""
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=world.tutor_id)

    response = api.get(_url(world), headers=_bearer(tutor_user))

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)


def test_an_unauthenticated_request_is_401(api: TestClient, world: SlotWorld) -> None:
    response = api.get(_url(world))

    _assert_detail(response, 401, CREDENTIALS_ERROR)


@pytest.mark.parametrize("omitted", ["subject_id", "date"])
def test_a_missing_required_parameter_is_400_never_422(
    api: TestClient, world: SlotWorld, admin: User, omitted: str
) -> None:
    query = {
        "subject_id": str(world.subject_id),
        "grade_level": "7",
        "date": DATE.isoformat(),
    }
    del query[omitted]

    response = api.get(f"/api/slots/available?{urlencode(query)}", headers=_bearer(admin))

    _assert_detail_shape(response, 400)
    assert omitted in response.json()["detail"]


@pytest.mark.parametrize("grade_level", ["0", "-1", "not-a-grade"])
def test_a_grade_level_below_one_is_400_never_the_whole_roster(
    api: TestClient, world: SlotWorld, admin: User, grade_level: str
) -> None:
    """Phase 3's review found `?grade_level=0` matching every ceiling and returning everyone."""
    response = api.get(_url(world, grade_level=grade_level), headers=_bearer(admin))

    _assert_detail_shape(response, 400)
    assert "grade_level" in response.json()["detail"]


@pytest.mark.parametrize(
    ("parameter", "value"), [("date", "not-a-date"), ("subject_id", "not-a-uuid")]
)
def test_a_malformed_parameter_is_400_never_422(
    api: TestClient, world: SlotWorld, admin: User, parameter: str, value: str
) -> None:
    response = api.get(_url(world, **{parameter: value}), headers=_bearer(admin))

    _assert_detail_shape(response, 400)
    assert parameter in response.json()["detail"]


def test_no_page_or_page_size_parameter_changes_the_answer(
    api: TestClient, db: Session, world: SlotWorld, admin: User
) -> None:
    """REQ-043.3: there is no paging here, so a caller sending one gets the same first page
    rather than a second one."""
    _make_availability(db, world.tutor_id, date=DATE, start=TWELVE_THIRTY, end=TWENTY_ONE)

    body = api.get(f"{_url(world)}&page=2&page_size=50", headers=_bearer(admin)).json()

    assert body["page"] == 1
    assert body["page_size"] == 5
    assert len(body["items"]) == 5


def _url(
    world: SlotWorld | None,
    *,
    subject_id: uuid.UUID | str | None = None,
    grade_level: int | str | None = 7,
    date: datetime.date | str | None = None,
    tutor_id: uuid.UUID | None = None,
) -> str:
    query = {
        "subject_id": str(subject_id if subject_id is not None else world.subject_id),
        "date": _isoformat(date if date is not None else world.date),
    }
    if grade_level is not None:
        query["grade_level"] = str(grade_level)
    if tutor_id is not None:
        query["tutor_id"] = str(tutor_id)

    return f"/api/slots/available?{urlencode(query)}"


def _isoformat(value: datetime.date | str) -> str:
    return value if isinstance(value, str) else value.isoformat()


def _windows(response: Response) -> list[tuple[str, str]]:
    return [(item["start_time"], item["end_time"]) for item in response.json()["items"]]


def _make_world(
    db: Session,
    *,
    date: datetime.date,
    subject_id: uuid.UUID | None = None,
    max_grade_level: int = 8,
    start: datetime.time = NINE,
    end: datetime.time = TWELVE,
) -> SlotWorld:
    suffix = uuid.uuid4().hex[:12]
    tutor = _make_tutor(db)
    subject_id = subject_id or _make_subject(db).id
    _assign(db, tutor_id=tutor.id, subject_id=subject_id, max_grade_level=max_grade_level)

    child = Child(name=f"Child {suffix}", grade_level=7, school_name="Test School")
    home = Home(address="1 Test Street", access_code="0000")
    db.add_all([child, home])
    db.flush()

    return SlotWorld(
        tutor_id=tutor.id,
        tutor_name=tutor.name,
        subject_id=subject_id,
        availability_id=_make_availability(db, tutor.id, date=date, start=start, end=end),
        child_id=child.id,
        home_id=home.id,
        date=date,
    )


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
    )
    db.add(tutor)
    db.flush()

    return tutor


def _make_subject(db: Session) -> Subject:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()

    return subject


def _assign(
    db: Session, *, tutor_id: uuid.UUID, subject_id: uuid.UUID, max_grade_level: int
) -> None:
    db.add(TutorSubject(tutor_id=tutor_id, subject_id=subject_id, max_grade_level=max_grade_level))
    db.flush()


def _make_availability(
    db: Session,
    tutor_id: uuid.UUID,
    *,
    date: datetime.date,
    start: datetime.time,
    end: datetime.time,
) -> uuid.UUID:
    # The weekday is derived from the date under test rather than written down, so the two can
    # never disagree — and `weekday()` is the 0 = Monday encoding the column stores.
    row = TutorAvailability(
        tutor_id=tutor_id, day_of_week=date.weekday(), start_time=start, end_time=end
    )
    db.add(row)
    db.flush()

    return row.id


def _make_booking(
    db: Session,
    world: SlotWorld,
    *,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> Booking:
    booking = Booking(
        child_id=world.child_id,
        tutor_id=world.tutor_id,
        subject_id=world.subject_id,
        availability_id=world.availability_id,
        home_id=world.home_id,
        scheduled_date=world.date,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


def _make_exception(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    start_date: datetime.date,
    end_date: datetime.date,
    status: ExceptionStatus,
    start_time: datetime.time | None = None,
    end_time: datetime.time | None = None,
) -> TutorAvailabilityException:
    row = TutorAvailabilityException(
        tutor_id=tutor_id,
        start_date=start_date,
        end_date=end_date,
        start_time=start_time,
        end_time=end_time,
        reason="vacation",
        status=status,
    )
    db.add(row)
    db.flush()

    return row


def _make_user(db: Session, *, role: UserRole, tutor_id: uuid.UUID | None = None) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password("slot-password"),
        role=role,
        tutor_id=tutor_id,
    )
    db.add(user)
    db.flush()

    return user


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)

    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    """The status, and a body that is exactly `{"detail": "<string>"}` — nothing else."""
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)


def _assert_detail_shape(response: Response, expected_status: int) -> None:
    """For the validation failures, whose message is pydantic's rather than this project's."""
    assert response.status_code == expected_status
    body = response.json()
    assert set(body) == {"detail"}
    assert isinstance(body["detail"], str)
