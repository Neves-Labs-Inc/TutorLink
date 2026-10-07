"""A delivery callback that reaches the route before the reminder's SID is committed.

Two real connections are needed: the run holds its reminder row locked across the send, and the
callback has to be seen waiting on that lock. Everything here is committed for real, so the test
creates its own rows and deletes them, and puts the template setting back, whatever happens.

The callback is posted from inside the fake send, on another thread, through the signed status
route with sessions of its own.
"""

import datetime
import threading
import uuid
from collections.abc import Generator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.main import app
from app.models.booking_reminder import BookingReminder
from app.models.booking_reminder_run import BookingReminderRun
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    Language,
    MessageStatus,
    ReminderStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.system_setting import SystemSetting
from app.models.user import User
from app.services.reminder_service import run_week, week_start_after
from tests.fake_twilio import FakeTwilio

NOW = datetime.datetime(2026, 10, 11, 18, 0)
EN_SID = "HXenglish000000000000000000000000"
TEMPLATE_SETTING = "reminder_template_sid_en"
# Long enough that a callback which does not wait would have finished well within it.
BLOCKED_CHECK_SECONDS = 1.0


@dataclass(frozen=True)
class Committed:
    guardian_id: uuid.UUID
    phone_number: str


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def committed_guardian(
    committed_sessions: sessionmaker[Session],
) -> Generator[Committed, None, None]:
    """An opted-in Guardian of one Evaluated Child, committed, with the EN template approved."""
    with committed_sessions() as session:
        previous_sid = session.scalars(
            select(SystemSetting.value).where(SystemSetting.key == TEMPLATE_SETTING)
        ).one()
        staff = User(
            email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
            display_name="Test Staff",
            hashed_password="not-a-hash",
            role=UserRole.ADMIN,
        )
        guardian = Guardian(name="Race", phone_number=f"+1{uuid.uuid4().int % 10**10:010d}")
        session.add_all([staff, guardian])
        session.flush()
        child = Child(
            name="Ana",
            grade_level=5,
            school_name="Test School",
            evaluated_at=datetime.datetime(2026, 9, 1, tzinfo=datetime.UTC),
            evaluated_by_user_id=staff.id,
        )
        session.add(child)
        session.flush()
        session.add_all(
            [
                ChildGuardian(child_id=child.id, guardian_id=guardian.id),
                ReminderConsent(
                    guardian_id=guardian.id,
                    action=ConsentAction.OPT_IN,
                    source=ConsentSource.STAFF,
                ),
            ]
        )
        session.execute(
            update(SystemSetting).where(SystemSetting.key == TEMPLATE_SETTING).values(value=EN_SID)
        )
        session.commit()
        ids = (staff.id, guardian.id, child.id)

    try:
        yield Committed(guardian_id=guardian.id, phone_number=guardian.phone_number)
    finally:
        _clean_up(committed_sessions, ids=ids, phone_number=guardian.phone_number)
        with committed_sessions() as session:
            session.execute(
                update(SystemSetting)
                .where(SystemSetting.key == TEMPLATE_SETTING)
                .values(value=previous_sid)
            )
            session.commit()


@pytest.fixture
def committed_api(
    committed_sessions: sessionmaker[Session],
) -> Generator[TestClient, None, None]:
    def committed_db() -> Generator[Session, None, None]:
        with committed_sessions() as session:
            yield session

    app.dependency_overrides[get_db] = committed_db
    try:
        yield TestClient(app)
    finally:
        del app.dependency_overrides[get_db]


