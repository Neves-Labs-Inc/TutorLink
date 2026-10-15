"""`GET /api/counts`, exercised over HTTP: every badge equals the `total` of its list.

Each count is asserted against the list it mirrors, called by the same caller at the same frozen
moment, so the test holds the two to the "same number by construction" contract rather than to
a number written down twice.
"""

import datetime
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.dependencies import CREDENTIALS_ERROR, OFFICE_REQUIRED_ERROR
from app.models.availability import TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    ExceptionStatus,
    FlagReason,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.message import Message
from app.models.subject import Subject
from app.models.user import User
from app.security import create_access_token, hash_password

NOW = datetime.datetime(2026, 9, 8, 9, 0)
YESTERDAY = datetime.date(2026, 9, 7)
TOMORROW = datetime.date(2026, 9, 9)
# Message times are real instants, unrelated to the frozen business clock.
MESSAGES_UNTIL = datetime.datetime(2026, 9, 8, 12, 0, tzinfo=datetime.UTC)

EMPTY_COUNTS = {
    "needs_attention": 0,
    "time_off_pending": 0,
    "children_awaiting_evaluation": 0,
    "bookings_to_sort_out": 0,
    "unread_chats": 0,
}


@pytest.fixture(autouse=True)
def _frozen(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(NOW)


# --- access -----------------------------------------------------------------------------------


def test_a_tutor_is_refused(api: TestClient, db: Session) -> None:
    tutor = _make_user(db, role=UserRole.TUTOR)

    response = api.get("/api/counts", headers=_auth(tutor))

    _assert_detail(response, 403, OFFICE_REQUIRED_ERROR)


def test_no_token_is_401(api: TestClient) -> None:
    response = api.get("/api/counts")

    _assert_detail(response, 401, CREDENTIALS_ERROR)


# --- empty database ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_an_empty_database_counts_zero_for_an_admin_role(
    api: TestClient, db: Session, role: UserRole
) -> None:
    caller = _make_user(db, role=role)

    body = api.get("/api/counts", headers=_auth(caller)).json()

    assert body == EMPTY_COUNTS


def test_an_empty_database_gives_a_manager_zeros_and_a_null_time_off_count(
    api: TestClient, db: Session
) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)

    body = api.get("/api/counts", headers=_auth(manager)).json()

    assert body == {**EMPTY_COUNTS, "time_off_pending": None}


# --- seeded: every kind, with what each list leaves out ---------------------------------------


@dataclass(frozen=True, slots=True)
class World:
    staff: User
    manager: User


@pytest.fixture
def world(db: Session) -> World:
    """Two of each count to find, beside one of everything each list must leave out."""
    staff = _make_user(db, role=UserRole.TUTOR)
    manager = _make_user(db, role=UserRole.MANAGER)
    developer = _make_user(db, role=UserRole.DEVELOPER)
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()

    # Children: one awaiting evaluation; archived, Evaluated and live-Evaluation ones are not.
    _make_child(db)
    _make_child(db, is_archived=True)
    evaluated = _make_child(db, evaluated_by=manager)
    for status, start in ((BookingStatus.PENDING, 12), (BookingStatus.CONFIRMED, 14)):
        _evaluation(db, _make_child(db), staff=staff, on=TOMORROW, start=start, status=status)
    # Evaluated Children carry the Regular Bookings below, so these leave the Children count be.

    # Bookings to sort out: one past with a Time off clash too (counted once), one a Manager's.
    _book(db, evaluated, subject, staff=staff, on=YESTERDAY, start=10)
    _time_off(db, staff, on=YESTERDAY, status=ExceptionStatus.APPROVED)
    _book(db, evaluated, subject, staff=manager, on=YESTERDAY, start=12)
    _book(db, evaluated, subject, staff=staff, on=TOMORROW, start=10)
    _book(
        db, evaluated, subject, staff=staff, on=YESTERDAY, start=14, status=BookingStatus.CANCELLED
    )

    # Time off pending: two undecided and not ended; ended, decided and a Developer's are not.
    _time_off(db, staff, on=TOMORROW, status=ExceptionStatus.PENDING)
    _time_off(db, manager, on=TOMORROW, status=ExceptionStatus.PENDING)
    _time_off(db, staff, on=YESTERDAY, status=ExceptionStatus.PENDING)
    _time_off(db, staff, on=TOMORROW, status=ExceptionStatus.REJECTED)
    _time_off(db, staff, on=TOMORROW, status=ExceptionStatus.CANCELLED)
    _time_off(db, developer, on=TOMORROW, status=ExceptionStatus.PENDING)

    # Chats: two flagged, two Unread (one with three Guardian messages); a bot-only chat and a
    # read one are neither.
    flagged_unread = _converse(db, flag=FlagReason.STUCK)
    for minute in (1, 2, 3):
        _message(db, flagged_unread, MessageAuthor.CLIENT, at=_earlier(minute))
    flagged_read = _converse(db, flag=FlagReason.STUCK, last_read_at=_earlier(0))
    _message(db, flagged_read, MessageAuthor.CLIENT, at=_earlier(5))
    _message(db, _converse(db), MessageAuthor.BOT, at=_earlier(5))
    read = _converse(db, last_read_at=_earlier(10))
    _message(db, read, MessageAuthor.CLIENT, at=_earlier(20))
    unread_since = _converse(db, last_read_at=_earlier(20))
    _message(db, unread_since, MessageAuthor.CLIENT, at=_earlier(10))

    return World(staff=staff, manager=manager)


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_each_count_equals_its_lists_total_for_an_admin_role(
    api: TestClient, db: Session, world: World, role: UserRole
) -> None:
    caller = _make_user(db, role=role)
    headers = _auth(caller)

    counts = api.get("/api/counts", headers=headers).json()

    assert counts == {
        "needs_attention": 2,
        "time_off_pending": 2,
        "children_awaiting_evaluation": 1,
        "bookings_to_sort_out": 2,
        "unread_chats": 2,
    }
    assert counts == _list_totals(api, headers, has_time_off=True)


