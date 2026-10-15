"""`POST /api/clients/{id}/homes` and `PATCH /api/homes/{id}` over HTTP — REQ-102.

Archiving a Home, and its upcoming-bookings guard, is `tests/test_archive_routes.py`. Every
refusal here re-reads the row, because a 400 whose body is right but whose other fields were
applied anyway is the failure A-49 exists to prevent.

Every negative case asserts the exact `{"detail": "..."}` body, not merely the status.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import OFFICE_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.routers import client_homes, clients, homes
from app.routers.booking_writes import REFERENCE_NOT_FOUND_ERROR
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"

CLIENT_NOT_FOUND_ERROR = "Client not found"
HOME_NOT_FOUND_ERROR = "Home not found"
BLANK_HOME_DETAILS_ERROR = "address and access_code must not be blank"

HOME_READ_KEYS = {"id", "label", "address", "access_code", "archived", "guardians"}

NINE = datetime.time(9, 0)
TWELVE = datetime.time(12, 0)


# --- POST /api/clients/{id}/homes -----------------------------------------------------------


def test_add_home_links_only_the_client_and_its_children_have_it(
    api: TestClient, db: Session
) -> None:
    """A Child's Homes are its Guardians' (#214): no per-child link is written or needed."""
    admin = _make_user(db)
    client = _make_client(db)
    first = _make_child(db, guardians=[client])
    second = _make_child(db, guardians=[client])

    response = _add(api, admin, client.id, label="Dad's", address="9 Elm St", access_code="4321")
    body = response.json()

    assert response.status_code == 201
    assert set(body) == HOME_READ_KEYS
    assert body["label"] == "Dad's"
    assert body["address"] == "9 Elm St"
    assert body["access_code"] == "4321"
    assert body["archived"] is False
    assert body["guardians"] == [{"id": str(client.id), "name": client.name}]

    home_id = uuid.UUID(body["id"])
    assert _guardian_home_ids(db, client) == [home_id]
    assert _child_home_ids(api, admin, first) == [body["id"]]
    assert _child_home_ids(api, admin, second) == [body["id"]]

    detail = api.get(f"/api/clients/{client.id}", headers=_auth(admin)).json()
    assert [home["id"] for home in detail["homes"]] == [body["id"]]


def test_add_home_ignores_child_ids(api: TestClient, db: Session) -> None:
    """`child_ids` left the contract: naming another client's child neither refuses nor links."""
    admin = _make_user(db)
    client = _make_client(db)
    other = _make_child(db, guardians=[_make_client(db)])

    response = _add(api, admin, client.id, child_ids=[str(other.id), str(uuid.uuid4())])
    home_id = uuid.UUID(response.json()["id"])

    assert response.status_code == 201
    assert _guardian_home_ids(db, client) == [home_id]
    assert _child_home_ids(api, admin, other) == []


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
    owner = _make_client(db)
    home = _make_home(db, client=owner)

    response = _patch(api, admin, home.id, {"access_code": "0000"})

    assert response.status_code == 200
    assert response.json() == {
        "id": str(home.id),
        "label": "Mum's",
        "address": "123 Main St",
        "access_code": "0000",
        "archived": False,
        "guardians": [{"id": str(owner.id), "name": owner.name}],
    }


def test_patch_returns_every_current_owner_archived_ones_included(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    zed = _make_client(db)
    zed.name, zed.is_archived = "Zed Doe", True
    amy = _make_client(db)
    amy.name = "Amy Doe"
    home = _make_home(db, client=zed)
    db.add(GuardianHome(guardian_id=amy.id, home_id=home.id))
    db.flush()

    response = _patch(api, admin, home.id, {"label": "Shared"})

    assert response.json()["guardians"] == [
        {"id": str(amy.id), "name": "Amy Doe"},
        {"id": str(zed.id), "name": "Zed Doe"},
    ]


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


def test_patch_leaves_every_link_in_place(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    child = _make_child(db, guardians=[client])

    response = _patch(api, admin, home.id, {"address": "10 Elm St"})

    assert response.status_code == 200
    assert _guardian_home_ids(db, client) == [home.id]
    assert _child_home_ids(api, admin, child) == [str(home.id)]


@pytest.mark.parametrize("is_active", [False, True])
def test_patch_ignores_is_active(api: TestClient, db: Session, is_active: bool) -> None:
    """Archive and Restore moved to `POST /api/archive` and `/api/restore`."""
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db), is_archived=is_active)

    response = _patch(api, admin, home.id, {"is_active": is_active, "label": "X"})

    assert response.status_code == 200
    assert response.json()["archived"] is is_active
    assert _reloaded(db, home).is_archived is is_active
    assert _reloaded(db, home).label == "X"


def test_patch_an_unknown_home_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = _patch(api, admin, uuid.uuid4(), {"label": "X"})

    _assert_detail(response, 404, HOME_NOT_FOUND_ERROR)


def test_an_archived_home_is_refused_by_post_bookings_and_bookable_once_restored(
    api: TestClient, db: Session
) -> None:
    """The existing `booking_write_service` retirement rule, asserted once — not re-implemented.
    Restoring proves the refusal came from the home and nothing else in the payload."""
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    child = _make_child(db, guardians=[client])
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=8))
    on = _next_monday()
    availability = _make_availability(db, tutor=tutor, weekday=on.weekday())
    payload = {
        "child_id": str(child.id),
        "user_id": str(tutor.user_id),
        "kind": "regular",
        "location": "home",
        "subject_id": str(subject.id),
        "availability_id": str(availability.id),
        "home_id": str(home.id),
        "scheduled_date": on.isoformat(),
        "start_time": "10:00:00",
        "end_time": "11:00:00",
    }

    target = {"type": "home", "id": str(home.id)}

    assert api.post("/api/archive", json=target, headers=_auth(admin)).status_code == 200
    refused = api.post("/api/bookings", json=payload, headers=_auth(admin))
    _assert_detail(refused, 400, REFERENCE_NOT_FOUND_ERROR)
    assert _booking_count(db, home) == 0

    assert api.post("/api/restore", json=target, headers=_auth(admin)).status_code == 200
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

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)
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
    assert homes.HOME_NOT_FOUND_ERROR == HOME_NOT_FOUND_ERROR


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


