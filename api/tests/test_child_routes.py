"""`/api/children` writes over HTTP — REQ-034, the replace semantics OQ-1 settles, and
deactivation (REQ-110, REQ-113).

The reads are `test_child_read_routes.py`'s; what matters here is asserted against the tables
directly, because three things a passing response body cannot show on its own are:

- a link that falls out of a `PATCH` is **hard-deleted**, not deactivated;
- a link that stays keeps **its own row** — the junction primary key is what separates set
  replacement from delete-all-then-reinsert, which look identical in the response;
- an **absent** link array is not an empty one, or a rename would silently unlink every
  guardian a child has.

Guardians and homes are made through the ORM rather than through `POST /api/clients`, so
phone-number normalisation never runs and these tests do not inherit REQ-037's fixtures.

REQ-095's date-of-birth bound is exercised at both ends, with the business clock
(`clock.business_now`) frozen for the upper one: an unfrozen "tomorrow" would pass or fail
depending on when the suite runs.

Deactivation cancels the child's upcoming sessions (P7C-O), so its tests freeze
the business clock at noon and seed bookings on either side of it: "upcoming" is "starts
after now" (P7C-T), and a session this morning that nobody has marked completed must survive.
Every cancellation is read back from the row, never inferred from the status code. The
two-connection race and the rollback of a half-done cancel need real commits and live in
`test_child_deactivation_race.py`.
"""

import datetime
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from httpx import Response
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import NOTES_MAX_LENGTH, Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.routers.children import GUARDIAN_REMOVAL_HAS_UPCOMING_BOOKINGS_ERROR
from app.security import create_access_token, hash_password
from app.services import broadcast_service, child_service, twilio_service
from app.services.archive_service import CHILD_NOT_FOUND_ERROR, UPCOMING_SESSIONS_CHANGED_ERROR

PASSWORD = "correct horse battery staple"
DATE_OF_BIRTH = "2014-05-02"
FROZEN_TODAY = datetime.date(2026, 9, 23)
# The date `business_evening` freezes; UTC is already on the 29th.
BUSINESS_TODAY = datetime.date(2026, 9, 28)
INVALID_LINKS_ERROR = (
    "guardian_ids must name at least one guardian, and every id given must already exist"
)
INVALID_DATE_OF_BIRTH_ERROR = "date_of_birth must be a real date between 1900-01-01 and today"
FROZEN_NOW = datetime.datetime(2026, 9, 23, 12, 0)
TODAY = FROZEN_NOW.date()
TOMORROW = TODAY + datetime.timedelta(days=1)
YESTERDAY = TODAY - datetime.timedelta(days=1)
NINE = datetime.time(9, 0)
FIFTEEN = datetime.time(15, 0)


@dataclass(frozen=True, slots=True)
class Sessions:
    child_id: uuid.UUID
    tomorrow: uuid.UUID
    this_afternoon: uuid.UUID
    this_morning: uuid.UUID
    yesterday: uuid.UUID
    already_cancelled: uuid.UUID
    other_childs: uuid.UUID


def _phone() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"t-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=_phone(),
    )
    db.add(tutor)
    db.flush()
    return tutor


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


def _make_guardian(db: Session, *, homes: Sequence[Home] = ()) -> Guardian:
    """A Guardian holding `homes`; a Child's Homes are its Guardians' (#214)."""
    guardian = Guardian(name=f"Guardian {uuid.uuid4().hex[:8]}", phone_number=_phone())
    db.add(guardian)
    db.flush()
    db.add_all([GuardianHome(guardian_id=guardian.id, home_id=home.id) for home in homes])
    db.flush()
    return guardian


def _make_home(db: Session) -> Home:
    home = Home(address=f"{uuid.uuid4().hex[:6]} Elm Street", directions="1234")
    db.add(home)
    db.flush()
    return home


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _payload(*, guardians: list[Guardian]) -> dict[str, object]:
    return {
        "guardian_ids": [str(one.id) for one in guardians],
        "name": "Tommy Doe",
        "date_of_birth": DATE_OF_BIRTH,
        "grade_level": 7,
        "school_name": "Lincoln Middle School",
    }


def _create_child(api: TestClient, admin: User, *, guardians: list[Guardian]) -> uuid.UUID:
    response = api.post("/api/children", headers=_auth(admin), json=_payload(guardians=guardians))
    assert response.status_code == 201
    return uuid.UUID(response.json()["id"])


def _guardian_links(db: Session, child_id: uuid.UUID) -> dict[uuid.UUID, uuid.UUID]:
    """Guardian id → the junction row's own primary key, which is what pins set replacement."""
    return {
        link.guardian_id: link.id
        for link in db.scalars(select(ChildGuardian).where(ChildGuardian.child_id == child_id))
    }


