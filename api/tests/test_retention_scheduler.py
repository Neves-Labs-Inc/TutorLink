"""`retention_scheduler`: the hour gate, the advisory lock, the tick loop, and the lifespan.

**The lock tests run on `committed_sessions`, never on the `db` fixture** (P4-N). Every session
the `db` fixture hands out shares one connection, and an advisory lock is reentrant for the
connection that holds it, so a "second instance" built from `db` would acquire the lock its
twin is holding and the skip path would never be reached. Only two real connections can contend.
The runs that do get the lock commit for real against the test database, so each such test
creates its own committed rows, asserts on those alone, and deletes whatever survives.

**The lock is proven transaction-scoped by reading `pg_locks` after a run**, not by trusting the
function name. A session-level lock left behind would sit on a pooled connection and be listed
there; an `xact` lock is gone the moment the run's transaction ends, success or failure.

**The loop is driven for real, with the waits shortened.** `_seconds_until_next_hour` and the
jitter are replaced so the loop ticks back to back, and a session factory pointed at a port
nothing listens on stands in for an unreachable database — the failure a production tick meets
when RDS is down. The factory counts its calls, which is how "no database access before the
first tick" is observed: an idle loop never calls it at all.

The hour row is seeded inside each test that reads it, as an upsert through the session it uses:
`conftest.py` does not seed it yet, and once it does a plain insert would collide.
"""

import asyncio
import datetime
import logging
import threading
import time
import uuid
from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.models.bot_flow_state import BotFlowState
from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting
from app.services import retention_scheduler
from app.services.retention_scheduler import (
    RETENTION_LOCK_KEY,
    RETENTION_LOCK_NAMESPACE,
    RETENTION_PURGE_HOUR_SETTING,
    _seconds_until_next_hour,
    run_forever,
    run_guarded_purge,
    run_scheduled_purge,
)

UTC = datetime.UTC
# Spelled out rather than imported: the runbook quotes these lines verbatim, so a test that
# compared against the module's own constants would pass straight through a reworded one.
SKIPPED_LINE = "retention purge: skipped, another instance holds the lock"
FAILED_LINE = "retention purge: failed"
UNREACHABLE_DATABASE_URL = "postgresql+psycopg://nobody:nothing@127.0.0.1:1/nothing"


