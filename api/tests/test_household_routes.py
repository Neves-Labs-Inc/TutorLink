"""`GET /api/households` over HTTP — REQ-115.

The grouping is the point: a household is a connected component over `child_guardians`, so a
chain of links through a shared child joins guardians who share no child directly, and removing
the one link that bridges two groups splits them again on the very next request. Paging is by
whole household, and the read costs the same number of statements however many households exist.

Every test runs inside the rolled-back `db` transaction and the endpoint reads every guardian, so
the only rows it sees are the ones the test made.
"""

import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, event
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"
URL = "/api/households"


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


def _make_tutor_user(db: Session) -> User:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
    )
    db.add(tutor)
    db.flush()
    return _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _make_guardian(
    db: Session, name: str, *, phone_number: str | None = None, is_active: bool = True
) -> Guardian:
    guardian = Guardian(
        name=name,
        phone_number=phone_number or f"+1303{uuid.uuid4().int % 10**7:07d}",
        is_active=is_active,
    )
    db.add(guardian)
    db.flush()
    return guardian


def _make_child(
    db: Session, name: str, *, guardians: list[Guardian], is_active: bool = True
) -> Child:
    child = Child(
        name=name, grade_level=7, school_name="Lincoln Middle School", is_active=is_active
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
                        "is_active": True,
                    }
                ],
                "children": [
                    {"id": str(tommy.id), "name": "Tommy Doe", "grade_level": 7, "is_active": True}
                ],
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
                    "is_active": True,
                }
            ],
            "children": [],
        }
    ]


def test_inactive_members_are_included_carrying_their_flag_and_is_active_is_not_a_filter(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    _make_guardian(db, "Dormant Guardian", is_active=False)
    parent = _make_guardian(db, "Active Guardian")
    _make_child(db, "Dormant Child", guardians=[parent], is_active=False)

    default = _get(api, admin)
    flagged = _get(api, admin, is_active="false")

    assert flagged == default
    assert default["total"] == 2
    active, dormant = default["items"]
    assert active["guardians"][0]["is_active"] is True
    assert active["children"][0]["is_active"] is False
    assert dormant["guardians"][0]["is_active"] is False


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
