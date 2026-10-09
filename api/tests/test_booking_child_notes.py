"""`child.notes` on `GET /api/bookings/{id}` (REQ-126, OQ-52 answered (b), 2026-09-23).

The assigned tutor now sees a child's current notes on the session detail; the list stays
`{id, name}` (P7C-V, OQ-86) and the date of birth never reaches a tutor anywhere. Bookings are
inserted straight through the session, as `test_tutor_isolation.py` does: `POST /api/bookings`
is admin-only and reads scheduling settings this harness does not seed.
"""

import datetime
import uuid
from collections.abc import Mapping
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.dependencies import CREDENTIALS_ERROR, TUTOR_SCOPE_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password

MONDAY = datetime.date(2026, 9, 7)
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
TWELVE = datetime.time(12, 0)

CHILD_DATE_OF_BIRTH = datetime.date(2014, 5, 2)
CHILD_NOTES = "Peanut allergy"


@dataclass(frozen=True, slots=True)
class Family:
    guardian: Guardian
    child: Child
    tutor: Tutor
    subject: Subject
    home: Home
    availability_id: uuid.UUID


@pytest.fixture
def family(db: Session) -> Family:
    return _make_family(db)


def test_no_tutor_reachable_response_carries_a_date_of_birth_or_an_age(
    api: TestClient, db: Session, family: Family
) -> None:
    booking_id = _make_booking(db, family, start=NINE, end=TEN)
    tutor_headers = _bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id))

    listed = api.get("/api/bookings", headers=tutor_headers)
    detail = api.get(f"/api/bookings/{booking_id}", headers=tutor_headers)

    assert listed.status_code == 200
    assert detail.status_code == 200
    for keys in (_all_keys(listed.json()), _all_keys(detail.json())):
        assert "date_of_birth" not in keys
        assert "age" not in keys
    assert CHILD_DATE_OF_BIRTH.isoformat() not in listed.text
    assert CHILD_DATE_OF_BIRTH.isoformat() not in detail.text


def test_a_child_with_no_notes_shows_a_null_not_an_absent_key(
    api: TestClient, db: Session, family: Family
) -> None:
    family.child.notes = None
    db.flush()
    booking_id = _make_booking(db, family, start=NINE, end=TEN)
    tutor_headers = _bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id))

    detail = api.get(f"/api/bookings/{booking_id}", headers=tutor_headers)
    body = detail.json()

    assert detail.status_code == 200
    assert "notes" in body["child"]
    assert body["child"]["notes"] is None


def test_the_detail_shows_the_childs_current_notes_not_a_snapshot(
    api: TestClient, db: Session, family: Family
) -> None:
    booking_id = _make_booking(db, family, start=NINE, end=TEN)
    tutor_headers = _bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id))

    updated_notes = f"Updated notes {uuid.uuid4().hex}"
    family.child.notes = updated_notes
    db.flush()

    detail = api.get(f"/api/bookings/{booking_id}", headers=tutor_headers)

    assert detail.status_code == 200
    assert detail.json()["child"]["notes"] == updated_notes


@pytest.mark.parametrize("status", [BookingStatus.CANCELLED, BookingStatus.COMPLETED])
def test_child_notes_are_present_regardless_of_booking_status(
    api: TestClient, db: Session, family: Family, status: BookingStatus
) -> None:
    booking_id = _make_booking(db, family, start=NINE, end=TEN, status=status)
    tutor_headers = _bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id))

    detail = api.get(f"/api/bookings/{booking_id}", headers=tutor_headers)

    assert detail.status_code == 200
    assert detail.json()["child"]["notes"] == CHILD_NOTES


def test_child_notes_are_present_for_an_inactive_child(
    api: TestClient, db: Session, family: Family
) -> None:
    family.child.is_active = False
    db.flush()
    booking_id = _make_booking(db, family, start=NINE, end=TEN)
    tutor_headers = _bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id))

    detail = api.get(f"/api/bookings/{booking_id}", headers=tutor_headers)

    assert detail.status_code == 200
    assert detail.json()["child"]["notes"] == CHILD_NOTES


