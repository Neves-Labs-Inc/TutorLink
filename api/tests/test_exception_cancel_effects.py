"""Cancelling approved Time off gives the time back: Bookings stop warning `time_off` for it.

End to end over HTTP: the same Booking is refused with the warning while the Time off stands,
and accepted once its owner has cancelled it. (Slots are covered by
`test_slot_routes.test_only_an_approved_exception_subtracts_from_availability`.)
"""

import datetime
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services import clock
from app.services.booking_write_service import WarningCode

GRADE = 5
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
TWELVE = datetime.time(12, 0)


@dataclass(frozen=True, slots=True)
class World:
    tutor: Tutor
    subject: Subject
    child: Child
    home: Home
    availability_id: uuid.UUID
    day: datetime.date


def test_a_cancelled_approved_time_off_no_longer_warns_time_off(
    api: TestClient, db: Session
) -> None:
    world = _make_world(db)
    admin = _make_admin(db)
    owner = _sign_in(db, world.tutor.user)

    created = api.post(
        f"/api/users/{world.tutor.user_id}/exceptions",
        json={"start_date": world.day.isoformat(), "end_date": world.day.isoformat()},
        headers=_bearer(admin),
    )
    while_approved = _post_booking(api, admin, world)
    cancelled = api.post(f"/api/exceptions/{created.json()['id']}/cancel", headers=_bearer(owner))
    after_cancel = _post_booking(api, admin, world)

    assert created.json()["status"] == "approved"
    assert while_approved.status_code == 409
    assert [warning["code"] for warning in while_approved.json()["warnings"]] == [
        WarningCode.TIME_OFF.value
    ]
    assert cancelled.status_code == 200
    assert after_cancel.status_code == 201


def _post_booking(api: TestClient, user: User, world: World) -> Response:
    body: dict[str, Any] = {
        "child_id": str(world.child.id),
        "user_id": str(world.tutor.user_id),
        "kind": "regular",
        "location": "home",
        "subject_id": str(world.subject.id),
        "availability_id": str(world.availability_id),
        "home_id": str(world.home.id),
        "scheduled_date": world.day.isoformat(),
        "start_time": NINE.isoformat(),
        "end_time": TEN.isoformat(),
        "booked_by_guardian_id": None,
        "notes": None,
    }
    return api.post("/api/bookings", json=body, headers=_bearer(user))


def _make_world(db: Session) -> World:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(name=f"Guardian {suffix}", phone_number=f"+1{suffix[:10]}")
    home = Home(label="Home", address=f"{suffix[:6]} Main St", access_code="1234")
    child = Child(name=f"Child {suffix[:8]}", grade_level=GRADE, school_name="Test School")
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+2{suffix[:10]}",
    )
    subject = Subject(name=f"Subject {suffix[:8]}")
    db.add_all([guardian, home, child, tutor, subject])
    db.flush()

    # A week out: inside the booking window and past the lead time, whatever today is.
    day = clock.business_today() + datetime.timedelta(days=7)
    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=day.weekday(), start_time=NINE, end_time=TWELVE
    )
    db.add_all(
        [
            GuardianHome(guardian_id=guardian.id, home_id=home.id),
            ChildGuardian(child_id=child.id, guardian_id=guardian.id),
            TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=GRADE),
            availability,
        ]
    )
    db.flush()

    return World(
        tutor=tutor,
        subject=subject,
        child=child,
        home=home,
        availability_id=availability.id,
        day=day,
    )


def _make_admin(db: Session) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        name="Admin",
        hashed_password=hash_password("cancel-effects-password"),
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()
    return user


def _sign_in(db: Session, user: User) -> User:
    user.hashed_password = hash_password("cancel-effects-password")
    db.flush()
    return user


def _bearer(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}
