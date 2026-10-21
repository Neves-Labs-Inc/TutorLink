"""`POST /api/clients/{id}/homes` and `PATCH /api/homes/{id}` over HTTP — REQ-102.

Archiving a Home, and its upcoming-bookings guard, is `tests/test_archive_routes.py`. Every
refusal here re-reads the row, because a 400 whose body is right but whose other fields were
applied anyway is the failure A-49 exists to prevent.

Every negative case asserts the exact `{"detail": "..."}` body, not merely the status.
"""

import datetime
import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import OFFICE_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.routers import client_homes, clients, homes
from app.routers.booking_writes import REFERENCE_NOT_FOUND_ERROR
from app.security import create_access_token, hash_password
from app.services import home_sharing_service

PASSWORD = "correct horse battery staple"

CLIENT_NOT_FOUND_ERROR = "Client not found"
HOME_NOT_FOUND_ERROR = "Home not found"
BLANK_HOME_DETAILS_ERROR = "address must not be blank"
ARCHIVED_HOME_ERROR = "This home is archived; restore it first"
LAST_GUARDIAN_ERROR = "A home needs at least one Guardian; archive it instead"
GUARDIAN_NOT_ON_HOME_ERROR = "This Guardian is not on this home"
HOME_LOST_WITH_UPCOMING_BOOKINGS_ERROR = (
    "A Child would lose this home while it has upcoming bookings there; cancel or move them first"
)

HOME_READ_KEYS = {
    "id",
    "label",
    "address",
    "directions",
    "archived",
    "guardians",
    "upcoming_booking_count",
}

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

    response = _add(api, admin, client.id, label="Dad's", address="9 Elm St", directions="4321")
    body = response.json()

    assert response.status_code == 201
    assert set(body) == HOME_READ_KEYS
    assert body["label"] == "Dad's"
    assert body["address"] == "9 Elm St"
    assert body["directions"] == "4321"
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


