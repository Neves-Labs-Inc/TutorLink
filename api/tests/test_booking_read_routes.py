"""`GET /api/bookings` and `GET /api/bookings/{id}`, exercised over HTTP.

`GET /api/bookings` is the one Phase-4 route where `TutorScope` is correct: a tutor sees only
their own bookings and a populated response for a tutor caller proves the scope was actually
read (`TutorScopeNotApplied` would otherwise 500 it). `GET /api/bookings/{id}` takes
`Principal` instead and checks ownership after loading, per every negative case asserting the
exact `{"detail": "..."}` body, as in `test_exception_routes.py`.
"""

import datetime
import uuid
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import CREDENTIALS_ERROR, TUTOR_SCOPE_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.bookings import BOOKING_NOT_FOUND_ERROR
from app.security import create_access_token, hash_password

DATE = datetime.date(2026, 9, 7)
LATER = datetime.date(2026, 9, 8)
LATEST = datetime.date(2026, 9, 9)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)


@dataclass(frozen=True, slots=True)
class Family:
    guardian: Guardian
    co_guardian: Guardian
    child: Child
    tutor: Tutor
    other_tutor: Tutor
    subject: Subject
    home: Home
    other_home: Home
    availability_id: uuid.UUID
    other_availability_id: uuid.UUID


# --- the #130 read shape: Staff, kind, Location ----------------------------------------------


