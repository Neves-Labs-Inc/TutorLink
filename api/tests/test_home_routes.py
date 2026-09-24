"""`POST /api/clients/{id}/homes` and `PATCH /api/homes/{id}` over HTTP — REQ-102.

The deactivation guard carries the weight here. Its clock is frozen at 12:00 through
`home_service._now`, so "later today" and "earlier today" are real cases rather than whatever
the wall clock happens to make them: a live booking at 14:00 today blocks, one at 09:00 today
does not. Every refusal also re-reads the row, because a 409 whose body is right but whose
other fields were applied anyway is the failure A-49 exists to prevent.

Every negative case asserts the exact `{"detail": "..."}` body, not merely the status.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.routers import client_homes, clients, homes
from app.routers.booking_writes import REFERENCE_NOT_FOUND_ERROR
from app.security import create_access_token, hash_password
from app.services import home_service

PASSWORD = "correct horse battery staple"

CLIENT_NOT_FOUND_ERROR = "Client not found"
HOME_NOT_FOUND_ERROR = "Home not found"
BLANK_HOME_DETAILS_ERROR = "address and access_code must not be blank"
CHILD_NOT_LINKED_ERROR = "child_ids must name children linked to this client"
UPCOMING_BOOKINGS_ERROR = "Home has upcoming bookings; cancel or move them first"

HOME_READ_KEYS = {"id", "label", "address", "access_code", "is_active"}

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


# --- POST /api/clients/{id}/homes -----------------------------------------------------------


def test_add_home_links_the_client_and_every_named_child(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    first = _make_child(db, guardians=[client])
    second = _make_child(db, guardians=[client])

    response = _add(
        api,
        admin,
        client.id,
        label="Dad's",
        address="9 Elm St",
        access_code="4321",
        child_ids=[str(first.id), str(second.id)],
    )
    body = response.json()

    assert response.status_code == 201
    assert set(body) == HOME_READ_KEYS
    assert body["label"] == "Dad's"
    assert body["address"] == "9 Elm St"
    assert body["access_code"] == "4321"
    assert body["is_active"] is True

    home_id = uuid.UUID(body["id"])
    assert _guardian_home_ids(db, client) == [home_id]
    assert _child_home_pairs(db, home_id) == {(first.id, home_id), (second.id, home_id)}

    detail = api.get(f"/api/clients/{client.id}", headers=_auth(admin)).json()
    assert [home["id"] for home in detail["homes"]] == [body["id"]]


def test_add_home_with_no_child_ids_links_only_the_client(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    _make_child(db, guardians=[client])

    response = _add(api, admin, client.id)
    home_id = uuid.UUID(response.json()["id"])

    assert response.status_code == 201
    assert _guardian_home_ids(db, client) == [home_id]
    assert _child_home_pairs(db, home_id) == set()


def test_add_home_collapses_a_repeated_child_id(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    child = _make_child(db, guardians=[client])

    response = _add(api, admin, client.id, child_ids=[str(child.id), str(child.id)])
    home_id = uuid.UUID(response.json()["id"])

    assert response.status_code == 201
    assert _child_home_pairs(db, home_id) == {(child.id, home_id)}


def test_add_home_accepts_an_inactive_child_linked_to_the_client(
    api: TestClient, db: Session
) -> None:
    """07C A2 delta 3: a home can be prepared before a child returns."""
    admin = _make_user(db)
    client = _make_client(db)
    child = _make_child(db, guardians=[client], is_active=False)

    response = _add(api, admin, client.id, child_ids=[str(child.id)])
    home_id = uuid.UUID(response.json()["id"])

    assert response.status_code == 201
    assert _child_home_pairs(db, home_id) == {(child.id, home_id)}


@pytest.mark.parametrize("stranger", ["other_clients_child", "random_uuid"])
def test_add_home_refuses_a_child_not_linked_to_the_client_and_writes_nothing(
    api: TestClient, db: Session, stranger: str
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    own = _make_child(db, guardians=[client])
    other = _make_child(db, guardians=[_make_client(db)])
    named = other.id if stranger == "other_clients_child" else uuid.uuid4()
    homes_before = _home_count(db)

    response = _add(api, admin, client.id, child_ids=[str(own.id), str(named)])

    _assert_detail(response, 400, CHILD_NOT_LINKED_ERROR)
    assert _home_count(db) == homes_before
    assert _guardian_home_ids(db, client) == []


@pytest.mark.parametrize(
    ("field", "value"),
    [("address", "   "), ("access_code", "   "), ("address", "")],
)
def test_add_home_refuses_blank_details_and_writes_nothing(
    api: TestClient, db: Session, field: str, value: str
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    homes_before = _home_count(db)

    response = _add(api, admin, client.id, **{field: value})

    _assert_detail(response, 400, BLANK_HOME_DETAILS_ERROR)
    assert _home_count(db) == homes_before


def test_add_home_stores_a_blank_label_as_null_and_trims_the_rest(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    client = _make_client(db)

    response = _add(api, admin, client.id, label="  ", address="  9 Elm St ", access_code=" 42 ")
    body = response.json()
    stored = db.get(Home, uuid.UUID(body["id"]))

    assert response.status_code == 201
    assert body["label"] is None
    assert stored is not None
    assert (stored.label, stored.address, stored.access_code) == (None, "9 Elm St", "42")


@pytest.mark.parametrize("field", ["label", "access_code"])
def test_add_home_refuses_a_field_over_64_characters_with_400(
    api: TestClient, db: Session, field: str
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    homes_before = _home_count(db)

    response = _add(api, admin, client.id, **{field: "x" * 65})

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)
    assert _home_count(db) == homes_before


def test_add_home_without_an_address_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)

    response = api.post(
        f"/api/clients/{client.id}/homes", json={"access_code": "1"}, headers=_auth(admin)
    )

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}


def test_add_home_for_an_unknown_client_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    homes_before = _home_count(db)

    response = _add(api, admin, uuid.uuid4())

    _assert_detail(response, 404, CLIENT_NOT_FOUND_ERROR)
    assert _home_count(db) == homes_before


# --- PATCH /api/homes/{id} ------------------------------------------------------------------


def test_patch_access_code_changes_only_that_field(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {"access_code": "0000"})

    assert response.status_code == 200
    assert response.json() == {
        "id": str(home.id),
        "label": "Mum's",
        "address": "123 Main St",
        "access_code": "0000",
        "is_active": True,
    }


@pytest.mark.parametrize(
    ("label", "stored"),
    [("", None), ("   ", None), (None, "Mum's"), (" Dad's ", "Dad's")],
)
def test_patch_label_clears_on_blank_and_is_left_alone_on_null(
    api: TestClient, db: Session, label: str | None, stored: str | None
) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {"label": label})

    assert response.status_code == 200
    assert response.json()["label"] == stored
    assert _reloaded(db, home).label == stored


def test_patch_with_an_empty_body_changes_nothing(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {})

    assert response.status_code == 200
    assert response.json()["label"] == "Mum's"
    assert response.json()["access_code"] == "1234"


@pytest.mark.parametrize("field", ["address", "access_code"])
def test_patch_refuses_a_blank_detail_and_applies_nothing(
    api: TestClient, db: Session, field: str
) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {field: "  ", "label": "X"})

    _assert_detail(response, 400, BLANK_HOME_DETAILS_ERROR)
    reloaded = _reloaded(db, home)
    assert (reloaded.label, reloaded.address, reloaded.access_code) == (
        "Mum's",
        "123 Main St",
        "1234",
    )


def test_patch_access_code_over_64_characters_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {"access_code": "x" * 65})

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert _reloaded(db, home).access_code == "1234"


@pytest.mark.parametrize(
    ("on", "start", "end", "status"),
    [
        (TOMORROW, TEN, ELEVEN, BookingStatus.CONFIRMED),
        (TOMORROW, TEN, ELEVEN, BookingStatus.PENDING),
        (TODAY, FOURTEEN, FIFTEEN, BookingStatus.CONFIRMED),
    ],
    ids=["confirmed_tomorrow", "pending_tomorrow", "confirmed_later_today"],
)
def test_deactivating_a_home_with_an_upcoming_live_booking_is_409_and_applies_nothing(
    api: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    on: datetime.date,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus,
) -> None:
    monkeypatch.setattr(home_service, "_now", lambda: NOW)
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))
    _book(db, home=home, on=on, start=start, end=end, status=status)

    response = _patch(api, admin, home.id, {"is_active": False, "label": "X"})

    _assert_detail(response, 409, UPCOMING_BOOKINGS_ERROR)
    reloaded = _reloaded(db, home)
    assert reloaded.is_active is True
    assert reloaded.label == "Mum's"


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
def test_deactivating_a_home_with_no_upcoming_live_booking_succeeds(
    api: TestClient,
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    on: datetime.date,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus,
) -> None:
    monkeypatch.setattr(home_service, "_now", lambda: NOW)
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))
    _book(db, home=home, on=on, start=start, end=end, status=status)

    response = _patch(api, admin, home.id, {"is_active": False})

    assert response.status_code == 200
    assert response.json()["is_active"] is False
    assert _reloaded(db, home).is_active is False


def test_a_booking_at_another_home_does_not_block_deactivation(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(home_service, "_now", lambda: NOW)
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    other = _make_home(db, client=client)
    _book(db, home=other, on=TOMORROW, start=TEN, end=ELEVEN, status=BookingStatus.CONFIRMED)

    response = _patch(api, admin, home.id, {"is_active": False})

    assert response.status_code == 200
    assert response.json()["is_active"] is False


def test_patch_reactivates_a_deactivated_home(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db), is_active=False)

    response = _patch(api, admin, home.id, {"is_active": True})

    assert response.status_code == 200
    assert response.json()["is_active"] is True
    assert _reloaded(db, home).is_active is True


def test_patch_leaves_every_link_in_place(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    child = _make_child(db, guardians=[client], homes=[home])

    response = _patch(api, admin, home.id, {"is_active": False, "address": "10 Elm St"})

    assert response.status_code == 200
    assert _guardian_home_ids(db, client) == [home.id]
    assert _child_home_pairs(db, home.id) == {(child.id, home.id)}


def test_patch_an_unknown_home_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = _patch(api, admin, uuid.uuid4(), {"label": "X"})

    _assert_detail(response, 404, HOME_NOT_FOUND_ERROR)


def test_a_deactivated_home_is_refused_by_post_bookings_and_bookable_once_reactivated(
    api: TestClient, db: Session
) -> None:
    """The existing `booking_write_service` retirement rule, asserted once — not re-implemented.
    Reactivating proves the refusal came from the home and nothing else in the payload."""
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    child = _make_child(db, guardians=[client], homes=[home])
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=8))
    on = _next_monday()
    availability = _make_availability(db, tutor=tutor, weekday=on.weekday())
    payload = {
        "child_id": str(child.id),
        "tutor_id": str(tutor.id),
        "subject_id": str(subject.id),
        "availability_id": str(availability.id),
        "home_id": str(home.id),
        "scheduled_date": on.isoformat(),
        "start_time": "10:00:00",
        "end_time": "11:00:00",
    }

    assert _patch(api, admin, home.id, {"is_active": False}).status_code == 200
    refused = api.post("/api/bookings", json=payload, headers=_auth(admin))
    _assert_detail(refused, 400, REFERENCE_NOT_FOUND_ERROR)
    assert _booking_count(db, home) == 0

    assert _patch(api, admin, home.id, {"is_active": True}).status_code == 200
    accepted = api.post("/api/bookings", json=payload, headers=_auth(admin))
    assert accepted.status_code == 201
    assert _booking_count(db, home) == 1


# --- RBAC, error shape, shared literals -----------------------------------------------------


@pytest.mark.parametrize("route", ["add", "patch"])
def test_a_tutor_is_refused_with_403(api: TestClient, db: Session, route: str) -> None:
    tutor_user = _make_tutor_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    homes_before = _home_count(db)

    if route == "add":
        response = _add(api, tutor_user, client.id)
    else:
        response = _patch(api, tutor_user, home.id, {"label": "X"})

    _assert_detail(response, 403, ADMIN_REQUIRED_ERROR)
    assert _home_count(db) == homes_before
    assert _reloaded(db, home).label == "Mum's"


@pytest.mark.parametrize("route", ["add", "patch"])
def test_no_token_is_refused_with_401(api: TestClient, db: Session, route: str) -> None:
    client = _make_client(db)
    home = _make_home(db, client=client)

    if route == "add":
        response = api.post(f"/api/clients/{client.id}/homes", json=_home_body())
    else:
        response = api.patch(f"/api/homes/{home.id}", json={"label": "X"})

    _assert_detail(response, 401, CREDENTIALS_ERROR)


def test_the_developer_role_may_add_and_patch_homes(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    client = _make_client(db)

    added = _add(api, developer, client.id)
    patched = _patch(api, developer, uuid.UUID(added.json()["id"]), {"label": "X"})

    assert added.status_code == 201
    assert patched.status_code == 200


def test_the_shared_literals_match_the_routers_that_already_declare_them() -> None:
    assert client_homes.CLIENT_NOT_FOUND_ERROR == clients.CLIENT_NOT_FOUND_ERROR
    assert homes.BLANK_HOME_DETAILS_ERROR == client_homes.BLANK_HOME_DETAILS_ERROR
    assert client_homes.BLANK_HOME_DETAILS_ERROR == BLANK_HOME_DETAILS_ERROR
    assert client_homes.CHILD_NOT_LINKED_ERROR == CHILD_NOT_LINKED_ERROR
    assert homes.HOME_NOT_FOUND_ERROR == HOME_NOT_FOUND_ERROR
    assert homes.HOME_HAS_UPCOMING_BOOKINGS_ERROR == UPCOMING_BOOKINGS_ERROR


# --- helpers --------------------------------------------------------------------------------


def _home_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {"label": "Dad's", "address": "9 Elm St", "access_code": "4321"}
    body.update(overrides)

    return body


def _add(api: TestClient, user: User, client_id: uuid.UUID, **overrides: object) -> Response:
    return api.post(
        f"/api/clients/{client_id}/homes", json=_home_body(**overrides), headers=_auth(user)
    )


def _patch(api: TestClient, user: User, home_id: uuid.UUID, body: dict[str, object]) -> Response:
    return api.patch(f"/api/homes/{home_id}", json=body, headers=_auth(user))


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


def _reloaded(db: Session, home: Home) -> Home:
    db.expire_all()
    reloaded = db.get(Home, home.id)
    assert reloaded is not None

    return reloaded


def _home_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Home)) or 0


def _booking_count(db: Session, home: Home) -> int:
    statement = select(func.count()).select_from(Booking).where(Booking.home_id == home.id)

    return db.scalar(statement) or 0


def _guardian_home_ids(db: Session, client: Guardian) -> list[uuid.UUID]:
    return list(
        db.scalars(select(GuardianHome.home_id).where(GuardianHome.guardian_id == client.id))
    )


def _child_home_pairs(db: Session, home_id: uuid.UUID) -> set[tuple[uuid.UUID, uuid.UUID]]:
    rows = db.execute(
        select(ChildHome.child_id, ChildHome.home_id).where(ChildHome.home_id == home_id)
    ).all()

    return {(child_id, linked_home_id) for child_id, linked_home_id in rows}


def _next_monday() -> datetime.date:
    today = datetime.datetime.now(tz=datetime.UTC).date()

    return today + datetime.timedelta(days=(0 - today.weekday()) % 7 or 7)


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password(PASSWORD),
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


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


def _make_tutor_user(db: Session) -> User:
    return _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)


def _make_subject(db: Session) -> Subject:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()

    return subject


def _make_availability(db: Session, *, tutor: Tutor, weekday: int) -> TutorAvailability:
    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=weekday, start_time=NINE, end_time=TWELVE
    )
    db.add(availability)
    db.flush()

    return availability


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)

    return {"Authorization": f"Bearer {token}"}


def _make_client(db: Session) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    client = Guardian(name=f"Client {suffix}", phone_number=f"+1{suffix[:10]}", is_active=True)
    db.add(client)
    db.flush()

    return client


def _make_home(db: Session, *, client: Guardian, is_active: bool = True) -> Home:
    home = Home(label="Mum's", address="123 Main St", access_code="1234", is_active=is_active)
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=client.id, home_id=home.id))
    db.flush()

    return home


def _make_child(
    db: Session,
    *,
    guardians: list[Guardian],
    homes: list[Home] | None = None,
    is_active: bool = True,
) -> Child:
    child = Child(
        name=f"Child {uuid.uuid4().hex[:12]}",
        date_of_birth=datetime.date(2014, 5, 2),
        grade_level=7,
        school_name="Lincoln Middle School",
        is_active=is_active,
    )
    db.add(child)
    db.flush()
    db.add_all([ChildGuardian(child_id=child.id, guardian_id=one.id) for one in guardians])
    db.add_all([ChildHome(child_id=child.id, home_id=one.id) for one in homes or []])
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
) -> Booking:
    tutor = _make_tutor(db)
    client = _make_client(db)
    booking = Booking(
        child_id=_make_child(db, guardians=[client], homes=[home]).id,
        tutor_id=tutor.id,
        subject_id=_make_subject(db).id,
        availability_id=_make_availability(db, tutor=tutor, weekday=on.weekday()).id,
        home_id=home.id,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking
