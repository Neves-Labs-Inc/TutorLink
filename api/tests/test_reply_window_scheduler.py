"""`reply_window_scheduler`: the five-minute tick, its advisory lock, the loop, and the lifespan.

Shaped like `test_reminder_scheduler.py`: ticks run on `lambda: db`, except the lock case,
which needs two real connections because an advisory lock is reentrant for the connection that
holds it. That case reaches the lock and stops, so it writes nothing. Log lines are spelled
out rather than imported, so a reworded line fails here.
"""

import asyncio
import datetime
import logging
import threading
import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.message import Message
from app.models.user import User
from app.security import hash_password
from app.services import reply_window_scheduler
from app.services.broadcast_service import BroadcastEvent, ConversationUpdated
from app.services.reminder_scheduler import REMINDER_LOCK_KEY, REMINDER_LOCK_NAMESPACE
from app.services.reply_window_scheduler import (
    REPLY_WINDOW_LOCK_KEY,
    REPLY_WINDOW_LOCK_NAMESPACE,
    TickOutcome,
    TickResult,
    run_forever,
    run_tick,
)
from app.services.retention_scheduler import RETENTION_LOCK_KEY, RETENTION_LOCK_NAMESPACE

SKIPPED_LINE = "reply window check: skipped, another instance holds the lock"
FAILED_LINE = "reply window check: failed"
PUBLISH_FAILED_LINE = "reply window check: publish failed"

NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)
CLOSED_AT = NOON + datetime.timedelta(hours=24)


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[BroadcastEvent]:
    events: list[BroadcastEvent] = []
    monkeypatch.setattr(reply_window_scheduler, "publish", events.append)

    return events


def test_a_tick_flags_closed_windows_commits_and_publishes_each_flagged_chat(
    db: Session, published: list[BroadcastEvent], caplog: pytest.LogCaptureFixture
) -> None:
    conversation_id = _closed_window_chat(db)
    # A savepoint release under the `db` fixture: the tick closes the session it is handed, and
    # closing would otherwise roll back the test's own setup.
    db.commit()

    with caplog.at_level(logging.INFO, logger=reply_window_scheduler.__name__):
        outcome = run_tick(lambda: db, now=CLOSED_AT)

    assert outcome.result is TickResult.RAN
    assert conversation_id in outcome.flagged
    assert [record.getMessage() for record in caplog.records] == [
        f"reply window check: ran flagged={len(outcome.flagged)}"
    ]
    assert db.get_one(Conversation, conversation_id).flag_reason is FlagReason.REPLY_WINDOW_CLOSED
    assert _published_ids(published) == list(outcome.flagged)


def test_a_second_tick_flags_and_publishes_nothing_more_for_the_same_window(
    db: Session, published: list[BroadcastEvent]
) -> None:
    conversation_id = _closed_window_chat(db)
    db.commit()
    run_tick(lambda: db, now=CLOSED_AT)
    published.clear()

    outcome = run_tick(lambda: db, now=CLOSED_AT + datetime.timedelta(minutes=5))

    assert conversation_id not in outcome.flagged
    assert conversation_id not in _published_ids(published)


def test_a_tick_skips_while_another_instance_holds_the_reply_window_lock(
    committed_sessions: sessionmaker[Session],
    published: list[BroadcastEvent],
    caplog: pytest.LogCaptureFixture,
) -> None:
    with committed_sessions() as holder:
        holder.execute(
            select(func.pg_advisory_xact_lock(REPLY_WINDOW_LOCK_NAMESPACE, REPLY_WINDOW_LOCK_KEY))
        )
        with caplog.at_level(logging.INFO, logger=reply_window_scheduler.__name__):
            result = run_tick(committed_sessions, now=CLOSED_AT).result
        holder.rollback()

    assert result is TickResult.SKIPPED
    assert [record.getMessage() for record in caplog.records] == [SKIPPED_LINE]
    assert published == []


def test_the_reply_window_lock_is_neither_the_retention_nor_the_reminder_lock() -> None:
    lock = (REPLY_WINDOW_LOCK_NAMESPACE, REPLY_WINDOW_LOCK_KEY)

    assert lock == (8102, 3)
    assert lock != (RETENTION_LOCK_NAMESPACE, RETENTION_LOCK_KEY)
    assert lock != (REMINDER_LOCK_NAMESPACE, REMINDER_LOCK_KEY)