def test_a_manager_gets_only_their_own_bookings_to_sort_out_and_no_time_off_count(
    api: TestClient, db: Session, world: World
) -> None:
    headers = _auth(world.manager)
    admin_counts = api.get("/api/counts", headers=_auth(_make_user(db))).json()

    counts = api.get("/api/counts", headers=headers).json()

    assert counts == {
        **admin_counts,
        "time_off_pending": None,
        "bookings_to_sort_out": 1,
    }
    assert counts == _list_totals(api, headers, has_time_off=False)


# --- helpers ----------------------------------------------------------------------------------


def _list_totals(
    api: TestClient, headers: dict[str, str], *, has_time_off: bool
) -> dict[str, object]:
    def total_of(path: str) -> int:
        response = api.get(path, headers=headers)
        assert response.status_code == 200

        return response.json()["total"]

    return {
        "needs_attention": total_of("/api/conversations?flagged=true"),
        "time_off_pending": (total_of("/api/exceptions?status=pending") if has_time_off else None),
        "children_awaiting_evaluation": total_of("/api/children?evaluable=true"),
        "bookings_to_sort_out": total_of("/api/bookings?to_sort_out=true"),
        "unread_chats": total_of("/api/conversations?unread=true"),
    }


def _make_child(
    db: Session, *, is_archived: bool = False, evaluated_by: User | None = None
) -> Child:
    child = Child(
        name=f"Child {uuid.uuid4().hex[:12]}",
        school_name="Test School",
        is_archived=is_archived,
        evaluated_at=None if evaluated_by is None else _earlier(60),
        evaluated_by_user_id=None if evaluated_by is None else evaluated_by.id,
    )
    db.add(child)
    db.flush()

    return child


def _book(
    db: Session,
    child: Child,
    subject: Subject,
    *,
    staff: User,
    on: datetime.date,
    start: int,
    status: BookingStatus = BookingStatus.PENDING,
) -> Booking:
    booking = Booking(
        child_id=child.id,
        user_id=staff.id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.IN_OFFICE,
        subject_id=subject.id,
        scheduled_date=on,
        start_time=datetime.time(start),
        end_time=datetime.time(start + 1),
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


def _evaluation(
    db: Session,
    child: Child,
    *,
    staff: User,
    on: datetime.date,
    start: int,
    status: BookingStatus,
) -> Booking:
    booking = Booking(
        child_id=child.id,
        user_id=staff.id,
        kind=BookingKind.EVALUATION,
        location=BookingLocation.IN_OFFICE,
        scheduled_date=on,
        start_time=datetime.time(start),
        end_time=datetime.time(start + 1),
        status=status,
    )
    db.add(booking)
    db.flush()

    return booking


def _time_off(
    db: Session, staff: User, *, on: datetime.date, status: ExceptionStatus
) -> TutorAvailabilityException:
    row = TutorAvailabilityException(user_id=staff.id, start_date=on, end_date=on, status=status)
    db.add(row)
    db.flush()

    return row


def _converse(
    db: Session,
    *,
    flag: FlagReason | None = None,
    last_read_at: datetime.datetime | None = None,
) -> Conversation:
    conversation = Conversation(
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
        last_message_at=_earlier(0),
        last_read_at=last_read_at,
        flag_reason=flag,
        flagged_at=None if flag is None else _earlier(30),
    )
    db.add(conversation)
    db.flush()

    return conversation


def _message(
    db: Session, conversation: Conversation, author: MessageAuthor, *, at: datetime.datetime
) -> Message:
    status = MessageStatus.RECEIVED if author == MessageAuthor.CLIENT else MessageStatus.SENT
    message = Message(
        conversation_id=conversation.id,
        author_kind=author,
        body="Hello",
        status=status,
        created_at=at,
    )
    db.add(message)
    db.flush()

    return message


def _earlier(minutes: int) -> datetime.datetime:
    return MESSAGES_UNTIL - datetime.timedelta(minutes=minutes)


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN) -> User:
    suffix = uuid.uuid4().hex[:12]
    user = User(
        email=f"counts-{suffix}@example.com",
        name=f"Staff {suffix}",
        hashed_password=hash_password("counts-password"),
        role=role,
        is_archived=False,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}