def test_an_opt_out_callback_before_the_sid_is_stored_waits_and_is_applied_once(
    committed_sessions: sessionmaker[Session],
    committed_guardian: Committed,
    committed_api: TestClient,
    fake_twilio: FakeTwilio,
) -> None:
    responses: list[Response] = []
    was_blocked: list[bool] = []
    threads: list[threading.Thread] = []

    def post_callback(sid: str) -> None:
        responses.append(
            fake_twilio.post_status(
                committed_api,
                sid=sid,
                status="undelivered",
                error_code="63050",
                to=committed_guardian.phone_number,
            )
        )

    def call_back_early(sid: str) -> None:
        callback = threading.Thread(target=post_callback, args=(sid,))
        callback.start()
        callback.join(BLOCKED_CHECK_SECONDS)
        was_blocked.append(callback.is_alive())
        threads.append(callback)

    fake_twilio.during_next_send(call_back_early)

    with committed_sessions() as session:
        run_week(session, now=NOW)
    threads[0].join(10)

    [sent] = [s for s in fake_twilio.sent if s.to == committed_guardian.phone_number]
    replay = fake_twilio.post_status(
        committed_api,
        sid=sent.sid,
        status="undelivered",
        error_code="63050",
        to=committed_guardian.phone_number,
    )

    assert was_blocked == [True]
    assert [r.status_code for r in responses] == [204]
    assert replay.status_code == 204
    with committed_sessions() as session:
        reminder = session.scalars(
            select(BookingReminder).where(
                BookingReminder.guardian_id == committed_guardian.guardian_id
            )
        ).one()
        copy = session.scalars(select(Message).where(Message.twilio_sid == sent.sid)).one()
        consents = session.execute(
            select(ReminderConsent.action, ReminderConsent.source)
            .where(ReminderConsent.guardian_id == committed_guardian.guardian_id)
            .order_by(ReminderConsent.created_at)
        ).all()

    assert (reminder.status, reminder.error_code, reminder.twilio_sid) == (
        ReminderStatus.FAILED,
        "63050",
        sent.sid,
    )
    assert (copy.status, copy.error_code) == (MessageStatus.FAILED, "63050")
    assert [tuple(row) for row in consents] == [
        (ConsentAction.OPT_IN, ConsentSource.STAFF),
        (ConsentAction.OPT_OUT, ConsentSource.SYSTEM),
    ]


def test_a_callback_does_not_wait_on_an_interrupted_reminder_from_an_earlier_week(
    committed_sessions: sessionmaker[Session],
    committed_guardian: Committed,
    committed_api: TestClient,
    fake_twilio: FakeTwilio,
) -> None:
    with committed_sessions() as session:
        session.add(
            BookingReminder(
                guardian_id=committed_guardian.guardian_id,
                week_start=datetime.date(2026, 9, 28),
                language=Language.EN,
                child_ids=[],
                status=ReminderStatus.FAILED,
                error_code="interrupted",
                created_at=datetime.datetime(2026, 9, 27, 22, 0, tzinfo=datetime.UTC),
            )
        )
        session.commit()
    responses: list[Response] = []

    def post_callback() -> None:
        responses.append(
            fake_twilio.post_status(
                committed_api,
                sid="SMunknown0000000000000000000000000",
                status="failed",
                error_code="30008",
                to=committed_guardian.phone_number,
            )
        )

    # Another connection holds the old row, as a stuck or unrelated transaction might.
    with committed_sessions() as holder:
        holder.execute(
            select(BookingReminder.id)
            .where(BookingReminder.guardian_id == committed_guardian.guardian_id)
            .with_for_update()
        ).all()
        callback = threading.Thread(target=post_callback)
        callback.start()
        callback.join(BLOCKED_CHECK_SECONDS)
        was_blocked = callback.is_alive()
        holder.rollback()
    callback.join(10)

    assert was_blocked is False
    assert [r.status_code for r in responses] == [204]


def _clean_up(
    sessions: sessionmaker[Session],
    *,
    ids: tuple[uuid.UUID, uuid.UUID, uuid.UUID],
    phone_number: str,
) -> None:
    staff_id, guardian_id, child_id = ids
    with sessions() as session:
        conversation_ids = select(Conversation.id).where(Conversation.phone_number == phone_number)
        session.execute(delete(ReminderConsent).where(ReminderConsent.guardian_id == guardian_id))
        session.execute(delete(BookingReminder).where(BookingReminder.guardian_id == guardian_id))
        session.execute(delete(Message).where(Message.conversation_id.in_(conversation_ids)))
        session.execute(delete(Conversation).where(Conversation.phone_number == phone_number))
        session.execute(delete(ChildGuardian).where(ChildGuardian.guardian_id == guardian_id))
        session.execute(delete(Child).where(Child.id == child_id))
        session.execute(delete(Guardian).where(Guardian.id == guardian_id))
        session.execute(delete(User).where(User.id == staff_id))
        # The committed run marked its week as run; no later test may inherit that.
        session.execute(
            delete(BookingReminderRun).where(
                BookingReminderRun.week_start == week_start_after(NOW.date())
            )
        )
        session.commit()