def test_a_tick_that_fails_logs_failed_and_returns_instead_of_raising(
    db: Session,
    published: list[BroadcastEvent],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def fail(db: Session, *, now: datetime.datetime) -> list[uuid.UUID]:
        raise RuntimeError("database went away")

    monkeypatch.setattr(reply_window_scheduler, "flag_closed_reply_windows", fail)
    db.commit()

    with caplog.at_level(logging.INFO, logger=reply_window_scheduler.__name__):
        result = run_tick(lambda: db, now=CLOSED_AT).result

    assert result is TickResult.FAILED
    assert [record.getMessage() for record in caplog.records] == [FAILED_LINE]
    assert caplog.records[0].exc_info is not None
    assert published == []


def test_a_publish_that_raises_is_logged_and_the_other_chats_still_publish(
    db: Session, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    first_id = _closed_window_chat(db)
    second_id = _closed_window_chat(db)
    db.commit()
    attempted: list[uuid.UUID] = []

    def raising_publish(event: BroadcastEvent) -> None:
        attempted.extend(_published_ids([event]))
        raise RuntimeError("notice could not be serialised")

    monkeypatch.setattr(reply_window_scheduler, "publish", raising_publish)

    with caplog.at_level(logging.INFO, logger=reply_window_scheduler.__name__):
        outcome = run_tick(lambda: db, now=CLOSED_AT)

    assert outcome.result is TickResult.RAN
    assert {first_id, second_id} <= set(attempted)
    assert attempted == list(outcome.flagged)
    publish_failures = [
        record for record in caplog.records if record.getMessage().startswith(PUBLISH_FAILED_LINE)
    ]
    assert len(publish_failures) == len(outcome.flagged)
    assert all(record.exc_info is not None for record in publish_failures)


def test_run_forever_keeps_ticking_when_publishing_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(reply_window_scheduler, "_TICK_SECONDS", 0.0)
    monkeypatch.setattr(reply_window_scheduler, "_TICK_JITTER_SECONDS", 0.0)
    third_tick = threading.Event()
    ticks: list[None] = []

    def flagging_tick(
        session_factory: Callable[[], Session], *, now: datetime.datetime
    ) -> TickOutcome:
        ticks.append(None)
        if len(ticks) >= 3:
            third_tick.set()
        return TickOutcome(result=TickResult.RAN, flagged=(uuid.uuid4(),))

    def raising_publish(event: BroadcastEvent) -> None:
        raise RuntimeError("notice could not be serialised")

    monkeypatch.setattr(reply_window_scheduler, "_tick", flagging_tick)
    monkeypatch.setattr(reply_window_scheduler, "publish", raising_publish)

    async def run_until_third_tick() -> bool:
        task = asyncio.create_task(run_forever(lambda: Session()))
        reached = await asyncio.to_thread(third_tick.wait, 10)
        still_running = not task.done()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return reached and still_running

    assert asyncio.run(run_until_third_tick()) is True


def test_run_forever_touches_no_database_before_its_first_tick() -> None:
    calls: list[None] = []

    def recording_factory() -> Session:
        calls.append(None)
        raise AssertionError("the scheduler opened a session before its first tick")

    async def start_then_cancel() -> None:
        task = asyncio.create_task(run_forever(recording_factory))
        await asyncio.sleep(0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(start_then_cancel())

    assert calls == []


def test_run_forever_keeps_ticking_after_a_failed_tick(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reply_window_scheduler, "_TICK_SECONDS", 0.0)
    monkeypatch.setattr(reply_window_scheduler, "_TICK_JITTER_SECONDS", 0.0)
    third_tick = threading.Event()
    ticks: list[None] = []

    def failing_factory() -> Session:
        ticks.append(None)
        if len(ticks) >= 3:
            third_tick.set()
        raise RuntimeError("database is down")

    async def run_until_third_tick() -> bool:
        task = asyncio.create_task(run_forever(failing_factory))
        reached = await asyncio.to_thread(third_tick.wait, 10)
        still_running = not task.done()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return reached and still_running

    assert asyncio.run(run_until_third_tick()) is True


def test_lifespan_starts_the_reply_window_scheduler_and_cancels_it_on_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main

    started = threading.Event()
    cancelled = threading.Event()

    async def fake_run_forever(session_factory: Callable[[], Session]) -> None:
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(main, "run_reply_window_checks_forever", fake_run_forever)

    with TestClient(main.create_app()):
        assert started.wait(5) is True
        assert cancelled.is_set() is False

    assert cancelled.is_set() is True


# --- helpers -----------------------------------------------------------------------------------


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


def _published_ids(published: list[BroadcastEvent]) -> list[uuid.UUID]:
    return [
        uuid.UUID(str(event.conversation["id"]))
        for event in published
        if isinstance(event, ConversationUpdated)
    ]


def _closed_window_chat(db: Session) -> uuid.UUID:
    """A Taken-over chat whose Guardian last wrote at `NOON`; plain id, since a tick detaches."""
    holder = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        name="Test Admin",
        hashed_password=hash_password("correct horse battery staple"),
        role=UserRole.ADMIN,
        is_archived=False,
    )
    db.add(holder)
    db.flush()
    conversation = Conversation(
        phone_number=f"+1555{uuid.uuid4().int % 10**7:07d}",
        status=ConversationStatus.HUMAN,
        taken_over_by_user_id=holder.id,
        taken_over_at=NOON,
        last_message_at=NOON,
    )
    db.add(conversation)
    db.flush()
    db.add(
        Message(
            conversation_id=conversation.id,
            author_kind=MessageAuthor.CLIENT,
            body="hello?",
            status=MessageStatus.RECEIVED,
            created_at=NOON,
        )
    )
    db.flush()

    return conversation.id
