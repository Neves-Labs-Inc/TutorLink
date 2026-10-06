"""`GET /api/stats/overview`, exercised over HTTP.

The four equality tests are the point of this file. Each asserts a count from this endpoint
against the `total` of the list endpoint that answers the same question, on the same admin
token, over a `landscape` fixture holding **more rows than one page** in every dimension — so a
count that silently paged, or a predicate that drifted from the list's, fails here rather than
on a dashboard. They assert against `total` and never `len(items)` for that reason.

The `landscape` also carries deactivated tutors, deactivated clients, and `cancelled` and
`completed` bookings inside both windows, because a count that ignored `is_active` or counted
every status would still match a fixture that held none of them.

Bookings are spread one per tutor within a date: `excl_bookings_live_overlap` refuses two live
bookings for the same tutor whose times overlap, so the fixture would not build otherwise.
"""

import datetime
import uuid
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, UserRole
from app.models.guardian import Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.schemas.common import DEFAULT_PAGE_SIZE
from app.security import create_access_token, hash_password

MONDAY = datetime.date(2026, 9, 7)
TUESDAY = datetime.date(2026, 9, 8)
WEDNESDAY = datetime.date(2026, 9, 9)
THURSDAY = datetime.date(2026, 9, 10)
FRIDAY = datetime.date(2026, 9, 11)
SATURDAY = datetime.date(2026, 9, 12)
SUNDAY = datetime.date(2026, 9, 13)
NEXT_MONDAY = datetime.date(2026, 9, 14)

EIGHT = datetime.time(8, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)
THIRTEEN = datetime.time(13, 0)
FOURTEEN = datetime.time(14, 0)

EPOCH = datetime.datetime(2026, 8, 1, 12, 0, tzinfo=datetime.UTC)

ACTIVE_TUTOR_TOTAL = 21
INACTIVE_TUTOR_TOTAL = 2
ACTIVE_CLIENT_TOTAL = 23
INACTIVE_CLIENT_TOTAL = 2
LIVE_TODAY_TOTAL = ACTIVE_TUTOR_TOTAL
LIVE_UPCOMING_TOTAL = ACTIVE_TUTOR_TOTAL + 1

SUMMARY_FIELDS = {
    "id",
    "child",
    "tutor",
    "subject",
    "scheduled_date",
    "start_time",
    "end_time",
    "status",
    "notes",
}


@dataclass(frozen=True, slots=True)
class Cast:
    tutor: Tutor
    availability_id: uuid.UUID


@dataclass(frozen=True, slots=True)
class Stage:
    child: Child
    subject: Subject
    home: Home
    cast: Cast


@pytest.fixture
def stage(db: Session) -> Stage:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    home = Home(address="1 Test Street", access_code="0000")
    child = Child(name=f"Child {uuid.uuid4().hex[:12]}", grade_level=7, school_name="PS 1")
    db.add_all([subject, home, child])
    db.flush()

    return Stage(child=child, subject=subject, home=home, cast=_make_cast(db))


@pytest.fixture
def landscape(db: Session, stage: Stage) -> Stage:
    casts = [stage.cast, *(_make_cast(db) for _ in range(ACTIVE_TUTOR_TOTAL - 1))]
    for _ in range(INACTIVE_TUTOR_TOTAL):
        _make_cast(db, is_active=False)
    for _ in range(ACTIVE_CLIENT_TOTAL):
        _make_guardian(db)
    for _ in range(INACTIVE_CLIENT_TOTAL):
        _make_guardian(db, is_active=False)

    for index, cast in enumerate(casts):
        live = BookingStatus.PENDING if index % 2 == 0 else BookingStatus.CONFIRMED
        _book(db, stage, cast=cast, on=WEDNESDAY, status=live)
        _book(db, stage, cast=cast, on=THURSDAY, status=live)

    _book(db, stage, on=SUNDAY, status=BookingStatus.CONFIRMED)
    _book(db, stage, on=NEXT_MONDAY, status=BookingStatus.CONFIRMED)
    _book(db, stage, on=TUESDAY, status=BookingStatus.CONFIRMED)
    _book(db, stage, on=WEDNESDAY, start=TWELVE, end=THIRTEEN, status=BookingStatus.CANCELLED)
    _book(db, stage, on=WEDNESDAY, start=THIRTEEN, end=FOURTEEN, status=BookingStatus.COMPLETED)
    _book(db, stage, on=THURSDAY, start=TWELVE, end=THIRTEEN, status=BookingStatus.CANCELLED)

    return stage


