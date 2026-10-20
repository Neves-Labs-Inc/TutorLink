"""`bot_worker`: the due-turn poll, the per-chat advisory lock, the conditional clear, and crashes.

Every case runs on committed sessions from their own `NullPool` engine, because the worker opens
several sessions per turn and an advisory lock is reentrant for the connection that holds it: two
contenders sharing one pooled connection would both get the lock. Rows are committed, so each
test deletes what it made. The poll sees every due chat in the test database, so assertions count
calls for this test's own chats only.
"""

import asyncio
import datetime
import logging
import threading
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from collections.abc import Callable, Generator

import pytest
from sqlalchemy import Connection, create_engine, delete, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, UserRole
from app.models.user import User
from app.security import hash_password
from app.services import bot_worker
from app.services.bot_worker import BOT_TURN_LOCK_NAMESPACE, run_due_turns, run_forever

NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)
SECOND = datetime.timedelta(seconds=1)
BARRIER_TIMEOUT_SECONDS = 10
POLL_SECONDS = 0.05

MakeChat = Callable[..., uuid.UUID]


class SimulatedCrash(BaseException):
    """The process dying mid-turn: not an `Exception`, so nothing in the worker handles it."""


class RecordingTurn:
    """A fake `take_turn` that records which chats it ran."""

    def __init__(self) -> None:
        self.calls: list[uuid.UUID] = []

    def __call__(self, db: Session, conversation_id: uuid.UUID) -> None:
        self.calls.append(conversation_id)


def test_a_chat_runs_once_its_turn_is_due_and_its_marker_clears(
    sessions: sessionmaker[Session], make_chat: MakeChat
) -> None:
    chat = make_chat(turn_due_at=NOON)
    turn = RecordingTurn()

    run_due_turns(sessions, now=NOON - SECOND, take_turn=turn)
    assert turn.calls.count(chat) == 0
    assert _marker(sessions, chat) == NOON

    run_due_turns(sessions, now=NOON, take_turn=turn)
    assert turn.calls.count(chat) == 1
    assert _marker(sessions, chat) is None


def test_a_marker_moved_mid_turn_stays_due_and_the_next_tick_runs_a_second_turn(
    sessions: sessionmaker[Session], make_chat: MakeChat
) -> None:
    chat = make_chat(turn_due_at=NOON)
    later = NOON + 4 * SECOND
    calls: list[uuid.UUID] = []

    def turn_while_an_inbound_arrives(db: Session, conversation_id: uuid.UUID) -> None:
        calls.append(conversation_id)
        if calls.count(chat) == 1:
            # The webhook stamping a new debounce from its own session, mid-turn.
            _move_marker(sessions, chat, to=later)

    run_due_turns(sessions, now=NOON, take_turn=turn_while_an_inbound_arrives)
    assert _marker(sessions, chat) == later

    run_due_turns(sessions, now=later, take_turn=turn_while_an_inbound_arrives)
    assert calls.count(chat) == 2
    assert _marker(sessions, chat) is None


def test_two_concurrent_workers_run_one_turn_for_the_same_chat(
    sessions: sessionmaker[Session], make_chat: MakeChat
) -> None:
    chat = make_chat(turn_due_at=NOON)
    started = threading.Barrier(2)
    release = threading.Event()
    turn = RecordingTurn()

    def hold_until_released(db: Session, conversation_id: uuid.UUID) -> None:
        turn(db, conversation_id)
        if conversation_id == chat:
            # Holds the lock until the other worker has polled, seen the chat due and given up.
            release.wait(timeout=BARRIER_TIMEOUT_SECONDS)

    def worker() -> int:
        started.wait(timeout=BARRIER_TIMEOUT_SECONDS)
        return run_due_turns(sessions, now=NOON, take_turn=hold_until_released)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(worker) for _ in range(2)]
        wait(futures, return_when=FIRST_COMPLETED, timeout=BARRIER_TIMEOUT_SECONDS)
        release.set()
        for future in futures:
            future.result()

    assert turn.calls.count(chat) == 1
    assert _marker(sessions, chat) is None


def test_a_taken_over_chats_marker_clears_without_a_turn(
    sessions: sessionmaker[Session], admin_id: uuid.UUID, make_chat: MakeChat
) -> None:
    chat = make_chat(
        turn_due_at=NOON,
        status=ConversationStatus.HUMAN,
        taken_over_by_user_id=admin_id,
        taken_over_at=NOON,
    )
    turn = RecordingTurn()

    run_due_turns(sessions, now=NOON, take_turn=turn)

    assert chat not in turn.calls
    assert _marker(sessions, chat) is None


