"""The bot's due-turn worker (docs/specs/whatsapp-bot-agent.md §7): runs each chat's debounced
turn once its `turn_due_at` has passed.

In-process like `reply_window_scheduler` and `retention_scheduler`, polling every second. What
differs from those:

**One lock per chat, held across commits.** A turn commits more than once, so the lock is the
session-level `pg_try_advisory_lock`, not the transaction-scoped one. It sits on its own
`Connection`, not on the turn's session: SQLAlchemy hands a session's connection back to the pool
on commit or rollback, and a session-level lock left on a pooled connection would be held by
whoever checks it out next. The unlock rolls back first (a failed statement would refuse it) and
discards the connection if it still fails. The turn and the clear each get their own session.
A chat whose lock is held is skipped; whoever holds it is running that turn.

**The marker clears only if unchanged.** The value seen before the turn is the one cleared
after it. An inbound that arrived mid-turn moved the marker, so it stays due and the next turn
runs after this one committed and sent, seeing this reply in its history.

**Crashes need no retry state.** A process killed mid-turn never cleared the marker, so the
next poll after restart runs the turn again. A turn that raises an ordinary exception is a bug,
not an outage (the turn handles those itself): it is logged and its marker cleared, so one bad
chat cannot spin forever.

**Taken-over chats** have their marker cleared by the poll without a turn.
"""

import asyncio
import contextlib
import datetime
import logging
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import Connection, func, select, update
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus

TakeTurn = Callable[[Session, uuid.UUID], object]

# The schedulers hold (8102, 1..3); chats get their own namespace so no chat can block a job.
BOT_TURN_LOCK_NAMESPACE = 8103
MAX_CONCURRENT_TURNS = 4

TURN_FAILED_MESSAGE = "bot worker: turn failed conversation_id=%s"
POLL_FAILED_MESSAGE = "bot worker: poll failed"

logger = logging.getLogger(__name__)


def run_due_turns(
    session_factory: Callable[[], Session],
    *,
    now: datetime.datetime,
    take_turn: TakeTurn,
) -> int:
    """Run every turn due at `now`, up to four at once, and return how many turns ran.

    A turn that raises is logged and counted. Anything that is not an `Exception` (a simulated
    crash, `SystemExit`) escapes and leaves its marker due.
    """
    due = _poll_due(session_factory, now=now)
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_TURNS) as pool:
        futures = [
            pool.submit(_run_turn, session_factory, conversation_id, now=now, take_turn=take_turn)
            for conversation_id in due
        ]
        ran = [future.result() for future in futures]

    return sum(ran)


async def run_forever(
    session_factory: Callable[[], Session], *, take_turn: TakeTurn, poll_s: float = 1.0
) -> None:
    """Poll every `poll_s` seconds until cancelled, running due turns in the background.

    A poll does not wait for the turns it started, so one slow chat never delays another; a
    chat whose turn is still running here is not started again. Sleeps first, so starting the
    API touches no database.
    """
    running: dict[uuid.UUID, asyncio.Task[None]] = {}
    slots = asyncio.Semaphore(MAX_CONCURRENT_TURNS)

    async def run_one(conversation_id: uuid.UUID, now: datetime.datetime) -> None:
        try:
            async with slots:
                await asyncio.to_thread(
                    _run_turn, session_factory, conversation_id, now=now, take_turn=take_turn
                )
        except Exception:
            # The lock or the clear failed; the marker stays due and a later poll retries.
            logger.exception(TURN_FAILED_MESSAGE, conversation_id)
        finally:
            running.pop(conversation_id, None)

    try:
        while True:
            await asyncio.sleep(poll_s)
            now = datetime.datetime.now(tz=datetime.UTC)
            try:
                due = await asyncio.to_thread(_poll_due, session_factory, now=now)
            except Exception:
                logger.exception(POLL_FAILED_MESSAGE)
                due = []
            for conversation_id in due:
                if conversation_id not in running:
                    running[conversation_id] = asyncio.create_task(run_one(conversation_id, now))
    finally:
        for task in list(running.values()):
            task.cancel()


