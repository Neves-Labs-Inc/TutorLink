"""REQ-063 — everything one tutor session can and cannot reach, asserted over HTTP.

The per-endpoint modules cover each route in depth. This one is the cross-cutting matrix, and
it exists because epic #8 rules out the two cheap proofs by name: "the view renders nothing"
is not evidence, and neither is "the `TutorScope` dependency is wired up". The assertion has
to be made against the response the server actually sent.

Two failure shapes the module is written to make impossible:

- **A vacuous negative.** "Only tutor A's rows came back" asserts nothing if tutor B never had
  any. The `world` fixture builds a second tutor with their own availability slot, a pending
  and an approved exception, and a fully-parented booking, and every one of those rows is in
  the database for every assertion below. `# --- the fixture world is real ---` reads them
  back through an admin token first, so the counts a tutor sees afterwards (`total == 2`,
  `total == 1`) are counts that something was genuinely filtered out of.
- **A weak negative.** `status_code != 200` passes on a 404 and on a 500. Every refusal goes
  through `_assert_detail`, which pins the status **and** that the body is exactly
  `{"detail": "<string>"}` — `CONSTITUTION.md` §11 makes cross-tutor access a 403, never a 404
  and never an empty 200, and a test that only checks for "not success" cannot tell those
  three apart.

Bookings are inserted straight through the session rather than through `POST /api/bookings`:
that route is admin-only anyway, and it reads the five scheduling settings the harness does
not seed (`conftest.py:100-106`).
"""

import datetime
import uuid
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR, TUTOR_SCOPE_ERROR
from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, ExceptionStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.exceptions import EXCEPTION_NOT_DELETABLE_ERROR
from app.security import create_access_token, hash_password

MONDAY = datetime.date(2026, 9, 7)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)
THIRTEEN = datetime.time(13, 0)
FOURTEEN = datetime.time(14, 0)
FIFTEEN = datetime.time(15, 0)
SIXTEEN = datetime.time(16, 0)

PENDING_FROM = datetime.date(2026, 9, 14)
APPROVED_FROM = datetime.date(2026, 9, 21)

# Wide enough to hold both exceptions at either end. `?from=`/`?to=` are not parameters the
# exceptions route declares today, so this reads as "unknown query string ignored"; when the
# window filter lands, the same window still selects both rows and the assertion goes on
# meaning what it means now — that a date window narrows rows, never widens the tutor scope.
WINDOW = "from=2026-09-01&to=2026-12-31"

# The smallest body `POST /api/tutors/{id}/exceptions` accepts. Every use of it below expects
# a refusal, so it is well-formed on purpose: a 400 from validation would prove nothing about
# who the caller is.
EXCEPTION_BODY = {"start_date": "2026-10-05", "end_date": "2026-10-06", "reason": "vacation"}


@dataclass(frozen=True, slots=True)
class World:
    """Tutor A, tutor B, and the three other principals. Every id here is a live row."""

    tutor: Tutor
    other_tutor: Tutor
    subject: Subject
    other_subject: Subject
    child_id: uuid.UUID
    home_id: uuid.UUID
    slot_id: uuid.UUID
    other_slot_id: uuid.UUID
    pending_id: uuid.UUID
    approved_id: uuid.UUID
    other_pending_id: uuid.UUID
    other_approved_id: uuid.UUID
    booking_id: uuid.UUID
    other_booking_id: uuid.UUID
    tutor_headers: dict[str, str]
    admin_headers: dict[str, str]
    unlinked_headers: dict[str, str]