def test_a_summary_names_its_staff_member_kind_and_location(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["staff"] == {
        "id": str(family.tutor.user_id),
        "name": family.tutor.user.name,
        "role": "tutor",
    }
    assert item["kind"] == "regular"
    assert item["location"] == "home"
    assert item["subject"] == {"id": str(family.subject.id), "name": family.subject.name}
    assert datetime.datetime.fromisoformat(item["updated_at"]) == booking.updated_at
    assert "tutor" not in item


def test_the_detail_of_an_office_evaluation_has_no_subject_and_no_home(
    api: TestClient, db: Session, family: Family
) -> None:
    """The two nullable refs, on the one shape that nulls both; written by hand because the
    write path refuses it until ticket 05."""
    admin = _make_user(db)
    evaluation = _evaluation(db, family, staff=admin)

    body = api.get(f"/api/bookings/{evaluation.id}", headers=_auth(admin)).json()

    assert body["staff"] == {"id": str(admin.id), "name": admin.name, "role": "admin"}
    assert body["kind"] == "evaluation"
    assert body["location"] == "in_office"
    assert body["subject"] is None
    assert body["home"] is None
    assert datetime.datetime.fromisoformat(body["updated_at"]) == evaluation.updated_at


def test_an_office_evaluation_is_listed_with_a_null_subject(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _evaluation(db, family, staff=admin)

    item = api.get("/api/bookings", headers=_auth(admin)).json()["items"][0]

    assert item["subject"] is None
    assert item["staff"]["role"] == "admin"


def test_admin_filtering_by_tutor_id_reaches_the_profiles_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    """`?tutor_id=` is still the profile's id, resolved to the Staff member's user: the scope
    parameter did not change shape when the column did (#130)."""
    admin = _make_user(db)
    own = _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)

    body = api.get(f"/api/bookings?tutor_id={family.tutor.id}", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(own.id)]
    assert body["total"] == 1


def _evaluation(db: Session, family: Family, *, staff: User) -> Booking:
    booking = Booking(
        child_id=family.child.id,
        user_id=staff.id,
        kind=BookingKind.EVALUATION,
        location=BookingLocation.IN_OFFICE,
        scheduled_date=DATE,
        start_time=TEN,
        end_time=ELEVEN,
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()

    return booking


@pytest.fixture
def family(db: Session) -> Family:
    return _make_family(db)


def test_list_returns_the_page_envelope_never_a_bare_array(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family)

    body = api.get("/api/bookings", headers=_auth(user)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1


def test_tutor_sees_only_their_own_bookings(api: TestClient, db: Session, family: Family) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    mine = _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)

    body = api.get("/api/bookings", headers=_auth(user)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_tutor_naming_another_tutor_id_is_403(api: TestClient, db: Session, family: Family) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family, tutor=family.other_tutor)

    response = api.get(f"/api/bookings?tutor_id={family.other_tutor.id}", headers=_auth(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_tutor_naming_their_own_id_is_the_same_as_omitting_it(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    mine = _book(db, family, tutor=family.tutor)

    omitted = api.get("/api/bookings", headers=_auth(user)).json()
    named = api.get(f"/api/bookings?tutor_id={family.tutor.id}", headers=_auth(user)).json()

    assert [row["id"] for row in omitted["items"]] == [str(mine.id)]
    assert named == omitted


def test_admin_with_no_filter_sees_every_tutors_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    first = _book(db, family, tutor=family.tutor)
    second = _book(db, family, tutor=family.other_tutor)

    body = api.get("/api/bookings", headers=_auth(admin)).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {str(first.id), str(second.id)}


def test_repeated_status_values_are_ored(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    pending = _book(db, family, on=DATE, status=BookingStatus.PENDING)
    confirmed = _book(db, family, on=LATER, status=BookingStatus.CONFIRMED)
    _book(db, family, on=LATEST, status=BookingStatus.CANCELLED)

    body = api.get("/api/bookings?status=pending&status=confirmed", headers=_auth(admin)).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {str(pending.id), str(confirmed.id)}


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("", [DATE, LATER, LATEST]),
        ("?from=2026-09-08", [LATER, LATEST]),
        ("?to=2026-09-08", [DATE, LATER]),
        ("?from=2026-09-08&to=2026-09-08", [LATER]),
    ],
)
def test_the_date_bounds_are_inclusive_and_either_may_stand_alone(
    api: TestClient,
    db: Session,
    family: Family,
    query: str,
    expected: list[datetime.date],
) -> None:
    admin = _make_user(db)
    for on in (DATE, LATER, LATEST):
        _book(db, family, on=on)

    body = api.get(f"/api/bookings{query}", headers=_auth(admin)).json()

    assert [row["scheduled_date"] for row in body["items"]] == [str(on) for on in expected]
    assert body["total"] == len(expected)


def test_an_inverted_range_selects_nothing_and_is_not_an_error(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=DATE)

    response = api.get("/api/bookings?from=2026-09-09&to=2026-09-07", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}


def test_filtering_by_child_id_returns_only_that_childs_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    other_child = _make_child(db, guardians=[family.guardian])
    mine = _book(db, family)
    _book(db, family, child=other_child, start=ELEVEN, end=TWELVE)

    body = api.get(f"/api/bookings?child_id={family.child.id}", headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_child_id_composes_with_status_and_date_range(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    other_child = _make_child(db, guardians=[family.guardian])
    matching = _book(db, family, on=LATER, status=BookingStatus.CONFIRMED)
    _book(db, family, on=LATER, status=BookingStatus.PENDING, start=ELEVEN, end=TWELVE)
    _book(
        db,
        family,
        child=other_child,
        on=LATER,
        status=BookingStatus.CONFIRMED,
        start=NINE,
        end=TEN,
    )

    query = f"?child_id={family.child.id}&status=confirmed&from=2026-09-08&to=2026-09-08"
    body = api.get(f"/api/bookings{query}", headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(matching.id)]


def test_an_unknown_child_id_is_an_empty_page_not_an_error(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family)

    response = api.get(f"/api/bookings?child_id={uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}


def test_a_malformed_child_id_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/bookings?child_id=not-a-uuid", headers=_auth(admin))

    assert response.status_code == 400
    body = response.json()
    assert isinstance(body["detail"], str)


def test_tutor_filtering_by_child_id_sees_only_their_own_bookings_of_that_child(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    mine = _book(db, family, tutor=family.tutor)
    _book(db, family, tutor=family.other_tutor)

    body = api.get(f"/api/bookings?child_id={family.child.id}", headers=_auth(user)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_tutor_naming_another_tutor_id_with_child_id_is_still_403(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family, tutor=family.other_tutor)

    response = api.get(
        f"/api/bookings?child_id={family.child.id}&tutor_id={family.other_tutor.id}",
        headers=_auth(user),
    )

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_bookings_are_ordered_by_date_then_start_time(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=LATER, start=TEN, end=ELEVEN)
    _book(db, family, on=DATE, start=ELEVEN, end=TWELVE)
    _book(db, family, on=DATE, start=NINE, end=TEN)

    body = api.get("/api/bookings", headers=_auth(admin)).json()

    assert [(row["scheduled_date"], row["start_time"]) for row in body["items"]] == [
        ("2026-09-07", "09:00:00"),
        ("2026-09-07", "11:00:00"),
        ("2026-09-08", "10:00:00"),
    ]


def test_get_by_id_returns_the_bookings_own_home_not_the_first_one(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family, home=family.other_home)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["home"]["address"] == family.other_home.address
    assert body["home"]["access_code"] == family.other_home.access_code


def test_get_by_id_with_no_booking_guardian_is_null(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family, booked_by=None)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["booked_by_guardian"] is None


def test_get_by_id_with_a_booking_guardian_names_them(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    booking = _book(db, family, booked_by=family.guardian)

    body = api.get(f"/api/bookings/{booking.id}", headers=_auth(admin)).json()

    assert body["booked_by_guardian"] == {
        "id": str(family.guardian.id),
        "name": family.guardian.name,
    }


def test_tutor_reading_their_own_booking_succeeds(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    booking = _book(db, family, tutor=family.tutor)

    response = api.get(f"/api/bookings/{booking.id}", headers=_auth(user))

    assert response.status_code == 200
    assert response.json()["id"] == str(booking.id)


def test_tutor_reading_another_tutors_booking_is_403(
    api: TestClient, db: Session, family: Family
) -> None:
    user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    booking = _book(db, family, tutor=family.other_tutor)

    response = api.get(f"/api/bookings/{booking.id}", headers=_auth(user))

    _assert_detail(response, 403, TUTOR_SCOPE_ERROR)


def test_an_unknown_booking_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/bookings/{uuid.uuid4()}", headers=_auth(admin))

    _assert_detail(response, 404, BOOKING_NOT_FOUND_ERROR)


def test_no_token_on_list_is_401(api: TestClient, db: Session) -> None:
    response = api.get("/api/bookings")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_no_token_on_get_by_id_is_401(api: TestClient, db: Session, family: Family) -> None:
    booking = _book(db, family)

    response = api.get(f"/api/bookings/{booking.id}")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_a_developer_may_list_and_read_any_booking(
    api: TestClient, db: Session, family: Family
) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    booking = _book(db, family)

    listed = api.get("/api/bookings", headers=_auth(developer))
    fetched = api.get(f"/api/bookings/{booking.id}", headers=_auth(developer))

    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()["items"]] == [str(booking.id)]
    assert fetched.status_code == 200


def _make_family(db: Session) -> Family:
    guardian = _make_guardian(db)
    co_guardian = _make_guardian(db)
    tutor = _make_tutor(db)
    other_tutor = _make_tutor(db)
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    home = Home(address="1 Test Street", access_code="0000")
    other_home = Home(address="2 Test Avenue", access_code="1111")
    db.add_all([subject, home, other_home])
    db.flush()
    child = _make_child(db, guardians=[guardian, co_guardian])

    return Family(
        guardian=guardian,
        co_guardian=co_guardian,
        child=child,
        tutor=tutor,
        other_tutor=other_tutor,
        subject=subject,
        home=home,
        other_home=other_home,
        availability_id=_make_availability(db, tutor.id),
        other_availability_id=_make_availability(db, other_tutor.id),
    )


def _book(
    db: Session,
    family: Family,
    *,
    tutor: Tutor | None = None,
    home: Home | None = None,
    child: Child | None = None,
    on: datetime.date = DATE,
    start: datetime.time = TEN,
    end: datetime.time = ELEVEN,
    status: BookingStatus = BookingStatus.PENDING,
    booked_by: Guardian | None = None,
) -> Booking:
    booked_tutor = tutor or family.tutor
    booking = Booking(
        child_id=(child or family.child).id,
        user_id=booked_tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=family.subject.id,
        availability_id=(
            family.availability_id
            if booked_tutor.id == family.tutor.id
            else family.other_availability_id
        ),
        home_id=(home or family.home).id,
        booked_by_guardian_id=None if booked_by is None else booked_by.id,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


def _make_guardian(db: Session) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(name=f"Guardian {suffix}", phone_number=f"+1{suffix[:10]}")
    db.add(guardian)
    db.flush()

    return guardian


def _make_child(db: Session, *, guardians: list[Guardian]) -> Child:
    suffix = uuid.uuid4().hex[:12]
    child = Child(name=f"Child {suffix}", grade_level=7, school_name="Test School")
    db.add(child)
    db.flush()
    db.add_all([ChildGuardian(child_id=child.id, guardian_id=one.id) for one in guardians])
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


def _make_availability(db: Session, tutor_id: uuid.UUID) -> uuid.UUID:
    availability = TutorAvailability(
        tutor_id=tutor_id, day_of_week=DATE.weekday(), start_time=NINE, end_time=TWELVE
    )
    db.add(availability)
    db.flush()

    return availability.id


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password("booking-read-password"),
            role=role,
            is_active=True,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password("booking-read-password")
        user.role = role
        user.is_active = True
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    body = response.json()
    assert body == {"detail": expected_detail}
    assert isinstance(body["detail"], str)
