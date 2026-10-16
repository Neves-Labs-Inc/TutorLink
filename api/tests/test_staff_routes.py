"""`GET /api/staff` and `GET /api/staff/{id}` over HTTP — the Office's one Staff read (#212).

Tutors, Managers and Admins, archived or not, each with the `id` that
`POST /api/bookings.user_id` takes, the `tutor_id` that `GET /api/tutors/{id}/availability`
takes, and what the Staff screen shows: email, Sign-in state, live Invite expiry, subjects and
the sessions still ahead this week. A Developer is never listed.
"""

import datetime
import uuid
from collections.abc import Callable

from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import CREDENTIALS_ERROR, OFFICE_REQUIRED_ERROR
from app.models.availability import TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, ExceptionStatus, UserRole
from app.models.password_link import PasswordLinkPurpose
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.schemas.common import DEFAULT_PAGE_SIZE
from app.security import create_access_token, hash_password
from app.services.password_link_service import issue_link

PASSWORD = "correct horse battery staple"
ITEM_FIELDS = {
    "id",
    "name",
    "role",
    "tutor_id",
    "email",
    "sign_in_state",
    "invite_expires_at",
    "archived",
    "subjects",
    "sessions_this_week",
    "assigned_children",
    "phone_number",
    "bio",
    "has_pending_time_off",
}
STAFF_NOT_FOUND_ERROR = "Staff member not found"
# A Wednesday: the week runs Monday 12 October to Sunday 18 October 2026.
WEDNESDAY_NOON = datetime.datetime(2026, 10, 14, 12, 0)
SUNDAY = datetime.date(2026, 10, 18)
NEXT_MONDAY = datetime.date(2026, 10, 19)


def _make_user(
    db: Session,
    *,
    role: UserRole = UserRole.ADMIN,
    name: str | None = None,
    is_archived: bool = False,
    has_password: bool = True,
) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name=name or f"User {uuid.uuid4().hex[:12]}",
        hashed_password=hash_password(PASSWORD) if has_password else None,
        role=role,
        is_archived=is_archived,
    )
    db.add(user)
    db.flush()
    return user


def _make_tutor(
    db: Session,
    *,
    role: UserRole = UserRole.TUTOR,
    name: str | None = None,
    is_archived: bool = False,
    has_password: bool = True,
) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(
            email=f"tutor-{suffix}@example.com",
            name=name or f"Tutor {suffix}",
            hashed_password=hash_password(PASSWORD) if has_password else None,
            role=role,
            is_archived=is_archived,
        ),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_subject(db: Session, *, name: str | None = None, is_archived: bool = False) -> Subject:
    subject = Subject(name=name or f"Subject {uuid.uuid4().hex[:12]}", is_archived=is_archived)
    db.add(subject)
    db.flush()
    return subject


def _assign(db: Session, tutor: Tutor, *subjects: Subject) -> None:
    db.add_all(
        TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=8)
        for subject in subjects
    )
    db.flush()


def _invite(db: Session, user: User) -> datetime.datetime:
    link, _token = issue_link(
        db, user=user, purpose=PasswordLinkPurpose.INVITE, now=datetime.datetime.now(datetime.UTC)
    )
    return link.expires_at


