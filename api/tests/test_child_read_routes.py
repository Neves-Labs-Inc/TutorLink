"""`GET /api/children` and `GET /api/children/{id}` over HTTP — REQ-111, REQ-112.

Three things here are worth more than the rest: `total` is asserted to count children, not
`child_guardians` rows, on a search where one child matches through two guardians; the list is
asserted to run the same number of SQL statements for a page of one child and a page of five;
and `next_session` / `upcoming_session_count` are asserted against a frozen business clock with a
session earlier the same day, which a date-granular "upcoming" would wrongly count.

Search terms carry a per-test token so that rows committed by a concurrent two-connection test
elsewhere in the suite can never land in a page asserted on here.
"""

import datetime
import uuid
from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers import children, children_read
from app.security import create_access_token, hash_password

PASSWORD = "correct horse battery staple"
CHILD_NOT_FOUND_ERROR = "Child not found"

NOW = datetime.datetime(2026, 10, 5, 12, 0)
TODAY = NOW.date()
YESTERDAY = TODAY - datetime.timedelta(days=1)
TOMORROW = TODAY + datetime.timedelta(days=1)
IN_THREE_DAYS = TODAY + datetime.timedelta(days=3)

NINE = datetime.time(9, 0)
FOURTEEN = datetime.time(14, 0)