@pytest.fixture
def world(db: Session) -> World:
    tutor = _make_tutor(db)
    other_tutor = _make_tutor(db)
    subject = _make_subject(db)
    other_subject = _make_subject(db)
    child_id, home_id = _make_family(db)
    other_child_id, other_home_id = _make_family(db)
    slot_id = _make_slot(db, tutor.id, day_of_week=MONDAY.weekday(), start=NINE, end=TWELVE)
    other_slot_id = _make_slot(db, other_tutor.id, day_of_week=2, start=THIRTEEN, end=SIXTEEN)

    return World(
        tutor=tutor,
        other_tutor=other_tutor,
        subject=subject,
        other_subject=other_subject,
        child_id=child_id,
        home_id=home_id,
        slot_id=slot_id,
        other_slot_id=other_slot_id,
        pending_id=_make_exception(db, tutor.id, ExceptionStatus.PENDING, PENDING_FROM),
        approved_id=_make_exception(db, tutor.id, ExceptionStatus.APPROVED, APPROVED_FROM),
        other_pending_id=_make_exception(db, other_tutor.id, ExceptionStatus.PENDING, PENDING_FROM),
        other_approved_id=_make_exception(
            db, other_tutor.id, ExceptionStatus.APPROVED, APPROVED_FROM
        ),
        booking_id=_make_booking(
            db,
            tutor_id=tutor.id,
            child_id=child_id,
            subject_id=subject.id,
            availability_id=slot_id,
            home_id=home_id,
            start=TEN,
            end=ELEVEN,
        ),
        other_booking_id=_make_booking(
            db,
            tutor_id=other_tutor.id,
            child_id=other_child_id,
            subject_id=other_subject.id,
            availability_id=other_slot_id,
            home_id=other_home_id,
            start=FOURTEEN,
            end=FIFTEEN,
        ),
        tutor_headers=_bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)),
        admin_headers=_bearer(_make_user(db, role=UserRole.ADMIN)),
        unlinked_headers=_bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=None)),
    )


# --- the fixture world is real ---------------------------------------------------------------


def test_both_tutors_rows_exist_and_an_admin_reaches_them(
    api: TestClient, db: Session, world: World
) -> None:
    """The premise every negative below rests on. If tutor B's rows were missing, "only A's
    came back" would be true of an empty database and would prove nothing at all."""
    bookings = api.get("/api/bookings", headers=world.admin_headers).json()
    exceptions = api.get(
        f"/api/tutors/{world.other_tutor.id}/exceptions", headers=world.admin_headers
    ).json()
    availability = api.get(
        f"/api/tutors/{world.other_tutor.id}/availability", headers=world.admin_headers
    ).json()

    assert bookings["total"] == 2
    assert {row["id"] for row in bookings["items"]} == {
        str(world.booking_id),
        str(world.other_booking_id),
    }
    assert exceptions["total"] == 2
    assert {row["id"] for row in exceptions["items"]} == {
        str(world.other_pending_id),
        str(world.other_approved_id),
    }
    assert [row["id"] for row in availability["items"]] == [str(world.other_slot_id)]
    assert _booking_count(db) == 2
    assert _exception_ids(db, world.other_tutor.id) == {
        world.other_pending_id,
        world.other_approved_id,
    }


# --- own data, as tutor A --------------------------------------------------------------------


def test_a_tutor_lists_their_own_availability_and_not_the_other_tutors(
    api: TestClient, world: World
) -> None:
    response = api.get(f"/api/tutors/{world.tutor.id}/availability", headers=world.tutor_headers)
    body = response.json()

    assert response.status_code == 200
    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(world.slot_id)]
    assert body["items"][0]["tutor_id"] == str(world.tutor.id)
    assert body["items"][0]["day_of_week"] == MONDAY.weekday()
    assert body["items"][0]["start_time"] == "09:00:00"


def test_a_tutor_lists_both_of_their_exceptions_and_none_of_the_other_tutors(
    api: TestClient, world: World
) -> None:
    response = api.get(f"/api/tutors/{world.tutor.id}/exceptions", headers=world.tutor_headers)
    body = response.json()

    assert response.status_code == 200
    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {
        str(world.pending_id),
        str(world.approved_id),
    }
    assert {row["status"] for row in body["items"]} == {"pending", "approved"}
    assert {row["tutor_id"] for row in body["items"]} == {str(world.tutor.id)}


def test_a_date_window_narrows_the_rows_and_never_widens_the_scope(
    api: TestClient, world: World
) -> None:
    """Tutor B's two exceptions sit inside this window as well. A window parameter is a filter
    on rows the caller may already see, not a second way of naming whose rows they are."""
    response = api.get(
        f"/api/tutors/{world.tutor.id}/exceptions?{WINDOW}", headers=world.tutor_headers
    )
    body = response.json()

    assert response.status_code == 200
    assert {row["tutor_id"] for row in body["items"]} == {str(world.tutor.id)}
    assert str(world.other_pending_id) not in {row["id"] for row in body["items"]}
    assert str(world.other_approved_id) not in {row["id"] for row in body["items"]}


