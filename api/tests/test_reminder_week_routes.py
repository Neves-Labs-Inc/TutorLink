"""`GET /api/reminders/week`: the Staff view of one week's Booking reminders.

One seam: the HTTP route, on the rolled-back `db`, with the business clock frozen. The seeded
send time is Sunday at 18:00, so on Sunday 2026-10-11 at noon the week the run covers is the
one starting Monday 2026-10-12, and the run has not happened yet.

Assertions only look at the Guardians a test made, so a row another module committed is never
mistaken for one of these.
"""

import datetime
import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.dependencies import STAFF_REQUIRED_ERROR
from app.models.booking_reminder import BookingReminder
from app.models.booking_reminder_run import BookingReminderRun
from app.models.enums import ConsentAction, Language, ReminderStatus, UserRole
from app.models.guardian import Guardian
from app.models.user import User
from app.security import create_access_token
from app.services.reminder_service import run_week
from tests.fake_twilio import FakeTwilio
from tests.test_reminder_service import EN_SID, World, set_template_sid

PATH = "/api/reminders/week"
SUNDAY_NOON = datetime.datetime(2026, 10, 11, 12, 0)
SUNDAY_RUN = datetime.datetime(2026, 10, 11, 18, 0)
WEEK_START = datetime.date(2026, 10, 12)
PAST_WEEK = datetime.date(2026, 9, 14)


@pytest.fixture(autouse=True)
def no_run_markers(db: Session) -> None:
    """Start with no week marked as run, inside the rolled-back transaction: a run another
    module committed must not decide `has_run` here."""
    db.execute(delete(BookingReminderRun))
    db.flush()


@pytest.fixture
def world(db: Session) -> World:
    return World(db=db)


@pytest.fixture
def at(freeze_business_clock: Callable[[datetime.datetime], None]) -> Callable[..., None]:
    return freeze_business_clock


def _staff(db: Session, role: UserRole = UserRole.ADMIN) -> dict[str, str]:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password="not-a-hash",
        role=role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)

    return {"Authorization": f"Bearer {token}"}


def _get(api: TestClient, db: Session, query: str = "") -> dict[str, object]:
    response = api.get(f"{PATH}{query}", headers=_staff(db))
    assert response.status_code == 200, response.text

    return response.json()


def _mine(items: object, *guardians: Guardian) -> list[dict[str, object]]:
    ids = {str(guardian.id) for guardian in guardians}
    assert isinstance(items, list)

    return [item for item in items if item["guardian_id"] in ids]


def _row(
    db: Session,
    guardian: Guardian,
    *,
    status: ReminderStatus,
    week_start: datetime.date = PAST_WEEK,
    error_code: str | None = None,
) -> None:
    db.add(
        BookingReminder(
            guardian_id=guardian.id,
            week_start=week_start,
            language=Language.EN,
            child_ids=[],
            status=status,
            skip_reason=None,
            error_code=error_code,
        )
    )
    db.flush()


# --- before and after the run -----------------------------------------------------------------


def test_before_the_run_the_week_carries_a_preview_of_who_is_due_and_why_skipped(
    api: TestClient, db: Session, world: World, at: Callable[..., None]
) -> None:
    at(SUNDAY_NOON)
    set_template_sid(db, Language.EN, EN_SID)
    english = world.guardian(name="Maria")
    world.child(english, name="Luis")
    world.child(english, name="Ana")
    spanish = world.guardian(name="Rosa")
    world.child(spanish, name="Sofia")
    world.conversation(spanish, language=Language.ES)
    opted_out = world.guardian(consent=ConsentAction.OPT_OUT)
    world.child(opted_out)

    body = _get(api, db)

    assert (body["week_start"], body["has_run"]) == ("2026-10-12", False)
    assert _mine(body["preview"], english, spanish, opted_out) == [
        {
            "guardian_id": str(english.id),
            "guardian_name": "Maria",
            "child_names": ["Ana", "Luis"],
            "language": "en",
            "skip_reason": None,
        },
        {
            "guardian_id": str(spanish.id),
            "guardian_name": "Rosa",
            "child_names": ["Sofia"],
            "language": "es",
            "skip_reason": "template_not_approved",
        },
    ]
    assert _mine(body["rows"], english, spanish) == []


