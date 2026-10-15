"""`POST /api/archive` and `POST /api/restore` over HTTP, for Guardians, Homes and Subjects.

The Home guard carries the weight. The business clock (`clock.business_now`) is frozen at 12:00,
so "later today" and "earlier today" are real cases: a live booking at 14:00 today blocks, one at
09:00 today does not. Every refusal re-reads the row, because a 409 whose body is right but whose
flag was flipped anyway is the failure the guard exists to prevent.
"""

import datetime
import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import CREDENTIALS_ERROR, OFFICE_REQUIRED_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"
HOME_HAS_UPCOMING_BOOKINGS_ERROR = "Home has upcoming bookings; cancel or move them first"

NOW = datetime.datetime(2031, 3, 4, 12, 0)
TODAY = NOW.date()
TOMORROW = TODAY + datetime.timedelta(days=1)
YESTERDAY = TODAY - datetime.timedelta(days=1)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)
FOURTEEN = datetime.time(14, 0)
FIFTEEN = datetime.time(15, 0)


def test_archiving_a_subject_sets_the_flag_and_answers_the_shared_shape(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)

    response = _archive(api, admin, "subject", subject.id)

    assert response.status_code == 200
    assert response.json() == {
        "type": "subject",
        "id": str(subject.id),
        "archived": True,
        "cancelled_booking_ids": [],
    }
    assert _reloaded(db, Subject, subject.id).is_archived is True


def test_archiving_a_subject_leaves_its_bookings_and_teaching_alone(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    subject = _make_subject(db)
    tutor = _make_tutor(db)
    teaching = TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=8)
    db.add(teaching)
    home = _make_home(db, client=_make_client(db))
    booking = _book(
        db,
        home=home,
        on=TOMORROW,
        start=TEN,
        end=ELEVEN,
        status=BookingStatus.CONFIRMED,
        subject=subject,
    )

    response = _archive(api, admin, "subject", subject.id)

    assert response.status_code == 200
    assert response.json()["cancelled_booking_ids"] == []
    assert _reloaded(db, Booking, booking.id).status == BookingStatus.CONFIRMED
    assert _reloaded(db, TutorSubject, teaching.id).subject_id == subject.id


def test_archiving_a_guardian_leaves_their_children_and_bookings_alone(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    booking = _book(
        db,
        home=home,
        on=TOMORROW,
        start=TEN,
        end=ELEVEN,
        status=BookingStatus.CONFIRMED,
        client=client,
    )

    response = _archive(api, admin, "guardian", client.id)

    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert response.json()["cancelled_booking_ids"] == []
    assert _reloaded(db, Guardian, client.id).is_archived is True
    assert _reloaded(db, Booking, booking.id).status == BookingStatus.CONFIRMED
    assert _reloaded(db, Child, booking.child_id).is_archived is False
    assert _reloaded(db, Home, home.id).is_archived is False


@pytest.mark.parametrize(
    ("on", "start", "end", "status"),
    [
        (TOMORROW, TEN, ELEVEN, BookingStatus.CONFIRMED),
        (TOMORROW, TEN, ELEVEN, BookingStatus.PENDING),
        (TODAY, FOURTEEN, FIFTEEN, BookingStatus.CONFIRMED),
    ],
    ids=["confirmed_tomorrow", "pending_tomorrow", "confirmed_later_today"],
)
def test_archiving_a_home_with_an_upcoming_live_booking_is_409_naming_it(
    api: TestClient,
    db: Session,
    freeze_business_clock: Callable[[datetime.datetime], None],
    on: datetime.date,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus,
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))
    booking = _book(db, home=home, on=on, start=start, end=end, status=status)

    response = _archive(api, admin, "home", home.id)

    assert response.status_code == 409
    assert response.json() == {
        "detail": HOME_HAS_UPCOMING_BOOKINGS_ERROR,
        "booking_ids": [str(booking.id)],
    }
    assert _reloaded(db, Home, home.id).is_archived is False


def test_a_home_refusal_names_every_upcoming_booking_and_only_those(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))
    later = _book(db, home=home, on=TOMORROW, start=TEN, end=ELEVEN, status=BookingStatus.PENDING)
    sooner = _book(
        db, home=home, on=TODAY, start=FOURTEEN, end=FIFTEEN, status=BookingStatus.CONFIRMED
    )
    _book(db, home=home, on=YESTERDAY, start=TEN, end=ELEVEN, status=BookingStatus.CONFIRMED)
    _book(db, home=home, on=TOMORROW, start=TWELVE, end=FOURTEEN, status=BookingStatus.CANCELLED)

    response = _archive(api, admin, "home", home.id)

    assert response.status_code == 409
    assert response.json()["booking_ids"] == [str(sooner.id), str(later.id)]


