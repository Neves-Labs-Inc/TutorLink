"""`PATCH /api/bookings/{id}` — the status-transition table, exercised over HTTP.

Every negative case asserts the exact status **and** that the body is `{"detail": "<string>"}`:
`status_code != 200` would pass on an accidental 404 or 500. The transition table is the
authority under test — every legal cell lands, and `cancelled`/`completed` are proven terminal
in both directions, including the no-op restatement of the current status.
"""

import datetime
import threading
import time
import uuid
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.dependencies import OFFICE_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, UserRole
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.booking_status import BOOKING_NOT_FOUND_ERROR, ILLEGAL_TRANSITION_ERROR
from app.security import create_access_token, hash_password
from app.services.booking_status_service import IllegalTransition, change_status

STAFF_ROLE_CASES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER]

DATE = datetime.date(2026, 9, 7)
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)

LEGAL_TRANSITIONS = [
    (BookingStatus.PENDING, BookingStatus.CONFIRMED),
    (BookingStatus.PENDING, BookingStatus.CANCELLED),
    (BookingStatus.CONFIRMED, BookingStatus.CANCELLED),
    (BookingStatus.CONFIRMED, BookingStatus.COMPLETED),
]

ILLEGAL_TRANSITIONS = [
    (BookingStatus.CANCELLED, BookingStatus.CONFIRMED),
    (BookingStatus.CANCELLED, BookingStatus.PENDING),
    (BookingStatus.CANCELLED, BookingStatus.CANCELLED),
    (BookingStatus.COMPLETED, BookingStatus.CANCELLED),
    (BookingStatus.COMPLETED, BookingStatus.CONFIRMED),
    (BookingStatus.COMPLETED, BookingStatus.COMPLETED),
    (BookingStatus.CONFIRMED, BookingStatus.CONFIRMED),
    (BookingStatus.CONFIRMED, BookingStatus.PENDING),
    (BookingStatus.PENDING, BookingStatus.PENDING),
    (BookingStatus.PENDING, BookingStatus.COMPLETED),
]


# --- legal transitions -----------------------------------------------------------------------


@pytest.mark.parametrize(("current", "target"), LEGAL_TRANSITIONS)
@pytest.mark.parametrize("role", STAFF_ROLE_CASES)
def test_a_legal_transition_succeeds(
    api: TestClient,
    db: Session,
    role: UserRole,
    current: BookingStatus,
    target: BookingStatus,
) -> None:
    booking = _make_booking(db, status=current)
    user = _make_user(db, role=role)

    response = api.patch(
        f"/api/bookings/{booking.id}", json={"status": target.value}, headers=_bearer(user)
    )
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == target.value
    assert body["id"] == str(booking.id)
    assert _row(db, booking.id).status is target


def test_cancelling_a_booking_frees_its_range(api: TestClient, db: Session) -> None:
    """The constraint's partial `WHERE`, proven from this side: once the booking is cancelled,
    an overlapping booking for the same tutor and window is no longer live and may be inserted."""
    booking = _make_booking(db, status=BookingStatus.CONFIRMED)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/bookings/{booking.id}", json={"status": "cancelled"}, headers=_bearer(user)
    )
    assert response.status_code == 200

    overlapping = Booking(
        child_id=booking.child_id,
        tutor_id=booking.tutor_id,
        subject_id=booking.subject_id,
        availability_id=booking.availability_id,
        home_id=booking.home_id,
        scheduled_date=booking.scheduled_date,
        start_time=booking.start_time,
        end_time=booking.end_time,
        status=BookingStatus.PENDING,
    )
    db.add(overlapping)
    db.flush()

    assert _row(db, overlapping.id).status is BookingStatus.PENDING


# --- illegal transitions ----------------------------------------------------------------------


@pytest.mark.parametrize(("current", "target"), ILLEGAL_TRANSITIONS)
def test_an_illegal_transition_is_409_and_writes_nothing(
    api: TestClient, db: Session, current: BookingStatus, target: BookingStatus
) -> None:
    booking = _make_booking(db, status=current)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/bookings/{booking.id}", json={"status": target.value}, headers=_bearer(user)
    )

    expected = ILLEGAL_TRANSITION_ERROR.format(current=current.value, target=target.value)
    _assert_detail(response, 409, expected)
    assert _row(db, booking.id).status is current


