"""The nightly retention purge, run from inside the API process on an hourly tick (REQ-085).

**This reverses P7-L**, which kept every scheduler out of `api/app/` and ran the purge as an
externally invoked command. The three reasons that decision gave are answered here, not waved
away:

- **Several processes racing one DELETE** (`--workers N`, or N tasks behind the load balancer).
  Every run takes `pg_try_advisory_xact_lock(8102, 1)` first; whoever does not get it logs
  "skipped" and touches nothing. Two instances waking at the same tick purge once. One whose
  tick lands after the first has finished takes the released lock and runs again, deleting
  nothing new — idempotent, and accepted (P8-O): the lock prevents *concurrent* purges, which is
  the real hazard, and exactly-once-per-day would need a stored marker nobody asked for.
- **A purge tied to the API's uptime silently skipping a night.** Accepted as the brief's
  trade-off: no instance up at the configured hour means no purge that day, and no catch-up.
  What is not accepted is *silently* — every run and every skip writes one fixed log line.
- **No exit code to alert on.** Each outcome is one of the four lines below, which is what the
  runbook greps CloudWatch for, and `python -m app.cli purge-messages` still exists for a manual
  run with an exit status, through the very same guarded function.

**The lock is transaction-scoped, never `pg_try_advisory_lock`** (P8-M). A session lock belongs
to the pooled connection, not to the run: a run that fails between lock and unlock returns the
connection to the pool still holding it, and every later night's purge then finds the lock
taken, logs "skipped", and never purges again. An `xact` lock cannot outlive the commit or
rollback of the transaction that took it, so a crash anywhere in the run releases it.

**Nothing touches the database until the first tick.** `run_forever` sleeps first, so starting
the API, and every `with TestClient(app)` in the suite, costs no connection and logs nothing.
Each tick then reads `retention_purge_hour_utc` afresh, so an admin's edit takes effect at the
next hour without a restart, and a tick that cannot reach the database logs "failed" and waits
for the next one. The loop itself never dies of a failed tick; only cancellation ends it.

This module knows nothing about FastAPI. The sync work runs on `asyncio.to_thread`, and the
lifespan that starts and cancels `run_forever` lives in `app/main.py`.
"""

import asyncio
import logging
import random
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.services.retention_service import (
    PurgeResult,
    purge_expired_messages,
    reap_expired_flow_states,
    reap_expired_login_attempts,
)
from app.services.settings_service import get_int_setting

RETENTION_PURGE_HOUR_SETTING = "retention_purge_hour_utc"
RETENTION_LOCK_NAMESPACE = 8102
RETENTION_LOCK_KEY = 1

RAN_MESSAGE = "retention purge: ran messages=%d conversations=%d flow_states=%d login_attempts=%d"
RAN_CHAT_DISABLED_MESSAGE = (
    "retention purge: ran, chat purge disabled (chat_retention_days=0)"
    " flow_states=%d login_attempts=%d"
)
SKIPPED_MESSAGE = "retention purge: skipped, another instance holds the lock"
FAILED_MESSAGE = "retention purge: failed"

_TICK_JITTER_SECONDS = 30.0

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PurgeRun:
    """`ran=False` means another instance held the lock and nothing was read or deleted."""

    ran: bool
    purge: PurgeResult | None
    flow_states_deleted: int
    login_attempts_deleted: int


def run_guarded_purge(session_factory: Callable[[], Session]) -> PurgeRun:
    """The purge and both reaps in one transaction, under the retention advisory lock.

    One transaction is the whole contract: the lock is released by the commit, so a commit
    between the three steps would let a second instance start deleting while this one is still
    running. Logs exactly one of the four outcome lines, and re-raises a failure after logging it
    so the CLI can exit non-zero and `run_forever` can wait for the next hour.
    """
    with session_factory() as session:
        try:
            run = _purge_under_lock(session)
        except Exception:
            logger.exception(FAILED_MESSAGE)
            session.rollback()
            raise

    _log_run(run)

    return run


def run_scheduled_purge(
    session_factory: Callable[[], Session], *, now: datetime
) -> PurgeRun | None:
    """Run the guarded purge if `now` falls in the configured hour; `None` means not due."""
    if _read_purge_hour(session_factory) == now.hour:
        run = run_guarded_purge(session_factory)
    else:
        run = None

    return run


async def run_forever(session_factory: Callable[[], Session]) -> None:
    """Tick at every top of the hour UTC until cancelled.

    The jitter spreads instances that booted together across half a minute, so they do not all
    reach the lock in the same millisecond; the loser's "skipped" line is the same either way.

    Every exception `run_scheduled_purge` can raise has already been logged as "failed" by the
    time it arrives here — by `run_guarded_purge` for the run itself, by `_read_purge_hour` for
    the settings read — so it is dropped rather than logged twice. Dropping it is the point: one
    failed night must not end the task and with it every night after. `CancelledError` is not an
    `Exception` and ends the loop as it should.
    """
    while True:
        delay = _seconds_until_next_hour(datetime.now(UTC))
        await asyncio.sleep(delay + random.uniform(0, _TICK_JITTER_SECONDS))
        try:
            await asyncio.to_thread(run_scheduled_purge, session_factory, now=datetime.now(UTC))
        except Exception:
            pass


def _purge_under_lock(session: Session) -> PurgeRun:
    acquired = session.execute(
        select(func.pg_try_advisory_xact_lock(RETENTION_LOCK_NAMESPACE, RETENTION_LOCK_KEY))
    ).scalar_one()

    if acquired:
        purge = purge_expired_messages(session)
        flow_states_deleted = reap_expired_flow_states(session)
        login_attempts_deleted = reap_expired_login_attempts(session)
        session.commit()
        run = PurgeRun(
            ran=True,
            purge=purge,
            flow_states_deleted=flow_states_deleted,
            login_attempts_deleted=login_attempts_deleted,
        )
    else:
        session.rollback()
        run = PurgeRun(ran=False, purge=None, flow_states_deleted=0, login_attempts_deleted=0)

    return run


def _log_run(run: PurgeRun) -> None:
    if run.purge is None:
        logger.info(SKIPPED_MESSAGE)
    elif run.purge.ran:
        logger.info(
            RAN_MESSAGE,
            run.purge.messages_deleted,
            run.purge.conversations_deleted,
            run.flow_states_deleted,
            run.login_attempts_deleted,
        )
    else:
        logger.info(RAN_CHAT_DISABLED_MESSAGE, run.flow_states_deleted, run.login_attempts_deleted)


def _read_purge_hour(session_factory: Callable[[], Session]) -> int:
    try:
        with session_factory() as session:
            hour = get_int_setting(session, key=RETENTION_PURGE_HOUR_SETTING)
    except Exception:
        logger.exception(FAILED_MESSAGE)
        raise

    return hour


def _seconds_until_next_hour(now: datetime) -> float:
    top_of_this_hour = now.replace(minute=0, second=0, microsecond=0)

    return (top_of_this_hour + timedelta(hours=1) - now).total_seconds()