@pytest.mark.parametrize(
    ("on", "start", "end", "status"),
    [
        (TOMORROW, TEN, ELEVEN, BookingStatus.CANCELLED),
        (YESTERDAY, TEN, ELEVEN, BookingStatus.CONFIRMED),
        (TODAY, NINE, TEN, BookingStatus.CONFIRMED),
        (TODAY, TWELVE, FOURTEEN, BookingStatus.CONFIRMED),
    ],
    ids=[
        "cancelled_tomorrow",
        "confirmed_yesterday",
        "confirmed_earlier_today",
        "confirmed_starting_exactly_now",
    ],
)
def test_archiving_a_home_with_no_upcoming_live_booking_succeeds(
    api: TestClient,
    db: Session,
    freeze_business_clock: Callable[[datetime.datetime], None],
    on: datetime.date,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus,
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))
    booking = _book(db, home=home, on=on, start=start, end=end, status=status)

    response = _archive(api, admin, "home", home.id)

    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert response.json()["cancelled_booking_ids"] == []
    assert _reloaded(db, Home, home.id).is_archived is True
    assert _reloaded(db, Booking, booking.id).status == status


def test_a_booking_at_another_home_does_not_block_archiving(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    other = _make_home(db, client=client)
    _book(db, home=other, on=TOMORROW, start=TEN, end=ELEVEN, status=BookingStatus.CONFIRMED)

    response = _archive(api, admin, "home", home.id)

    assert response.status_code == 200
    assert response.json()["archived"] is True


def test_restoring_a_home_with_upcoming_bookings_is_not_guarded(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db), is_archived=True)
    booking = _book(
        db, home=home, on=TOMORROW, start=TEN, end=ELEVEN, status=BookingStatus.CONFIRMED
    )

    response = _restore(api, admin, "home", home.id)

    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert _reloaded(db, Booking, booking.id).status == BookingStatus.CONFIRMED


@pytest.mark.parametrize("kind", ["guardian", "home", "subject"])
def test_restore_clears_the_flag(api: TestClient, db: Session, kind: str) -> None:
    admin = _make_user(db)
    model, row_id = _archived_row(db, kind)

    response = _restore(api, admin, kind, row_id)

    assert response.status_code == 200
    assert response.json() == {
        "type": kind,
        "id": str(row_id),
        "archived": False,
        "cancelled_booking_ids": [],
    }
    assert _reloaded(db, model, row_id).is_archived is False


@pytest.mark.parametrize("kind", ["guardian", "home", "subject"])
def test_archiving_an_archived_row_is_a_no_op_200(api: TestClient, db: Session, kind: str) -> None:
    admin = _make_user(db)
    model, row_id = _archived_row(db, kind)

    response = _archive(api, admin, kind, row_id)

    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert response.json()["cancelled_booking_ids"] == []
    assert _reloaded(db, model, row_id).is_archived is True


@pytest.mark.parametrize("kind", ["guardian", "home", "subject"])
def test_restoring_an_active_row_is_a_no_op_200(api: TestClient, db: Session, kind: str) -> None:
    admin = _make_user(db)
    model, row_id = _active_row(db, kind)

    response = _restore(api, admin, kind, row_id)

    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert _reloaded(db, model, row_id).is_archived is False


@pytest.mark.parametrize(
    ("kind", "detail"),
    [
        ("guardian", "Client not found"),
        ("home", "Home not found"),
        ("subject", "Subject not found"),
    ],
)
@pytest.mark.parametrize("action", ["archive", "restore"])
def test_an_unknown_id_is_404_with_the_types_message(
    api: TestClient, db: Session, kind: str, detail: str, action: str
) -> None:
    admin = _make_user(db)

    response = api.post(
        f"/api/{action}", json={"type": kind, "id": str(uuid.uuid4())}, headers=_auth(admin)
    )

    assert response.status_code == 404
    assert response.json() == {"detail": detail}