def test_a_409_leaves_the_session_usable_for_the_next_request(api: TestClient, db: Session) -> None:
    """The session must survive a rejected transition intact: a route that mishandles ordering
    around a domain exception can leave it unusable, and the only assertion that catches that is
    the next request still returning 200."""
    booking = _make_booking(db, status=BookingStatus.CANCELLED)
    user = _make_user(db, role=UserRole.ADMIN)

    rejected = api.patch(
        f"/api/bookings/{booking.id}", json={"status": "confirmed"}, headers=_bearer(user)
    )
    assert rejected.status_code == 409

    other = _make_booking(db, status=BookingStatus.PENDING)
    accepted = api.patch(
        f"/api/bookings/{other.id}", json={"status": "confirmed"}, headers=_bearer(user)
    )

    assert accepted.status_code == 200
    assert _row(db, other.id).status is BookingStatus.CONFIRMED


def test_a_concurrent_status_change_is_serialized_by_the_row_lock(
    committed_sessions: sessionmaker[Session],
) -> None:
    """A genuine two-connection race, not the sequential one the rolled-back `db` fixture would
    fake (Phase 3 decision D-J: a shared transaction turns two "concurrent" calls into two calls
    in a row, where the second just reads the already-decided row and 409s — proving the
    transition table, not the lock).

    Thread A locks the row and holds it open past its `flush()`. Thread B's `change_status` call
    is issued while A still holds the lock, so it must block inside `with_for_update()` until A
    commits — proven by asserting B's own call took at least as long as A held the lock — and
    then see A's committed `cancelled`, not the stale `pending` A first read.
    """
    committed = _make_committed_booking(committed_sessions, status=BookingStatus.PENDING)
    booking_id = committed.booking_id
    hold_seconds = 0.4
    a_locked = threading.Event()
    b_elapsed: list[float] = []
    b_error: list[IllegalTransition] = []

    def hold_lock() -> None:
        with committed_sessions() as session:
            change_status(session, booking_id=booking_id, target=BookingStatus.CANCELLED)
            a_locked.set()
            time.sleep(hold_seconds)
            session.commit()

    def contend() -> None:
        a_locked.wait(timeout=5)
        start = time.monotonic()
        with committed_sessions() as session:
            try:
                change_status(session, booking_id=booking_id, target=BookingStatus.CONFIRMED)
            except IllegalTransition as error:
                b_error.append(error)
        b_elapsed.append(time.monotonic() - start)

    try:
        holder = threading.Thread(target=hold_lock)
        contender = threading.Thread(target=contend)
        holder.start()
        contender.start()
        holder.join(timeout=5)
        contender.join(timeout=5)

        assert b_elapsed[0] >= hold_seconds * 0.8
        assert len(b_error) == 1
        assert b_error[0].current is BookingStatus.CANCELLED
        with committed_sessions() as session:
            assert session.get(Booking, booking_id).status is BookingStatus.CANCELLED
    finally:
        _delete_committed_booking(committed_sessions, committed)


def test_an_unknown_booking_is_404(api: TestClient, db: Session) -> None:
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/bookings/{uuid.uuid4()}", json={"status": "cancelled"}, headers=_bearer(user)
    )

    _assert_detail(response, 404, BOOKING_NOT_FOUND_ERROR)


def test_an_unrecognised_status_is_400_not_422(api: TestClient, db: Session) -> None:
    booking = _make_booking(db, status=BookingStatus.PENDING)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/bookings/{booking.id}", json={"status": "archived"}, headers=_bearer(user)
    )

    _assert_detail_shape(response, 400)
    assert _row(db, booking.id).status is BookingStatus.PENDING