@pytest.fixture
def frozen_now(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(NOW)


@pytest.fixture
def token() -> str:
    return "".join(chr(ord("a") + int(digit, 16) % 26) for digit in uuid.uuid4().hex[:10])


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


# --- the envelope, the flag and the RBAC gate ------------------------------------------------


def test_list_returns_the_page_envelope_never_a_bare_array(
    api: TestClient, db: Session, token: str
) -> None:
    admin = _make_user(db)
    _make_child(db, name=f"Tommy {token}")

    response = api.get(f"/api/children?q={token}", headers=_auth(admin))
    body = response.json()

    assert response.status_code == 200
    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert (body["total"], body["page"], body["page_size"]) == (1, 1, 20)


def test_deactivated_children_are_hidden_until_asked_for(
    api: TestClient, db: Session, token: str
) -> None:
    admin = _make_user(db)
    active = _make_child(db, name=f"Active {token}")
    dormant = _make_child(db, name=f"Dormant {token}", is_active=False)
    headers = _auth(admin)

    default = api.get(f"/api/children?q={token}", headers=headers).json()
    inactive = api.get(f"/api/children?q={token}&is_active=false", headers=headers).json()

    assert [row["id"] for row in default["items"]] == [str(active.id)]
    assert default["total"] == 1
    assert [row["id"] for row in inactive["items"]] == [str(dormant.id)]
    assert inactive["items"][0]["is_active"] is False
    assert inactive["total"] == 1


@pytest.mark.parametrize(
    "query",
    ["is_active=maybe", "page=0", "page_size=0", "page_size=101"],
)
def test_malformed_list_query_is_400_not_422(api: TestClient, db: Session, query: str) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/children?{query}", headers=_auth(admin))

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("path", ["/api/children", "/api/children/{id}"])
def test_a_tutor_is_refused_with_403(api: TestClient, db: Session, path: str) -> None:
    tutor_user = _make_tutor_user(db)
    child = _make_child(db)

    response = api.get(path.format(id=child.id), headers=_auth(tutor_user))

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("path", ["/api/children", "/api/children/{id}"])
def test_no_token_is_401(api: TestClient, db: Session, path: str) -> None:
    child = _make_child(db)

    response = api.get(path.format(id=child.id))

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


def test_both_routes_answer_an_admin_with_bookings_present(
    api: TestClient, db: Session, token: str, frozen_now: None
) -> None:
    """Both routes read `bookings`, a tutor-owned table. Either one taking `TutorScope` without
    reading it would arm the unapplied-scope guard and turn this into a 500 (§15)."""
    admin = _make_user(db)
    child = _make_child(db, name=f"Tommy {token}")
    _book(db, child=child, on=TOMORROW, start=NINE)
    headers = _auth(admin)

    listed = api.get(f"/api/children?q={token}", headers=headers)
    detail = api.get(f"/api/children/{child.id}", headers=headers)

    assert listed.status_code == 200
    assert listed.json()["items"][0]["next_session"] is not None
    assert detail.status_code == 200
    assert detail.json()["upcoming_session_count"] == 1


# --- guardians and homes ----------------------------------------------------------------------


def test_list_row_nests_every_guardian_and_only_active_homes(
    api: TestClient, db: Session, token: str
) -> None:
    admin = _make_user(db)
    zed = _make_guardian(db, name="Zed Doe", is_active=False)
    amy = _make_guardian(db, name="Amy Doe")
    active_home = _make_home(db, label="Mum's")
    dormant_home = _make_home(db, label="Dad's", is_active=False)
    child = _make_child(
        db, name=f"Tommy {token}", guardians=[zed, amy], homes=[active_home, dormant_home]
    )

    body = api.get(f"/api/children?q={token}", headers=_auth(admin)).json()

    row = body["items"][0]
    assert row["id"] == str(child.id)
    assert row["guardians"] == [
        {"id": str(amy.id), "name": "Amy Doe"},
        {"id": str(zed.id), "name": "Zed Doe"},
    ]
    assert row["homes"] == [
        {
            "id": str(active_home.id),
            "label": "Mum's",
            "address": active_home.address,
            "is_active": True,
        }
    ]
    assert set(row) == {
        "id",
        "name",
        "grade_level",
        "school_name",
        "is_active",
        "guardians",
        "homes",
        "next_session",
    }


def test_detail_nests_every_guardian_and_every_home(
    api: TestClient, db: Session, token: str
) -> None:
    admin = _make_user(db)
    zed = _make_guardian(db, name="Zed Doe", is_active=False)
    amy = _make_guardian(db, name="Amy Doe")
    older = _make_home(db, label="Dad's", is_active=False, created_days_ago=2)
    newer = _make_home(db, label="Mum's", created_days_ago=1)
    child = _make_child(db, name=f"Tommy {token}", guardians=[zed, amy], homes=[newer, older])

    response = api.get(f"/api/children/{child.id}", headers=_auth(admin))
    body = response.json()

    assert response.status_code == 200
    assert body["guardians"] == [
        {"id": str(amy.id), "name": "Amy Doe", "phone_number": amy.phone_number, "is_active": True},
        {
            "id": str(zed.id),
            "name": "Zed Doe",
            "phone_number": zed.phone_number,
            "is_active": False,
        },
    ]
    assert body["homes"] == [
        {
            "id": str(older.id),
            "label": "Dad's",
            "address": older.address,
            "access_code": "1234",
            "is_active": False,
        },
        {
            "id": str(newer.id),
            "label": "Mum's",
            "address": newer.address,
            "access_code": "1234",
            "is_active": True,
        },
    ]


def test_list_homes_are_ordered_by_creation(api: TestClient, db: Session, token: str) -> None:
    admin = _make_user(db)
    older = _make_home(db, label="Older", created_days_ago=2)
    newer = _make_home(db, label="Newer", created_days_ago=1)
    _make_child(db, name=f"Tommy {token}", homes=[newer, older])

    body = api.get(f"/api/children?q={token}", headers=_auth(admin)).json()

    assert [home["id"] for home in body["items"][0]["homes"]] == [str(older.id), str(newer.id)]


# --- next_session and upcoming_session_count --------------------------------------------------


def test_next_session_is_the_earliest_live_booking_after_now(
    api: TestClient, db: Session, token: str, frozen_now: None
) -> None:
    admin = _make_user(db)
    child = _make_child(db, name=f"Tommy {token}")
    _book(db, child=child, on=YESTERDAY, start=NINE, status=BookingStatus.CONFIRMED)
    _book(db, child=child, on=TODAY, start=NINE, status=BookingStatus.CONFIRMED)
    _book(db, child=child, on=TOMORROW, start=FOURTEEN, status=BookingStatus.CANCELLED)
    expected = _book(db, child=child, on=TOMORROW, start=NINE, status=BookingStatus.PENDING)
    _book(db, child=child, on=IN_THREE_DAYS, start=NINE, status=BookingStatus.CONFIRMED)
    headers = _auth(admin)

    listed = api.get(f"/api/children?q={token}", headers=headers).json()
    detail = api.get(f"/api/children/{child.id}", headers=headers).json()

    assert listed["items"][0]["next_session"] == {
        "id": str(expected.id),
        "scheduled_date": TOMORROW.isoformat(),
        "start_time": "09:00:00",
        "end_time": "10:00:00",
        "tutor": {"id": str(expected.tutor.id), "name": expected.tutor.name},
        "subject": {"id": str(expected.subject.id), "name": expected.subject.name},
    }
    assert detail["upcoming_session_count"] == 2


def test_no_live_booking_after_now_is_null_and_zero(
    api: TestClient, db: Session, token: str, frozen_now: None
) -> None:
    admin = _make_user(db)
    child = _make_child(db, name=f"Tommy {token}")
    _book(db, child=child, on=YESTERDAY, start=NINE, status=BookingStatus.CONFIRMED)
    _book(db, child=child, on=TODAY, start=NINE, status=BookingStatus.CONFIRMED)
    _book(db, child=child, on=TOMORROW, start=NINE, status=BookingStatus.CANCELLED)
    _book(db, child=_make_child(db), on=TOMORROW, start=FOURTEEN)
    headers = _auth(admin)

    listed = api.get(f"/api/children?q={token}", headers=headers).json()
    detail = api.get(f"/api/children/{child.id}", headers=headers).json()

    assert listed["items"][0]["next_session"] is None
    assert detail["upcoming_session_count"] == 0


def test_each_child_on_a_page_gets_its_own_next_session(
    api: TestClient, db: Session, token: str, frozen_now: None
) -> None:
    """The batched `DISTINCT ON (child_id)` must partition by child, not keep one row for the
    whole page."""
    admin = _make_user(db)
    first = _make_child(db, name=f"Anna {token}")
    second = _make_child(db, name=f"Bert {token}")
    first_next = _book(db, child=first, on=IN_THREE_DAYS, start=NINE)
    second_next = _book(db, child=second, on=TOMORROW, start=FOURTEEN)
    _book(db, child=second, on=IN_THREE_DAYS, start=FOURTEEN)

    body = api.get(f"/api/children?q={token}", headers=_auth(admin)).json()

    assert [row["next_session"]["id"] for row in body["items"]] == [
        str(first_next.id),
        str(second_next.id),
    ]


# --- search -----------------------------------------------------------------------------------


def test_q_matches_a_guardian_name_or_the_childs_and_total_counts_children(
    api: TestClient, db: Session, token: str
) -> None:
    """Tommy matches through both guardians. A join over `child_guardians` would make him two
    rows and `total` 3."""
    admin = _make_user(db)
    jane = _make_guardian(db, name=f"Jane{token} Doe")
    janine = _make_guardian(db, name=f"Jane{token}ine Roe")
    john = _make_guardian(db, name="John Smith")
    tommy = _make_child(db, name="Tommy", guardians=[jane, janine])
    janet = _make_child(db, name=f"Jane{token}t", guardians=[john])
    _make_child(db, name="Billy", guardians=[john])

    body = api.get(f"/api/children?q=JANE{token.upper()}", headers=_auth(admin)).json()

    assert body["total"] == 2
    assert [row["id"] for row in body["items"]] == [str(janet.id), str(tommy.id)]


def test_q_wildcards_match_themselves(api: TestClient, db: Session, token: str) -> None:
    admin = _make_user(db)
    literal = _make_child(db, name=f"100% {token}")
    _make_child(db, name=f"100 {token}")
    headers = _auth(admin)

    percent = api.get("/api/children", params={"q": f"% {token}"}, headers=headers).json()
    underscore = api.get("/api/children", params={"q": f"_{token}"}, headers=headers).json()

    assert [row["id"] for row in percent["items"]] == [str(literal.id)]
    assert underscore["total"] == 0


def test_blank_q_is_no_filter(api: TestClient, db: Session, token: str) -> None:
    admin = _make_user(db)
    _make_child(db, name=f"Tommy {token}")
    headers = _auth(admin)

    unfiltered = api.get("/api/children", params={"page_size": 100}, headers=headers).json()
    blank = api.get("/api/children", params={"q": "   ", "page_size": 100}, headers=headers).json()

    assert blank["total"] == unfiltered["total"] >= 1


# --- order and paging -------------------------------------------------------------------------


def test_paging_walks_every_child_once_in_name_then_id_order(
    api: TestClient, db: Session, token: str
) -> None:
    admin = _make_user(db)
    made = [
        _make_child(db, name=f"{name} {token}") for name in ("Cara", "Anna", "Bert", "Anna", "Dan")
    ]
    expected = [str(child.id) for child in sorted(made, key=lambda child: (child.name, child.id))]
    headers = _auth(admin)

    walked = [
        row["id"]
        for page in range(1, len(made) + 1)
        for row in api.get(
            f"/api/children?q={token}&page={page}&page_size=1", headers=headers
        ).json()["items"]
    ]

    assert walked == expected


def test_the_list_runs_the_same_statements_for_one_child_or_five(
    api: TestClient, db: Session, token: str, frozen_now: None, statements: list[str]
) -> None:
    admin = _make_user(db)
    for index in range(5):
        guardian = _make_guardian(db)
        home = _make_home(db)
        child = _make_child(db, name=f"Child {index} {token}", guardians=[guardian], homes=[home])
        _book(db, child=child, on=TOMORROW, start=datetime.time(9 + index, 0))
    headers = _auth(admin)
    counts = []

    for page_size in (1, 5):
        db.expire_all()
        statements.clear()
        body = api.get(f"/api/children?q={token}&page_size={page_size}", headers=headers).json()

        assert len(body["items"]) == page_size
        assert all(row["next_session"] is not None for row in body["items"])
        counts.append(len(statements))

    assert counts[0] == counts[1] > 0


# --- the by-id read ---------------------------------------------------------------------------


def test_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get(f"/api/children/{uuid.uuid4()}", headers=_auth(admin))

    assert response.status_code == 404
    assert response.json() == {"detail": CHILD_NOT_FOUND_ERROR}


def test_the_not_found_message_matches_the_write_routes() -> None:
    assert children_read.CHILD_NOT_FOUND_ERROR == children.CHILD_NOT_FOUND_ERROR


def test_a_malformed_child_id_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/children/not-a-uuid", headers=_auth(admin))

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_an_inactive_childs_detail_is_200(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db, is_active=False, notes="Peanut allergy")

    response = api.get(f"/api/children/{child.id}", headers=_auth(admin))
    body = response.json()

    assert response.status_code == 200
    assert body["is_active"] is False
    assert body["notes"] == "Peanut allergy"
    assert body["date_of_birth"] == "2014-05-02"
    assert set(body) == {
        "id",
        "name",
        "date_of_birth",
        "grade_level",
        "school_name",
        "notes",
        "is_active",
        "upcoming_session_count",
        "guardians",
        "homes",
    }


# --- helpers ----------------------------------------------------------------------------------


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
    return _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}", phone_number=f"+1{suffix[:10]}", email=f"t-{suffix}@example.com"
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_guardian(db: Session, *, name: str = "Jane Doe", is_active: bool = True) -> Guardian:
    guardian = Guardian(
        name=name, phone_number=f"+1{uuid.uuid4().int % 10**10:010d}", is_active=is_active
    )
    db.add(guardian)
    db.flush()
    return guardian


