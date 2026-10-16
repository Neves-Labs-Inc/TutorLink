"""`GET /api/households` over HTTP — REQ-115.

The grouping is the point: a household is a connected component over `child_guardians`, so a
chain of links through a shared child joins guardians who share no child directly, and removing
the one link that bridges two groups splits them again on the very next request. Paging is by
whole household, and the read costs the same number of statements however many households exist.

Every test runs inside the rolled-back `db` transaction and the endpoint reads every guardian, so
the only rows it sees are the ones the test made.
"""

import datetime
import uuid
from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, event
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"
URL = "/api/households"
FROZEN_NOW = datetime.datetime(2026, 9, 23, 12, 0)
TODAY = FROZEN_NOW.date()
TOMORROW = TODAY + datetime.timedelta(days=1)
YESTERDAY = TODAY - datetime.timedelta(days=1)


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


def _make_tutor_user(db: Session) -> User:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _make_guardian(
    db: Session, name: str, *, phone_number: str | None = None, is_archived: bool = False
) -> Guardian:
    guardian = Guardian(
        name=name,
        phone_number=phone_number or f"+1303{uuid.uuid4().int % 10**7:07d}",
        is_archived=is_archived,
    )
    db.add(guardian)
    db.flush()
    return guardian


def _make_child(
    db: Session, name: str, *, guardians: list[Guardian], is_archived: bool = False
) -> Child:
    child = Child(
        name=name, grade_level=7, school_name="Lincoln Middle School", is_archived=is_archived
    )
    db.add(child)
    db.flush()
    for guardian in guardians:
        _link(db, child=child, guardian=guardian)
    return child


def _link(db: Session, *, child: Child, guardian: Guardian) -> None:
    db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
    db.flush()


def _names(household: dict[str, list[dict[str, str]]]) -> tuple[list[str], list[str]]:
    return (
        [guardian["name"] for guardian in household["guardians"]],
        [child["name"] for child in household["children"]],
    )


def _get(api: TestClient, admin: User, **params: str | int) -> dict:
    response = api.get(URL, headers=_auth(admin), params=params)
    assert response.status_code == 200
    return response.json()


def _chained_family(db: Session) -> dict[str, Guardian | Child]:
    """Mum and Dad share Kid A; Partner has Kid B; Dad also has Kid B. The user's example."""
    mum = _make_guardian(db, "Mum")
    dad = _make_guardian(db, "Dad")
    partner = _make_guardian(db, "Partner")
    kid_a = _make_child(db, "Kid A", guardians=[mum, dad])
    kid_b = _make_child(db, "Kid B", guardians=[partner, dad])
    return {"mum": mum, "dad": dad, "partner": partner, "kid_a": kid_a, "kid_b": kid_b}