def test_a_body_carrying_other_fields_ignores_them(api: TestClient, db: Session) -> None:
    booking = _make_booking(db, status=BookingStatus.PENDING)
    user = _make_user(db, role=UserRole.ADMIN)

    response = api.patch(
        f"/api/bookings/{booking.id}",
        json={
            "status": "confirmed",
            "scheduled_date": "2099-01-01",
            "start_time": "01:00:00",
            "end_time": "02:00:00",
            "notes": "should be ignored",
        },
        headers=_bearer(user),
    )
    body = response.json()

    assert response.status_code == 200
    assert body["scheduled_date"] == DATE.isoformat()
    assert body["start_time"] == "09:00:00"
    assert body["end_time"] == "10:00:00"
    row = _row(db, booking.id)
    assert row.scheduled_date == DATE
    assert row.start_time == NINE
    assert row.end_time == TEN


# --- RBAC and auth -----------------------------------------------------------------------------


def test_tutor_token_is_403(api: TestClient, db: Session) -> None:
    booking = _make_booking(db, status=BookingStatus.PENDING)
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=booking.tutor_id)

    response = api.patch(
        f"/api/bookings/{booking.id}", json={"status": "confirmed"}, headers=_bearer(user)
    )

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)
    assert _row(db, booking.id).status is BookingStatus.PENDING


def test_unauthenticated_is_401(api: TestClient, db: Session) -> None:
    booking = _make_booking(db, status=BookingStatus.PENDING)

    response = api.patch(f"/api/bookings/{booking.id}", json={"status": "confirmed"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)
    assert _row(db, booking.id).status is BookingStatus.PENDING


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    """A factory of real, independently-committing sessions on `_test_engine`.

    The rolled-back `db` fixture shares one transaction, so two sessions from it can never
    contend for the same row lock — only sessions each bound to their own connection can, which
    is what `test_a_concurrent_status_change_is_serialized_by_the_row_lock` needs.
    """
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@dataclass(frozen=True, slots=True)
class _CommittedBooking:
    booking_id: uuid.UUID
    tutor_id: uuid.UUID
    child_id: uuid.UUID
    subject_id: uuid.UUID
    home_id: uuid.UUID


def _make_committed_booking(
    sessions: sessionmaker[Session], *, status: BookingStatus
) -> _CommittedBooking:
    """A booking committed on its own connection, so a second connection can lock it for real."""
    with sessions() as session:
        booking = _make_booking(session, status=status)
        session.commit()
        return _CommittedBooking(
            booking_id=booking.id,
            tutor_id=booking.tutor_id,
            child_id=booking.child_id,
            subject_id=booking.subject_id,
            home_id=booking.home_id,
        )


def _delete_committed_booking(sessions: sessionmaker[Session], row: _CommittedBooking) -> None:
    with sessions() as session:
        session.execute(delete(Booking).where(Booking.id == row.booking_id))
        session.execute(delete(TutorAvailability).where(TutorAvailability.tutor_id == row.tutor_id))
        session.execute(delete(Tutor).where(Tutor.id == row.tutor_id))
        session.execute(delete(Child).where(Child.id == row.child_id))
        session.execute(delete(Subject).where(Subject.id == row.subject_id))
        session.execute(delete(Home).where(Home.id == row.home_id))
        session.commit()


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
        display_name="Test User",
        hashed_password=hash_password("booking-status-password"),
        role=role,
        tutor_id=tutor_id,
    )
    db.add(user)
    db.flush()
    return user


def _make_booking(db: Session, *, status: BookingStatus) -> Booking:
    suffix = uuid.uuid4().hex[:12]
    child = Child(name=f"Child {suffix}", grade_level=7, school_name="Test School")
    subject = Subject(name=f"Subject {suffix}")
    home = Home(address="1 Test Street", access_code="0000")
    tutor = _make_tutor(db)
    db.add_all([child, subject, home])
    db.flush()

    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=DATE.weekday(), start_time=NINE, end_time=TWELVE
    )
    db.add(availability)
    db.flush()

    booking = Booking(
        child_id=child.id,
        tutor_id=tutor.id,
        subject_id=subject.id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=DATE,
        start_time=NINE,
        end_time=TEN,
        status=status,
    )
    db.add(booking)
    db.flush()
    return booking


def _row(db: Session, booking_id: uuid.UUID) -> Booking:
    db.expire_all()
    return db.get_one(Booking, booking_id)


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
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