def test_a_tutor_listing_bookings_sees_one_of_the_two_in_the_database(
    api: TestClient, db: Session, world: World
) -> None:
    """The scoping-happens-in-the-query assertion. `total` counts the filtered query before
    paging, so a `total` of 1 against two stored bookings means the other row was excluded by
    the `WHERE`, not dropped while the page was rendered."""
    response = api.get("/api/bookings", headers=world.tutor_headers)
    body = response.json()

    assert _booking_count(db) == 2
    assert response.status_code == 200
    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(world.booking_id)]
    assert body["items"][0]["tutor"]["id"] == str(world.tutor.id)
    assert body["items"][0]["subject"]["name"] == world.subject.name
    assert str(world.other_tutor.id) not in response.text


def test_naming_their_own_tutor_id_returns_exactly_the_same_page(
    api: TestClient, world: World
) -> None:
    omitted = api.get("/api/bookings", headers=world.tutor_headers)
    named = api.get(f"/api/bookings?tutor_id={world.tutor.id}", headers=world.tutor_headers)

    assert omitted.status_code == 200
    assert named.status_code == 200
    assert named.json() == omitted.json()
    assert [row["id"] for row in named.json()["items"]] == [str(world.booking_id)]


def test_a_tutor_reads_their_own_booking(api: TestClient, world: World) -> None:
    response = api.get(f"/api/bookings/{world.booking_id}", headers=world.tutor_headers)
    body = response.json()

    assert response.status_code == 200
    assert body["id"] == str(world.booking_id)
    assert body["tutor"]["id"] == str(world.tutor.id)
    assert body["home"]["id"] == str(world.home_id)
    assert body["child"]["id"] == str(world.child_id)


def test_a_tutor_creating_their_own_time_off_lands_pending(
    api: TestClient, db: Session, world: World
) -> None:
    """The role decides the status, never the body — `ExceptionCreate` has no `status` field,
    so the key below is inert rather than honoured."""
    response = api.post(
        f"/api/tutors/{world.tutor.id}/exceptions",
        json={
            "start_date": "2026-10-05",
            "end_date": "2026-10-06",
            "reason": "personal",
            "status": "approved",
        },
        headers=world.tutor_headers,
    )
    body = response.json()

    assert response.status_code == 201
    assert body["status"] == "pending"
    assert body["tutor_id"] == str(world.tutor.id)
    assert body["reason"] == "personal"
    assert _row(db, uuid.UUID(body["id"])).status is ExceptionStatus.PENDING
    assert _exception_ids(db, world.other_tutor.id) == {
        world.other_pending_id,
        world.other_approved_id,
    }


def test_a_tutor_deletes_their_own_pending_request_and_nothing_else(
    api: TestClient, db: Session, world: World
) -> None:
    response = api.delete(f"/api/exceptions/{world.pending_id}", headers=world.tutor_headers)

    assert response.status_code == 204
    assert response.content == b""
    assert _exception_ids(db, world.tutor.id) == {world.approved_id}
    assert _exception_ids(db, world.other_tutor.id) == {
        world.other_pending_id,
        world.other_approved_id,
    }


# --- another tutor's data: 403, never 404, never an empty 200 --------------------------------


@pytest.mark.parametrize("target", ["another-tutor", "no-such-tutor"])
@pytest.mark.parametrize(
    ("method", "template", "body"),
    [
        ("GET", "/api/tutors/{tutor_id}/availability", None),
        ("GET", "/api/tutors/{tutor_id}/exceptions", None),
        ("GET", "/api/tutors/{tutor_id}/exceptions?" + WINDOW, None),
        ("POST", "/api/tutors/{tutor_id}/exceptions", EXCEPTION_BODY),
        ("GET", "/api/bookings?tutor_id={tutor_id}", None),
    ],
    ids=["availability", "exceptions", "exceptions-windowed", "create-exception", "bookings"],
)
def test_a_tutor_naming_a_tutor_id_that_is_not_theirs_is_403(
    api: TestClient,
    db: Session,
    world: World,
    target: str,
    method: str,
    template: str,
    body: dict[str, str] | None,
) -> None:
    """An id matching no tutor at all is 403 too, and deliberately so: a 404 there would turn
    the endpoint into an oracle for which tutor ids exist, the documented choice recorded at
    `test_tutor_routes.py:1-9` rather than an oversight to harden. The refusal is raised while
    dependencies resolve, so the route body never runs and nothing is written."""
    tutor_id = world.other_tutor.id if target == "another-tutor" else uuid.uuid4()

    response = api.request(
        method, template.format(tutor_id=tutor_id), json=body, headers=world.tutor_headers
    )

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)
    assert _exception_ids(db, world.other_tutor.id) == {
        world.other_pending_id,
        world.other_approved_id,
    }