def _book(
    db: Session,
    *,
    child_id: uuid.UUID,
    home_id: uuid.UUID,
    on: datetime.date,
    start: datetime.time,
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> uuid.UUID:
    """A booking written straight to the table, each with its own tutor, so no two collide on
    `excl_bookings_live_overlap` and none has to pass the window gates of `POST /api/bookings`."""
    tutor = _make_tutor(db)
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:8]}")
    db.add(subject)
    db.flush()
    availability = TutorAvailability(
        tutor_id=tutor.id,
        day_of_week=on.weekday(),
        start_time=datetime.time(8, 0),
        end_time=datetime.time(20, 0),
    )
    db.add(availability)
    db.flush()
    booking = Booking(
        child_id=child_id,
        user_id=tutor.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=subject.id,
        availability_id=availability.id,
        home_id=home_id,
        scheduled_date=on,
        start_time=start,
        end_time=(datetime.datetime.combine(on, start) + datetime.timedelta(hours=1)).time(),
        status=status,
    )
    db.add(booking)
    db.flush()
    return booking.id


def _seed_sessions(api: TestClient, db: Session, admin: User) -> Sessions:
    """Two upcoming live sessions (tomorrow, and 15:00 today), and four that must survive a
    deactivation at noon: 09:00 today, yesterday, an already-cancelled one tomorrow, and another
    child's tomorrow."""
    home = _make_home(db)
    guardian = _make_guardian(db, homes=[home])
    child_id = _create_child(api, admin, guardians=[guardian])
    other_child_id = _create_child(api, admin, guardians=[guardian])

    def book(
        on: datetime.date,
        start: datetime.time,
        status: BookingStatus = BookingStatus.CONFIRMED,
    ) -> uuid.UUID:
        return _book(db, child_id=child_id, home_id=home.id, on=on, start=start, status=status)

    return Sessions(
        child_id=child_id,
        tomorrow=book(TOMORROW, NINE),
        this_afternoon=book(TODAY, FIFTEEN, BookingStatus.PENDING),
        this_morning=book(TODAY, NINE),
        yesterday=book(YESTERDAY, FIFTEEN),
        already_cancelled=book(TOMORROW, FIFTEEN, BookingStatus.CANCELLED),
        other_childs=_book(db, child_id=other_child_id, home_id=home.id, on=TOMORROW, start=NINE),
    )


def _archive_child(api: TestClient, user: User, child_id: uuid.UUID, **fields: int) -> Response:
    return api.post(
        "/api/archive",
        headers=_auth(user),
        json={"type": "child", "id": str(child_id), **fields},
    )


def _restore_child(api: TestClient, user: User, child_id: uuid.UUID) -> Response:
    return api.post(
        "/api/restore", headers=_auth(user), json={"type": "child", "id": str(child_id)}
    )


def _status(db: Session, booking_id: uuid.UUID) -> BookingStatus:
    db.expire_all()
    return db.scalars(select(Booking.status).where(Booking.id == booking_id)).one()


def _child(db: Session, child_id: uuid.UUID) -> Child:
    db.expire_all()
    return db.get_one(Child, child_id)


def _refuse_outbound(*args: object, **kwargs: object) -> None:
    raise AssertionError("a deactivation must not notify anyone (OQ-59)")


# --- REQ-034.6: the RBAC gate and the error envelope ----------------------------------------


def test_a_tutor_is_refused_on_both_routes(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    guardian = _make_guardian(db)
    child_id = _create_child(api, admin, guardians=[guardian])

    created = api.post("/api/children", headers=_auth(tutor), json=_payload(guardians=[guardian]))
    updated = api.patch(f"/api/children/{child_id}", headers=_auth(tutor), json={"name": "Nope"})

    assert created.status_code == 403
    assert updated.status_code == 403
    assert isinstance(created.json()["detail"], str)
    assert isinstance(updated.json()["detail"], str)


def test_no_token_is_401_not_403(api: TestClient, db: Session) -> None:
    guardian = _make_guardian(db)

    response = api.post("/api/children", json=_payload(guardians=[guardian]))

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)