def _book(
    db: Session,
    staff: User,
    *,
    on: datetime.date,
    start: datetime.time,
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> None:
    # A fresh Child each time: a Child holds at most one live Evaluation.
    child = Child(name=f"Child {uuid.uuid4().hex[:12]}", grade_level=7, school_name="PS 1")
    db.add(child)
    db.flush()
    db.add(
        Booking(
            child_id=child.id,
            user_id=staff.id,
            kind=BookingKind.EVALUATION,
            location=BookingLocation.IN_OFFICE,
            scheduled_date=on,
            start_time=start,
            end_time=(datetime.datetime.combine(on, start) + datetime.timedelta(hours=1)).time(),
            status=status,
        )
    )
    db.flush()


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


def _ids(body: dict[str, object]) -> list[str]:
    items = body["items"]
    assert isinstance(items, list)
    return [row["id"] for row in items]


def _row(body: dict[str, object], user_id: uuid.UUID) -> dict[str, object]:
    items = body["items"]
    assert isinstance(items, list)
    return next(row for row in items if row["id"] == str(user_id))


# --- the gate ---------------------------------------------------------------------------------


def test_an_admin_and_a_manager_read_identical_rows(api: TestClient, db: Session) -> None:
    admin = _make_user(db, role=UserRole.ADMIN, name="Admin Person")
    manager = _make_tutor(db, role=UserRole.MANAGER, name="Manager Person")
    tutor = _make_tutor(db, name="Tutor Person")
    expected = {str(admin.id), str(manager.user_id), str(tutor.user_id)}

    bodies = [
        api.get("/api/staff?page_size=100", headers=_auth(caller)).json()
        for caller in (admin, manager.user)
    ]

    for body in bodies:
        assert set(body) == {"items", "total", "page", "page_size"}
        assert expected <= set(_ids(body))
        assert all(set(row) == ITEM_FIELDS for row in body["items"])
    assert bodies[0] == bodies[1]


def test_a_developer_token_is_200(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    response = api.get("/api/staff", headers=_auth(developer))

    assert response.status_code == 200


def test_a_tutor_token_is_403(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.get("/api/staff", headers=_auth(tutor.user))

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)


def test_no_token_is_401(api: TestClient) -> None:
    response = api.get("/api/staff")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


# --- who is listed --------------------------------------------------------------------------


def test_a_developer_user_is_never_listed(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)

    body = api.get("/api/staff?page_size=100", headers=_auth(developer)).json()

    assert str(developer.id) not in _ids(body)


def test_a_manager_with_no_profile_has_a_null_tutor_id(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    manager = _make_user(db, role=UserRole.MANAGER, name="Migrated Manager")

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    assert _row(body, manager.id)["tutor_id"] is None
    assert _row(body, manager.id)["subjects"] == []


# --- the row --------------------------------------------------------------------------------


def test_a_tutors_row_carries_every_field(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(WEDNESDAY_NOON)
    admin = _make_user(db)
    tutor = _make_tutor(db, name="Sarah Miller", has_password=False)
    expires_at = _invite(db, tutor.user)
    algebra = _make_subject(db, name="Algebra Staff01")
    retired_chemistry = _make_subject(db, name="Chemistry Staff01", is_archived=True)
    _assign(db, tutor, retired_chemistry, algebra)
    _book(db, tutor.user, on=SUNDAY, start=datetime.time(9, 0))

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    row = _row(body, tutor.user_id)
    invite_expires_at = row.pop("invite_expires_at")
    assert row == {
        "id": str(tutor.user_id),
        "name": "Sarah Miller",
        "role": "tutor",
        "tutor_id": str(tutor.id),
        "email": tutor.user.email,
        "sign_in_state": "invited",
        "archived": False,
        "subjects": [
            {"id": str(algebra.id), "name": "Algebra Staff01", "max_grade_level": 8},
            {"id": str(retired_chemistry.id), "name": "Chemistry Staff01", "max_grade_level": 8},
        ],
        "sessions_this_week": 1,
        "assigned_children": [],
        "phone_number": tutor.phone_number,
        "bio": None,
        "has_pending_time_off": False,
    }
    assert isinstance(invite_expires_at, str)
    assert datetime.datetime.fromisoformat(invite_expires_at) == expires_at


def test_a_managers_row_carries_their_subjects_and_sign_in_state(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    manager = _make_tutor(db, role=UserRole.MANAGER, name="Manager Person", has_password=False)
    physics = _make_subject(db, name="Physics Staff01")
    _assign(db, manager, physics)

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    assert _row(body, manager.user_id) == {
        "id": str(manager.user_id),
        "name": "Manager Person",
        "role": "manager",
        "tutor_id": str(manager.id),
        "email": manager.user.email,
        "sign_in_state": "not_invited",
        "invite_expires_at": None,
        "archived": False,
        "subjects": [{"id": str(physics.id), "name": "Physics Staff01", "max_grade_level": 8}],
        "sessions_this_week": 0,
        "assigned_children": [],
        "phone_number": manager.phone_number,
        "bio": None,
        "has_pending_time_off": False,
    }


def test_an_admins_row_is_active_with_no_subjects(api: TestClient, db: Session) -> None:
    caller = _make_user(db)
    admin = _make_user(db, name="Admin Person")

    body = api.get("/api/staff?page_size=100", headers=_auth(caller)).json()

    assert _row(body, admin.id) == {
        "id": str(admin.id),
        "name": "Admin Person",
        "role": "admin",
        "tutor_id": None,
        "email": admin.email,
        "sign_in_state": "active",
        "invite_expires_at": None,
        "archived": False,
        "subjects": [],
        "sessions_this_week": 0,
        "assigned_children": [],
        "phone_number": None,
        "bio": None,
        "has_pending_time_off": False,
    }


def test_an_admin_who_kept_a_profile_lists_no_subjects_and_matches_no_subject(
    api: TestClient, db: Session
) -> None:
    caller = _make_user(db)
    promoted = _make_tutor(db, role=UserRole.ADMIN)
    subject = _make_subject(db)
    _assign(db, promoted, subject)

    listed = api.get("/api/staff?page_size=100", headers=_auth(caller)).json()
    by_subject = api.get(f"/api/staff?subject_id={subject.id}", headers=_auth(caller)).json()

    assert _row(listed, promoted.user_id)["subjects"] == []
    assert _row(listed, promoted.user_id)["tutor_id"] == str(promoted.id)
    assert by_subject["items"] == []
    assert by_subject["total"] == 0


def test_an_archived_staff_member_is_listed_with_a_session_count(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(WEDNESDAY_NOON)
    admin = _make_user(db)
    retired = _make_tutor(db, is_archived=True)
    _book(db, retired.user, on=WEDNESDAY_NOON.date(), start=datetime.time(15, 0))

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    row = _row(body, retired.user_id)
    assert row["archived"] is True
    assert row["sessions_this_week"] == 1


def test_sessions_this_week_count_live_bookings_from_now_through_sunday(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(WEDNESDAY_NOON)
    admin = _make_user(db)
    tutor = _make_tutor(db)
    today = WEDNESDAY_NOON.date()
    # Counted: later today (pending and confirmed), Thursday, and Sunday.
    _book(db, tutor.user, on=today, start=datetime.time(14, 0), status=BookingStatus.PENDING)
    _book(db, tutor.user, on=today, start=datetime.time(16, 0))
    _book(db, tutor.user, on=today + datetime.timedelta(days=1), start=datetime.time(9, 0))
    _book(db, tutor.user, on=SUNDAY, start=datetime.time(18, 0))
    # Not counted: earlier today, cancelled, completed, next Monday.
    _book(db, tutor.user, on=today, start=datetime.time(9, 0))
    _book(db, tutor.user, on=SUNDAY, start=datetime.time(10, 0), status=BookingStatus.CANCELLED)
    _book(db, tutor.user, on=SUNDAY, start=datetime.time(11, 0), status=BookingStatus.COMPLETED)
    _book(db, tutor.user, on=NEXT_MONDAY, start=datetime.time(9, 0))

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    assert _row(body, tutor.user_id)["sessions_this_week"] == 4


# --- one Staff member -----------------------------------------------------------------------


def test_one_staff_member_reads_the_same_row_as_the_list(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(WEDNESDAY_NOON)
    manager = _make_tutor(db, role=UserRole.MANAGER)
    tutor = _make_tutor(db, has_password=False)
    _invite(db, tutor.user)
    _assign(db, tutor, _make_subject(db))
    _book(db, tutor.user, on=SUNDAY, start=datetime.time(9, 0))

    listed = api.get("/api/staff?page_size=100", headers=_auth(manager.user)).json()
    response = api.get(f"/api/staff/{tutor.user_id}", headers=_auth(manager.user))

    assert response.status_code == 200
    assert response.json() == _row(listed, tutor.user_id)


def test_an_archived_staff_member_is_read_by_id(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    retired = _make_tutor(db, is_archived=True)

    response = api.get(f"/api/staff/{retired.user_id}", headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["archived"] is True


def test_a_developer_or_an_unknown_id_is_not_found(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    developer = _make_user(db, role=UserRole.DEVELOPER)

    for staff_id in (developer.id, uuid.uuid4()):
        response = api.get(f"/api/staff/{staff_id}", headers=_auth(admin))

        _assert_detail(response, 404, STAFF_NOT_FOUND_ERROR)


def test_a_tutor_token_reading_one_is_403(api: TestClient, db: Session) -> None:
    tutor = _make_tutor(db)

    response = api.get(f"/api/staff/{tutor.user_id}", headers=_auth(tutor.user))

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)


# --- filters --------------------------------------------------------------------------------


def test_archived_is_both_when_omitted_and_narrows_when_given(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)
    active = _make_tutor(db)
    retired = _make_tutor(db, is_archived=True)
    _assign(db, active, subject)
    _assign(db, retired, subject)

    def ids(query: str) -> set[str]:
        url = f"/api/staff?subject_id={subject.id}{query}"
        return set(_ids(api.get(url, headers=_auth(admin)).json()))

    assert ids("") == {str(active.user_id), str(retired.user_id)}
    assert ids("&archived=false") == {str(active.user_id)}
    assert ids("&archived=true") == {str(retired.user_id)}


def test_role_is_repeatable_and_developer_matches_none(api: TestClient, db: Session) -> None:
    caller = _make_user(db)
    _make_user(db, role=UserRole.DEVELOPER)
    tutor = _make_tutor(db)
    manager = _make_user(db, role=UserRole.MANAGER)

    both = api.get("/api/staff?role=tutor&role=manager&page_size=100", headers=_auth(caller))
    developers = api.get("/api/staff?role=developer", headers=_auth(caller)).json()

    assert {row["role"] for row in both.json()["items"]} == {"tutor", "manager"}
    assert {str(tutor.user_id), str(manager.id)} <= set(_ids(both.json()))
    assert developers["items"] == []
    assert developers["total"] == 0


def test_an_unknown_role_is_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/staff?role=tutor&role=janitor", headers=_auth(admin))

    _assert_detail(response, 422, "role must be one of: admin, tutor, developer, manager")


def test_sign_in_state_is_repeatable(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    invited = _make_tutor(db, has_password=False)
    _invite(db, invited.user)
    not_invited = _make_user(db, role=UserRole.MANAGER, has_password=False)

    body = api.get(
        "/api/staff?sign_in_state=invited&sign_in_state=not_invited&page_size=100",
        headers=_auth(admin),
    ).json()

    assert {str(invited.user_id), str(not_invited.id)} <= set(_ids(body))
    assert str(admin.id) not in _ids(body)
    assert {row["sign_in_state"] for row in body["items"]} <= {"invited", "not_invited"}


def test_an_unknown_sign_in_state_is_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.get("/api/staff?sign_in_state=asleep", headers=_auth(admin))

    _assert_detail(response, 422, "sign_in_state must be one of: not_invited, invited, active")


def test_an_unknown_subject_gives_an_empty_page(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.get(f"/api/staff?subject_id={uuid.uuid4()}", headers=_auth(admin)).json()

    assert body["items"] == []
    assert body["total"] == 0


def test_filters_combine_and_total_counts_the_matches(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    subject = _make_subject(db)
    match = _make_tutor(db, name="Match Tutor", has_password=False)
    other_role = _make_tutor(db, role=UserRole.MANAGER, has_password=False)
    other_state = _make_tutor(db)
    archived = _make_tutor(db, has_password=False, is_archived=True)
    second_match = _make_tutor(db, name="Second Match Tutor", has_password=False)
    for tutor in (match, other_role, other_state, archived, second_match):
        _assign(db, tutor, subject)

    body = api.get(
        f"/api/staff?subject_id={subject.id}&role=tutor&sign_in_state=not_invited"
        "&archived=false&page_size=1",
        headers=_auth(admin),
    ).json()

    assert body["total"] == 2
    assert _ids(body) == [str(match.user_id)]


# --- ordering and paging --------------------------------------------------------------------


def test_items_are_ordered_by_name(api: TestClient, db: Session) -> None:
    admin = _make_user(db, name="Zed Admin")
    _make_tutor(db, name="Bea Tutor")
    _make_user(db, role=UserRole.MANAGER, name="Abe Manager")
    _make_tutor(db, name="Cal Tutor")

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    names = [row["name"] for row in body["items"]]
    assert names == sorted(names)


def test_total_counts_beyond_the_page(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    for _ in range(DEFAULT_PAGE_SIZE):
        _make_tutor(db)

    body = api.get("/api/staff", headers=_auth(admin)).json()

    assert len(body["items"]) == DEFAULT_PAGE_SIZE
    assert body["total"] > DEFAULT_PAGE_SIZE
    assert body["page"] == 1
    assert body["page_size"] == DEFAULT_PAGE_SIZE


# --- q, contact fields, pending Time off, subject grade ---------------------------------------


def _time_off(
    db: Session, user: User, *, status: ExceptionStatus, start: datetime.date, days: int = 1
) -> None:
    db.add(
        TutorAvailabilityException(
            user_id=user.id,
            start_date=start,
            end_date=start + datetime.timedelta(days=days - 1),
            reason="dentist",
            status=status,
        )
    )
    db.flush()


def test_q_matches_a_name_case_insensitively(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    match = _make_tutor(db, name="Zebulon Quillfeather")
    other = _make_tutor(db, name="Someone Else")

    body = api.get("/api/staff?q=quILLfeath", headers=_auth(admin)).json()

    assert _ids(body) == [str(match.user_id)]
    assert str(other.user_id) not in _ids(body)


def test_q_matches_an_email(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    match = _make_tutor(db)
    match.user.email = "findable-Marker@example.com"
    db.flush()

    body = api.get("/api/staff?q=FINDABLE-marker", headers=_auth(admin)).json()

    assert _ids(body) == [str(match.user_id)]


def test_q_combines_with_the_other_filters(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    active = _make_tutor(db, name="Quokka Active")
    _make_tutor(db, name="Quokka Gone", is_archived=True)

    body = api.get("/api/staff?q=quokka&archived=false", headers=_auth(admin)).json()

    assert _ids(body) == [str(active.user_id)]


def test_a_blank_q_is_ignored(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)

    body = api.get("/api/staff?q=%20%20&page_size=100", headers=_auth(admin)).json()

    assert str(tutor.user_id) in _ids(body)


def test_phone_and_bio_come_from_the_profile_and_are_null_without_one(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    tutor.bio = "Loves fractions"
    db.flush()

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    with_profile = _row(body, tutor.user_id)
    assert with_profile["phone_number"] == tutor.phone_number
    assert with_profile["bio"] == "Loves fractions"
    without_profile = _row(body, admin.id)
    assert without_profile["phone_number"] is None
    assert without_profile["bio"] is None


def test_has_pending_time_off_is_true_only_for_a_live_pending_request(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    pending = _make_tutor(db)
    expired = _make_tutor(db)
    approved = _make_tutor(db)
    none = _make_tutor(db)
    future = datetime.date(2099, 1, 5)
    _time_off(db, pending.user, status=ExceptionStatus.PENDING, start=future)
    _time_off(db, expired.user, status=ExceptionStatus.PENDING, start=datetime.date(2020, 1, 6))
    _time_off(db, approved.user, status=ExceptionStatus.APPROVED, start=future)

    body = api.get("/api/staff?page_size=100", headers=_auth(admin)).json()

    flags = {
        name: _row(body, tutor.user_id)["has_pending_time_off"]
        for name, tutor in (
            ("pending", pending),
            ("expired", expired),
            ("approved", approved),
            ("none", none),
        )
    }
    assert flags == {"pending": True, "expired": False, "approved": False, "none": False}


def test_each_subject_carries_the_persons_highest_grade(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    tutor = _make_tutor(db)
    subject = _make_subject(db)
    _assign(db, tutor, subject)

    row = api.get(f"/api/staff/{tutor.user_id}", headers=_auth(admin)).json()

    assert row["subjects"] == [{"id": str(subject.id), "name": subject.name, "max_grade_level": 8}]