def test_run_scheduled_purge_returns_none_and_touches_nothing_outside_the_hour(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    _seed_purge_hour(db, 3)
    phone_number = _add_flow_state(db, expires_at=_an_hour_ago())
    # A savepoint release under the `db` fixture, so closing the hour-read session cannot
    # roll the setup back and make "nothing was deleted" pass for the wrong reason.
    db.commit()

    with caplog.at_level(logging.DEBUG, logger=retention_scheduler.__name__):
        run = run_scheduled_purge(
            lambda: db, now=datetime.datetime(2026, 9, 24, 4, 0, 5, tzinfo=UTC)
        )

    assert run is None
    assert db.get(BotFlowState, phone_number) is not None
    assert caplog.records == []


def test_run_scheduled_purge_runs_the_guarded_purge_inside_the_hour(db: Session) -> None:
    _seed_purge_hour(db, 3)
    phone_number = _add_flow_state(db, expires_at=_an_hour_ago())
    db.commit()

    run = run_scheduled_purge(lambda: db, now=datetime.datetime(2026, 9, 24, 3, 0, 17, tzinfo=UTC))

    assert run is not None and run.ran is True
    assert db.get(BotFlowState, phone_number) is None


def test_run_guarded_purge_skips_while_another_transaction_holds_the_lock_and_runs_after(
    committed_sessions: sessionmaker[Session], caplog: pytest.LogCaptureFixture
) -> None:
    phone_number = _add_committed_flow_state(committed_sessions, expires_at=_an_hour_ago())
    try:
        with committed_sessions() as holder:
            holder.execute(
                select(func.pg_advisory_xact_lock(RETENTION_LOCK_NAMESPACE, RETENTION_LOCK_KEY))
            )
            with caplog.at_level(logging.INFO, logger=retention_scheduler.__name__):
                skipped = run_guarded_purge(committed_sessions)
            skip_messages = [record.getMessage() for record in caplog.records]
            survived_the_skip = _committed_flow_state_exists(committed_sessions, phone_number)
            holder.rollback()

        ran = run_guarded_purge(committed_sessions)

        assert skipped.ran is False
        assert skipped.purge is None
        assert skip_messages == [SKIPPED_LINE]
        assert survived_the_skip is True
        assert ran.ran is True
        assert ran.flow_states_deleted >= 1
        assert _committed_flow_state_exists(committed_sessions, phone_number) is False
    finally:
        _delete_committed_flow_state(committed_sessions, phone_number)


def test_run_guarded_purge_logs_the_ran_line_with_its_counts(
    committed_sessions: sessionmaker[Session], caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger=retention_scheduler.__name__):
        run = run_guarded_purge(committed_sessions)

    assert run.purge is not None
    assert [record.getMessage() for record in caplog.records] == [
        f"retention purge: ran messages={run.purge.messages_deleted}"
        f" conversations={run.purge.conversations_deleted}"
        f" flow_states={run.flow_states_deleted}"
        f" login_attempts={run.login_attempts_deleted}"
    ]
    assert _retention_lock_is_held(committed_sessions) is False


def test_run_guarded_purge_rolls_back_releases_the_lock_and_logs_failed_on_an_error(
    committed_sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # The failure lands after the flow-state reap has already deleted its row, so the row
    # surviving is what proves the three steps are one transaction rather than three.
    def fail(db: Session) -> int:
        raise RuntimeError("login attempts unavailable")

    monkeypatch.setattr(retention_scheduler, "reap_expired_login_attempts", fail)
    phone_number = _add_committed_flow_state(committed_sessions, expires_at=_an_hour_ago())
    try:
        with caplog.at_level(logging.INFO, logger=retention_scheduler.__name__):
            with pytest.raises(RuntimeError, match="login attempts unavailable"):
                run_guarded_purge(committed_sessions)

        assert [record.getMessage() for record in caplog.records] == [FAILED_LINE]
        assert caplog.records[0].exc_info is not None
        assert _committed_flow_state_exists(committed_sessions, phone_number) is True
        assert _retention_lock_is_held(committed_sessions) is False
    finally:
        _delete_committed_flow_state(committed_sessions, phone_number)


def test_run_scheduled_purge_logs_failed_and_raises_when_the_database_is_unreachable(
    unreachable_sessions: sessionmaker[Session], caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger=retention_scheduler.__name__):
        with pytest.raises(Exception):
            run_scheduled_purge(
                unreachable_sessions, now=datetime.datetime(2026, 9, 24, 3, 0, tzinfo=UTC)
            )

    assert [record.getMessage() for record in caplog.records] == [FAILED_LINE]


@pytest.mark.parametrize(
    ("now", "expected_seconds"),
    [
        (datetime.datetime(2026, 9, 24, 0, 0, 0, tzinfo=UTC), 3600.0),
        (datetime.datetime(2026, 9, 24, 0, 59, 59, 900000, tzinfo=UTC), 0.1),
        (datetime.datetime(2026, 9, 24, 23, 30, 0, tzinfo=UTC), 1800.0),
        (datetime.datetime(2026, 1, 31, 23, 59, 30, tzinfo=UTC), 30.0),
        (datetime.datetime(2026, 2, 28, 23, 59, 59, tzinfo=UTC), 1.0),
        (datetime.datetime(2026, 12, 31, 23, 15, 0, tzinfo=UTC), 2700.0),
    ],
    ids=[
        "top-of-hour",
        "a-tenth-before-the-hour",
        "before-midnight",
        "january-month-end",
        "february-month-end",
        "year-end",
    ],
)
def test_seconds_until_next_hour(now: datetime.datetime, expected_seconds: float) -> None:
    assert _seconds_until_next_hour(now) == pytest.approx(expected_seconds)


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


def test_run_forever_keeps_ticking_after_a_tick_that_cannot_reach_the_database(
    unreachable_sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(retention_scheduler, "_seconds_until_next_hour", lambda now: 0.0)
    monkeypatch.setattr(retention_scheduler, "_TICK_JITTER_SECONDS", 0.0)
    third_tick = threading.Event()
    ticks: list[None] = []

    def counting_factory() -> Session:
        ticks.append(None)
        if len(ticks) >= 3:
            third_tick.set()
        return unreachable_sessions()

    async def run_until_third_tick() -> bool:
        task = asyncio.create_task(run_forever(counting_factory))
        reached = await asyncio.to_thread(third_tick.wait, 10)
        still_running = not task.done()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return reached and still_running

    with caplog.at_level(logging.INFO, logger=retention_scheduler.__name__):
        survived = asyncio.run(run_until_third_tick())

    assert survived is True
    assert len([r for r in caplog.records if r.getMessage() == FAILED_LINE]) >= 2


def test_lifespan_starts_the_scheduler_and_cancels_it_on_exit(
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

    monkeypatch.setattr(main, "run_forever", fake_run_forever)

    with TestClient(main.create_app()):
        assert started.wait(5) is True
        assert cancelled.is_set() is False

    assert cancelled.is_set() is True


def test_lifespan_enters_and_exits_promptly_without_touching_the_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main

    calls: list[None] = []

    def recording_factory() -> Session:
        calls.append(None)
        raise AssertionError("the lifespan opened a session")

    monkeypatch.setattr(main, "SessionLocal", recording_factory)
    started_at = time.monotonic()

    with TestClient(main.create_app()) as client:
        assert client.get("/health").status_code == 200

    assert time.monotonic() - started_at < 5
    assert calls == []


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    """Real, independently-committing sessions on `_test_engine`, one connection each.

    The only way two sessions can contend for the retention lock: see the module docstring.
    """
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def unreachable_sessions() -> Generator[sessionmaker[Session], None, None]:
    """Sessions whose first statement fails to connect, standing in for a database that is down."""
    engine = create_engine(UNREACHABLE_DATABASE_URL, poolclass=NullPool)
    try:
        yield sessionmaker(bind=engine)
    finally:
        engine.dispose()


def _seed_purge_hour(db: Session, hour: int) -> None:
    statement = insert(SystemSetting).values(
        key=RETENTION_PURGE_HOUR_SETTING,
        value=str(hour),
        value_type=SETTING_VALUE_TYPE_INTEGER,
        is_developer_only=False,
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[SystemSetting.key], set_={"value": statement.excluded.value}
        )
    )
    db.flush()


def _add_flow_state(db: Session, *, expires_at: datetime.datetime) -> str:
    flow_state = _flow_state(expires_at=expires_at)
    db.add(flow_state)
    db.flush()

    return flow_state.phone_number


def _add_committed_flow_state(
    sessions: sessionmaker[Session], *, expires_at: datetime.datetime
) -> str:
    with sessions() as session:
        flow_state = _flow_state(expires_at=expires_at)
        session.add(flow_state)
        session.commit()

    return flow_state.phone_number


def _committed_flow_state_exists(sessions: sessionmaker[Session], phone_number: str) -> bool:
    with sessions() as session:
        exists = session.get(BotFlowState, phone_number) is not None

    return exists


def _delete_committed_flow_state(sessions: sessionmaker[Session], phone_number: str) -> None:
    with sessions() as session:
        session.execute(delete(BotFlowState).where(BotFlowState.phone_number == phone_number))
        session.commit()


def _retention_lock_is_held(sessions: sessionmaker[Session]) -> bool:
    # A two-integer advisory key is listed with the first integer as `classid`, the second as
    # `objid`, and `objsubid = 2`; one taken by any connection, in any mode, shows up here.
    with sessions() as session:
        held = session.execute(
            text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'"
                " AND classid = :namespace AND objid = :key AND objsubid = 2"
            ),
            {"namespace": RETENTION_LOCK_NAMESPACE, "key": RETENTION_LOCK_KEY},
        ).scalar_one()

    return held > 0


def _flow_state(*, expires_at: datetime.datetime) -> BotFlowState:
    return BotFlowState(
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
        step="awaiting_name",
        collected_data={},
        misses=0,
        prompt="What is your name?",
        expires_at=expires_at,
    )


def _an_hour_ago() -> datetime.datetime:
    return datetime.datetime.now(UTC) - datetime.timedelta(hours=1)