@pytest.mark.parametrize("address", ["   ", ""])
def test_add_home_refuses_a_blank_address_and_writes_nothing(
    api: TestClient, db: Session, address: str
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    homes_before = _home_count(db)

    response = _add(api, admin, client.id, address=address)

    _assert_detail(response, 400, BLANK_HOME_DETAILS_ERROR)
    assert _home_count(db) == homes_before


def test_add_home_stores_a_blank_label_as_null_and_trims_the_rest(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    client = _make_client(db)

    response = _add(api, admin, client.id, label="  ", address="  9 Elm St ", directions=" 42 ")
    body = response.json()
    stored = db.get(Home, uuid.UUID(body["id"]))

    assert response.status_code == 201
    assert body["label"] is None
    assert stored is not None
    assert (stored.label, stored.address, stored.directions) == (None, "9 Elm St", "42")


@pytest.mark.parametrize("directions", [None, "  ", ""])
def test_add_home_stores_absent_or_blank_directions_as_null(
    api: TestClient, db: Session, directions: str | None
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    body = (
        {"address": "9 Elm St"}
        if directions is None
        else {"address": "9 Elm St", "directions": directions}
    )

    response = api.post(f"/api/clients/{client.id}/homes", json=body, headers=_auth(admin))
    stored = db.get(Home, uuid.UUID(response.json()["id"]))

    assert response.status_code == 201
    assert response.json()["directions"] is None
    assert stored is not None
    assert stored.directions is None


def test_add_home_accepts_500_characters_of_directions(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)

    response = _add(api, admin, client.id, directions="x" * 500)

    assert response.status_code == 201
    assert response.json()["directions"] == "x" * 500


@pytest.mark.parametrize(("field", "length"), [("label", 65), ("directions", 501)])
def test_add_home_refuses_a_field_over_its_limit_with_400(
    api: TestClient, db: Session, field: str, length: int
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    homes_before = _home_count(db)

    response = _add(api, admin, client.id, **{field: "x" * length})

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)
    assert _home_count(db) == homes_before


def test_add_home_without_an_address_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)

    response = api.post(
        f"/api/clients/{client.id}/homes", json={"directions": "1"}, headers=_auth(admin)
    )

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}


def test_add_home_for_an_unknown_client_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    homes_before = _home_count(db)

    response = _add(api, admin, uuid.uuid4())

    _assert_detail(response, 404, CLIENT_NOT_FOUND_ERROR)
    assert _home_count(db) == homes_before


# --- POST /api/homes -----------------------------------------------------------------------


def test_create_on_two_guardians_gives_one_home_both_families_can_book(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    amy = _make_client(db)
    amy.name = "Amy Doe"
    zed = _make_client(db)
    zed.name = "Zed Doe"
    amys_child = _make_child(db, guardians=[amy])
    zeds_child = _make_child(db, guardians=[zed])
    homes_before = _home_count(db)

    response = _create(api, admin, [zed.id, amy.id, zed.id], label="Shared", address=" 9 Elm ")
    body = response.json()

    assert response.status_code == 201
    assert set(body) == HOME_READ_KEYS
    assert body["address"] == "9 Elm"
    assert body["guardians"] == [
        {"id": str(amy.id), "name": "Amy Doe"},
        {"id": str(zed.id), "name": "Zed Doe"},
    ]
    assert _home_count(db) == homes_before + 1
    assert _child_home_ids(api, admin, amys_child) == [body["id"]]
    assert _child_home_ids(api, admin, zeds_child) == [body["id"]]


def test_create_allows_an_archived_guardian(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    archived = _make_client(db)
    archived.is_archived = True
    db.flush()

    response = _create(api, admin, [archived.id])

    assert response.status_code == 201
    assert response.json()["guardians"] == [{"id": str(archived.id), "name": archived.name}]


def test_create_with_an_unknown_guardian_is_404_and_writes_nothing(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    homes_before = _home_count(db)

    response = _create(api, admin, [client.id, uuid.uuid4()])

    _assert_detail(response, 404, CLIENT_NOT_FOUND_ERROR)
    assert _home_count(db) == homes_before
    assert _guardian_home_ids(db, client) == []


@pytest.mark.parametrize("address", ["   ", ""])
def test_create_refuses_a_blank_address_and_writes_nothing(
    api: TestClient, db: Session, address: str
) -> None:
    admin = _make_user(db)
    client = _make_client(db)
    homes_before = _home_count(db)

    response = _create(api, admin, [client.id], address=address)

    _assert_detail(response, 400, BLANK_HOME_DETAILS_ERROR)
    assert _home_count(db) == homes_before


def test_create_without_a_guardian_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    homes_before = _home_count(db)

    response = _create(api, admin, [])

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert _home_count(db) == homes_before


# --- POST /api/homes/{id}/guardians ---------------------------------------------------------


def test_share_adds_the_guardian_and_their_children_have_the_home(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    owner = _make_client(db)
    owner.name = "Amy Doe"
    partner = _make_client(db)
    partner.name, partner.is_archived = "Zed Doe", True
    partners_child = _make_child(db, guardians=[partner])
    home = _make_home(db, client=owner)

    response = _share(api, admin, home.id, partner.id)

    assert response.status_code == 200
    assert set(response.json()) == HOME_READ_KEYS
    assert response.json()["guardians"] == [
        {"id": str(owner.id), "name": "Amy Doe"},
        {"id": str(partner.id), "name": "Zed Doe"},
    ]
    assert _guardian_home_ids(db, partner) == [home.id]
    assert _child_home_ids(api, admin, partners_child) == [str(home.id)]


def test_sharing_with_a_guardian_already_on_the_home_is_a_no_op(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    owner = _make_client(db)
    home = _make_home(db, client=owner)

    response = _share(api, admin, home.id, owner.id)

    assert response.status_code == 200
    assert response.json()["guardians"] == [{"id": str(owner.id), "name": owner.name}]
    assert _guardian_home_ids(db, owner) == [home.id]


def test_sharing_an_archived_home_is_409_and_links_nothing(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db), is_archived=True)
    partner = _make_client(db)

    response = _share(api, admin, home.id, partner.id)

    _assert_detail(response, 409, ARCHIVED_HOME_ERROR)
    assert _guardian_home_ids(db, partner) == []


def test_sharing_an_unknown_home_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = _share(api, admin, uuid.uuid4(), _make_client(db).id)

    _assert_detail(response, 404, HOME_NOT_FOUND_ERROR)


def test_sharing_with_an_unknown_guardian_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _share(api, admin, home.id, uuid.uuid4())

    _assert_detail(response, 404, CLIENT_NOT_FOUND_ERROR)


# --- DELETE /api/homes/{id}/guardians/{guardian_id} -----------------------------------------


def test_unshare_removes_the_link(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    owner = _make_client(db)
    partner = _make_client(db)
    partners_child = _make_child(db, guardians=[partner])
    home = _make_home(db, client=owner)
    db.add(GuardianHome(guardian_id=partner.id, home_id=home.id))
    db.flush()

    response = _unshare(api, admin, home.id, partner.id)

    assert response.status_code == 200
    assert response.json()["guardians"] == [{"id": str(owner.id), "name": owner.name}]
    assert _guardian_home_ids(db, partner) == []
    assert _child_home_ids(api, admin, partners_child) == []


def test_unsharing_the_last_guardian_is_409(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    owner = _make_client(db)
    home = _make_home(db, client=owner)

    response = _unshare(api, admin, home.id, owner.id)

    _assert_detail(response, 409, LAST_GUARDIAN_ERROR)
    assert _guardian_home_ids(db, owner) == [home.id]


def test_unsharing_a_guardian_not_on_the_home_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _unshare(api, admin, home.id, _make_client(db).id)

    _assert_detail(response, 404, GUARDIAN_NOT_ON_HOME_ERROR)


def test_unsharing_an_unknown_home_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = _unshare(api, admin, uuid.uuid4(), _make_client(db).id)

    _assert_detail(response, 404, HOME_NOT_FOUND_ERROR)


def test_unshare_is_refused_while_a_child_losing_the_home_has_an_upcoming_booking_there(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    owner = _make_client(db)
    partner = _make_client(db)
    home = _make_home(db, client=owner)
    db.add(GuardianHome(guardian_id=partner.id, home_id=home.id))
    db.flush()
    later = _book(db, client=partner, home=home, on=TOMORROW + datetime.timedelta(days=1))
    sooner = _book(db, client=partner, home=home, on=TOMORROW)
    _book(db, client=partner, home=home, on=YESTERDAY)
    _book(db, client=partner, home=home, on=TOMORROW, status=BookingStatus.CANCELLED)

    response = _unshare(api, admin, home.id, partner.id)

    assert response.status_code == 409
    assert response.json() == {
        "detail": HOME_LOST_WITH_UPCOMING_BOOKINGS_ERROR,
        "booking_ids": [str(sooner.id), str(later.id)],
    }
    assert _guardian_home_ids(db, partner) == [home.id]


def test_unshare_is_allowed_when_the_childs_other_guardian_stays_on_the_home(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    owner = _make_client(db)
    partner = _make_client(db)
    home = _make_home(db, client=owner)
    db.add(GuardianHome(guardian_id=partner.id, home_id=home.id))
    db.flush()
    child = _make_child(db, guardians=[owner, partner])
    _book(db, client=partner, home=home, on=TOMORROW, child=child)

    response = _unshare(api, admin, home.id, partner.id)

    assert response.status_code == 200
    assert _guardian_home_ids(db, partner) == []
    assert _child_home_ids(api, admin, child) == [str(home.id)]


def test_a_shared_home_is_still_edited_and_archived_by_its_id(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    amy = _make_client(db)
    zed = _make_client(db)
    home_id = _create(api, admin, [amy.id, zed.id]).json()["id"]

    patched = _patch(api, admin, uuid.UUID(home_id), {"label": "Renamed"})
    archived = api.post("/api/archive", json={"type": "home", "id": home_id}, headers=_auth(admin))

    assert patched.status_code == 200
    assert patched.json()["label"] == "Renamed"
    assert len(patched.json()["guardians"]) == 2
    assert archived.status_code == 200


# --- PATCH /api/homes/{id} ------------------------------------------------------------------


def test_patch_directions_changes_only_that_field(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    owner = _make_client(db)
    home = _make_home(db, client=owner)

    response = _patch(api, admin, home.id, {"directions": " Side door "})

    assert response.status_code == 200
    assert response.json() == {
        "id": str(home.id),
        "label": "Mum's",
        "address": "123 Main St",
        "directions": "Side door",
        "archived": False,
        "guardians": [{"id": str(owner.id), "name": owner.name}],
        "upcoming_booking_count": 0,
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
    assert response.json()["directions"] == "1234"


@pytest.mark.parametrize(
    ("directions", "stored"),
    [("", None), ("   ", None), (None, "1234"), (" Back gate ", "Back gate")],
)
def test_patch_directions_clears_on_blank_and_is_left_alone_on_null(
    api: TestClient, db: Session, directions: str | None, stored: str | None
) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {"directions": directions})

    assert response.status_code == 200
    assert response.json()["directions"] == stored
    assert _reloaded(db, home).directions == stored


def test_patch_refuses_a_blank_address_and_applies_nothing(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {"address": "  ", "label": "X", "directions": ""})

    _assert_detail(response, 400, BLANK_HOME_DETAILS_ERROR)
    reloaded = _reloaded(db, home)
    assert (reloaded.label, reloaded.address, reloaded.directions) == (
        "Mum's",
        "123 Main St",
        "1234",
    )


def test_patch_directions_over_500_characters_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    home = _make_home(db, client=_make_client(db))

    response = _patch(api, admin, home.id, {"directions": "x" * 501})

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert _reloaded(db, home).directions == "1234"


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
    # Tutoring needs an Evaluated Child.
    child.evaluated_at = datetime.datetime.now(tz=datetime.UTC)
    child.evaluated_by_user_id = admin.id
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


# --- upcoming_booking_count -----------------------------------------------------------------

NOW = datetime.datetime(2031, 3, 4, 12, 0)
TODAY = NOW.date()
TOMORROW = TODAY + datetime.timedelta(days=1)
YESTERDAY = TODAY - datetime.timedelta(days=1)


def test_a_home_with_no_bookings_counts_zero(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    client = _make_client(db)

    response = _add(api, admin, client.id)

    assert response.json()["upcoming_booking_count"] == 0


def test_the_count_is_the_upcoming_live_bookings_the_archive_refusal_names(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    client = _make_client(db)
    home = _make_home(db, client=client)
    other_home = _make_home(db, client=client)
    _book(db, client=client, home=home, on=TOMORROW, status=BookingStatus.PENDING)
    _book(db, client=client, home=home, on=TOMORROW, status=BookingStatus.CONFIRMED)
    _book(db, client=client, home=home, on=YESTERDAY, status=BookingStatus.CONFIRMED)
    _book(db, client=client, home=home, on=TOMORROW, status=BookingStatus.CANCELLED)
    _book(db, client=client, home=other_home, on=TOMORROW, status=BookingStatus.CONFIRMED)

    patched = _patch(api, admin, home.id, {"label": "Renamed"})
    detail = api.get(f"/api/clients/{client.id}", headers=_auth(admin)).json()
    refusal = api.post(
        "/api/archive", json={"type": "home", "id": str(home.id)}, headers=_auth(admin)
    )

    counts = {entry["id"]: entry["upcoming_booking_count"] for entry in detail["homes"]}
    assert patched.json()["upcoming_booking_count"] == 2
    assert counts == {str(home.id): 2, str(other_home.id): 1}
    assert refusal.status_code == 409
    assert len(refusal.json()["booking_ids"]) == 2


def _book(
    db: Session,
    *,
    client: Guardian,
    home: Home,
    on: datetime.date,
    status: BookingStatus = BookingStatus.CONFIRMED,
    child: Child | None = None,
) -> Booking:
    tutor = _make_tutor(db)
    availability = _make_availability(db, tutor=tutor, weekday=on.weekday())
    booking = Booking(
        child_id=(child or _make_child(db, guardians=[client])).id,
        user_id=tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=_make_subject(db).id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=on,
        start_time=TWELVE,
        end_time=datetime.time(13, 0),
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


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


@pytest.mark.parametrize("route", ["create", "share", "unshare"])
def test_a_tutor_is_refused_the_sharing_routes_with_403(
    api: TestClient, db: Session, route: str
) -> None:
    tutor_user = _make_tutor_user(db)
    owner = _make_client(db)
    partner = _make_client(db)
    home = _make_home(db, client=owner)
    db.add(GuardianHome(guardian_id=partner.id, home_id=home.id))
    db.flush()
    homes_before = _home_count(db)

    if route == "create":
        response = _create(api, tutor_user, [owner.id])
    elif route == "share":
        response = _share(api, tutor_user, home.id, _make_client(db).id)
    else:
        response = _unshare(api, tutor_user, home.id, partner.id)

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)
    assert _home_count(db) == homes_before
    assert _guardian_home_ids(db, partner) == [home.id]


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
    assert home_sharing_service.BLANK_ADDRESS_ERROR == BLANK_HOME_DETAILS_ERROR


# --- helpers --------------------------------------------------------------------------------


def _home_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {"label": "Dad's", "address": "9 Elm St", "directions": "4321"}
    body.update(overrides)

    return body


def _create(
    api: TestClient, user: User, guardian_ids: list[uuid.UUID], **overrides: object
) -> Response:
    body = _home_body(guardian_ids=[str(guardian_id) for guardian_id in guardian_ids], **overrides)

    return api.post("/api/homes", json=body, headers=_auth(user))


def _share(api: TestClient, user: User, home_id: uuid.UUID, guardian_id: uuid.UUID) -> Response:
    return api.post(
        f"/api/homes/{home_id}/guardians",
        json={"guardian_id": str(guardian_id)},
        headers=_auth(user),
    )


def _unshare(api: TestClient, user: User, home_id: uuid.UUID, guardian_id: uuid.UUID) -> Response:
    return api.delete(f"/api/homes/{home_id}/guardians/{guardian_id}", headers=_auth(user))


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
    home = Home(label="Mum's", address="123 Main St", directions="1234", is_archived=is_archived)
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
