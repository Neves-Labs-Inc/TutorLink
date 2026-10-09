"""`Child.is_active` (migration 0016, P7C-1) and `upcoming_live_bookings`, the one definition of
"upcoming" that CW and CR both import (P7C-T).
"""

import datetime
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking, upcoming_live_bookings
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.guardian import Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password
from tests.support import user_id_of

PASSWORD = "correct horse battery staple"
NOW = datetime.datetime(2026, 9, 23, 10, 0)


def _phone() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"


def _make_guardian(db: Session) -> Guardian:
    guardian = Guardian(name=f"Guardian {uuid.uuid4().hex[:8]}", phone_number=_phone())
    db.add(guardian)
    db.flush()
    return guardian


def _make_home(db: Session) -> Home:
    home = Home(address=f"{uuid.uuid4().hex[:6]} Elm Street", access_code="1234")
    db.add(home)
    db.flush()
    return home


def _make_admin(db: Session) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"t-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_availability(db: Session, *, tutor_id: uuid.UUID) -> TutorAvailability:
    row = TutorAvailability(
        tutor_id=tutor_id,
        day_of_week=0,
        start_time=datetime.time(0, 0),
        end_time=datetime.time(23, 0),
    )
    db.add(row)
    db.flush()
    return row


def _make_booking(
    db: Session,
    *,
    child: Child,
    tutor_id: uuid.UUID,
    availability_id: uuid.UUID,
    home_id: uuid.UUID,
    scheduled_date: datetime.date,
    start_time: datetime.time,
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> Booking:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()
    booking = Booking(
        child_id=child.id,
        user_id=user_id_of(db, tutor_id),
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=subject.id,
        availability_id=availability_id,
        home_id=home_id,
        scheduled_date=scheduled_date,
        start_time=start_time,
        end_time=datetime.time(start_time.hour + 1, start_time.minute),
        status=status,
    )
    db.add(booking)
    db.flush()
    return booking


def test_a_child_inserted_without_is_active_reads_back_true(db: Session) -> None:
    child = Child(name="Tommy Doe", grade_level=7, school_name="Lincoln Middle School")
    db.add(child)
    db.flush()
    db.expire_all()

    assert db.get_one(Child, child.id).is_active is True


def test_post_children_returns_is_active_true(api: TestClient, db: Session) -> None:
    admin = _make_admin(db)
    guardian, home = _make_guardian(db), _make_home(db)

    response = api.post(
        "/api/children",
        headers=_auth(admin),
        json={
            "guardian_ids": [str(guardian.id)],
            "home_ids": [str(home.id)],
            "name": "Tommy Doe",
            "date_of_birth": "2014-05-02",
            "grade_level": 7,
            "school_name": "Lincoln Middle School",
        },
    )

    assert response.status_code == 201
    assert response.json()["is_active"] is True


def test_get_client_nests_the_childs_is_active(api: TestClient, db: Session) -> None:
    admin = _make_admin(db)
    guardian, home = _make_guardian(db), _make_home(db)
    child_id = uuid.UUID(
        api.post(
            "/api/children",
            headers=_auth(admin),
            json={
                "guardian_ids": [str(guardian.id)],
                "home_ids": [str(home.id)],
                "name": "Tommy Doe",
                "date_of_birth": "2014-05-02",
                "grade_level": 7,
                "school_name": "Lincoln Middle School",
            },
        ).json()["id"]
    )

    response = api.get(f"/api/clients/{guardian.id}", headers=_auth(admin))

    nested = next(row for row in response.json()["children"] if row["id"] == str(child_id))
    assert nested["is_active"] is True


def test_upcoming_live_bookings(db: Session) -> None:
    tutor = _make_tutor(db)
    availability = _make_availability(db, tutor_id=tutor.id)
    child = Child(name="Kid", grade_level=5, school_name="Test School")
    home = _make_home(db)
    db.add(child)
    db.flush()

    later_today = _make_booking(
        db,
        child=child,
        tutor_id=tutor.id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=NOW.date(),
        start_time=datetime.time(11, 0),
    )
    earlier_today = _make_booking(
        db,
        child=child,
        tutor_id=tutor.id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=NOW.date(),
        start_time=datetime.time(9, 0),
    )
    at_now = _make_booking(
        db,
        child=child,
        tutor_id=tutor.id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=NOW.date(),
        start_time=NOW.time(),
    )
    tomorrow = _make_booking(
        db,
        child=child,
        tutor_id=tutor.id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=NOW.date() + datetime.timedelta(days=1),
        start_time=datetime.time(9, 0),
    )
    cancelled = _make_booking(
        db,
        child=child,
        tutor_id=tutor.id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=NOW.date() + datetime.timedelta(days=1),
        start_time=datetime.time(10, 0),
        status=BookingStatus.CANCELLED,
    )

    upcoming = set(db.scalars(select(Booking.id).where(upcoming_live_bookings(NOW))).all())

    assert upcoming == {later_today.id, tomorrow.id}
    assert earlier_today.id not in upcoming
    assert at_now.id not in upcoming
    assert cancelled.id not in upcoming