def test_a_tutor_token_is_403(api: TestClient, db: Session, stage: Stage) -> None:
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=stage.cast.tutor.id)

    response = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(tutor_user))

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)


def test_a_developer_token_is_200(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    response = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(developer))

    assert response.status_code == 200


def test_no_token_is_401(api: TestClient, db: Session) -> None:
    response = api.get(f"/api/stats/overview?date={WEDNESDAY}")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


@pytest.mark.parametrize(
    "query",
    ["", "?date=", "?date=2026-13-45", "?date=yesterday", "?date=2026-09-09T10:00:00Z"],
    ids=["omitted", "empty", "impossible-day", "a-word", "a-timestamp"],
)
def test_a_missing_or_malformed_date_is_400_with_a_string_detail(
    api: TestClient, db: Session, query: str
) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/stats/overview{query}", headers=_auth(admin))

    assert response.status_code == 400
    body = response.json()
    assert set(body) == {"detail"}
    assert isinstance(body["detail"], str)
    assert body["detail"].startswith("query.date: ")


@pytest.mark.parametrize(
    ("on", "week_end"),
    [(datetime.date(1970, 1, 1), "1970-01-04"), (datetime.date(2099, 12, 30), "2100-01-03")],
    ids=["far-past", "far-future"],
)
def test_date_carries_no_past_or_future_bound(
    api: TestClient, db: Session, on: datetime.date, week_end: str
) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/stats/overview?date={on}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["week_end"] == week_end


