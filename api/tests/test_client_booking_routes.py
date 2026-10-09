import datetime
import uuid
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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

PASSWORD = "correct horse battery staple"

DATE = datetime.date(2026, 9, 7)
LATER = datetime.date(2026, 9, 8)
LATEST = datetime.date(2026, 9, 9)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)


@dataclass(frozen=True, slots=True)
class Family:
    client: Guardian
    co_guardian: Guardian
    child: Child
    sibling: Child
    tutor: Tutor
    other_tutor: Tutor
    subject: Subject
    home: Home
    availability_id: uuid.UUID
    other_availability_id: uuid.UUID


@pytest.fixture
def family(db: Session) -> Family:
    return _make_family(db)


def test_list_returns_the_page_envelope_never_a_bare_array(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family)

    body = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1


def test_total_counts_matches_not_returned_rows(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    for on in (DATE, LATER, LATEST):
        _book(db, family, on=on)

    body = api.get(
        f"/api/clients/{family.client.id}/bookings?page_size=2", headers=_auth(admin)
    ).json()

    assert len(body["items"]) == 2
    assert body["total"] == 3


def test_an_admin_created_booking_for_the_clients_child_appears(
    api: TestClient, db: Session, family: Family
) -> None:
    """`booked_by_guardian_id` is NULL for every booking the dashboard makes. Scoping the query
    through that column instead of through the child's guardians passes every test built from
    bot-created bookings and drops all of these."""
    admin = _make_user(db)
    booking = _book(db, family, booked_by=None)

    body = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin)).json()

    assert booking.booked_by_guardian_id is None
    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(booking.id)]


def test_a_booking_the_co_guardian_made_appears_in_the_clients_list(
    api: TestClient, db: Session, family: Family
) -> None:
    """The list is the child's bookings, not the ones this guardian happened to make."""
    admin = _make_user(db)
    booking = _book(db, family, booked_by=family.co_guardian)

    body = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(booking.id)]


def test_bookings_for_every_child_of_the_client_appear(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    first = _book(db, family, child=family.child, on=DATE)
    second = _book(db, family, child=family.sibling, on=LATER)

    body = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin)).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {str(first.id), str(second.id)}


def test_another_familys_booking_does_not_appear(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    stranger = _make_family(db)
    mine = _book(db, family)
    _book(db, stranger)

    body = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin)).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_a_child_with_two_guardians_yields_one_row_per_booking(
    api: TestClient, db: Session, family: Family
) -> None:
    """The join reaches bookings through `child_guardians`, which holds two rows for this
    child. `total` must count bookings, not join rows."""
    admin = _make_user(db)
    booking = _book(db, family, child=family.child)
    headers = _auth(admin)

    for guardian in (family.client, family.co_guardian):
        body = api.get(f"/api/clients/{guardian.id}/bookings", headers=headers).json()

        assert body["total"] == 1
        assert [row["id"] for row in body["items"]] == [str(booking.id)]


def test_repeated_status_values_are_ored(api: TestClient, db: Session, family: Family) -> None:
    admin = _make_user(db)
    pending = _book(db, family, on=DATE, status=BookingStatus.PENDING)
    confirmed = _book(db, family, on=LATER, status=BookingStatus.CONFIRMED)
    _book(db, family, on=LATEST, status=BookingStatus.CANCELLED)

    body = api.get(
        f"/api/clients/{family.client.id}/bookings?status=pending&status=confirmed",
        headers=_auth(admin),
    ).json()

    assert body["total"] == 2
    assert {row["id"] for row in body["items"]} == {str(pending.id), str(confirmed.id)}


def test_a_single_status_returns_only_that_status(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=DATE, status=BookingStatus.PENDING)
    cancelled = _book(db, family, on=LATER, status=BookingStatus.CANCELLED)

    body = api.get(
        f"/api/clients/{family.client.id}/bookings?status=cancelled", headers=_auth(admin)
    ).json()

    assert [row["id"] for row in body["items"]] == [str(cancelled.id)]


def test_an_unknown_status_value_is_400_not_422(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)

    response = api.get(
        f"/api/clients/{family.client.id}/bookings?status=sideways", headers=_auth(admin)
    )

    assert response.status_code == 400
    assert "status" in response.json()["detail"]


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("", [DATE, LATER, LATEST]),
        ("?from=2026-09-08", [LATER, LATEST]),
        ("?to=2026-09-08", [DATE, LATER]),
        ("?from=2026-09-08&to=2026-09-08", [LATER]),
        ("?from=2026-09-07&to=2026-09-09", [DATE, LATER, LATEST]),
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

    body = api.get(f"/api/clients/{family.client.id}/bookings{query}", headers=_auth(admin)).json()

    assert [row["scheduled_date"] for row in body["items"]] == [str(on) for on in expected]
    assert body["total"] == len(expected)


def test_an_inverted_range_selects_nothing_and_is_not_an_error(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=DATE)

    response = api.get(
        f"/api/clients/{family.client.id}/bookings?from=2026-09-09&to=2026-09-07",
        headers=_auth(admin),
    )

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_tutor_id_narrows_within_the_clients_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    stranger = _make_family(db)
    _book(db, family, tutor=family.tutor)
    mine = _book(db, family, tutor=family.other_tutor)
    _book(db, stranger, tutor=stranger.tutor)

    body = api.get(
        f"/api/clients/{family.client.id}/bookings?tutor_id={family.other_tutor.id}",
        headers=_auth(admin),
    ).json()

    assert body["total"] == 1
    assert [row["id"] for row in body["items"]] == [str(mine.id)]