def _make_home(
    db: Session, *, label: str | None = None, is_active: bool = True, created_days_ago: int = 0
) -> Home:
    home = Home(
        label=label,
        address=f"{uuid.uuid4().hex[:6]} Main St",
        access_code="1234",
        is_active=is_active,
        created_at=datetime.datetime.now(tz=datetime.UTC)
        - datetime.timedelta(days=created_days_ago),
    )
    db.add(home)
    db.flush()
    return home


def _make_child(
    db: Session,
    *,
    name: str = "Tommy Doe",
    guardians: list[Guardian] | None = None,
    homes: list[Home] | None = None,
    is_active: bool = True,
    notes: str | None = None,
) -> Child:
    child = Child(
        name=name,
        date_of_birth=datetime.date(2014, 5, 2),
        grade_level=7,
        school_name="Lincoln Middle School",
        notes=notes,
        is_active=is_active,
    )
    db.add(child)
    db.flush()
    for guardian in guardians or [_make_guardian(db)]:
        db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
    for home in homes or [_make_home(db)]:
        db.add(ChildHome(child_id=child.id, home_id=home.id))
    db.flush()
    return child


def _book(
    db: Session,
    *,
    child: Child,
    on: datetime.date,
    start: datetime.time,
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> Booking:
    tutor = _make_tutor(db)
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    availability = TutorAvailability(
        tutor_id=tutor.id,
        day_of_week=0,
        start_time=datetime.time(0, 0),
        end_time=datetime.time(23, 0),
    )
    home = _make_home(db)
    db.add_all([subject, availability])
    db.flush()
    booking = Booking(
        child_id=child.id,
        tutor_id=tutor.id,
        subject_id=subject.id,
        availability_id=availability.id,
        home_id=home.id,
        scheduled_date=on,
        start_time=start,
        end_time=datetime.time(start.hour + 1, start.minute),
        status=status,
    )
    db.add(booking)
    db.flush()
    return booking