@pytest.mark.parametrize(
    "on",
    [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY],
    ids=["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
)
def test_week_end_is_the_sunday_of_the_iso_week(
    api: TestClient, db: Session, on: datetime.date
) -> None:
    admin = _make_user(db)

    body = api.get(f"/api/stats/overview?date={on}", headers=_auth(admin)).json()

    assert body["date"] == str(on)
    assert body["week_end"] == str(SUNDAY)


def test_on_a_sunday_the_upcoming_window_is_empty_while_live_bookings_exist_after_it(
    api: TestClient, db: Session, landscape: Stage
) -> None:
    admin = _make_user(db)

    body = api.get(f"/api/stats/overview?date={SUNDAY}", headers=_auth(admin)).json()

    assert body["week_end"] == str(SUNDAY)
    assert body["today_session_count"] == 1
    assert body["upcoming_week_session_count"] == 0

    beyond = api.get(
        f"/api/bookings?status=pending&status=confirmed&from={NEXT_MONDAY}", headers=_auth(admin)
    ).json()
    assert beyond["total"] == 1


def test_a_booking_on_date_is_counted_today_and_not_upcoming(
    api: TestClient, db: Session, stage: Stage
) -> None:
    admin = _make_user(db)
    _book(db, stage, on=WEDNESDAY, status=BookingStatus.CONFIRMED)

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()

    assert body["today_session_count"] == 1
    assert body["upcoming_week_session_count"] == 0


@pytest.mark.parametrize(
    "status",
    [BookingStatus.CANCELLED, BookingStatus.COMPLETED],
    ids=["cancelled", "completed"],
)
def test_a_dead_booking_is_counted_by_neither_window(
    api: TestClient, db: Session, stage: Stage, status: BookingStatus
) -> None:
    admin = _make_user(db)
    _book(db, stage, on=WEDNESDAY, status=status)
    _book(db, stage, on=THURSDAY, start=TWELVE, end=THIRTEEN, status=status)

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()

    assert body["today_session_count"] == 0
    assert body["upcoming_week_session_count"] == 0


@pytest.mark.parametrize("on", [WEDNESDAY, SUNDAY], ids=["midweek", "sunday-inverts-the-range"])
def test_the_session_counts_equal_the_booking_list_totals(
    api: TestClient, db: Session, landscape: Stage, on: datetime.date
) -> None:
    admin = _make_user(db)
    body = api.get(f"/api/stats/overview?date={on}", headers=_auth(admin)).json()
    week_end = body["week_end"]
    day_after = on + datetime.timedelta(days=1)

    today = api.get(
        f"/api/bookings?status=pending&status=confirmed&from={on}&to={on}", headers=_auth(admin)
    ).json()
    upcoming = api.get(
        f"/api/bookings?status=pending&status=confirmed&from={day_after}&to={week_end}",
        headers=_auth(admin),
    ).json()

    assert body["today_session_count"] == today["total"]
    assert body["upcoming_week_session_count"] == upcoming["total"]


def test_the_session_count_fixture_outgrows_one_page(
    api: TestClient, db: Session, landscape: Stage
) -> None:
    admin = _make_user(db)

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()

    assert body["today_session_count"] == LIVE_TODAY_TOTAL > DEFAULT_PAGE_SIZE
    assert body["upcoming_week_session_count"] == LIVE_UPCOMING_TOTAL > DEFAULT_PAGE_SIZE


def test_active_tutor_count_equals_the_tutor_list_total(
    api: TestClient, db: Session, landscape: Stage
) -> None:
    admin = _make_user(db)

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()
    listed = api.get("/api/tutors?is_active=true", headers=_auth(admin)).json()
    deactivated = api.get("/api/tutors?is_active=false", headers=_auth(admin)).json()

    assert body["active_tutor_count"] == listed["total"] == ACTIVE_TUTOR_TOTAL
    assert body["active_tutor_count"] > DEFAULT_PAGE_SIZE
    assert deactivated["total"] == INACTIVE_TUTOR_TOTAL


def test_active_client_count_equals_the_client_list_total(
    api: TestClient, db: Session, landscape: Stage
) -> None:
    admin = _make_user(db)

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()
    listed = api.get("/api/clients?is_active=true", headers=_auth(admin)).json()
    deactivated = api.get("/api/clients?is_active=false", headers=_auth(admin)).json()

    assert body["active_client_count"] == listed["total"] == ACTIVE_CLIENT_TOTAL
    assert body["active_client_count"] > DEFAULT_PAGE_SIZE
    assert deactivated["total"] == INACTIVE_CLIENT_TOTAL


def test_the_response_carries_exactly_the_seven_documented_fields(
    api: TestClient, db: Session, stage: Stage
) -> None:
    admin = _make_user(db)

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()

    assert set(body) == {
        "date",
        "week_end",
        "today_session_count",
        "upcoming_week_session_count",
        "active_tutor_count",
        "active_client_count",
        "recent_bookings",
    }


def test_recent_bookings_is_a_bare_array_and_not_a_page_envelope(
    api: TestClient, db: Session, stage: Stage
) -> None:
    admin = _make_user(db)
    _book(db, stage, on=WEDNESDAY)

    recent = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()[
        "recent_bookings"
    ]

    assert isinstance(recent, list)
    assert len(recent) == 1


def test_six_bookings_yield_the_five_most_recently_created_newest_first(
    api: TestClient, db: Session, stage: Stage
) -> None:
    admin = _make_user(db)
    created = [
        _book(
            db,
            stage,
            on=WEDNESDAY,
            start=datetime.time(8 + index),
            end=datetime.time(9 + index),
            created_at=EPOCH + datetime.timedelta(minutes=index),
        )
        for index in range(6)
    ]

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()

    assert [row["id"] for row in body["recent_bookings"]] == [
        str(booking.id) for booking in reversed(created[1:])
    ]


def test_bookings_sharing_a_created_at_are_ordered_by_id_descending(
    api: TestClient, db: Session, stage: Stage
) -> None:
    admin = _make_user(db)
    together = [
        _book(db, stage, on=WEDNESDAY, start=EIGHT, end=TEN, created_at=EPOCH),
        _book(db, stage, on=WEDNESDAY, start=TEN, end=ELEVEN, created_at=EPOCH),
    ]

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()

    assert [row["id"] for row in body["recent_bookings"]] == [
        str(booking.id)
        for booking in sorted(together, key=lambda booking: booking.id, reverse=True)
    ]


def test_a_cancelled_booking_created_last_leads_the_feed(
    api: TestClient, db: Session, stage: Stage
) -> None:
    admin = _make_user(db)
    _book(db, stage, on=WEDNESDAY, created_at=EPOCH)
    cancelled = _book(
        db,
        stage,
        on=WEDNESDAY,
        start=TWELVE,
        end=THIRTEEN,
        status=BookingStatus.CANCELLED,
        created_at=EPOCH + datetime.timedelta(minutes=1),
    )

    body = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()

    assert body["recent_bookings"][0]["id"] == str(cancelled.id)
    assert body["recent_bookings"][0]["status"] == "cancelled"
    assert body["today_session_count"] == 1


def test_each_recent_booking_is_shaped_like_a_booking_list_item(
    api: TestClient, db: Session, stage: Stage
) -> None:
    admin = _make_user(db)
    booking = _book(db, stage, on=WEDNESDAY, status=BookingStatus.CONFIRMED)

    item = api.get(f"/api/stats/overview?date={WEDNESDAY}", headers=_auth(admin)).json()[
        "recent_bookings"
    ][0]
    listed = api.get(f"/api/bookings?from={WEDNESDAY}&to={WEDNESDAY}", headers=_auth(admin)).json()

    assert set(item) == SUMMARY_FIELDS
    assert set(item["child"]) == set(item["tutor"]) == set(item["subject"]) == {"id", "name"}
    assert item == {
        "id": str(booking.id),
        "child": {"id": str(stage.child.id), "name": stage.child.name},
        "tutor": {"id": str(stage.cast.tutor.id), "name": stage.cast.tutor.name},
        "subject": {"id": str(stage.subject.id), "name": stage.subject.name},
        "scheduled_date": str(WEDNESDAY),
        "start_time": "10:00:00",
        "end_time": "11:00:00",
        "status": "confirmed",
        "notes": None,
    }
    assert item == listed["items"][0]


def _book(
    db: Session,
    stage: Stage,
    *,
    cast: Cast | None = None,
    on: datetime.date = WEDNESDAY,
    start: datetime.time = TEN,
    end: datetime.time = ELEVEN,
    status: BookingStatus = BookingStatus.PENDING,
    created_at: datetime.datetime | None = None,
) -> Booking:
    booked = cast or stage.cast
    booking = Booking(
        child_id=stage.child.id,
        tutor_id=booked.tutor.id,
        subject_id=stage.subject.id,
        availability_id=booked.availability_id,
        home_id=stage.home.id,
        booked_by_guardian_id=None,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    if created_at is not None:
        booking.created_at = created_at
        booking.updated_at = created_at
    db.add(booking)
    db.flush()

    return booking


def _make_cast(db: Session, *, is_active: bool = True) -> Cast:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
        is_active=is_active,
    )
    db.add(tutor)
    db.flush()
    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=WEDNESDAY.weekday(), start_time=EIGHT, end_time=FOURTEEN
    )
    db.add(availability)
    db.flush()

    return Cast(tutor=tutor, availability_id=availability.id)


def _make_guardian(db: Session, *, is_active: bool = True) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(
        name=f"Guardian {suffix}", phone_number=f"+1{suffix[:10]}", is_active=is_active
    )
    db.add(guardian)
    db.flush()

    return guardian


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password("stats-password"),
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)

    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)
