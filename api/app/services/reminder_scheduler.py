"""The weekly Booking reminder's in-process scheduler: an hourly tick that runs the week when
business-local now is on `reminder_weekday`, at or after `reminder_hour`.

Shaped like `retention_scheduler`, whose docstring argues the in-process choice; what differs:

**Due is a window, not an hour.** Any tick from the hour to midnight on the day is due, so the
first tick at or after the hour runs: a 2 AM hour on a spring-forward night (when 02:00 never
comes) runs at 03:00, and an instance that was down at 18:00 still reminds at 19:00. Every tick
after the first is a no-op because a Guardian's row for the week is the de-dup. There is no
catch-up on a later day.

**The lock is held on its own session** while the run commits on another. `run_week` commits
once per Guardian so a reminder already sent is never rolled back, and a transaction-scoped
lock would be released by the first of those commits. A second session keeps the lock's
transaction open for the whole run, and a crash still releases it with that session's
connection.

**Each tick logs one fixed line**: ran with counts, not due, skipped (lock held), or failed.
Settings and the clock are read afresh every tick, so an edit takes effect at the next hour.
"""

import asyncio
import datetime
import enum
import logging
import random
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.services import clock
from app.services.reminder_service import RunResult, run_week
from app.services.settings_service import get_int_setting

REMINDER_WEEKDAY_SETTING = "reminder_weekday"
REMINDER_HOUR_SETTING = "reminder_hour"
# The retention purge holds (8102, 1); the two jobs never block each other.
REMINDER_LOCK_NAMESPACE = 8102
REMINDER_LOCK_KEY = 2

RAN_MESSAGE = "booking reminders: ran week_start=%s sent=%d failed=%d undeliverable=%d skipped=%d"
NOT_DUE_MESSAGE = "booking reminders: not due"
SKIPPED_MESSAGE = "booking reminders: skipped, another instance holds the lock"
FAILED_MESSAGE = "booking reminders: failed"

_TICK_JITTER_SECONDS = 30.0

logger = logging.getLogger(__name__)


class TickResult(enum.Enum):
    RAN = "ran"
    NOT_DUE = "not_due"
    SKIPPED = "skipped"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class TickOutcome:
    """What one tick did; `run` is set only when it ran."""

    result: TickResult
    run: RunResult | None = None


def run_tick(session_factory: Callable[[], Session]) -> TickOutcome:
    """One scheduler pass. Never raises: a failure is logged and reported as `FAILED`."""
    try:
        outcome = _tick(session_factory, now=clock.business_now())
    except Exception:
        logger.exception(FAILED_MESSAGE)
        outcome = TickOutcome(result=TickResult.FAILED)
    else:
        _log(outcome)

    return outcome


async def run_forever(session_factory: Callable[[], Session]) -> None:
    """Tick at every top of the hour, plus jitter, until cancelled.

    Sleeps first, so starting the API touches no database. `run_tick` logs and swallows its own
    failures, so one bad hour cannot end the loop; `CancelledError` still does.
    """
    while True:
        delay = _seconds_until_next_hour(datetime.datetime.now(datetime.UTC))
        await asyncio.sleep(delay + random.uniform(0, _TICK_JITTER_SECONDS))
        await asyncio.to_thread(run_tick, session_factory)


def _tick(session_factory: Callable[[], Session], *, now: datetime.datetime) -> TickOutcome:
    with session_factory() as lock_session:
        weekday = get_int_setting(lock_session, key=REMINDER_WEEKDAY_SETTING)
        hour = get_int_setting(lock_session, key=REMINDER_HOUR_SETTING)

        if not _is_due(now, weekday=weekday, hour=hour):
            outcome = TickOutcome(result=TickResult.NOT_DUE)
        elif not _try_lock(lock_session):
            outcome = TickOutcome(result=TickResult.SKIPPED)
        else:
            with session_factory() as db:
                outcome = TickOutcome(result=TickResult.RAN, run=run_week(db, now=now))
        # Ends the lock's transaction, and with it the lock.
        lock_session.rollback()

    return outcome


def _is_due(now: datetime.datetime, *, weekday: int, hour: int) -> bool:
    """On the configured ISO weekday, from the hour until midnight."""
    return now.isoweekday() == weekday and now.hour >= hour


def _try_lock(session: Session) -> bool:
    return session.execute(
        select(func.pg_try_advisory_xact_lock(REMINDER_LOCK_NAMESPACE, REMINDER_LOCK_KEY))
    ).scalar_one()


def _log(outcome: TickOutcome) -> None:
    if outcome.run is not None:
        logger.info(
            RAN_MESSAGE,
            outcome.run.week_start.isoformat(),
            outcome.run.sent,
            outcome.run.failed,
            outcome.run.undeliverable,
            outcome.run.skipped,
        )
    elif outcome.result is TickResult.NOT_DUE:
        logger.info(NOT_DUE_MESSAGE)
    else:
        logger.info(SKIPPED_MESSAGE)


def _seconds_until_next_hour(now: datetime.datetime) -> float:
    top_of_this_hour = now.replace(minute=0, second=0, microsecond=0)

    return (top_of_this_hour + datetime.timedelta(hours=1) - now).total_seconds()
