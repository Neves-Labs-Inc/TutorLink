"""`reminder_scheduler`: when a tick sends, the advisory lock, the loop, and the lifespan.

Ticks run on `lambda: db` with the business clock frozen, except the lock case, which needs two
real connections for the reason `test_retention_scheduler.py` gives (an advisory lock is
reentrant for the connection holding it). That case reaches the lock and stops, so it writes
nothing. Log lines are spelled out rather than imported, so a reworded line fails here.
"""

import asyncio
import datetime
import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.enums import Language
from app.models.booking_reminder import BookingReminder
from app.services import reminder_scheduler
from app.services.reminder_scheduler import (
    REMINDER_LOCK_KEY,
    REMINDER_LOCK_NAMESPACE,
    TickOutcome,
    TickResult,
    run_forever,
    run_tick,
)
from app.services.retention_scheduler import RETENTION_LOCK_KEY, RETENTION_LOCK_NAMESPACE
from tests.conftest import SPRING_FORWARD_SUNDAY_2AM
from tests.fake_twilio import FakeTwilio
from tests.test_reminder_service import EN_SID, World, set_template_sid

NOT_DUE_LINE = "booking reminders: not due"
SKIPPED_LINE = "booking reminders: skipped, another instance holds the lock"
FAILED_LINE = "booking reminders: failed"

SUNDAY_6PM = datetime.datetime(2026, 10, 11, 18, 0)

Freeze = Callable[[datetime.datetime], None]


@pytest.fixture
def world(db: Session) -> World:
    return World(db=db)


@dataclass(frozen=True)
class DueGuardian:
    """Plain values, not the ORM row: a tick closes the session, which detaches every row."""

    guardian_id: uuid.UUID
    phone_number: str


@pytest.fixture
def due_guardian(world: World, db: Session) -> DueGuardian:
    set_template_sid(db, Language.EN, EN_SID)
    guardian = world.guardian()
    world.child(guardian)

    return DueGuardian(guardian_id=guardian.id, phone_number=guardian.phone_number)


def _sends(fake: FakeTwilio, due: DueGuardian) -> int:
    return len([sent for sent in fake.sent if sent.to == due.phone_number])


def _tick(db: Session) -> TickResult:
    return _run_tick(db).result


def _run_tick(db: Session) -> TickOutcome:
    # A savepoint release under the `db` fixture: the tick closes the session it is handed, and
    # closing would otherwise roll back the test's own setup.
    db.commit()

    return run_tick(lambda: db)


@pytest.mark.parametrize(
    "now",
    [
        datetime.datetime(2026, 10, 11, 17, 59),
        datetime.datetime(2026, 10, 10, 18, 0),
        datetime.datetime(2026, 10, 12, 0, 0),
        datetime.datetime(2026, 10, 12, 18, 0),
    ],
    ids=["sunday-before-the-hour", "saturday", "just-after-midnight", "monday-at-the-hour"],
)
def test_a_tick_off_the_configured_day_or_before_the_hour_is_not_due(
    db: Session,
    freeze_business_clock: Freeze,
    fake_twilio: FakeTwilio,
    due_guardian: DueGuardian,
    caplog: pytest.LogCaptureFixture,
    now: datetime.datetime,
) -> None:
    freeze_business_clock(now)

    with caplog.at_level(logging.INFO, logger=reminder_scheduler.__name__):
        result = _tick(db)

    assert result is TickResult.NOT_DUE
    assert [record.getMessage() for record in caplog.records] == [NOT_DUE_LINE]
    assert _sends(fake_twilio, due_guardian) == 0


@pytest.mark.parametrize("hour", [18, 21, 23])
def test_any_tick_from_the_hour_to_midnight_on_the_day_runs(
    db: Session,
    freeze_business_clock: Freeze,
    fake_twilio: FakeTwilio,
    due_guardian: DueGuardian,
    caplog: pytest.LogCaptureFixture,
    hour: int,
) -> None:
    freeze_business_clock(SUNDAY_6PM.replace(hour=hour, minute=0, second=12))

    with caplog.at_level(logging.INFO, logger=reminder_scheduler.__name__):
        outcome = _run_tick(db)

    assert outcome.result is TickResult.RAN
    assert outcome.run is not None
    assert _sends(fake_twilio, due_guardian) == 1
    assert [record.getMessage() for record in caplog.records] == [
        f"booking reminders: ran week_start=2026-10-12 sent={outcome.run.sent}"
        f" failed={outcome.run.failed} undeliverable={outcome.run.undeliverable}"
        f" skipped={outcome.run.skipped}"
    ]


def test_a_second_tick_the_same_evening_sends_nothing_more(
    db: Session, freeze_business_clock: Freeze, fake_twilio: FakeTwilio, due_guardian: DueGuardian
) -> None:
    freeze_business_clock(SUNDAY_6PM)
    _tick(db)
    freeze_business_clock(SUNDAY_6PM + datetime.timedelta(hours=1))

    second = _run_tick(db)

    assert second.result is TickResult.RAN
    assert _sends(fake_twilio, due_guardian) == 1