@pytest.mark.parametrize("action", ["archive", "restore"])
def test_a_tutor_is_refused_with_403_and_nothing_changes(
    api: TestClient, db: Session, action: str
) -> None:
    tutor_user = _make_tutor(db).user
    subject = _make_subject(db, is_archived=action == "restore")

    response = api.post(
        f"/api/{action}", json={"type": "subject", "id": str(subject.id)}, headers=_auth(tutor_user)
    )

    assert response.status_code == 403
    assert response.json() == {"detail": OFFICE_REQUIRED_ERROR}
    assert _reloaded(db, Subject, subject.id).is_archived is (action == "restore")


@pytest.mark.parametrize("action", ["archive", "restore"])
def test_no_token_is_refused_with_401(api: TestClient, db: Session, action: str) -> None:
    subject = _make_subject(db)

    response = api.post(f"/api/{action}", json={"type": "subject", "id": str(subject.id)})

    assert response.status_code == 401
    assert response.json() == {"detail": CREDENTIALS_ERROR}


@pytest.mark.parametrize("role", [UserRole.MANAGER, UserRole.DEVELOPER])
def test_every_office_role_may_archive(api: TestClient, db: Session, role: UserRole) -> None:
    user = _make_user(db, role=role)
    subject = _make_subject(db)

    response = _archive(api, user, "subject", subject.id)

    assert response.status_code == 200


def test_an_unknown_type_is_refused_with_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = _archive(api, admin, "booking", uuid.uuid4())

    assert response.status_code == 400


# --- helpers --------------------------------------------------------------------------------


def _archive(api: TestClient, user: User, kind: str, target_id: uuid.UUID) -> Response:
    return api.post("/api/archive", json={"type": kind, "id": str(target_id)}, headers=_auth(user))


def _restore(api: TestClient, user: User, kind: str, target_id: uuid.UUID) -> Response:
    return api.post("/api/restore", json={"type": kind, "id": str(target_id)}, headers=_auth(user))


def _archived_row(db: Session, kind: str) -> tuple[type[Guardian | Home | Subject], uuid.UUID]:
    return _row(db, kind, is_archived=True)


def _active_row(db: Session, kind: str) -> tuple[type[Guardian | Home | Subject], uuid.UUID]:
    return _row(db, kind, is_archived=False)


def _row(
    db: Session, kind: str, *, is_archived: bool
) -> tuple[type[Guardian | Home | Subject], uuid.UUID]:
    if kind == "guardian":
        found = (Guardian, _make_client(db, is_archived=is_archived).id)
    elif kind == "home":
        home = _make_home(db, client=_make_client(db), is_archived=is_archived)
        found = (Home, home.id)
    else:
        found = (Subject, _make_subject(db, is_archived=is_archived).id)

    return found


def _reloaded[Row](db: Session, model: type[Row], row_id: uuid.UUID) -> Row:
    db.expire_all()

    return db.get_one(model, row_id)


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=role,
        is_archived=False,
    )
    db.add(user)
    db.flush()

    return user


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()

    return tutor


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _make_subject(db: Session, *, is_archived: bool = False) -> Subject:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}", is_archived=is_archived)
    db.add(subject)
    db.flush()

    return subject


def _make_client(db: Session, *, is_archived: bool = False) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    client = Guardian(
        name=f"Client {suffix}", phone_number=f"+1{suffix[:10]}", is_archived=is_archived
    )
    db.add(client)
    db.flush()

    return client


def _make_home(db: Session, *, client: Guardian, is_archived: bool = False) -> Home:
    home = Home(label="Mum's", address="123 Main St", directions="1234", is_archived=is_archived)
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=client.id, home_id=home.id))
    db.flush()

    return home


def _make_child(db: Session, *, guardians: list[Guardian]) -> Child:
    child = Child(
        name=f"Child {uuid.uuid4().hex[:12]}",
        date_of_birth=datetime.date(2014, 5, 2),
        grade_level=7,
        school_name="Lincoln Middle School",
        is_archived=False,
    )
    db.add(child)
    db.flush()
    db.add_all([ChildGuardian(child_id=child.id, guardian_id=one.id) for one in guardians])
    db.flush()

    return child


def _book(
    db: Session,
    *,
    home: Home,
    on: datetime.date,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus,
    subject: Subject | None = None,
    client: Guardian | None = None,
) -> Booking:
    tutor = _make_tutor(db)
    guardian = client or _make_client(db)
    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=on.weekday(), start_time=NINE, end_time=FIFTEEN
    )
    db.add(availability)
    db.flush()
    booking = Booking(
        child_id=_make_child(db, guardians=[guardian]).id,
        user_id=tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=(subject or _make_subject(db)).id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking
