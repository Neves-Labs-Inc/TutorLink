"""`POST /api/archive` and `POST /api/restore` for `type: "staff"`, over HTTP.

Archiving a Staff member is the one archive that signs someone out: their refresh tokens and
password links are revoked in the same transaction, and every later request, refresh and login is
refused. The business clock is frozen at 12:00, so a Booking later today is upcoming and one
earlier today is not. A refusal re-reads the user, and proves the tokens still work, because a 409
that revoked anyway is the failure the warning exists to prevent.
"""

import datetime
import uuid
from collections.abc import Callable
from datetime import UTC

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.password_link import PasswordLinkPurpose
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services.password_link_service import issue_link

PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "a brand new password"
WARNINGS_DETAIL = "This archive needs the listed warnings confirmed"
WARNING_CODE = "archived_staff_bookings"
WARNING_MESSAGE = "This Staff member has upcoming bookings that will wait for the office"

NOW = datetime.datetime(2031, 3, 4, 12, 0)
TODAY = NOW.date()
TOMORROW = TODAY + datetime.timedelta(days=1)

NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
FOURTEEN = datetime.time(14, 0)
FIFTEEN = datetime.time(15, 0)


@pytest.mark.parametrize("role", [UserRole.TUTOR, UserRole.MANAGER])
def test_archiving_staff_signs_them_out_everywhere(
    api: TestClient, db: Session, role: UserRole
) -> None:
    admin = _make_user(db)
    staff = _make_staff(db, role=role)
    refresh_token = _login(api, staff).json()["refresh_token"]
    api.cookies.clear()

    response = _archive(api, admin, staff.id)

    assert response.status_code == 200
    assert response.json() == {
        "type": "staff",
        "id": str(staff.id),
        "archived": True,
        "cancelled_booking_ids": [],
        "archived_child_ids": [],
    }
    assert api.get("/api/me", headers=_auth(staff)).status_code == 401
    assert _refresh(api, refresh_token).status_code == 401
    assert _login(api, staff).status_code == 401


@pytest.mark.parametrize("purpose", [PasswordLinkPurpose.INVITE, PasswordLinkPurpose.RESET])
def test_archiving_staff_revokes_their_password_links_for_good(
    api: TestClient, db: Session, purpose: PasswordLinkPurpose
) -> None:
    admin = _make_user(db)
    staff = _make_staff(db, role=UserRole.TUTOR)
    _link, token = issue_link(db, user=staff, purpose=purpose, now=datetime.datetime.now(UTC))

    archived = _archive(api, admin, staff.id)
    while_archived = _set_password(api, token)
    restored = _restore(api, admin, staff.id)
    after_restore = _set_password(api, token)

    assert archived.status_code == 200
    assert while_archived.status_code == 400
    assert restored.status_code == 200
    assert after_restore.status_code == 400