def test_a_turn_that_raises_is_logged_cleared_and_other_chats_still_run(
    sessions: sessionmaker[Session], make_chat: MakeChat, caplog: pytest.LogCaptureFixture
) -> None:
    bad = make_chat(turn_due_at=NOON - SECOND)
    good = make_chat(turn_due_at=NOON)
    turn = RecordingTurn()

    def raise_for_the_bad_chat(db: Session, conversation_id: uuid.UUID) -> None:
        if conversation_id == bad:
            raise RuntimeError("a bug outside the turn's outage handling")
        turn(db, conversation_id)

    with caplog.at_level(logging.ERROR, logger=bot_worker.__name__):
        run_due_turns(sessions, now=NOON, take_turn=raise_for_the_bad_chat)

    assert f"bot worker: turn failed conversation_id={bad}" in [
        record.getMessage() for record in caplog.records
    ]
    assert _marker(sessions, bad) is None
    assert turn.calls.count(good) == 1
    assert _marker(sessions, good) is None


def test_a_crash_before_the_clear_leaves_the_marker_due_and_the_next_tick_reruns_it(
    sessions: sessionmaker[Session], make_chat: MakeChat
) -> None:
    chat = make_chat(turn_due_at=NOON)

    def crash(db: Session, conversation_id: uuid.UUID) -> None:
        if conversation_id == chat:
            raise SimulatedCrash

    with pytest.raises(SimulatedCrash):
        run_due_turns(sessions, now=NOON, take_turn=crash)
    assert _marker(sessions, chat) == NOON

    turn = RecordingTurn()
    run_due_turns(sessions, now=NOON, take_turn=turn)
    assert turn.calls.count(chat) == 1
    assert _marker(sessions, chat) is None


def test_run_forever_runs_due_turns_without_a_slow_chat_holding_up_another(
    make_chat: MakeChat, sessions: sessionmaker[Session]
) -> None:
    due = datetime.datetime.now(tz=datetime.UTC) - SECOND
    slow = make_chat(turn_due_at=due)
    fast = make_chat(turn_due_at=due + datetime.timedelta(microseconds=1))
    fast_ran = threading.Event()

    def turn(db: Session, conversation_id: uuid.UUID) -> None:
        if conversation_id == slow:
            # Still running when the fast chat's turn has to go out.
            fast_ran.wait(timeout=2 * BARRIER_TIMEOUT_SECONDS)
        elif conversation_id == fast:
            fast_ran.set()

    async def run_until_fast_chat_ran() -> None:
        worker = asyncio.create_task(run_forever(sessions, take_turn=turn, poll_s=POLL_SECONDS))
        try:
            await asyncio.to_thread(fast_ran.wait, BARRIER_TIMEOUT_SECONDS)
        finally:
            worker.cancel()

    asyncio.run(run_until_fast_chat_ran())

    assert fast_ran.is_set()


