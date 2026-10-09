"""`purge-prelaunch-data`: the one-off that clears test data written before go-live.

Rows are inserted through the session; the command runs through `main` against the `db`
fixture, the way `test_cli_seed.py` drives the other commands.
"""

import datetime
import uuid

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.cli as cli_module
from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.booking_reminder import BookingReminder
from app.models.booking_reminder_run import BookingReminderRun
from app.models.bot_flow_state import BotFlowState
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import (
    BookingStatus,
    ConsentAction,
    ConsentSource,
    Language,
    MessageAuthor,
    MessageStatus,
    ReminderStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.login_attempt import LoginAttempt
from app.models.message import Message
from app.models.refresh_token import RefreshToken
from app.models.reminder_consent import ReminderConsent
from app.models.subject import Subject
from app.models.system_setting import SystemSetting
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.security import hash_password

PURGED_MODELS = (
    Guardian,
    Child,
    ChildGuardian,
    ChildHome,
    GuardianHome,
    Home,
    Booking,
    Conversation,
    Message,
    ChildSubjectLevel,
    ReminderConsent,
    BookingReminder,
    BookingReminderRun,
    BotFlowState,
)
KEPT_MODELS = (
    User,
    Tutor,
    Subject,
    TutorSubject,
    TutorAvailability,
    TutorAvailabilityException,
    SystemSetting,
    RefreshToken,
    LoginAttempt,
)
MONDAY = datetime.date(2026, 9, 7)
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)


def test_everything_in_the_delete_list_is_gone_and_kept_tables_are_unchanged(
    db: Session, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_test_data(db)
    kept_before = _counts(db, KEPT_MODELS)
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)

    # The database's own clock: it stamped the rows, and the command compares against it too.
    cutoff = db.scalar(select(func.now())).isoformat()

    status = cli_module.main(["purge-prelaunch-data", "--confirm", "--cutoff", cutoff])

    assert status == 0
    assert _counts(db, PURGED_MODELS) == dict.fromkeys(PURGED_MODELS, 0)
    assert _counts(db, KEPT_MODELS) == kept_before
    assert all(count > 0 for count in kept_before.values())
    assert "guardians: 1" in capsys.readouterr().out


def test_one_row_newer_than_the_cutoff_deletes_nothing(
    db: Session, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_test_data(db)
    before = _counts(db, PURGED_MODELS)
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)

    status = cli_module.main(["purge-prelaunch-data", "--confirm", "--cutoff", _cutoff(hours=-1)])

    assert status != 0
    assert _counts(db, PURGED_MODELS) == before
    assert "newer than the cutoff" in capsys.readouterr().err


def test_a_reminder_run_marker_newer_than_the_cutoff_deletes_nothing(
    db: Session, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_test_data(db)
    cutoff = db.scalar(select(func.now()))
    db.add(
        BookingReminderRun(
            week_start=MONDAY + datetime.timedelta(days=7),
            ran_at=cutoff + datetime.timedelta(minutes=1),
        )
    )
    db.commit()
    before = _counts(db, PURGED_MODELS)
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)

    status = cli_module.main(["purge-prelaunch-data", "--confirm", "--cutoff", cutoff.isoformat()])

    err = capsys.readouterr().err
    assert status != 0
    assert _counts(db, PURGED_MODELS) == before
    assert "newer than the cutoff in booking_reminder_runs" in err


def test_without_confirm_nothing_is_deleted(
    db: Session, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_test_data(db)
    before = _counts(db, PURGED_MODELS)
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)

    status = cli_module.main(["purge-prelaunch-data", "--cutoff", _cutoff(hours=1)])

    assert status != 0
    assert _counts(db, PURGED_MODELS) == before
    assert "--confirm" in capsys.readouterr().err


def test_a_lock_timeout_deletes_nothing_and_says_to_try_again(
    db: Session,
    _test_engine: Engine,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)
    monkeypatch.setattr(cli_module, "PRELAUNCH_LOCK_TIMEOUT", "100ms")

    # Another session holding a conflicting lock, as an idle-in-transaction one would.
    with _test_engine.connect() as other:
        other.execute(text("LOCK TABLE guardians IN ACCESS EXCLUSIVE MODE"))
        status = cli_module.main(
            ["purge-prelaunch-data", "--confirm", "--cutoff", _cutoff(hours=-1)]
        )
        other.rollback()

    assert status != 0
    assert "could not lock tables" in capsys.readouterr().err