def test_a_settings_change_is_picked_up_on_the_next_tick(
    db: Session,
    freeze_business_clock: Freeze,
    fake_twilio: FakeTwilio,
    due_guardian: DueGuardian,
    set_int_setting: Callable[[str, int], None],
) -> None:
    freeze_business_clock(SUNDAY_6PM)
    set_int_setting("reminder_weekday", 1)
    before = _tick(db)

    set_int_setting("reminder_weekday", 7)
    set_int_setting("reminder_hour", 17)
    after = _tick(db)

    assert (before, after) == (TickResult.NOT_DUE, TickResult.RAN)
    assert _sends(fake_twilio, due_guardian) == 1


@pytest.mark.parametrize(
    "sunday",
    [datetime.date(2026, 11, 1), datetime.date(2027, 3, 14)],
    ids=["fall-back", "spring-forward"],
)
def test_on_a_dst_sunday_the_6pm_run_happens_once(
    db: Session,
    freeze_business_clock: Freeze,
    fake_twilio: FakeTwilio,
    due_guardian: DueGuardian,
    sunday: datetime.date,
) -> None:
    results = []
    for hour in (17, 18, 19, 23):
        freeze_business_clock(datetime.datetime.combine(sunday, datetime.time(hour, 0)))
        results.append(_tick(db))

    assert results == [TickResult.NOT_DUE, TickResult.RAN, TickResult.RAN, TickResult.RAN]
    assert _sends(fake_twilio, due_guardian) == 1
    week_starts = db.scalars(
        select(BookingReminder.week_start).where(
            BookingReminder.guardian_id == due_guardian.guardian_id
        )
    ).all()
    assert week_starts == [sunday + datetime.timedelta(days=1)]


def test_a_2am_hour_skipped_by_spring_forward_runs_at_the_first_tick_after_it(
    db: Session,
    freeze_business_clock: Freeze,
    fake_twilio: FakeTwilio,
    due_guardian: DueGuardian,
    set_int_setting: Callable[[str, int], None],
) -> None:
    set_int_setting("reminder_hour", 2)
    # New York's clock reads 01:00 and then 03:00 that night; 02:00 never comes.
    freeze_business_clock(SPRING_FORWARD_SUNDAY_2AM.replace(hour=1))
    at_one = _tick(db)
    freeze_business_clock(SPRING_FORWARD_SUNDAY_2AM.replace(hour=3))
    at_three = _tick(db)

    assert (at_one, at_three) == (TickResult.NOT_DUE, TickResult.RAN)
    assert _sends(fake_twilio, due_guardian) == 1


def test_a_tick_skips_while_another_instance_holds_the_reminder_lock(
    committed_sessions: sessionmaker[Session],
    freeze_business_clock: Freeze,
    caplog: pytest.LogCaptureFixture,
) -> None:
    freeze_business_clock(SUNDAY_6PM)

    with committed_sessions() as holder:
        holder.execute(
            select(func.pg_advisory_xact_lock(REMINDER_LOCK_NAMESPACE, REMINDER_LOCK_KEY))
        )
        with caplog.at_level(logging.INFO, logger=reminder_scheduler.__name__):
            result = run_tick(committed_sessions).result
        holder.rollback()

    assert result is TickResult.SKIPPED
    assert [record.getMessage() for record in caplog.records] == [SKIPPED_LINE]


def test_the_reminder_lock_is_not_the_retention_lock() -> None:
    assert (REMINDER_LOCK_NAMESPACE, REMINDER_LOCK_KEY) != (
        RETENTION_LOCK_NAMESPACE,
        RETENTION_LOCK_KEY,
    )


def test_a_tick_that_fails_logs_failed_and_returns_instead_of_raising(
    db: Session,
    freeze_business_clock: Freeze,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    freeze_business_clock(SUNDAY_6PM)

    def fail(db: Session, *, now: datetime.datetime) -> None:
        raise RuntimeError("database went away")

    monkeypatch.setattr(reminder_scheduler, "run_week", fail)

    with caplog.at_level(logging.INFO, logger=reminder_scheduler.__name__):
        result = _tick(db)

    assert result is TickResult.FAILED
    assert [record.getMessage() for record in caplog.records] == [FAILED_LINE]
    assert caplog.records[0].exc_info is not None


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


def test_run_forever_keeps_ticking_after_a_failed_tick(
    monkeypatch: pytest.MonkeyPatch, freeze_business_clock: Freeze
) -> None:
    freeze_business_clock(SUNDAY_6PM)
    monkeypatch.setattr(reminder_scheduler, "_seconds_until_next_hour", lambda now: 0.0)
    monkeypatch.setattr(reminder_scheduler, "_TICK_JITTER_SECONDS", 0.0)
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


def test_lifespan_starts_the_reminder_scheduler_and_cancels_it_on_exit(
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

    monkeypatch.setattr(main, "run_reminders_forever", fake_run_forever)

    with TestClient(main.create_app()):
        assert started.wait(5) is True
        assert cancelled.is_set() is False

    assert cancelled.is_set() is True


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)