def _poll_due(session_factory: Callable[[], Session], *, now: datetime.datetime) -> list[uuid.UUID]:
    """Clear Taken-over chats' markers, and return the bot chats due at `now`, oldest first."""
    with session_factory() as db:
        db.execute(
            update(Conversation)
            .where(
                Conversation.turn_due_at <= now,
                Conversation.status != ConversationStatus.BOT,
            )
            .values(turn_due_at=None)
        )
        due = list(
            db.scalars(
                select(Conversation.id)
                .where(Conversation.turn_due_at <= now)
                .order_by(Conversation.turn_due_at)
            )
        )
        db.commit()

    return due


def _run_turn(
    session_factory: Callable[[], Session],
    conversation_id: uuid.UUID,
    *,
    now: datetime.datetime,
    take_turn: TakeTurn,
) -> bool:
    """Run one chat's turn under its lock; False when it was not run (lock held, or no longer
    due because another worker finished it between the poll and the lock)."""
    with _chat_lock(session_factory, conversation_id) as lock_connection:
        seen = (
            None
            if lock_connection is None
            else _due_marker(lock_connection, conversation_id, now=now)
        )
        if seen is not None:
            with session_factory() as turn_db:
                try:
                    take_turn(turn_db, conversation_id)
                except Exception:
                    logger.exception(TURN_FAILED_MESSAGE, conversation_id)
            _clear_marker(session_factory, conversation_id, seen=seen)

    return seen is not None


@contextlib.contextmanager
def _chat_lock(
    session_factory: Callable[[], Session], conversation_id: uuid.UUID
) -> Iterator[Connection | None]:
    """The connection holding this chat's lock, or None when someone else holds it.

    A `Connection` rather than a `Session`: it keeps its one DBAPI connection through a
    rollback, so the unlock runs where the lock was taken. A session would hand it back to the
    pool on rollback, lock and all.
    """
    with session_factory() as db:
        engine = db.get_bind().engine
    with engine.connect() as connection:
        key = _lock_key(conversation_id)
        is_locked = connection.execute(
            select(func.pg_try_advisory_lock(BOT_TURN_LOCK_NAMESPACE, key))
        ).scalar_one()
        try:
            yield connection if is_locked else None
        finally:
            if is_locked:
                _unlock(connection, key)


def _unlock(connection: Connection, key: int) -> None:
    try:
        # A failed statement under the lock aborts the transaction, refusing the unlock.
        connection.rollback()
        connection.execute(select(func.pg_advisory_unlock(BOT_TURN_LOCK_NAMESPACE, key)))
    except Exception:
        # Session-level locks survive a rollback: a connection that may still hold one is
        # discarded, never pooled.
        connection.invalidate()
        raise


def _lock_key(conversation_id: uuid.UUID) -> int:
    # The two-int lock form takes an int4. Two chats sharing a key only means one waits a tick.
    return int.from_bytes(conversation_id.bytes[:4], "big", signed=True)


def _due_marker(
    connection: Connection, conversation_id: uuid.UUID, *, now: datetime.datetime
) -> datetime.datetime | None:
    """The chat's marker if it is still a due bot turn, read under the lock."""
    return connection.scalar(
        select(Conversation.turn_due_at).where(
            Conversation.id == conversation_id,
            Conversation.turn_due_at <= now,
            Conversation.status == ConversationStatus.BOT,
        )
    )


def _clear_marker(
    session_factory: Callable[[], Session], conversation_id: uuid.UUID, *, seen: datetime.datetime
) -> None:
    with session_factory() as db:
        db.execute(
            update(Conversation)
            .where(Conversation.id == conversation_id, Conversation.turn_due_at == seen)
            .values(turn_due_at=None)
        )
        db.commit()