def test_bookings_are_ordered_by_date_then_start_time(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    _book(db, family, on=LATER, start=TEN, end=ELEVEN)
    _book(db, family, on=DATE, start=ELEVEN, end=TWELVE)
    _book(db, family, on=DATE, start=NINE, end=TEN)

    body = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin)).json()

    assert [(row["scheduled_date"], row["start_time"]) for row in body["items"]] == [
        ("2026-09-07", "09:00:00"),
        ("2026-09-07", "11:00:00"),
        ("2026-09-08", "10:00:00"),
    ]


def test_paging_over_a_tied_group_repeats_and_drops_nothing(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)
    tutors = [family.tutor, family.other_tutor]
    for _ in range(3):
        tutor = _make_tutor(db)
        _make_availability(db, tutor.id)
        tutors.append(tutor)
    bookings = [_book(db, family, tutor=tutor, on=DATE, start=NINE, end=TEN) for tutor in tutors]

    seen: list[str] = []
    for page in range(1, 4):
        body = api.get(
            f"/api/clients/{family.client.id}/bookings?page={page}&page_size=2",
            headers=_auth(admin),
        ).json()
        seen.extend(row["id"] for row in body["items"])

    assert sorted(seen) == sorted(str(booking.id) for booking in bookings)
    assert len(seen) == len(bookings)


def test_an_item_is_the_nine_field_booking_summary(
    api: TestClient, db: Session, family: Family
) -> None:
    """`start_time` renders as `09:00:00`, matching `ExceptionRead`, where `docs/api-design.md`
    shows `09:00` — a reported divergence, not an accident."""
    admin = _make_user(db)
    booking = _book(db, family, start=NINE, end=TEN, status=BookingStatus.CONFIRMED)

    item = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin)).json()[
        "items"
    ][0]

    assert set(item) == {
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
    assert item["child"] == {"id": str(family.child.id), "name": family.child.name}
    assert item["tutor"] == {"id": str(family.tutor.id), "name": family.tutor.user.name}
    assert item["subject"] == {"id": str(family.subject.id), "name": family.subject.name}
    assert item["id"] == str(booking.id)
    assert item["scheduled_date"] == "2026-09-07"
    assert item["start_time"] == "09:00:00"
    assert item["end_time"] == "10:00:00"
    assert item["status"] == "confirmed"
    assert item["notes"] is None


def test_an_unknown_client_id_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/clients/{uuid.uuid4()}/bookings", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json()["detail"] == "Client not found"


def test_a_client_with_no_bookings_is_an_empty_page_not_a_404(
    api: TestClient, db: Session, family: Family
) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "page": 1, "page_size": 20}


def test_a_tutor_is_refused_with_403_and_never_a_500(
    api: TestClient, db: Session, family: Family
) -> None:
    """The `TutorScopeNotApplied` regression. `Booking` is a tutor-owned mapper, so a route
    that took `TutorScope` and never read it would answer 500 here — but only once a matching
    booking exists, which is why one is created first."""
    tutor_user = _make_user(db, role=UserRole.TUTOR, tutor_id=family.tutor.id)
    _book(db, family)

    response = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(tutor_user))

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)


def test_no_token_is_401_not_403(api: TestClient, db: Session, family: Family) -> None:
    response = api.get(f"/api/clients/{family.client.id}/bookings")

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


def test_a_developer_may_read_a_clients_bookings(
    api: TestClient, db: Session, family: Family
) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    booking = _book(db, family)

    body = api.get(f"/api/clients/{family.client.id}/bookings", headers=_auth(developer)).json()

    assert [row["id"] for row in body["items"]] == [str(booking.id)]


def _make_family(db: Session) -> Family:
    suffix = uuid.uuid4().hex[:12]
    client = _make_client(db)
    co_guardian = _make_client(db)
    tutor = _make_tutor(db)
    other_tutor = _make_tutor(db)
    subject = Subject(name=f"Subject {suffix}")
    home = Home(address="1 Test Street", access_code="0000")
    db.add_all([subject, home])
    db.flush()

    return Family(
        client=client,
        co_guardian=co_guardian,
        child=_make_child(db, guardians=[client, co_guardian]),
        sibling=_make_child(db, guardians=[client]),
        tutor=tutor,
        other_tutor=other_tutor,
        subject=subject,
        home=home,
        availability_id=_make_availability(db, tutor.id),
        other_availability_id=_make_availability(db, other_tutor.id),
    )


def _book(
    db: Session,
    family: Family,
    *,
    child: Child | None = None,
    tutor: Tutor | None = None,
    on: datetime.date = DATE,
    start: datetime.time = TEN,
    end: datetime.time = ELEVEN,
    status: BookingStatus = BookingStatus.PENDING,
    booked_by: Guardian | None = None,
) -> Booking:
    booked_tutor = tutor or family.tutor
    booking = Booking(
        child_id=(child or family.child).id,
        tutor_id=booked_tutor.id,
        subject_id=family.subject.id,
        availability_id=(
            family.availability_id
            if booked_tutor.id == family.tutor.id
            else family.other_availability_id
        ),
        home_id=family.home.id,
        booked_by_guardian_id=None if booked_by is None else booked_by.id,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


def _make_client(db: Session) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(name=f"Client {suffix}", phone_number=f"+1{suffix[:10]}")
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
            hashed_password=hash_password(PASSWORD),
            role=role,
            is_active=True,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password(PASSWORD)
        user.role = role
        user.is_active = True
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}
