"""Deactivating a child or a home against a concurrent booking of it, on two real connections
(P7C-S).

The rolled-back `db` fixture shares one transaction, so two requests through it run one after
the other and can never contend for a row lock (Phase 3 decision D-J) — these tests would pass
with every lock removed. Instead every request here opens and commits its own session, the
world is committed up front and deleted afterwards, and the two requests run on two threads.

Both orders are proved, and each assertion on elapsed time is what shows the second request
actually waited rather than winning a sequential race:

- **booking first** — the booking holds the child `FOR SHARE` past `_resolve`; the
  deactivation, sent with the count from before that booking, waits on the child, then counts
  the new booking and refuses with 409. The child stays active, the booking stays live.
- **deactivation first** — the deactivation holds the child `FOR UPDATE` until it commits; the
  booking waits on the child, then sees it inactive and refuses with the reference 400.

With `_resolve`'s `FOR SHARE` on the child removed, both fail: the first because the
deactivation no longer waits and cancels one session while a second commits behind it, the second
because the booking's foreign key only waits for the deactivation and then inserts a live session
for an inactive child.

The same two orders are run against `PATCH /api/homes/{id}`, whose guard refuses while a booking
at the home is upcoming: booking first, the guard waits and then sees it (409); deactivation
first, the booking waits and then sees the home inactive (400). They book at `spare_home_id`, a
second home of the child with nothing on it, so the guard has nothing to find but the racing
booking. Without the home's `FOR SHARE` they fail the same two ways.

The rollback of a half-done cancel lives here too: it needs a request whose session really is
closed without a commit, which only this harness gives.
"""

import datetime
import threading
import time
import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.routers import children as children_router
from app.routers import homes as homes_router
from app.routers.booking_writes import REFERENCE_NOT_FOUND_ERROR
from app.routers.children import UPCOMING_SESSIONS_CHANGED_ERROR
from app.routers.homes import HOME_HAS_UPCOMING_BOOKINGS_ERROR
from app.security import create_access_token, hash_password
from app.services import booking_status_service, booking_write_service

HOLD_SECONDS = 0.5
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)
THIRTEEN = datetime.time(13, 0)


def _next_monday() -> datetime.date:
    """Between one and seven days out, inside every booking window the settings allow."""
    today = datetime.datetime.now(tz=datetime.UTC).date()

    return today + datetime.timedelta(days=(0 - today.weekday()) % 7 or 7)


MONDAY = _next_monday()


@dataclass(frozen=True, slots=True)
class World:
    admin: User
    child_id: uuid.UUID
    tutor_id: uuid.UUID
    subject_id: uuid.UUID
    availability_id: uuid.UUID
    home_id: uuid.UUID
    spare_home_id: uuid.UUID
    guardian_id: uuid.UUID