def test_a_failed_statement_under_the_lock_still_releases_it_before_the_connection_is_pooled(
    make_chat: MakeChat,
    pooled_sessions: sessionmaker[Session],
    sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pooled engine, because a connection returned to the pool still holding a session-level
    lock is the failure: a `NullPool` connection is closed, and the server drops its locks."""
    make_chat(turn_due_at=NOON)

    def abort_the_lock_transaction(connection: object, *args: object, **kwargs: object) -> None:
        assert isinstance(connection, Connection | Session)
        connection.execute(text("SELECT 1 / 0"))

    # Fault injection: a statement on the lock's connection fails and aborts its transaction.
    monkeypatch.setattr(bot_worker, "_due_marker", abort_the_lock_transaction)

    with pytest.raises(DBAPIError):
        run_due_turns(pooled_sessions, now=NOON, take_turn=RecordingTurn())

    assert _held_bot_turn_locks(sessions) == 0


# --- helpers -----------------------------------------------------------------------------------


def test_a_poll_runs_at_most_its_limit_oldest_first_and_leaves_the_rest_due(
    sessions: sessionmaker[Session], make_chat: MakeChat, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(bot_worker, "MAX_DUE_PER_POLL", 2)
    # Long before any other test's chat, so these are the oldest due.
    long_ago = datetime.datetime(2000, 1, 3, 12, 0, tzinfo=datetime.UTC)
    oldest, middle, newest = (make_chat(turn_due_at=long_ago + n * SECOND) for n in range(3))
    turn = RecordingTurn()

    run_due_turns(sessions, now=long_ago + 3 * SECOND, take_turn=turn)

    assert sorted(turn.calls) == sorted([oldest, middle])
    assert _marker(sessions, newest) == long_ago + 2 * SECOND


def test_a_chat_held_for_a_number_change_is_skipped_and_stays_due(
    sessions: sessionmaker[Session], make_chat: MakeChat
) -> None:
    chat = make_chat(turn_due_at=NOON)
    turn = RecordingTurn()

    with sessions() as holder:
        bot_worker.hold_turns(holder, conversation_ids=[chat])
        run_due_turns(sessions, now=NOON, take_turn=turn)
        assert turn.calls.count(chat) == 0
        assert _marker(sessions, chat) == NOON
        holder.commit()

    run_due_turns(sessions, now=NOON, take_turn=turn)
    assert turn.calls.count(chat) == 1


def test_the_lifespan_starts_the_bot_worker_and_cancels_it_on_exit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi.testclient import TestClient

    from app import main

    started = threading.Event()
    cancelled = threading.Event()
    given: list[object] = []

    async def fake_run_forever(
        session_factory: Callable[[], Session], *, take_turn: Callable[..., object]
    ) -> None:
        given.append(take_turn)
        started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(main, "run_bot_turns_forever", fake_run_forever)

    with TestClient(main.create_app()):
        assert started.wait(5) is True
        assert cancelled.is_set() is False

    assert cancelled.is_set() is True
    assert callable(given[0])


def test_the_lifespan_warms_the_model_up_once_without_waiting_for_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from fastapi.testclient import TestClient

    from app import main
    from app.services import bot_agent

    release = threading.Event()
    warm_ups: list[object] = []

    def stuck_warm_up(deps: object) -> None:
        warm_ups.append(deps)
        release.wait(10)

    async def idle_worker(
        session_factory: Callable[[], Session], *, take_turn: Callable[..., object]
    ) -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(bot_agent, "warm_up", stuck_warm_up)
    monkeypatch.setattr(main, "run_bot_turns_forever", idle_worker)

    try:
        with TestClient(main.create_app()) as client:
            assert client.get("/health").status_code == 200
            assert len(warm_ups) == 1
    finally:
        release.set()


@pytest.fixture
def sessions(_test_engine: Engine) -> Generator[sessionmaker[Session], None, None]:
    """Sessions on their own engine, one real connection each, committing for real."""
    engine = create_engine(_test_engine.url, poolclass=NullPool)
    try:
        yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    finally:
        engine.dispose()


@pytest.fixture
def make_chat(sessions: sessionmaker[Session]) -> Generator[MakeChat, None, None]:
    made: list[uuid.UUID] = []

    def make(**fields: object) -> uuid.UUID:
        with sessions() as db:
            conversation = Conversation(
                phone_number=f"+1555{uuid.uuid4().int % 10**7:07d}", **fields
            )
            db.add(conversation)
            db.commit()
            made.append(conversation.id)

        return conversation.id

    yield make

    with sessions() as db:
        db.execute(delete(Conversation).where(Conversation.id.in_(made)))
        db.commit()


@pytest.fixture
def admin_id(sessions: sessionmaker[Session]) -> Generator[uuid.UUID, None, None]:
    """A committed admin to hold takeovers; requested before `make_chat`, so
    it outlives the chats that reference it."""
    with sessions() as db:
        admin = User(
            email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
            name="Test Admin",
            hashed_password=hash_password("correct horse battery staple"),
            role=UserRole.ADMIN,
            is_archived=False,
        )
        db.add(admin)
        db.commit()

    yield admin.id

    with sessions() as db:
        db.execute(delete(User).where(User.id == admin.id))
        db.commit()


@pytest.fixture
def pooled_sessions(_test_engine: Engine) -> Generator[sessionmaker[Session], None, None]:
    engine = create_engine(_test_engine.url)
    try:
        yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    finally:
        engine.dispose()


def _held_bot_turn_locks(sessions: sessionmaker[Session]) -> int:
    with sessions() as db:
        return db.execute(
            text(
                "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND classid = :namespace"
            ),
            {"namespace": BOT_TURN_LOCK_NAMESPACE},
        ).scalar_one()


def _marker(sessions: sessionmaker[Session], chat: uuid.UUID) -> datetime.datetime | None:
    with sessions() as db:
        return db.get_one(Conversation, chat).turn_due_at


def _move_marker(
    sessions: sessionmaker[Session], chat: uuid.UUID, *, to: datetime.datetime
) -> None:
    with sessions() as db:
        db.execute(update(Conversation).where(Conversation.id == chat).values(turn_due_at=to))
        db.commit()