def test_a_tutor_reading_another_tutors_booking_is_403(api: TestClient, world: World) -> None:
    response = api.get(f"/api/bookings/{world.other_booking_id}", headers=world.tutor_headers)

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_a_tutor_deleting_another_tutors_pending_request_is_403(
    api: TestClient, db: Session, world: World
) -> None:
    response = api.delete(f"/api/exceptions/{world.other_pending_id}", headers=world.tutor_headers)

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)
    assert _row(db, world.other_pending_id).status is ExceptionStatus.PENDING


# --- writes no tutor may make, including on their own rows -----------------------------------


@pytest.mark.parametrize(
    ("method", "template", "body", "detail"),
    [
        (
            "PATCH",
            "/api/exceptions/{pending_id}",
            {"status": "approved"},
            ADMIN_REQUIRED_ERROR,
        ),
        (
            "PATCH",
            "/api/exceptions/{other_pending_id}",
            {"status": "rejected"},
            ADMIN_REQUIRED_ERROR,
        ),
        ("DELETE", "/api/exceptions/{approved_id}", None, EXCEPTION_NOT_DELETABLE_ERROR),
        (
            "POST",
            "/api/tutors/{tutor_id}/availability",
            {"day_of_week": 3, "start_time": "09:00:00", "end_time": "12:00:00"},
            ADMIN_REQUIRED_ERROR,
        ),
        (
            "PATCH",
            "/api/availability/{slot_id}",
            {"start_time": "10:00:00", "end_time": "11:00:00"},
            ADMIN_REQUIRED_ERROR,
        ),
        ("DELETE", "/api/availability/{slot_id}", None, ADMIN_REQUIRED_ERROR),
        ("PATCH", "/api/bookings/{booking_id}", {"status": "cancelled"}, ADMIN_REQUIRED_ERROR),
    ],
    ids=[
        "decide-own-pending",
        "decide-another-tutors-pending",
        "delete-own-approved",
        "create-own-availability",
        "edit-own-availability",
        "deactivate-own-availability",
        "change-own-bookings-status",
    ],
)
def test_a_tutor_may_not_write_even_to_their_own_rows(
    api: TestClient,
    db: Session,
    world: World,
    method: str,
    template: str,
    body: dict[str, object] | None,
    detail: str,
) -> None:
    """Approving one's own time off is the rule the status column exists to enforce, and #24
    widened the refusal to everything else a tutor owns: availability is admin-managed even on
    one's own profile, and a decided exception is no longer the tutor's to withdraw."""
    response = api.request(
        method, template.format(**_targets(world)), json=body, headers=world.tutor_headers
    )

    _assert_detail(response, 403, detail)
    assert _row(db, world.pending_id).status is ExceptionStatus.PENDING
    assert _row(db, world.approved_id).status is ExceptionStatus.APPROVED
    assert _row(db, world.other_pending_id).status is ExceptionStatus.PENDING
    assert _slot_is_active(db, world.slot_id)
    assert _booking_status(db, world.booking_id) is BookingStatus.PENDING


def test_a_tutor_may_not_create_a_booking_even_entirely_from_their_own_rows(
    api: TestClient, db: Session, world: World
) -> None:
    """Every id in this body is tutor A's own, so the refusal is about the role rather than
    about anything in the payload failing to validate."""
    response = api.post(
        "/api/bookings",
        json={
            "child_id": str(world.child_id),
            "tutor_id": str(world.tutor.id),
            "subject_id": str(world.subject.id),
            "availability_id": str(world.slot_id),
            "home_id": str(world.home_id),
            "scheduled_date": "2026-09-14",
            "start_time": "10:00:00",
            "end_time": "11:00:00",
        },
        headers=world.tutor_headers,
    )

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _booking_count(db) == 2