def test_a_developer_may_create_and_update(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    guardian = _make_guardian(db)
    child_id = _create_child(api, developer, guardians=[guardian])

    updated = api.patch(
        f"/api/children/{child_id}", headers=_auth(developer), json={"name": "Renamed"}
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Renamed"


# --- REQ-034.1 and REQ-034.3: POST, and the ids it is given ---------------------------------


def test_post_links_every_guardian_it_is_given(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    guardians = [_make_guardian(db), _make_guardian(db)]

    response = api.post("/api/children", headers=_auth(admin), json=_payload(guardians=guardians))

    body = response.json()
    child_id = uuid.UUID(body["id"])
    assert response.status_code == 201
    assert set(_guardian_links(db, child_id)) == {one.id for one in guardians}
    assert set(body["guardian_ids"]) == {str(one.id) for one in guardians}
    assert body["grade_level"] == 7


def test_a_created_childs_homes_are_its_guardians_homes(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    mums, dads = _make_home(db), _make_home(db)
    guardians = [_make_guardian(db, homes=[mums]), _make_guardian(db, homes=[dads])]

    child_id = _create_child(api, admin, guardians=guardians)
    detail = api.get(f"/api/children/{child_id}", headers=_auth(admin)).json()

    assert {home["id"] for home in detail["homes"]} == {str(mums.id), str(dads.id)}


def test_a_repeated_guardian_id_collapses_to_one_link(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db)

    response = api.post(
        "/api/children",
        headers=_auth(admin),
        json=_payload(guardians=[guardian, guardian]),
    )

    assert response.status_code == 201
    assert list(_guardian_links(db, uuid.UUID(response.json()["id"]))) == [guardian.id]


def test_post_requires_at_least_one_guardian(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post("/api/children", headers=_auth(admin), json=_payload(guardians=[]))

    assert response.status_code == 400
    assert response.json() == {"detail": INVALID_LINKS_ERROR}


def test_post_ignores_home_ids(api: TestClient, db: Session) -> None:
    """`home_ids` is gone from the contract: a Child's Homes are its Guardians' (#214)."""
    admin = _make_user(db)
    home, stray = _make_home(db), _make_home(db)
    guardian = _make_guardian(db, homes=[home])
    payload = {**_payload(guardians=[guardian]), "home_ids": [str(stray.id)]}

    response = api.post("/api/children", headers=_auth(admin), json=payload)
    detail = api.get(f"/api/children/{response.json()['id']}", headers=_auth(admin)).json()

    assert response.status_code == 201
    assert "home_ids" not in response.json()
    assert [one["id"] for one in detail["homes"]] == [str(home.id)]


def test_an_unresolvable_guardian_id_is_400_and_leaves_no_child_behind(
    api: TestClient, db: Session
) -> None:
    """An orphan child is what validating before writing exists to prevent — the ERD has no
    room for a child with no guardian, and no later request through this surface could fix
    one."""
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["guardian_ids"] = [str(uuid.uuid4())]
    before = db.scalar(select(func.count()).select_from(Child))

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert response.json() == {"detail": INVALID_LINKS_ERROR}
    assert db.scalar(select(func.count()).select_from(Child)) == before


def test_a_grade_level_label_is_refused_rather_than_coerced(api: TestClient, db: Session) -> None:
    """`grade_level` is stored as an integer; "Grade 7" is derived for display and never sent."""
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["grade_level"] = "Grade 7"

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_a_body_missing_a_required_field_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post("/api/children", headers=_auth(admin), json={"name": "Nobody"})

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


# --- REQ-034.4: PATCH replaces a link set ---------------------------------------------------


def test_patch_replaces_the_guardian_set_without_rewriting_the_links_that_stay(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    kept, dropped = _make_guardian(db), _make_guardian(db)
    child_id = _create_child(api, admin, guardians=[kept, dropped])
    before = _guardian_links(db, child_id)

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"guardian_ids": [str(kept.id)]}
    )

    after = _guardian_links(db, child_id)
    assert response.status_code == 200
    assert response.json()["guardian_ids"] == [str(kept.id)]
    assert set(after) == {kept.id}
    assert after[kept.id] == before[kept.id]


def test_patch_refuses_an_empty_guardian_array(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db)
    child_id = _create_child(api, admin, guardians=[guardian])

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"guardian_ids": []}
    )

    assert response.status_code == 400
    assert response.json() == {"detail": INVALID_LINKS_ERROR}
    assert set(_guardian_links(db, child_id)) == {guardian.id}


def test_patch_omitting_the_guardian_array_leaves_every_link_alone(
    api: TestClient, db: Session
) -> None:
    """Absent is not empty. Treating them alike would unlink every guardian on a rename."""
    admin = _make_user(db)
    guardians = [_make_guardian(db), _make_guardian(db)]
    child_id = _create_child(api, admin, guardians=guardians)
    before = _guardian_links(db, child_id)

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"name": "Renamed"}
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    assert _guardian_links(db, child_id) == before


def test_a_patch_that_fails_validation_writes_none_of_its_other_fields(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db)
    child_id = _create_child(api, admin, guardians=[guardian])

    response = api.patch(
        f"/api/children/{child_id}",
        headers=_auth(admin),
        json={"name": "Renamed", "guardian_ids": [str(uuid.uuid4())]},
    )

    assert response.status_code == 400
    assert db.scalar(select(Child.name).where(Child.id == child_id)) == "Tommy Doe"
    assert set(_guardian_links(db, child_id)) == {guardian.id}


def test_patch_may_change_grade_level(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = api.patch(f"/api/children/{child_id}", headers=_auth(admin), json={"grade_level": 8})

    assert response.status_code == 200
    assert response.json()["grade_level"] == 8
    assert db.scalar(select(Child.grade_level).where(Child.id == child_id)) == 8


@pytest.mark.parametrize("grade_level", [-1, 13])
def test_post_refuses_a_grade_level_outside_k_to_12(
    api: TestClient, db: Session, grade_level: int
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["grade_level"] = grade_level
    before = db.scalar(select(func.count()).select_from(Child))

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert db.scalar(select(func.count()).select_from(Child)) == before


@pytest.mark.parametrize("grade_level", [0, 12])
def test_post_accepts_kindergarten_through_grade_12(
    api: TestClient, db: Session, grade_level: int
) -> None:
    """0 is Kindergarten."""
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["grade_level"] = grade_level

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 201
    assert response.json()["grade_level"] == grade_level


def test_patch_accepts_kindergarten(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = api.patch(f"/api/children/{child_id}", headers=_auth(admin), json={"grade_level": 0})

    assert response.status_code == 200
    assert response.json()["grade_level"] == 0


def test_post_without_a_grade_level_creates_a_child_whose_grade_reads_as_null(
    api: TestClient, db: Session
) -> None:
    """The admin sets the grade by hand after the first session, so a child may exist without
    one, and every read says so with `null` rather than a guessed grade."""
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    del payload["grade_level"]

    created = api.post("/api/children", headers=_auth(admin), json=payload)
    child_id = created.json()["id"]
    detail = api.get(f"/api/children/{child_id}", headers=_auth(admin))
    listed = api.get(
        "/api/children", headers=_auth(admin), params={"q": payload["name"], "page_size": 100}
    )

    assert created.status_code == 201
    assert created.json()["grade_level"] is None
    assert detail.json()["grade_level"] is None
    rows = [row for row in listed.json()["items"] if row["id"] == child_id]
    assert [row["grade_level"] for row in rows] == [None]


@pytest.mark.parametrize("grade_level", [-1, 13])
def test_patch_refuses_a_grade_level_outside_k_to_12_and_writes_nothing(
    api: TestClient, db: Session, grade_level: int
) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db)
    child_id = _create_child(api, admin, guardians=[guardian])

    response = api.patch(
        f"/api/children/{child_id}",
        headers=_auth(admin),
        json={"name": "Renamed", "grade_level": grade_level},
    )

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert db.scalar(select(Child.name).where(Child.id == child_id)) == "Tommy Doe"
    assert db.scalar(select(Child.grade_level).where(Child.id == child_id)) == 7


def test_patch_on_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(
        f"/api/children/{uuid.uuid4()}", headers=_auth(admin), json={"name": "Ghost"}
    )

    assert response.status_code == 404
    assert isinstance(response.json()["detail"], str)


# --- REQ-095: date of birth and notes -------------------------------------------------------


def test_the_response_carries_exactly_the_documented_keys(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        "/api/children",
        headers=_auth(admin),
        json=_payload(guardians=[_make_guardian(db)]),
    )

    assert response.status_code == 201
    assert set(response.json()) == {
        "id",
        "name",
        "date_of_birth",
        "grade_level",
        "school_name",
        "notes",
        "archived",
        "guardian_ids",
    }


def test_post_without_a_date_of_birth_is_400_and_writes_nothing(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    del payload["date_of_birth"]
    before = db.scalar(select(func.count()).select_from(Child))

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert db.scalar(select(func.count()).select_from(Child)) == before


@pytest.mark.parametrize("date_of_birth", ["2100-01-01", "1899-12-31"])
def test_post_refuses_an_implausible_date_of_birth(
    api: TestClient, db: Session, date_of_birth: str
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["date_of_birth"] = date_of_birth
    before = db.scalar(select(func.count()).select_from(Child))

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert response.json() == {"detail": INVALID_DATE_OF_BIRTH_ERROR}
    assert db.scalar(select(func.count()).select_from(Child)) == before


@pytest.mark.parametrize("date_of_birth", ["2016-02-30", "23/04/2016", "nine"])
def test_post_refuses_a_date_of_birth_that_is_not_a_calendar_date(
    api: TestClient, db: Session, date_of_birth: str
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["date_of_birth"] = date_of_birth
    before = db.scalar(select(func.count()).select_from(Child))

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert db.scalar(select(func.count()).select_from(Child)) == before


@pytest.mark.parametrize("date_of_birth", ["1900-01-01", "2016-04-23"])
def test_post_accepts_a_plausible_date_of_birth_and_echoes_it(
    api: TestClient, db: Session, date_of_birth: str
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["date_of_birth"] = date_of_birth

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    child_id = uuid.UUID(response.json()["id"])
    assert response.status_code == 201
    assert response.json()["date_of_birth"] == date_of_birth
    stored = db.scalar(select(Child.date_of_birth).where(Child.id == child_id))
    assert stored == datetime.date.fromisoformat(date_of_birth)


@pytest.mark.parametrize(
    ("date_of_birth", "expected_status"),
    [(FROZEN_TODAY, 201), (FROZEN_TODAY + datetime.timedelta(days=1), 400)],
)
def test_the_upper_bound_is_today_inclusive(
    api: TestClient,
    db: Session,
    freeze_business_clock: Callable[[datetime.datetime], None],
    date_of_birth: datetime.date,
    expected_status: int,
) -> None:
    freeze_business_clock(datetime.datetime.combine(FROZEN_TODAY, datetime.time(12, 0)))
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["date_of_birth"] = date_of_birth.isoformat()

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == expected_status


@pytest.mark.parametrize(("days_after_business_today", "expected_status"), [(0, 201), (1, 400)])
def test_post_bounds_date_of_birth_by_the_business_date_not_the_utc_date(
    api: TestClient,
    db: Session,
    business_evening: datetime.datetime,
    days_after_business_today: int,
    expected_status: int,
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    date_of_birth = BUSINESS_TODAY + datetime.timedelta(days=days_after_business_today)
    payload["date_of_birth"] = date_of_birth.isoformat()

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == expected_status


@pytest.mark.parametrize(("days_after_business_today", "expected_status"), [(0, 200), (1, 400)])
def test_patch_bounds_date_of_birth_by_the_business_date_not_the_utc_date(
    api: TestClient,
    db: Session,
    business_evening: datetime.datetime,
    days_after_business_today: int,
    expected_status: int,
) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])
    date_of_birth = BUSINESS_TODAY + datetime.timedelta(days=days_after_business_today)

    response = api.patch(
        f"/api/children/{child_id}",
        headers=_auth(admin),
        json={"date_of_birth": date_of_birth.isoformat()},
    )

    assert response.status_code == expected_status


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (datetime.date(1900, 1, 1), True),
        (datetime.date(1899, 12, 31), False),
        (FROZEN_TODAY, True),
        (FROZEN_TODAY + datetime.timedelta(days=1), False),
    ],
)
def test_date_of_birth_is_plausible(value: datetime.date, expected: bool) -> None:
    assert child_service.date_of_birth_is_plausible(value, today=FROZEN_TODAY) is expected


@pytest.mark.parametrize(
    ("notes", "expected"),
    [
        (None, None),
        ("   ", None),
        ("Peanut allergy", "Peanut allergy"),
        ("  Peanut allergy \n", "Peanut allergy"),
        ("x" * NOTES_MAX_LENGTH, "x" * NOTES_MAX_LENGTH),
    ],
)
def test_post_stores_notes_stripped_and_blank_as_null(
    api: TestClient, db: Session, notes: str | None, expected: str | None
) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    if notes is not None:
        payload["notes"] = notes

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    child_id = uuid.UUID(response.json()["id"])
    assert response.status_code == 201
    assert response.json()["notes"] == expected
    assert db.scalar(select(Child.notes).where(Child.id == child_id)) == expected


def test_post_refuses_notes_over_the_limit_and_writes_nothing(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["notes"] = "x" * (NOTES_MAX_LENGTH + 1)
    before = db.scalar(select(func.count()).select_from(Child))

    response = api.post("/api/children", headers=_auth(admin), json=payload)

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)
    assert db.scalar(select(func.count()).select_from(Child)) == before


@pytest.mark.parametrize("cleared", ["", "   "])
def test_patch_with_blank_notes_clears_them(api: TestClient, db: Session, cleared: str) -> None:
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["notes"] = "Peanut allergy"
    child_id = uuid.UUID(api.post("/api/children", headers=_auth(admin), json=payload).json()["id"])

    response = api.patch(f"/api/children/{child_id}", headers=_auth(admin), json={"notes": cleared})

    assert response.status_code == 200
    assert response.json()["notes"] is None
    assert db.scalar(select(Child.notes).where(Child.id == child_id)) is None


@pytest.mark.parametrize(
    "body", [{"name": "X"}, {"date_of_birth": None, "notes": None}], ids=["absent", "null"]
)
def test_patch_leaves_date_of_birth_and_notes_alone_unless_given(
    api: TestClient, db: Session, body: dict[str, object]
) -> None:
    """`date_of_birth` can be corrected but never cleared, so an explicit null is "unchanged"
    exactly as an absent key is."""
    admin = _make_user(db)
    payload = _payload(guardians=[_make_guardian(db)])
    payload["notes"] = "Peanut allergy"
    child_id = uuid.UUID(api.post("/api/children", headers=_auth(admin), json=payload).json()["id"])

    response = api.patch(f"/api/children/{child_id}", headers=_auth(admin), json=body)

    stored = db.get_one(Child, child_id)
    db.refresh(stored)
    assert response.status_code == 200
    assert response.json()["date_of_birth"] == DATE_OF_BIRTH
    assert response.json()["notes"] == "Peanut allergy"
    assert stored.date_of_birth == datetime.date.fromisoformat(DATE_OF_BIRTH)
    assert stored.notes == "Peanut allergy"


def test_patch_corrects_the_date_of_birth(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"date_of_birth": "2015-06-01"}
    )

    assert response.status_code == 200
    assert response.json()["date_of_birth"] == "2015-06-01"
    stored = db.scalar(select(Child.date_of_birth).where(Child.id == child_id))
    assert stored == datetime.date(2015, 6, 1)


def test_patch_refuses_an_implausible_date_of_birth_and_writes_nothing(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = api.patch(
        f"/api/children/{child_id}",
        headers=_auth(admin),
        json={"name": "Renamed", "notes": "Changed", "date_of_birth": "2100-01-01"},
    )

    stored = db.get_one(Child, child_id)
    db.refresh(stored)
    assert response.status_code == 400
    assert response.json() == {"detail": INVALID_DATE_OF_BIRTH_ERROR}
    assert stored.name == "Tommy Doe"
    assert stored.notes is None
    assert stored.date_of_birth == datetime.date.fromisoformat(DATE_OF_BIRTH)


# --- REQ-034.5: no DELETE route --------------------------------------------------------------


def test_a_child_has_no_delete_route(api: TestClient, db: Session) -> None:
    """Archiving a child is `POST /api/archive`; the frozen contract lists no DELETE."""
    admin = _make_user(db)
    body = api.post(
        "/api/children",
        headers=_auth(admin),
        json=_payload(guardians=[_make_guardian(db)]),
    ).json()

    assert api.delete(f"/api/children/{body['id']}", headers=_auth(admin)).status_code == 405


# --- REQ-110 and REQ-113: deactivation, reactivation, the home-unlink guard -----------------


@pytest.fixture
def frozen_now(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(FROZEN_NOW)


@pytest.mark.parametrize(
    "extra", [{}, {"expected_cancellations": 0}, {"expected_cancellations": 3}]
)
def test_deactivating_a_child_with_no_upcoming_sessions_ignores_the_count(
    api: TestClient, db: Session, frozen_now: None, extra: dict[str, int]
) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = _archive_child(api, admin, child_id, **extra)

    assert response.status_code == 200
    assert response.json() == {
        "type": "child",
        "id": str(child_id),
        "archived": True,
        "cancelled_booking_ids": [],
        "archived_child_ids": [],
    }
    assert _child(db, child_id).is_archived is True


def test_reactivating_a_child_touches_no_booking(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    admin = _make_user(db)
    home = _make_home(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db, homes=[home])])
    upcoming = _book(db, child_id=child_id, home_id=home.id, on=TOMORROW, start=NINE)
    _child(db, child_id).is_archived = True
    db.flush()

    response = _restore_child(api, admin, child_id)

    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert response.json()["cancelled_booking_ids"] == []
    assert _child(db, child_id).is_archived is False
    assert _status(db, upcoming) is BookingStatus.CONFIRMED


def test_deactivating_an_already_inactive_child_cancels_nothing(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    """Not re-processed: no count is demanded and a live booking left over stays live."""
    admin = _make_user(db)
    home = _make_home(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db, homes=[home])])
    upcoming = _book(db, child_id=child_id, home_id=home.id, on=TOMORROW, start=NINE)
    _child(db, child_id).is_archived = True
    db.flush()

    response = _archive_child(api, admin, child_id)

    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert response.json()["cancelled_booking_ids"] == []
    assert _status(db, upcoming) is BookingStatus.CONFIRMED


def test_deactivation_cancels_exactly_the_sessions_that_start_after_now(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    admin = _make_user(db)
    sessions = _seed_sessions(api, db, admin)

    response = _archive_child(api, admin, sessions.child_id, expected_cancellations=2)

    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert response.json()["cancelled_booking_ids"] == [
        str(sessions.this_afternoon),
        str(sessions.tomorrow),
    ]
    assert _child(db, sessions.child_id).is_archived is True
    assert _status(db, sessions.tomorrow) is BookingStatus.CANCELLED
    assert _status(db, sessions.this_afternoon) is BookingStatus.CANCELLED
    assert _status(db, sessions.this_morning) is BookingStatus.CONFIRMED
    assert _status(db, sessions.yesterday) is BookingStatus.CONFIRMED
    assert _status(db, sessions.already_cancelled) is BookingStatus.CANCELLED
    assert _status(db, sessions.other_childs) is BookingStatus.CONFIRMED


@pytest.mark.parametrize(
    "extra",
    [{}, {"expected_cancellations": 1}, {"expected_cancellations": 3}],
    ids=["absent", "fewer", "more"],
)
def test_a_deactivation_count_that_does_not_match_is_409_and_applies_nothing(
    api: TestClient, db: Session, frozen_now: None, extra: dict[str, int]
) -> None:
    admin = _make_user(db)
    sessions = _seed_sessions(api, db, admin)

    response = _archive_child(api, admin, sessions.child_id, **extra)

    child = _child(db, sessions.child_id)
    assert response.status_code == 409
    assert response.json() == {"detail": UPCOMING_SESSIONS_CHANGED_ERROR}
    assert child.is_archived is False
    assert _status(db, sessions.tomorrow) is BookingStatus.CONFIRMED
    assert _status(db, sessions.this_afternoon) is BookingStatus.PENDING


def test_a_deactivation_sends_nothing_to_anyone(
    api: TestClient, db: Session, frozen_now: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """OQ-59: cancelled without notice. Both outbound seams raise, so any attempt is a 500."""
    monkeypatch.setattr(twilio_service, "send_whatsapp_message", _refuse_outbound)
    monkeypatch.setattr(broadcast_service, "publish", _refuse_outbound)
    admin = _make_user(db)
    sessions = _seed_sessions(api, db, admin)

    response = _archive_child(api, admin, sessions.child_id, expected_cancellations=2)

    assert response.status_code == 200
    assert _status(db, sessions.tomorrow) is BookingStatus.CANCELLED


def test_removing_a_guardian_whose_home_has_upcoming_bookings_is_409_with_their_ids(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    """Dad's own Home leaves the set; the shared one stays, so its booking blocks nothing."""
    admin = _make_user(db)
    shared, dads = _make_home(db), _make_home(db)
    mum = _make_guardian(db, homes=[shared])
    dad = _make_guardian(db, homes=[shared, dads])
    child_id = _create_child(api, admin, guardians=[mum, dad])
    later = _book(db, child_id=child_id, home_id=dads.id, on=TOMORROW, start=FIFTEEN)
    sooner = _book(
        db,
        child_id=child_id,
        home_id=dads.id,
        on=TOMORROW,
        start=NINE,
        status=BookingStatus.PENDING,
    )
    _book(db, child_id=child_id, home_id=shared.id, on=TOMORROW, start=datetime.time(12, 0))
    before = _guardian_links(db, child_id)

    response = api.patch(
        f"/api/children/{child_id}",
        headers=_auth(admin),
        json={"guardian_ids": [str(mum.id)], "name": "X"},
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": GUARDIAN_REMOVAL_HAS_UPCOMING_BOOKINGS_ERROR,
        "booking_ids": [str(sooner), str(later)],
    }
    assert _guardian_links(db, child_id) == before
    assert _child(db, child_id).name == "Tommy Doe"


def test_removing_a_guardian_is_allowed_when_another_guardian_holds_the_home(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    admin = _make_user(db)
    shared = _make_home(db)
    mum, dad = _make_guardian(db, homes=[shared]), _make_guardian(db, homes=[shared])
    child_id = _create_child(api, admin, guardians=[mum, dad])
    _book(db, child_id=child_id, home_id=shared.id, on=TOMORROW, start=NINE)

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"guardian_ids": [str(mum.id)]}
    )

    assert response.status_code == 200
    assert set(_guardian_links(db, child_id)) == {mum.id}


@pytest.mark.parametrize(
    ("on", "start", "status"),
    [
        (YESTERDAY, FIFTEEN, BookingStatus.CONFIRMED),
        (TODAY, NINE, BookingStatus.CONFIRMED),
        (TOMORROW, NINE, BookingStatus.CANCELLED),
    ],
    ids=["yesterday", "earlier-today", "cancelled"],
)
def test_a_booking_that_is_not_upcoming_does_not_block_removing_a_guardian(
    api: TestClient,
    db: Session,
    frozen_now: None,
    on: datetime.date,
    start: datetime.time,
    status: BookingStatus,
) -> None:
    admin = _make_user(db)
    mums, dads = _make_home(db), _make_home(db)
    mum, dad = _make_guardian(db, homes=[mums]), _make_guardian(db, homes=[dads])
    child_id = _create_child(api, admin, guardians=[mum, dad])
    _book(db, child_id=child_id, home_id=dads.id, on=on, start=start, status=status)

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"guardian_ids": [str(mum.id)]}
    )

    assert response.status_code == 200
    assert set(_guardian_links(db, child_id)) == {mum.id}


def test_an_archived_home_still_counts_for_the_unlink_guard(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    """A session can sit at a Home archived since; taking the Home away would orphan it."""
    admin = _make_user(db)
    mums, dads = _make_home(db), _make_home(db)
    mum, dad = _make_guardian(db, homes=[mums]), _make_guardian(db, homes=[dads])
    child_id = _create_child(api, admin, guardians=[mum, dad])
    booking = _book(db, child_id=child_id, home_id=dads.id, on=TOMORROW, start=NINE)
    dads.is_archived = True
    db.flush()

    response = api.patch(
        f"/api/children/{child_id}", headers=_auth(admin), json={"guardian_ids": [str(mum.id)]}
    )

    assert response.status_code == 409
    assert response.json()["booking_ids"] == [str(booking)]


def test_an_inactive_child_can_still_be_edited(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])
    _child(db, child_id).is_archived = True
    db.flush()

    response = api.patch(f"/api/children/{child_id}", headers=_auth(admin), json={"notes": "x"})

    assert response.status_code == 200
    assert response.json()["notes"] == "x"
    assert response.json()["archived"] is True


def test_a_tutor_cannot_archive_a_child(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_user(db, role=UserRole.TUTOR, tutor_id=_make_tutor(db).id)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = _archive_child(api, tutor, child_id)

    assert response.status_code == 403
    assert isinstance(response.json()["detail"], str)
    assert _child(db, child_id).is_archived is False


def test_archive_with_no_token_is_401(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = api.post("/api/archive", json={"type": "child", "id": str(child_id)})

    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)
    assert _child(db, child_id).is_archived is False


def test_restoring_a_child_works_with_every_guardian_and_home_archived(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    home = _make_home(db)
    guardian = _make_guardian(db, homes=[home])
    child_id = _create_child(api, admin, guardians=[guardian])
    guardian.is_archived = True
    home.is_archived = True
    _child(db, child_id).is_archived = True
    db.flush()

    response = _restore_child(api, admin, child_id)

    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert _child(db, child_id).is_archived is False


def test_restoring_a_child_leaves_its_cancelled_sessions_cancelled(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    admin = _make_user(db)
    sessions = _seed_sessions(api, db, admin)
    _archive_child(api, admin, sessions.child_id, expected_cancellations=2)

    response = _restore_child(api, admin, sessions.child_id)

    assert response.status_code == 200
    assert _child(db, sessions.child_id).is_archived is False
    assert _status(db, sessions.tomorrow) is BookingStatus.CANCELLED
    assert _status(db, sessions.this_afternoon) is BookingStatus.CANCELLED


def test_restoring_an_active_child_is_a_no_op_200(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = _restore_child(api, admin, child_id)

    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert response.json()["cancelled_booking_ids"] == []


def test_archiving_an_unknown_child_is_404(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = _archive_child(api, admin, uuid.uuid4())

    assert response.status_code == 404
    assert response.json() == {"detail": CHILD_NOT_FOUND_ERROR}


def test_a_negative_expected_cancellations_is_400(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child_id = _create_child(api, admin, guardians=[_make_guardian(db)])

    response = _archive_child(api, admin, child_id, expected_cancellations=-1)

    assert response.status_code == 400
    assert _child(db, child_id).is_archived is False


def test_patch_no_longer_acts_on_is_active_or_expected_cancellations(
    api: TestClient, db: Session, frozen_now: None
) -> None:
    admin = _make_user(db)
    sessions = _seed_sessions(api, db, admin)

    response = api.patch(
        f"/api/children/{sessions.child_id}",
        headers=_auth(admin),
        json={"is_active": False, "expected_cancellations": 2, "name": "Renamed"},
    )

    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert _child(db, sessions.child_id).is_archived is False
    assert _status(db, sessions.tomorrow) is BookingStatus.CONFIRMED