def test_after_the_run_the_week_carries_the_rows_the_preview_promised_and_no_preview(
    api: TestClient, db: Session, world: World, at: Callable[..., None], fake_twilio: FakeTwilio
) -> None:
    at(SUNDAY_NOON)
    set_template_sid(db, Language.EN, EN_SID)
    sent = world.guardian(name="Maria")
    world.child(sent, name="Ana")
    skipped = world.guardian(name="Rosa")
    world.child(skipped, name="Sofia")
    world.conversation(skipped, language=Language.ES)
    preview = _mine(_get(api, db)["preview"], sent, skipped)

    run_week(db, now=SUNDAY_RUN)
    at(SUNDAY_RUN + datetime.timedelta(minutes=5))
    body = _get(api, db)

    rows = _mine(body["rows"], sent, skipped)
    assert (body["has_run"], body["preview"]) == (True, None)
    assert [(item["guardian_id"], item["skip_reason"]) for item in preview] == [
        (row["guardian_id"], row["skip_reason"]) for row in rows
    ]
    assert [(row["guardian_name"], row["child_names"], row["status"]) for row in rows] == [
        ("Maria", ["Ana"], "sent"),
        ("Rosa", ["Sofia"], "skipped"),
    ]
    assert rows[0]["sent_at"] is not None
    assert rows[1]["sent_at"] is None


def test_a_week_with_rows_has_run_even_before_the_send_time(
    api: TestClient, db: Session, world: World, at: Callable[..., None]
) -> None:
    at(SUNDAY_NOON)
    guardian = world.guardian()
    world.child(guardian)
    _row(db, guardian, status=ReminderStatus.SENT, week_start=WEEK_START)

    body = _get(api, db)

    assert (body["has_run"], body["preview"]) == (True, None)


@pytest.mark.parametrize(
    "now",
    [
        SUNDAY_RUN,
        SUNDAY_RUN + datetime.timedelta(seconds=20),
        datetime.datetime(2026, 10, 11, 23, 59),
    ],
    ids=["send-hour", "before-the-first-tick", "down-all-evening"],
)
def test_past_the_send_time_with_no_run_the_week_still_has_a_preview(
    api: TestClient, db: Session, world: World, at: Callable[..., None], now: datetime.datetime
) -> None:
    at(now)
    guardian = world.guardian(name="Maria")
    world.child(guardian)

    body = _get(api, db)

    assert (body["week_start"], body["has_run"]) == ("2026-10-12", False)
    assert [item["guardian_id"] for item in _mine(body["preview"], guardian)] == [str(guardian.id)]


def test_a_week_whose_run_never_happened_reads_as_not_run_afterwards(
    api: TestClient, db: Session, at: Callable[..., None]
) -> None:
    # Down all Sunday evening: on Monday the missed week has no run, and no preview either.
    at(datetime.datetime(2026, 10, 12, 9, 0))

    body = _get(api, db, f"?week_start={WEEK_START}")

    assert (body["has_run"], body["preview"]) == (False, None)


def test_a_run_that_reminded_nobody_still_reads_as_run(
    api: TestClient, db: Session, world: World, at: Callable[..., None], fake_twilio: FakeTwilio
) -> None:
    at(SUNDAY_NOON)
    opted_out = world.guardian(consent=ConsentAction.OPT_OUT)
    world.child(opted_out)

    run_week(db, now=SUNDAY_RUN)
    body = _get(api, db)

    assert (body["has_run"], body["preview"]) == (True, None)
    assert _mine(body["rows"], opted_out) == []


def test_the_default_week_midweek_is_the_one_the_next_run_covers(
    api: TestClient, db: Session, at: Callable[..., None]
) -> None:
    at(datetime.datetime(2026, 10, 14, 9, 0))

    body = _get(api, db)

    assert (body["week_start"], body["has_run"]) == ("2026-10-19", False)
    assert body["preview"] is not None