def test_a_deactivation_behind_an_open_booking_waits_then_refuses_the_stale_count(
    session_per_request_api: TestClient,
    committed_sessions: sessionmaker[Session],
    world: World,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a_resolved = threading.Event()
    booked: list[Response] = []
    deactivated: list[Response] = []
    b_elapsed: list[float] = []
    resolve = booking_write_service._resolve

    def resolve_then_hold(*args: Any, **kwargs: Any) -> Any:
        context = resolve(*args, **kwargs)
        a_resolved.set()
        time.sleep(HOLD_SECONDS)
        return context

    monkeypatch.setattr(booking_write_service, "_resolve", resolve_then_hold)

    def book() -> None:
        booked.append(
            _post_booking(
                session_per_request_api, world, home_id=world.home_id, start=ELEVEN, end=TWELVE
            )
        )

    def deactivate() -> None:
        a_resolved.wait(timeout=5)
        start = time.monotonic()
        deactivated.append(_deactivate(session_per_request_api, world, expected=1))
        b_elapsed.append(time.monotonic() - start)

    _run_concurrently(book, deactivate)

    assert booked[0].status_code == 201
    assert b_elapsed[0] >= HOLD_SECONDS * 0.8
    assert deactivated[0].status_code == 409
    assert deactivated[0].json() == {"detail": UPCOMING_SESSIONS_CHANGED_ERROR}
    with committed_sessions() as session:
        assert session.get_one(Child, world.child_id).is_active is True
        assert _statuses(session, world.child_id) == [
            BookingStatus.CONFIRMED,
            BookingStatus.CONFIRMED,
        ]


def test_a_booking_behind_an_open_deactivation_waits_then_is_refused(
    session_per_request_api: TestClient,
    committed_sessions: sessionmaker[Session],
    world: World,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    b_locked = threading.Event()
    booked: list[Response] = []
    deactivated: list[Response] = []
    a_elapsed: list[float] = []
    update_child = children_router.update_child

    def update_then_hold(*args: Any, **kwargs: Any) -> Child:
        child = update_child(*args, **kwargs)
        b_locked.set()
        time.sleep(HOLD_SECONDS)
        return child

    monkeypatch.setattr(children_router, "update_child", update_then_hold)

    def deactivate() -> None:
        deactivated.append(_deactivate(session_per_request_api, world, expected=1))

    def book() -> None:
        b_locked.wait(timeout=5)
        start = time.monotonic()
        booked.append(
            _post_booking(
                session_per_request_api, world, home_id=world.home_id, start=ELEVEN, end=TWELVE
            )
        )
        a_elapsed.append(time.monotonic() - start)

    _run_concurrently(deactivate, book)

    assert deactivated[0].status_code == 200
    assert a_elapsed[0] >= HOLD_SECONDS * 0.8
    assert booked[0].status_code == 400
    assert booked[0].json() == {"detail": REFERENCE_NOT_FOUND_ERROR}
    with committed_sessions() as session:
        assert session.get_one(Child, world.child_id).is_active is False
        assert _statuses(session, world.child_id) == [BookingStatus.CANCELLED]


def test_a_cancel_that_fails_part_way_leaves_the_child_and_every_session_as_they_were(
    session_per_request_api: TestClient,
    committed_sessions: sessionmaker[Session],
    world: World,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The router's single commit is the only one: a failure on the second cancellation must
    take the first one, and the deactivation, down with it."""
    with committed_sessions() as session:
        _add_booking(session, world, start=ELEVEN, end=TWELVE)
        session.commit()
    change_status = booking_status_service.change_status
    calls: list[uuid.UUID] = []

    def fail_on_second_call(db: Session, *, booking_id: uuid.UUID, target: BookingStatus) -> Any:
        calls.append(booking_id)
        if len(calls) == 2:
            raise RuntimeError("the second cancellation failed")
        return change_status(db, booking_id=booking_id, target=target)

    monkeypatch.setattr(booking_status_service, "change_status", fail_on_second_call)

    with pytest.raises(RuntimeError):
        _deactivate(session_per_request_api, world, expected=2)

    assert len(calls) == 2
    with committed_sessions() as session:
        assert session.get_one(Child, world.child_id).is_active is True
        assert _statuses(session, world.child_id) == [
            BookingStatus.CONFIRMED,
            BookingStatus.CONFIRMED,
        ]


def test_a_home_deactivation_behind_an_open_booking_waits_then_sees_it(
    session_per_request_api: TestClient,
    committed_sessions: sessionmaker[Session],
    world: World,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    a_resolved = threading.Event()
    booked: list[Response] = []
    deactivated: list[Response] = []
    b_elapsed: list[float] = []
    resolve = booking_write_service._resolve

    def resolve_then_hold(*args: Any, **kwargs: Any) -> Any:
        context = resolve(*args, **kwargs)
        a_resolved.set()
        time.sleep(HOLD_SECONDS)
        return context

    monkeypatch.setattr(booking_write_service, "_resolve", resolve_then_hold)

    def book() -> None:
        booked.append(
            _post_booking(
                session_per_request_api,
                world,
                home_id=world.spare_home_id,
                start=ELEVEN,
                end=TWELVE,
            )
        )

    def deactivate() -> None:
        a_resolved.wait(timeout=5)
        start = time.monotonic()
        deactivated.append(_deactivate_home(session_per_request_api, world))
        b_elapsed.append(time.monotonic() - start)

    _run_concurrently(book, deactivate)

    assert booked[0].status_code == 201
    assert b_elapsed[0] >= HOLD_SECONDS * 0.8
    assert deactivated[0].status_code == 409
    assert deactivated[0].json() == {"detail": HOME_HAS_UPCOMING_BOOKINGS_ERROR}
    with committed_sessions() as session:
        assert session.get_one(Home, world.spare_home_id).is_active is True
        assert _statuses_at(session, world.spare_home_id) == [BookingStatus.CONFIRMED]


def test_a_booking_behind_an_open_home_deactivation_waits_then_is_refused(
    session_per_request_api: TestClient,
    committed_sessions: sessionmaker[Session],
    world: World,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    b_locked = threading.Event()
    booked: list[Response] = []
    deactivated: list[Response] = []
    a_elapsed: list[float] = []
    update_home = homes_router.update_home

    def update_then_hold(*args: Any, **kwargs: Any) -> Home:
        home = update_home(*args, **kwargs)
        b_locked.set()
        time.sleep(HOLD_SECONDS)
        return home

    monkeypatch.setattr(homes_router, "update_home", update_then_hold)

    def deactivate() -> None:
        deactivated.append(_deactivate_home(session_per_request_api, world))

    def book() -> None:
        b_locked.wait(timeout=5)
        start = time.monotonic()
        booked.append(
            _post_booking(
                session_per_request_api,
                world,
                home_id=world.spare_home_id,
                start=ELEVEN,
                end=TWELVE,
            )
        )
        a_elapsed.append(time.monotonic() - start)

    _run_concurrently(deactivate, book)

    assert deactivated[0].status_code == 200
    assert a_elapsed[0] >= HOLD_SECONDS * 0.8
    assert booked[0].status_code == 400
    assert booked[0].json() == {"detail": REFERENCE_NOT_FOUND_ERROR}
    with committed_sessions() as session:
        assert session.get_one(Home, world.spare_home_id).is_active is False
        assert _statuses_at(session, world.spare_home_id) == []


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def session_per_request_api(
    committed_sessions: sessionmaker[Session],
) -> Generator[TestClient, None, None]:
    """One session per request, closed without a commit on failure — what `get_db` does."""
    from app.db import get_db
    from app.main import app

    def open_and_close_one_session_per_request() -> Generator[Session, None, None]:
        session = committed_sessions()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = open_and_close_one_session_per_request
    try:
        yield TestClient(app)
    finally:
        del app.dependency_overrides[get_db]


@pytest.fixture
def world(committed_sessions: sessionmaker[Session]) -> Generator[World, None, None]:
    """A bookable child with one upcoming confirmed session at `home_id` and none at
    `spare_home_id`, committed, and deleted afterwards — including whatever booking a test adds
    for it."""
    with committed_sessions() as session:
        created = _make_world(session)
        session.commit()
    try:
        yield created
    finally:
        _delete_world(committed_sessions, created)


def _make_world(session: Session) -> World:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(name=f"Guardian {suffix}", phone_number=f"+1{suffix[:10]}")
    home = Home(address=f"{suffix[:6]} Race Street", access_code="1234")
    spare_home = Home(address=f"{suffix[:6]} Spare Street", access_code="1234")
    child = Child(name=f"Child {suffix}", grade_level=7, school_name="Test School")
    tutor = Tutor(
        user=User(email=f"t-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[-10:]}",
    )
    subject = Subject(name=f"Subject {suffix}")
    admin = User(
        email=f"admin-{suffix}@example.com",
        name="Test User",
        hashed_password=hash_password("race-password"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    session.add_all([guardian, home, spare_home, child, tutor, subject, admin])
    session.flush()
    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=MONDAY.weekday(), start_time=NINE, end_time=THIRTEEN
    )
    session.add_all(
        [
            availability,
            ChildGuardian(child_id=child.id, guardian_id=guardian.id),
            ChildHome(child_id=child.id, home_id=home.id),
            ChildHome(child_id=child.id, home_id=spare_home.id),
            TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=8),
        ]
    )
    session.flush()
    world = World(
        admin=admin,
        child_id=child.id,
        tutor_id=tutor.id,
        subject_id=subject.id,
        availability_id=availability.id,
        home_id=home.id,
        spare_home_id=spare_home.id,
        guardian_id=guardian.id,
    )
    _add_booking(session, world, start=NINE, end=TEN)

    return world


def _add_booking(
    session: Session, world: World, *, start: datetime.time, end: datetime.time
) -> uuid.UUID:
    booking = Booking(
        child_id=world.child_id,
        tutor_id=world.tutor_id,
        subject_id=world.subject_id,
        availability_id=world.availability_id,
        home_id=world.home_id,
        scheduled_date=MONDAY,
        start_time=start,
        end_time=end,
        status=BookingStatus.CONFIRMED,
    )
    session.add(booking)
    session.flush()

    return booking.id


def _delete_world(sessions: sessionmaker[Session], world: World) -> None:
    with sessions() as session:
        session.execute(delete(Booking).where(Booking.child_id == world.child_id))
        session.execute(delete(TutorSubject).where(TutorSubject.tutor_id == world.tutor_id))
        session.execute(
            delete(TutorAvailability).where(TutorAvailability.tutor_id == world.tutor_id)
        )
        session.execute(delete(ChildGuardian).where(ChildGuardian.child_id == world.child_id))
        session.execute(delete(ChildHome).where(ChildHome.child_id == world.child_id))
        session.execute(delete(Child).where(Child.id == world.child_id))
        tutor_user_id = session.scalar(select(Tutor.user_id).where(Tutor.id == world.tutor_id))
        session.execute(delete(Tutor).where(Tutor.id == world.tutor_id))
        session.execute(delete(Subject).where(Subject.id == world.subject_id))
        session.execute(delete(Home).where(Home.id.in_([world.home_id, world.spare_home_id])))
        session.execute(delete(Guardian).where(Guardian.id == world.guardian_id))
        session.execute(delete(User).where(User.id.in_([world.admin.id, tutor_user_id])))
        session.commit()


def _run_concurrently(first: Callable[[], None], second: Callable[[], None]) -> None:
    threads = [threading.Thread(target=first), threading.Thread(target=second)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)


def _post_booking(
    api: TestClient,
    world: World,
    *,
    home_id: uuid.UUID,
    start: datetime.time,
    end: datetime.time,
) -> Response:
    return api.post(
        "/api/bookings",
        headers=_auth(world.admin),
        json={
            "child_id": str(world.child_id),
            "tutor_id": str(world.tutor_id),
            "subject_id": str(world.subject_id),
            "availability_id": str(world.availability_id),
            "home_id": str(home_id),
            "scheduled_date": MONDAY.isoformat(),
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "booked_by_guardian_id": None,
            "notes": None,
        },
    )


def _deactivate(api: TestClient, world: World, *, expected: int) -> Response:
    return api.patch(
        f"/api/children/{world.child_id}",
        headers=_auth(world.admin),
        json={"is_active": False, "expected_cancellations": expected},
    )


def _deactivate_home(api: TestClient, world: World) -> Response:
    return api.patch(
        f"/api/homes/{world.spare_home_id}", headers=_auth(world.admin), json={"is_active": False}
    )


def _statuses_at(session: Session, home_id: uuid.UUID) -> list[BookingStatus]:
    return list(session.scalars(select(Booking.status).where(Booking.home_id == home_id)))


def _statuses(session: Session, child_id: uuid.UUID) -> list[BookingStatus]:
    return list(
        session.scalars(
            select(Booking.status).where(Booking.child_id == child_id).order_by(Booking.start_time)
        )
    )


def _auth(user: User) -> dict[str, str]:
    # Every caller here is Office with no profile, and the row is detached by now: no lazy
    # load of `profile`. The principal reads the row on every request anyway.
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=None)

    return {"Authorization": f"Bearer {token}"}
