"""The "Reply window closed" check's in-process scheduler: every five minutes, Taken-over chats
whose Guardian's 24-hour WhatsApp window has closed go back to Needs attention.

Shaped like `retention_scheduler`, whose docstring argues the in-process choice and the
transaction-scoped lock; what differs:

**One transaction, one lock.** The check and its flags commit once, so the transaction-scoped
`pg_try_advisory_xact_lock(8102, 3)` is held for the whole run and released by that commit. Two
instances ticking together check once; the loser logs "skipped". A later tick that finds the
lock free runs again and flags nothing new, because each closed window is flagged once
(`conversation_service.flag_closed_reply_windows`).

**Publishing comes after the commit.** Each flagged chat gets a `conversation.updated`, which
the socket pump rebuilds from the row, so a notice sent before the commit would find the old
row. `broadcast_service.publish` fails open on a database error, and any other error from it
is logged here per chat, so a dropped notice never fails the tick or ends the loop.

**Each tick logs one fixed line**: ran with a count, skipped (lock held), or failed. A failed
tick never ends the loop; only cancellation does. Nothing touches the database until the first
tick, because the loop sleeps first.
"""

import asyncio
import datetime
import enum
import logging
import random
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.services.broadcast_service import ConversationUpdated, publish
from app.services.conversation_service import flag_closed_reply_windows

# The retention purge holds (8102, 1) and the reminders (8102, 2); no job blocks another.
REPLY_WINDOW_LOCK_NAMESPACE = 8102
REPLY_WINDOW_LOCK_KEY = 3

RAN_MESSAGE = "reply window check: ran flagged=%d"
SKIPPED_MESSAGE = "reply window check: skipped, another instance holds the lock"
FAILED_MESSAGE = "reply window check: failed"
PUBLISH_FAILED_MESSAGE = "reply window check: publish failed conversation_id=%s"

_TICK_SECONDS = 300.0
_TICK_JITTER_SECONDS = 30.0

logger = logging.getLogger(__name__)


class TickResult(enum.Enum):
    RAN = "ran"
    SKIPPED = "skipped"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class TickOutcome:
    """What one tick did; `flagged` is the chats it flagged, empty unless it ran."""

    result: TickResult
    flagged: tuple[uuid.UUID, ...] = ()


def run_tick(session_factory: Callable[[], Session], *, now: datetime.datetime) -> TickOutcome:
    """One check. Never raises: a failure is logged and reported as `FAILED`."""
    try:
        outcome = _tick(session_factory, now=now)
    except Exception:
        logger.exception(FAILED_MESSAGE)
        outcome = TickOutcome(result=TickResult.FAILED)
    else:
        _log(outcome)
        _publish(outcome.flagged)

    return outcome


async def run_forever(session_factory: Callable[[], Session]) -> None:
    """Tick every five minutes, plus jitter, until cancelled.

    Sleeps first, so starting the API touches no database. `run_tick` logs and swallows its own
    failures, so one bad tick cannot end the loop; `CancelledError` still does.
    """
    while True:
        await asyncio.sleep(_TICK_SECONDS + random.uniform(0, _TICK_JITTER_SECONDS))
        await asyncio.to_thread(
            run_tick, session_factory, now=datetime.datetime.now(tz=datetime.UTC)
        )


def _tick(session_factory: Callable[[], Session], *, now: datetime.datetime) -> TickOutcome:
    with session_factory() as db:
        if _try_lock(db):
            flagged = tuple(flag_closed_reply_windows(db, now=now))
            # Releases the lock with the flags.
            db.commit()
            outcome = TickOutcome(result=TickResult.RAN, flagged=flagged)
        else:
            db.rollback()
            outcome = TickOutcome(result=TickResult.SKIPPED)

    return outcome


def _try_lock(db: Session) -> bool:
    return db.execute(
        select(func.pg_try_advisory_xact_lock(REPLY_WINDOW_LOCK_NAMESPACE, REPLY_WINDOW_LOCK_KEY))
    ).scalar_one()


def _publish(flagged: tuple[uuid.UUID, ...]) -> None:
    # Only the id crosses the channel (see `broadcast_service`): the pump reads the row back
    # and serialises it, so the router's `ConversationRead` is not needed here.
    for conversation_id in flagged:
        try:
            publish(ConversationUpdated(conversation={"id": str(conversation_id)}))
        except Exception:
            # `publish` swallows only database errors. The flags are committed, so a notice
            # that cannot go out is logged and dropped rather than ending the loop.
            logger.exception(PUBLISH_FAILED_MESSAGE, conversation_id)


def _log(outcome: TickOutcome) -> None:
    if outcome.result is TickResult.RAN:
        logger.info(RAN_MESSAGE, len(outcome.flagged))
    else:
        logger.info(SKIPPED_MESSAGE)