# --- admin-only surfaces, and the one list a tutor may read ----------------------------------


@pytest.mark.parametrize(
    "template",
    [
        "/api/clients",
        "/api/users",
        "/api/settings",
        "/api/stats/overview?date=2026-09-07",
        "/api/slots/available?subject_id={subject_id}&date=2026-09-07&grade_level=7",
    ],
    ids=["clients", "users", "settings", "stats", "slots"],
)
def test_an_admin_only_surface_is_403_for_a_tutor(
    api: TestClient, world: World, template: str
) -> None:
    """403 and nothing else — `/api/slots/available` in particular reads five tutor-owned
    mappers, so a `TutorScope` mistakenly hung on it would answer 500 instead, which a bare
    "not 200" assertion would accept."""
    response = api.get(template.format(**_targets(world)), headers=world.tutor_headers)

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)


def test_a_tutor_may_read_every_subject_including_the_other_tutors(
    api: TestClient, world: World
) -> None:
    """The documented line in the matrix, asserted so that "a tutor is refused everything" is
    visibly not what this file proves. Subjects are global: the one tutor B teaches is in the
    list, and that is correct rather than a leak."""
    response = api.get("/api/subjects?page_size=100", headers=world.tutor_headers)
    names = {row["name"] for row in response.json()["items"]}

    assert response.status_code == 200
    assert world.subject.name in names
    assert world.other_subject.name in names


# --- the tutor account whose tutor_id is NULL ------------------------------------------------


@pytest.mark.parametrize(
    ("method", "template", "body"),
    [
        ("GET", "/api/tutors/{tutor_id}/availability", None),
        ("GET", "/api/tutors/{tutor_id}/exceptions", None),
        ("POST", "/api/tutors/{tutor_id}/exceptions", EXCEPTION_BODY),
        ("GET", "/api/bookings", None),
        ("GET", "/api/bookings?tutor_id={tutor_id}", None),
        ("GET", "/api/bookings/{booking_id}", None),
        ("DELETE", "/api/exceptions/{pending_id}", None),
    ],
    ids=[
        "availability",
        "exceptions",
        "create-exception",
        "bookings",
        "bookings-by-tutor",
        "booking-by-id",
        "delete-exception",
    ],
)
def test_a_tutor_account_with_no_tutor_id_reaches_nothing(
    api: TestClient,
    db: Session,
    world: World,
    method: str,
    template: str,
    body: dict[str, str] | None,
) -> None:
    """`users.tutor_id` is nullable because admins have no tutor profile, so a `tutor` row in
    that state is a data error. `dependencies.py:196-226` refuses it rather than reading it as
    "unscoped" — a 200 here would carry every tutor's rows."""
    response = api.request(
        method, template.format(**_targets(world)), json=body, headers=world.unlinked_headers
    )

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)
    assert _exception_ids(db, world.tutor.id) == {world.pending_id, world.approved_id}


# --- no token at all -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "template", "body"),
    [
        ("GET", "/api/tutors/{tutor_id}/availability", None),
        ("GET", "/api/tutors/{tutor_id}/exceptions", None),
        ("POST", "/api/tutors/{tutor_id}/exceptions", EXCEPTION_BODY),
        ("GET", "/api/bookings", None),
        ("GET", "/api/bookings/{booking_id}", None),
        ("PATCH", "/api/exceptions/{pending_id}", {"status": "approved"}),
        ("DELETE", "/api/exceptions/{pending_id}", None),
        ("GET", "/api/subjects", None),
        ("GET", "/api/clients", None),
    ],
    ids=[
        "availability",
        "exceptions",
        "create-exception",
        "bookings",
        "booking-by-id",
        "decide-exception",
        "delete-exception",
        "subjects",
        "clients",
    ],
)
def test_an_anonymous_call_is_401_even_on_an_admin_only_route(
    api: TestClient,
    db: Session,
    world: World,
    method: str,
    template: str,
    body: dict[str, object] | None,
) -> None:
    """Authentication runs before the role gate (`dependencies.py:151`), so `/api/clients`
    without a token is 401 rather than the 403 a tutor token gets — the anonymous caller is
    never told that the route is admin-only."""
    response = api.request(method, template.format(**_targets(world)), json=body)

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _exception_ids(db, world.tutor.id) == {world.pending_id, world.approved_id}