@pytest.fixture
def statements(db: Session) -> Generator[list[str], None, None]:
    captured: list[str] = []

    def record(
        connection: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        captured.append(statement)

    bind = db.get_bind()
    event.listen(bind, "before_cursor_execute", record)
    try:
        yield captured
    finally:
        event.remove(bind, "before_cursor_execute", record)


# --- the envelope and the RBAC gate ---------------------------------------------------------


def test_list_returns_the_page_envelope_with_the_pinned_item_shape(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    jane = _make_guardian(db, "Jane Doe", phone_number="+12025550123")
    tommy = _make_child(db, "Tommy Doe", guardians=[jane])

    body = _get(api, admin)

    assert body == {
        "items": [
            {
                "key": str(jane.id),
                "guardians": [
                    {
                        "id": str(jane.id),
                        "name": "Jane Doe",
                        "phone_number": "+12025550123",
                        "archived": False,
                    }
                ],
                "children": [
                    {"id": str(tommy.id), "name": "Tommy Doe", "grade_level": 7, "archived": False}
                ],
                "name": "Doe family",
                "archived": False,
                "homes": [],
                "next_booking": None,
            }
        ],
        "total": 1,
        "page": 1,
        "page_size": 20,
    }


def test_a_tutor_is_refused_with_403(api: TestClient, db: Session) -> None:
    """A 403 rather than a 500 also proves the route does not depend on `TutorScope`."""
    tutor = _make_tutor_user(db)
    _make_guardian(db, "Jane Doe")

    response = api.get(URL, headers=_auth(tutor))

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)


def test_no_token_is_401_not_403(api: TestClient) -> None:
    response = api.get(URL)

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


def test_a_developer_may_list_households(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    assert api.get(URL, headers=_auth(developer)).status_code == 200


@pytest.mark.parametrize("query", ["page=0", "page_size=0", "page_size=101", "page=abc"])
def test_bad_paging_is_400_not_422(api: TestClient, db: Session, query: str) -> None:
    admin = _make_user(db)

    response = api.get(f"{URL}?{query}", headers=_auth(admin))

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


# --- grouping ---------------------------------------------------------------------------------


def test_a_chain_of_links_through_a_shared_child_is_one_household(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    family = _chained_family(db)

    body = _get(api, admin)

    assert body["total"] == 1
    assert _names(body["items"][0]) == (["Dad", "Mum", "Partner"], ["Kid A", "Kid B"])
    assert body["items"][0]["key"] == str(family["dad"].id)


def test_removing_the_bridging_link_splits_the_household_in_two(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    family = _chained_family(db)
    assert _get(api, admin)["total"] == 1

    db.execute(
        delete(ChildGuardian).where(
            ChildGuardian.child_id == family["kid_b"].id,
            ChildGuardian.guardian_id == family["dad"].id,
        )
    )
    db.flush()
    body = _get(api, admin)

    assert body["total"] == 2
    assert [_names(household) for household in body["items"]] == [
        (["Dad", "Mum"], ["Kid A"]),
        (["Partner"], ["Kid B"]),
    ]


def test_a_guardian_with_no_children_is_a_household_of_one(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    solo = _make_guardian(db, "Solo Guardian")

    body = _get(api, admin)

    assert body["items"] == [
        {
            "key": str(solo.id),
            "guardians": [
                {
                    "id": str(solo.id),
                    "name": "Solo Guardian",
                    "phone_number": solo.phone_number,
                    "archived": False,
                }
            ],
            "children": [],
            "name": "Guardian family",
            "archived": False,
            "homes": [],
            "next_booking": None,
        }
    ]


def test_archived_members_are_included_carrying_their_flag_and_is_active_is_not_a_filter(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    _make_guardian(db, "Dormant Guardian", is_archived=True)
    parent = _make_guardian(db, "Active Guardian")
    _make_child(db, "Dormant Child", guardians=[parent], is_archived=True)

    default = _get(api, admin, include_archived="true")
    flagged = _get(api, admin, include_archived="true", is_active="false")

    assert flagged == default
    assert default["total"] == 2
    active, dormant = default["items"]
    assert active["guardians"][0]["archived"] is False
    assert active["children"][0]["archived"] is True
    assert dormant["guardians"][0]["archived"] is True


# --- search -----------------------------------------------------------------------------------


def test_a_child_name_match_returns_the_whole_household(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _chained_family(db)
    _make_guardian(db, "Unrelated")

    body = _get(api, admin, q="  kid b ")

    assert body["total"] == 1
    assert _names(body["items"][0]) == (["Dad", "Mum", "Partner"], ["Kid A", "Kid B"])


@pytest.mark.parametrize("q", ["(202) 555-0199", "5550199", "+1 202.555.0199"])
def test_a_formatted_or_partial_phone_number_finds_the_guardian_household(
    api: TestClient, db: Session, q: str
) -> None:
    admin = _make_user(db)
    john = _make_guardian(db, "John Doe", phone_number="+12025550199")
    _make_child(db, "Tommy Doe", guardians=[john])
    _make_guardian(db, "Someone Else", phone_number="+12025550123")

    body = _get(api, admin, q=q)

    assert body["total"] == 1
    assert _names(body["items"][0]) == (["John Doe"], ["Tommy Doe"])


@pytest.mark.parametrize("q", ["zzz", "%", "_", "555-01x9"])
def test_a_term_nothing_contains_matches_no_household(api: TestClient, db: Session, q: str) -> None:
    """`%` and `_` are literal, and a term with a letter in it is never a phone search."""
    admin = _make_user(db)
    john = _make_guardian(db, "John Doe", phone_number="+12025550199")
    _make_child(db, "Tommy Doe", guardians=[john])

    body = _get(api, admin, q=q)

    assert body["total"] == 0
    assert body["items"] == []


@pytest.mark.parametrize("q", ["", "   "])
def test_a_blank_term_is_no_filter(api: TestClient, db: Session, q: str) -> None:
    admin = _make_user(db)
    _make_guardian(db, "Anne")
    _make_guardian(db, "Bert")

    assert _get(api, admin, q=q)["total"] == 2


# --- paging and ordering ----------------------------------------------------------------------


def test_paging_is_by_whole_household_and_total_is_every_match(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    for name in ["E", "C", "A", "D", "B"]:
        _make_guardian(db, name)

    pages = [_get(api, admin, page=page, page_size=2) for page in (1, 2, 3)]

    assert [len(body["items"]) for body in pages] == [2, 2, 1]
    assert [body["total"] for body in pages] == [5, 5, 5]
    keys = [household["key"] for body in pages for household in body["items"]]
    assert len(set(keys)) == 5
    assert [household["guardians"][0]["name"] for body in pages for household in body["items"]] == [
        "A",
        "B",
        "C",
        "D",
        "E",
    ]


def test_a_household_is_never_split_across_a_page_boundary(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _make_guardian(db, "Aaron")
    _chained_family(db)
    _make_guardian(db, "Zed")

    pages = [_get(api, admin, page=page, page_size=1) for page in (1, 2, 3, 4)]

    assert [body["total"] for body in pages] == [3, 3, 3, 3]
    assert [[_names(household) for household in body["items"]] for body in pages] == [
        [(["Aaron"], [])],
        [(["Dad", "Mum", "Partner"], ["Kid A", "Kid B"])],
        [(["Zed"], [])],
        [],
    ]


def test_ordering_is_case_insensitive_deterministic_and_breaks_name_ties_by_id(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    twins = [_make_guardian(db, "sam same"), _make_guardian(db, "Sam Same")]
    _make_guardian(db, "bob")
    _make_guardian(db, "Alice")
    parent = _make_guardian(db, "Parent")
    siblings = [_make_child(db, "Kit", guardians=[parent]) for _ in range(3)]

    first = _get(api, admin)
    second = _get(api, admin)

    assert first == second
    households = first["items"]
    assert [household["guardians"][0]["name"] for household in households][:2] == ["Alice", "bob"]
    assert [household["key"] for household in households[3:]] == [
        str(twin.id) for twin in sorted(twins, key=lambda twin: twin.id)
    ]
    assert [child["id"] for child in households[2]["children"]] == [
        str(sibling.id) for sibling in sorted(siblings, key=lambda sibling: sibling.id)
    ]


# --- cost -------------------------------------------------------------------------------------


def test_the_read_costs_a_constant_number_of_statements(
    api: TestClient, db: Session, statements: list[str]
) -> None:
    admin = _make_user(db)
    headers = _auth(admin)
    _chained_family(db)
    api.get(URL, headers=headers)
    statements.clear()

    api.get(URL, headers=headers)
    few = len(statements)

    for index in range(10):
        guardian = _make_guardian(db, f"Guardian {index}")
        _make_child(db, f"Child {index}", guardians=[guardian])
    statements.clear()
    api.get(URL, headers=headers)

    assert len(statements) == few


def test_the_read_with_homes_and_bookings_costs_a_constant_number_of_statements(
    api: TestClient,
    db: Session,
    statements: list[str],
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    freeze_business_clock(FROZEN_NOW)
    admin = _make_user(db)
    headers = _auth(admin)
    _family_with_home_and_booking(db, "Seed")
    api.get(URL, headers=headers)
    statements.clear()

    api.get(URL, headers=headers)
    few = len(statements)

    for index in range(10):
        _family_with_home_and_booking(db, f"Family{index}")
    statements.clear()
    api.get(URL, headers=headers)

    assert len(statements) == few


# --- family read helpers ----------------------------------------------------------------------


def _make_home(db: Session, *, owners: list[Guardian], is_archived: bool = False) -> Home:
    home = Home(
        label="Main",
        address=f"{uuid.uuid4().hex[:6]} Elm Street",
        directions="Gate 1234",
        is_archived=is_archived,
    )
    db.add(home)
    db.flush()
    for owner in owners:
        db.add(GuardianHome(guardian_id=owner.id, home_id=home.id))
    db.flush()
    return home


def _book(
    db: Session,
    *,
    child: Child,
    on: datetime.date,
    start: datetime.time,
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> Booking:
    """An in-office Regular booking written straight to the table, each with its own Staff
    member so none collides on `excl_bookings_live_overlap`."""
    staff = _make_user(db)
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:8]}")
    db.add(subject)
    db.flush()
    booking = Booking(
        child_id=child.id,
        user_id=staff.id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.IN_OFFICE,
        subject_id=subject.id,
        scheduled_date=on,
        start_time=start,
        end_time=(datetime.datetime.combine(on, start) + datetime.timedelta(hours=1)).time(),
        status=status,
    )
    db.add(booking)
    db.flush()
    return booking


def _family_with_home_and_booking(db: Session, surname: str) -> None:
    guardian = _make_guardian(db, f"Pat {surname}")
    child = _make_child(db, f"Kid {surname}", guardians=[guardian])
    _make_home(db, owners=[guardian])
    _book(db, child=child, on=TOMORROW, start=datetime.time(9, 0))


def _read(api: TestClient, admin: User, member_id: uuid.UUID) -> dict:
    response = api.get(f"{URL}/{member_id}", headers=_auth(admin))
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def frozen_now(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(FROZEN_NOW)


# --- the single family read -------------------------------------------------------------------


def test_reading_by_a_guardian_or_a_child_returns_the_same_family_as_the_list(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    family = _chained_family(db)
    _make_guardian(db, "Unrelated")

    by_guardian = _read(api, admin, family["partner"].id)
    by_child = _read(api, admin, family["kid_a"].id)

    assert by_guardian == by_child
    listed = [item for item in _get(api, admin)["items"] if item["key"] == by_guardian["key"]]
    assert listed == [by_guardian]
    assert _names(by_guardian) == (["Dad", "Mum", "Partner"], ["Kid A", "Kid B"])


def test_an_unknown_member_id_is_404_family_not_found(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    _chained_family(db)

    response = api.get(f"{URL}/{uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json() == {"detail": "Family not found"}


def test_an_archived_family_reads_fine(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db, "Ana Gomez", is_archived=True)
    child = _make_child(db, "Leo Gomez", guardians=[guardian], is_archived=True)

    body = _read(api, admin, child.id)

    assert body["archived"] is True
    assert body["key"] == str(guardian.id)


def test_a_tutor_is_refused_the_single_read(api: TestClient, db: Session) -> None:
    tutor = _make_tutor_user(db)
    guardian = _make_guardian(db, "Jane Doe")

    assert api.get(f"{URL}/{guardian.id}", headers=_auth(tutor)).status_code == 403


# --- the family name --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("guardians", "expected"),
    [
        ([("Ana Gomez", False)], "Gomez family"),
        ([("Ana Gomez", False), ("Luis GOMEZ", False)], "Gomez family"),
        ([("Rosa Reyes", False), ("Carlos Martinez", False)], "Martinez & Reyes family"),
        (
            [("Ana Gomez", False), ("Bea Lopez", False), ("Cy Diaz", False)],
            "Ana Gomez + 2 family",
        ),
        ([("Ana Gomez", False), ("Old Reyes", True)], "Gomez family"),
        ([("Ana Gomez", True), ("Rosa Reyes", True)], "Gomez & Reyes family"),
        ([("Cher", False)], "Cher family"),
    ],
    ids=["one", "shared-surname", "two", "three", "archived-ignored", "all-archived", "one-word"],
)
def test_the_family_name_is_built_from_guardian_surnames(
    api: TestClient, db: Session, guardians: list[tuple[str, bool]], expected: str
) -> None:
    admin = _make_user(db)
    members = [_make_guardian(db, name, is_archived=archived) for name, archived in guardians]
    child = _make_child(db, "Kid", guardians=members)

    assert _read(api, admin, child.id)["name"] == expected


# --- homes ------------------------------------------------------------------------------------


def test_a_home_shared_by_two_guardians_appears_once_with_both_guardian_ids(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    mum = _make_guardian(db, "Mum Gomez")
    dad = _make_guardian(db, "Dad Gomez", is_archived=True)
    child = _make_child(db, "Kid Gomez", guardians=[mum, dad])
    shared = _make_home(db, owners=[mum, dad])
    old = _make_home(db, owners=[dad], is_archived=True)

    homes = _read(api, admin, child.id)["homes"]

    # Both Homes share the transaction's `created_at`, so the order between them is by id.
    assert len(homes) == 2
    assert {home["id"]: home for home in homes} == {
        str(shared.id): {
            "id": str(shared.id),
            "label": "Main",
            "address": shared.address,
            "directions": "Gate 1234",
            "archived": False,
            "guardian_ids": [str(dad.id), str(mum.id)],
        },
        str(old.id): {
            "id": str(old.id),
            "label": "Main",
            "address": old.address,
            "directions": "Gate 1234",
            "archived": True,
            "guardian_ids": [str(dad.id)],
        },
    }


# --- next booking -----------------------------------------------------------------------------


def test_next_booking_is_the_earliest_upcoming_live_one_of_any_child(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db, "Ana Gomez")
    leo = _make_child(db, "Leo Gomez", guardians=[guardian])
    mia = _make_child(db, "Mia Gomez", guardians=[guardian])
    _book(db, child=leo, on=YESTERDAY, start=datetime.time(9, 0))
    _book(db, child=leo, on=TODAY, start=datetime.time(11, 0))
    _book(db, child=leo, on=TODAY, start=datetime.time(13, 0), status=BookingStatus.CANCELLED)
    _book(db, child=leo, on=TOMORROW, start=datetime.time(9, 0))
    earliest = _book(db, child=mia, on=TODAY, start=datetime.time(15, 0))

    body = _read(api, admin, guardian.id)

    assert body["next_booking"] == {
        "id": str(earliest.id),
        "kind": "regular",
        "scheduled_date": "2026-09-23",
        "start_time": "15:00:00",
        "end_time": "16:00:00",
        "location": "in_office",
        "child": {"id": str(mia.id), "name": "Mia Gomez"},
        "staff": {"id": str(earliest.user_id), "name": "Test User"},
    }


def test_next_booking_is_null_when_only_past_and_cancelled_ones_exist(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db, "Ana Gomez")
    leo = _make_child(db, "Leo Gomez", guardians=[guardian])
    _book(db, child=leo, on=YESTERDAY, start=datetime.time(9, 0))
    _book(db, child=leo, on=TOMORROW, start=datetime.time(9, 0), status=BookingStatus.CANCELLED)

    assert _read(api, admin, guardian.id)["next_booking"] is None


# --- the archived filter ----------------------------------------------------------------------


def test_the_list_hides_all_archived_families_unless_asked(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    gone = _make_guardian(db, "Ana Gone", is_archived=True)
    half = [_make_guardian(db, "Bo Half"), _make_guardian(db, "Cy Half", is_archived=True)]
    _make_child(db, "Kid Half", guardians=half)
    _make_guardian(db, "Di Live")

    default = _get(api, admin)
    everything = _get(api, admin, include_archived="true")

    assert default["total"] == 2
    assert [item["name"] for item in default["items"]] == ["Half family", "Live family"]
    assert all(item["archived"] is False for item in default["items"])
    assert everything["total"] == 3
    assert everything["items"][0]["key"] == str(gone.id)
    assert everything["items"][0]["archived"] is True