def test_the_response_carries_no_send_time(
    api: TestClient, db: Session, at: Callable[..., None]
) -> None:
    at(SUNDAY_NOON)

    assert set(_get(api, db)) == {"week_start", "has_run", "preview", "rows"}


# --- an explicit week, and the worklist ---------------------------------------------------------


def test_a_past_week_returns_its_rows_and_never_a_preview(
    api: TestClient, db: Session, world: World, at: Callable[..., None]
) -> None:
    at(SUNDAY_NOON)
    guardian = world.guardian(name="Maria")
    world.child(guardian)
    _row(db, guardian, status=ReminderStatus.READ)

    body = _get(api, db, f"?week_start={PAST_WEEK.isoformat()}")

    assert (body["week_start"], body["has_run"], body["preview"]) == ("2026-09-14", True, None)
    assert [row["status"] for row in _mine(body["rows"], guardian)] == ["read"]


def test_a_past_week_with_no_rows_is_empty(
    api: TestClient, db: Session, at: Callable[..., None]
) -> None:
    at(SUNDAY_NOON)

    body = _get(api, db, "?week_start=2001-01-01")

    assert (body["preview"], body["rows"]) == (None, [])


def test_the_worklist_filter_returns_only_those_statuses(
    api: TestClient, db: Session, world: World, at: Callable[..., None]
) -> None:
    at(SUNDAY_NOON)
    guardians = {status: world.guardian(name=status.value) for status in ReminderStatus}
    for status, guardian in guardians.items():
        if status is ReminderStatus.SKIPPED:
            db.add(
                BookingReminder(
                    guardian_id=guardian.id,
                    week_start=PAST_WEEK,
                    language=Language.EN,
                    child_ids=[],
                    status=status,
                    skip_reason="takeover",
                )
            )
            db.flush()
        else:
            _row(db, guardian, status=status)

    body = _get(api, db, f"?week_start={PAST_WEEK}&status=undeliverable,failed,skipped")

    assert sorted(row["status"] for row in _mine(body["rows"], *guardians.values())) == [
        "failed",
        "skipped",
        "undeliverable",
    ]


@pytest.mark.parametrize(
    ("error_code", "may_have_been_delivered"),
    [("interrupted", True), ("delivery_unknown", True), ("63016", False), (None, False)],
)
def test_a_failed_row_says_whether_it_may_have_been_delivered(
    api: TestClient,
    db: Session,
    world: World,
    at: Callable[..., None],
    error_code: str | None,
    may_have_been_delivered: bool,
) -> None:
    at(SUNDAY_NOON)
    guardian = world.guardian()
    _row(db, guardian, status=ReminderStatus.FAILED, error_code=error_code)

    body = _get(api, db, f"?week_start={PAST_WEEK}")

    (row,) = _mine(body["rows"], guardian)
    assert (row["error_code"], row["may_have_been_delivered"]) == (
        error_code,
        may_have_been_delivered,
    )


@pytest.mark.parametrize("query", ["?status=sent,nonsense", "?week_start=2026-10-14"])
def test_an_unknown_status_or_a_week_start_that_is_not_a_monday_is_400(
    api: TestClient, db: Session, at: Callable[..., None], query: str
) -> None:
    at(SUNDAY_NOON)

    response = api.get(f"{PATH}{query}", headers=_staff(db))

    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


# --- who may read it ----------------------------------------------------------------------------


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_admins_and_developers_may_read_the_week(
    api: TestClient, db: Session, at: Callable[..., None], role: UserRole
) -> None:
    at(SUNDAY_NOON)

    assert api.get(PATH, headers=_staff(db, role)).status_code == 200


def test_a_tutor_is_refused(api: TestClient, db: Session, at: Callable[..., None]) -> None:
    at(SUNDAY_NOON)

    response = api.get(PATH, headers=_staff(db, UserRole.TUTOR))

    assert response.status_code == 403
    assert response.json() == {"detail": STAFF_REQUIRED_ERROR}