def _targets(world: World) -> dict[str, str]:
    return {
        "tutor_id": str(world.tutor.id),
        "other_tutor_id": str(world.other_tutor.id),
        "subject_id": str(world.subject.id),
        "slot_id": str(world.slot_id),
        "pending_id": str(world.pending_id),
        "approved_id": str(world.approved_id),
        "other_pending_id": str(world.other_pending_id),
        "booking_id": str(world.booking_id),
        "other_booking_id": str(world.other_booking_id),
    }


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


def _make_user(db: Session, *, role: UserRole, tutor_id: uuid.UUID | None = None) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password("isolation-password"),
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


def _make_subject(db: Session) -> Subject:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()

    return subject


def _make_family(db: Session) -> tuple[uuid.UUID, uuid.UUID]:
    """One guardian, one child and one home, all distinct per tutor — so a leaked booking
    shows up as a name that belongs to the other tutor's client, not only as a stray id."""
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(name=f"Guardian {suffix}", phone_number=f"+1{suffix[:10]}")
    home = Home(address=f"{suffix} Test Street", access_code="0000")
    child = Child(name=f"Child {suffix}", age=12, grade_level=7, school_name="Test School")
    db.add_all([guardian, home, child])
    db.flush()
    db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
    db.flush()

    return child.id, home.id


def _make_slot(
    db: Session,
    tutor_id: uuid.UUID,
    *,
    day_of_week: int,
    start: datetime.time,
    end: datetime.time,
) -> uuid.UUID:
    slot = TutorAvailability(
        tutor_id=tutor_id, day_of_week=day_of_week, start_time=start, end_time=end
    )
    db.add(slot)
    db.flush()

    return slot.id


def _make_exception(
    db: Session, tutor_id: uuid.UUID, status: ExceptionStatus, start_date: datetime.date
) -> uuid.UUID:
    row = TutorAvailabilityException(
        tutor_id=tutor_id,
        start_date=start_date,
        end_date=start_date + datetime.timedelta(days=1),
        reason="vacation",
        status=status,
    )
    db.add(row)
    db.flush()

    return row.id


def _make_booking(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    child_id: uuid.UUID,
    subject_id: uuid.UUID,
    availability_id: uuid.UUID,
    home_id: uuid.UUID,
    start: datetime.time,
    end: datetime.time,
) -> uuid.UUID:
    booking = Booking(
        child_id=child_id,
        tutor_id=tutor_id,
        subject_id=subject_id,
        availability_id=availability_id,
        home_id=home_id,
        scheduled_date=MONDAY,
        start_time=start,
        end_time=end,
        status=BookingStatus.PENDING,
    )
    db.add(booking)
    db.flush()

    return booking.id


def _row(db: Session, exception_id: uuid.UUID) -> TutorAvailabilityException:
    db.expire_all()

    return db.get_one(TutorAvailabilityException, exception_id)


def _exception_ids(db: Session, tutor_id: uuid.UUID) -> set[uuid.UUID]:
    db.expire_all()

    return set(
        db.scalars(
            select(TutorAvailabilityException.id).where(
                TutorAvailabilityException.tutor_id == tutor_id
            )
        ).all()
    )


def _booking_count(db: Session) -> int:
    db.expire_all()

    return db.execute(select(func.count()).select_from(Booking)).scalar_one()


def _booking_status(db: Session, booking_id: uuid.UUID) -> BookingStatus:
    db.expire_all()

    return db.get_one(Booking, booking_id).status


def _slot_is_active(db: Session, slot_id: uuid.UUID) -> bool:
    db.expire_all()

    return db.get_one(TutorAvailability, slot_id).is_active


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)

    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    """The status, and a body that is exactly `{"detail": "<string>"}` — nothing else.

    The whole point: a 403, a 404 and an empty 200 are indistinguishable to an assertion that
    only checks for failure, and `CONSTITUTION.md` §11 makes the difference between them the
    thing this module is here to prove.
    """
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)