def test_a_cutoff_in_the_future_deletes_nothing(
    db: Session, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_test_data(db)
    before = _counts(db, PURGED_MODELS)
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)

    status = cli_module.main(["purge-prelaunch-data", "--confirm", "--cutoff", _cutoff(hours=1)])

    assert status != 0
    assert _counts(db, PURGED_MODELS) == before
    assert "future" in capsys.readouterr().err


@pytest.mark.parametrize(
    "cutoff_args", [[], ["--cutoff", "not-a-date"], ["--cutoff", "2026-01-01"]]
)
def test_a_missing_or_unusable_cutoff_deletes_nothing(
    db: Session,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    cutoff_args: list[str],
) -> None:
    _make_test_data(db)
    before = _counts(db, PURGED_MODELS)
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)

    status = cli_module.main(["purge-prelaunch-data", "--confirm", *cutoff_args])

    assert status != 0
    assert _counts(db, PURGED_MODELS) == before
    assert "--cutoff" in capsys.readouterr().err


def _cutoff(*, hours: int) -> str:
    return (datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=hours)).isoformat()


def _counts(db: Session, models: tuple[type, ...]) -> dict[type, int]:
    return {model: db.scalar(select(func.count()).select_from(model)) or 0 for model in models}


def _make_test_data(db: Session) -> None:
    suffix = uuid.uuid4().hex[:12]
    staff = User(
        email=f"staff-{suffix}@example.com",
        name="Staff",
        hashed_password=hash_password("purge-password"),
        role=UserRole.ADMIN,
    )
    tutor = Tutor(
        user=User(email=f"t-{suffix}@example.com", name="Tutor", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    subject = Subject(name=f"Subject {suffix}")
    guardian = Guardian(name="Guardian", phone_number=f"+2{suffix[:10]}")
    home = Home(address=f"{suffix} Test Street", access_code="0000")
    child = Child(name="Child", grade_level=7, school_name="Test School")
    conversation = Conversation(phone_number=guardian.phone_number)
    db.add_all([staff, tutor, subject, guardian, home, child, conversation])
    db.flush()

    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=MONDAY.weekday(), start_time=NINE, end_time=TEN
    )
    message = Message(
        conversation_id=conversation.id,
        author_kind=MessageAuthor.CLIENT,
        body="Hello",
        status=MessageStatus.SENT,
    )
    db.add_all([availability, message])
    db.flush()
    db.add_all(
        [
            TutorAvailabilityException(
                tutor_id=tutor.id, start_date=MONDAY, end_date=MONDAY, reason="sick"
            ),
            SystemSetting(key=f"k-{suffix}", value="1", value_type="integer"),
            RefreshToken(
                user_id=staff.id,
                family_id=uuid.uuid4(),
                expires_at=datetime.datetime.now(datetime.UTC),
            ),
            LoginAttempt(
                bucket_key=f"b-{suffix}",
                attempt_id=uuid.uuid4(),
                attempted_at=datetime.datetime.now(datetime.UTC),
            ),
            TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=12),
            ChildGuardian(child_id=child.id, guardian_id=guardian.id),
            ChildHome(child_id=child.id, home_id=home.id),
            GuardianHome(guardian_id=guardian.id, home_id=home.id),
            Booking(
                child_id=child.id,
                tutor_id=tutor.id,
                subject_id=subject.id,
                availability_id=availability.id,
                home_id=home.id,
                scheduled_date=MONDAY,
                start_time=NINE,
                end_time=TEN,
                status=BookingStatus.PENDING,
            ),
            ChildSubjectLevel(
                child_id=child.id, subject_id=subject.id, level=2, set_by_user_id=staff.id
            ),
            ReminderConsent(
                guardian_id=guardian.id,
                action=ConsentAction.OPT_IN,
                source=ConsentSource.INTAKE,
                message_id=message.id,
                phone_number=guardian.phone_number,
            ),
            BookingReminder(
                guardian_id=guardian.id,
                week_start=MONDAY,
                language=Language.EN,
                child_ids=[child.id],
                status=ReminderStatus.SENT,
            ),
            BookingReminderRun(week_start=MONDAY),
            BotFlowState(
                phone_number=guardian.phone_number,
                step="start",
                collected_data={},
                misses=0,
                prompt="hi",
                expires_at=datetime.datetime.now(datetime.UTC),
            ),
        ]
    )
    # The command closes its session, which would undo rows that were only flushed.
    db.commit()