def test_an_admin_sees_the_same_child_notes_on_the_detail_and_id_name_on_every_list(
    api: TestClient, db: Session, family: Family
) -> None:
    booking_id = _make_booking(db, family, start=NINE, end=TEN)
    admin_headers = _bearer(_make_user(db, role=UserRole.ADMIN))

    detail = api.get(f"/api/bookings/{booking_id}", headers=admin_headers)
    listed = api.get("/api/bookings", headers=admin_headers)
    client_bookings = api.get(f"/api/clients/{family.guardian.id}/bookings", headers=admin_headers)
    stats = api.get("/api/stats/overview?date=2026-09-07", headers=admin_headers)

    assert detail.status_code == 200
    assert set(detail.json()["child"]) == {"id", "name", "notes"}
    assert detail.json()["child"]["notes"] == CHILD_NOTES

    assert listed.status_code == 200
    assert [set(row["child"]) for row in listed.json()["items"]] == [{"id", "name"}]

    assert client_bookings.status_code == 200
    assert [set(row["child"]) for row in client_bookings.json()["items"]] == [{"id", "name"}]

    assert stats.status_code == 200
    assert [set(row["child"]) for row in stats.json()["recent_bookings"]] == [{"id", "name"}]


def test_the_detail_is_401_with_no_token_and_403_for_a_tutor_with_no_tutor_id(
    api: TestClient, db: Session, family: Family
) -> None:
    booking_id = _make_booking(db, family, start=NINE, end=TEN)
    unlinked_headers = _bearer(_make_user(db, role=UserRole.TUTOR, tutor_id=None))

    anonymous = api.get(f"/api/bookings/{booking_id}")
    unlinked = api.get(f"/api/bookings/{booking_id}", headers=unlinked_headers)

    assert anonymous.status_code == 401
    assert anonymous.json() == {"detail": CREDENTIALS_ERROR}
    assert unlinked.status_code == 403
    assert unlinked.json() == {"detail": TUTOR_SCOPE_ERROR}


def _all_keys(obj: object) -> set[str]:
    keys: set[str] = set()
    if isinstance(obj, Mapping):
        keys.update(obj.keys())
        for value in obj.values():
            keys.update(_all_keys(value))
    elif isinstance(obj, list):
        for item in obj:
            keys.update(_all_keys(item))

    return keys


def _make_family(db: Session) -> Family:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    subject = Subject(name=f"Subject {suffix}")
    guardian = Guardian(name=f"Guardian {suffix}", phone_number=f"+2{suffix[:10]}")
    home = Home(address=f"{suffix} Test Street", access_code="0000")
    child = Child(
        name=f"Child {suffix}",
        date_of_birth=CHILD_DATE_OF_BIRTH,
        grade_level=7,
        school_name="Test School",
        notes=CHILD_NOTES,
    )
    db.add_all([tutor, subject, guardian, home, child])
    db.flush()
    db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=MONDAY.weekday(), start_time=NINE, end_time=TWELVE
    )
    db.add(availability)
    db.flush()

    return Family(
        guardian=guardian,
        child=child,
        tutor=tutor,
        subject=subject,
        home=home,
        availability_id=availability.id,
    )


def _make_booking(
    db: Session,
    family: Family,
    *,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus = BookingStatus.PENDING,
) -> uuid.UUID:
    booking = Booking(
        child_id=family.child.id,
        tutor_id=family.tutor.id,
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

    return booking.id


def _make_user(db: Session, *, role: UserRole, tutor_id: uuid.UUID | None = None) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password("child-notes-password"),
            role=role,
            is_active=True,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("child-notes-password")
        user.role = role
        user.is_active = True
    db.flush()

    return user


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}