def _child_home_ids(api: TestClient, user: User, child: Child) -> list[str]:
    detail = api.get(f"/api/children/{child.id}", headers=_auth(user)).json()

    return [home["id"] for home in detail["homes"]]


def _next_monday() -> datetime.date:
    today = datetime.datetime.now(tz=datetime.UTC).date()

    return today + datetime.timedelta(days=(0 - today.weekday()) % 7 or 7)


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    if tutor_id is None:
        user = User(
            email=f"user-{uuid.uuid4().hex[:12]}@example.com",
            name="Test User",
            hashed_password=hash_password(PASSWORD),
            role=role,
            is_archived=False,
        )
        db.add(user)
    else:
        # The profile's own user is the login: one record per person.
        user = db.get_one(Tutor, tutor_id).user
        user.hashed_password = hash_password(PASSWORD)
        user.role = role
        user.is_archived = False
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
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _make_client(db: Session) -> Guardian:
    suffix = uuid.uuid4().hex[:12]
    client = Guardian(name=f"Client {suffix}", phone_number=f"+1{suffix[:10]}", is_archived=False)
    db.add(client)
    db.flush()

    return client


def _make_home(db: Session, *, client: Guardian, is_archived: bool = False) -> Home:
    home = Home(label="Mum's", address="123 Main St", access_code="1234", is_archived=is_archived)
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=client.id, home_id=home.id))
    db.flush()

    return home


def _make_child(
    db: Session,
    *,
    guardians: list[Guardian],
    is_archived: bool = False,
) -> Child:
    child = Child(
        name=f"Child {uuid.uuid4().hex[:12]}",
        date_of_birth=datetime.date(2014, 5, 2),
        grade_level=7,
        school_name="Lincoln Middle School",
        is_archived=is_archived,
    )
    db.add(child)
    db.flush()
    db.add_all([ChildGuardian(child_id=child.id, guardian_id=one.id) for one in guardians])
    db.flush()

    return child