def test_upcoming_bookings_without_confirmation_are_409_and_nothing_changes(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    staff = _make_staff(db, role=UserRole.TUTOR)
    refresh_token = _login(api, staff).json()["refresh_token"]
    api.cookies.clear()
    later = _book(db, staff=staff, on=TOMORROW, start=TEN, end=ELEVEN, status=BookingStatus.PENDING)
    sooner = _book(
        db, staff=staff, on=TODAY, start=FOURTEEN, end=FIFTEEN, status=BookingStatus.CONFIRMED
    )
    _book(db, staff=staff, on=TODAY, start=NINE, end=TEN, status=BookingStatus.CONFIRMED)
    _book(db, staff=staff, on=TOMORROW, start=NINE, end=TEN, status=BookingStatus.CANCELLED)

    response = _archive(api, admin, staff.id)

    assert response.status_code == 409
    assert response.json() == {
        "detail": WARNINGS_DETAIL,
        "warnings": [
            {
                "code": WARNING_CODE,
                "message": WARNING_MESSAGE,
                "bookings": [
                    _booking_json(db, sooner, status="confirmed"),
                    _booking_json(db, later, status="pending"),
                ],
            }
        ],
    }
    assert _reloaded(db, User, staff.id).is_archived is False
    assert _refresh(api, refresh_token).status_code == 200


def test_confirmed_archive_lands_and_leaves_every_booking_as_it_was(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    staff = _make_staff(db, role=UserRole.TUTOR)
    pending = _book(
        db, staff=staff, on=TOMORROW, start=TEN, end=ELEVEN, status=BookingStatus.PENDING
    )
    confirmed = _book(
        db, staff=staff, on=TODAY, start=FOURTEEN, end=FIFTEEN, status=BookingStatus.CONFIRMED
    )

    response = _archive(api, admin, staff.id, confirm_warnings=[WARNING_CODE])

    assert response.status_code == 200
    assert response.json()["archived"] is True
    assert response.json()["cancelled_booking_ids"] == []
    assert _reloaded(db, User, staff.id).is_archived is True
    assert _reloaded(db, Booking, pending.id).status == BookingStatus.PENDING
    assert _reloaded(db, Booking, confirmed.id).status == BookingStatus.CONFIRMED
    assert _reloaded(db, Booking, pending.id).user_id == staff.id
    assert _reloaded(db, Booking, confirmed.id).user_id == staff.id


def test_a_manager_may_not_archive_or_restore_staff(api: TestClient, db: Session) -> None:
    manager = _make_staff(db, role=UserRole.MANAGER)
    staff = _make_staff(db, role=UserRole.TUTOR)

    archived = _archive(api, manager, staff.id)
    restored = _restore(api, manager, staff.id)

    assert archived.status_code == 403
    assert archived.json() == {"detail": ADMIN_REQUIRED_ERROR}
    assert restored.status_code == 403
    assert _reloaded(db, User, staff.id).is_archived is False


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_nobody_may_archive_themselves(api: TestClient, db: Session, role: UserRole) -> None:
    actor = _make_user(db, role=role)

    response = _archive(api, actor, actor.id)

    assert response.status_code == 403
    assert _reloaded(db, User, actor.id).is_archived is False


@pytest.mark.parametrize("action", ["archive", "restore"])
@pytest.mark.parametrize("target_role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_an_admin_may_not_archive_or_restore_a_peer_admin_or_a_developer(
    api: TestClient, db: Session, action: str, target_role: UserRole
) -> None:
    admin = _make_user(db)
    target = _make_user(db, role=target_role, is_archived=action == "restore")

    response = _post(api, action, admin, target.id)

    assert response.status_code == 403
    assert _reloaded(db, User, target.id).is_archived is (action == "restore")


def test_a_developer_may_archive_an_admin(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    admin = _make_user(db)

    response = _archive(api, developer, admin.id)

    assert response.status_code == 200
    assert _reloaded(db, User, admin.id).is_archived is True


def test_restore_clears_the_flag_and_the_password_works_again(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    staff = _make_staff(db, role=UserRole.TUTOR)
    refresh_token = _login(api, staff).json()["refresh_token"]
    api.cookies.clear()
    _archive(api, admin, staff.id)

    response = _restore(api, admin, staff.id)

    assert response.status_code == 200
    assert response.json() == {
        "type": "staff",
        "id": str(staff.id),
        "archived": False,
        "cancelled_booking_ids": [],
        "archived_child_ids": [],
    }
    assert _refresh(api, refresh_token).status_code == 401
    assert _login(api, staff).status_code == 200


def test_archiving_archived_staff_is_a_no_op_with_no_warning(
    api: TestClient, db: Session, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(NOW)
    admin = _make_user(db)
    staff = _make_staff(db, role=UserRole.TUTOR, is_archived=True)
    _book(db, staff=staff, on=TOMORROW, start=TEN, end=ELEVEN, status=BookingStatus.CONFIRMED)

    response = _archive(api, admin, staff.id)

    assert response.status_code == 200
    assert response.json()["archived"] is True


def test_restoring_active_staff_is_a_no_op(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    staff = _make_staff(db, role=UserRole.TUTOR)
    refresh_token = _login(api, staff).json()["refresh_token"]
    api.cookies.clear()

    response = _restore(api, admin, staff.id)

    assert response.status_code == 200
    assert response.json()["archived"] is False
    assert _refresh(api, refresh_token).status_code == 200


@pytest.mark.parametrize("action", ["archive", "restore"])
def test_an_unknown_staff_id_is_404(api: TestClient, db: Session, action: str) -> None:
    admin = _make_user(db)

    response = _post(api, action, admin, uuid.uuid4())

    assert response.status_code == 404
    assert response.json() == {"detail": "User not found"}


def test_an_unknown_warning_code_is_refused(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    staff = _make_staff(db, role=UserRole.TUTOR)

    response = _archive(api, admin, staff.id, confirm_warnings=["gap"])

    assert response.status_code == 400
    assert _reloaded(db, User, staff.id).is_archived is False


def test_no_token_is_refused_with_401(api: TestClient, db: Session) -> None:
    staff = _make_staff(db, role=UserRole.TUTOR)

    response = api.post("/api/archive", json={"type": "staff", "id": str(staff.id)})

    assert response.status_code == 401
    assert response.json() == {"detail": CREDENTIALS_ERROR}


# --- helpers --------------------------------------------------------------------------------


def _archive(
    api: TestClient, actor: User, target_id: uuid.UUID, *, confirm_warnings: list[str] | None = None
) -> Response:
    body: dict[str, object] = {"type": "staff", "id": str(target_id)}

    if confirm_warnings is not None:
        body["confirm_warnings"] = confirm_warnings

    return api.post("/api/archive", json=body, headers=_auth(actor))


def _restore(api: TestClient, actor: User, target_id: uuid.UUID) -> Response:
    return _post(api, "restore", actor, target_id)


def _post(api: TestClient, action: str, actor: User, target_id: uuid.UUID) -> Response:
    return api.post(
        f"/api/{action}", json={"type": "staff", "id": str(target_id)}, headers=_auth(actor)
    )


def _login(api: TestClient, user: User) -> Response:
    return api.post("/auth/token", data={"username": user.email, "password": PASSWORD})


def _refresh(api: TestClient, refresh_token: str) -> Response:
    api.cookies.clear()

    return api.post("/auth/refresh", json={"refresh_token": refresh_token})


def _set_password(api: TestClient, token: str) -> Response:
    return api.post("/auth/password/set", json={"token": token, "password": NEW_PASSWORD})


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _reloaded[Row](db: Session, model: type[Row], row_id: uuid.UUID) -> Row:
    db.expire_all()

    return db.get_one(model, row_id)


def _booking_json(db: Session, booking: Booking, *, status: str) -> dict[str, str]:
    child = db.get_one(Child, booking.child_id)

    return {
        "id": str(booking.id),
        "scheduled_date": booking.scheduled_date.isoformat(),
        "start_time": booking.start_time.isoformat(),
        "end_time": booking.end_time.isoformat(),
        "child_name": child.name,
        "status": status,
    }


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN, is_archived: bool = False) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=role,
        is_archived=is_archived,
    )
    db.add(user)
    db.flush()

    return user


def _make_staff(db: Session, *, role: UserRole, is_archived: bool = False) -> User:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(
            email=f"staff-{suffix}@example.com",
            name=f"Staff {suffix}",
            hashed_password=hash_password(PASSWORD),
            role=role,
            is_archived=is_archived,
        ),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()

    return tutor.user


def _book(
    db: Session,
    *,
    staff: User,
    on: datetime.date,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus,
) -> Booking:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    child = Child(
        name=f"Child {uuid.uuid4().hex[:12]}",
        date_of_birth=datetime.date(2014, 5, 2),
        grade_level=7,
        school_name="Lincoln Middle School",
        is_archived=False,
    )
    db.add_all([subject, child])
    db.flush()
    booking = Booking(
        child_id=child.id,
        user_id=staff.id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.IN_OFFICE,
        subject_id=subject.id,
        scheduled_date=on,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking
