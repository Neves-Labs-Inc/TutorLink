"""A number change racing a bot turn: an Intake that finishes at the Guardian's new number, and
a turn still running on a thread the change merges.

The inbound turn from M holds the thread at M for the whole turn and, as Intake ends, inserts a
Guardian at M. The PATCH moving the Guardian to M locks the thread at M before it writes M into
`guardians`, so it waits for the turn: the Intake wins the number and the PATCH answers 409.
Were the PATCH to write the Guardian first and then wait on the thread, the turn's insert would
wait on the PATCH and PostgreSQL would abort one of them as a deadlock, a 500.

Two real connections are needed, so everything here is committed for real: the test creates its
own rows and deletes them whatever happens. The PATCH runs through the route on another thread
with sessions of its own; the inbound turn is played on this thread as the two statements that
matter, the thread lock and the Guardian insert.
"""

import datetime
import random
import threading
import time
import uuid
from collections.abc import Generator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.main import app
from app.models.bot_flow_state import BotFlowState
from app.models.conversation import Conversation
from app.models.enums import MessageAuthor, MessageStatus, SystemMessageKind, UserRole
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User
from app.security import create_access_token
from app.services import conversation_service, message_service
from app.services.bot_worker import run_due_turns

# Long enough that a PATCH which did not wait on the thread at M would have written M by then.
PATCH_SETTLE_SECONDS = 1.0
AREA_CODES = ("202", "212", "312", "415", "617")
SUBSCRIBER_NUMBERS = 10_000


@dataclass(frozen=True)
class Committed:
    staff: User
    guardian_id: uuid.UUID
    old_number: str
    new_number: str
    new_thread_id: uuid.UUID


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


def _fresh_number(session: Session) -> str:
    taken = set(session.scalars(select(Guardian.phone_number)).all()) | set(
        session.scalars(select(Conversation.phone_number)).all()
    )
    number = None
    while number is None or number in taken:
        number = f"+1{random.choice(AREA_CODES)}555{random.randrange(SUBSCRIBER_NUMBERS):04d}"

    return number


@pytest.fixture
def committed(committed_sessions: sessionmaker[Session]) -> Generator[Committed, None, None]:
    """A Guardian with a thread at N, and an unlinked thread at M where Intake is under way."""
    with committed_sessions() as session:
        old_number = _fresh_number(session)
        new_number = _fresh_number(session)
        while new_number == old_number:
            new_number = _fresh_number(session)
        staff = User(
            email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
            name="Test Staff",
            hashed_password="not-a-hash",
            role=UserRole.ADMIN,
        )
        guardian = Guardian(name="Race", phone_number=old_number)
        session.add_all([staff, guardian])
        session.flush()
        old_thread = Conversation(phone_number=old_number, guardian_id=guardian.id)
        new_thread = Conversation(phone_number=new_number)
        session.add_all([old_thread, new_thread])
        session.commit()
        thread_ids = [old_thread.id, new_thread.id]
        numbers = [old_number, new_number]

    try:
        yield Committed(
            staff=staff,
            guardian_id=guardian.id,
            old_number=old_number,
            new_number=new_number,
            new_thread_id=new_thread.id,
        )
    finally:
        with committed_sessions() as session:
            session.execute(delete(Message).where(Message.conversation_id.in_(thread_ids)))
            session.execute(delete(Conversation).where(Conversation.id.in_(thread_ids)))
            session.execute(delete(BotFlowState).where(BotFlowState.phone_number.in_(numbers)))
            session.execute(delete(Guardian).where(Guardian.phone_number.in_(numbers)))
            session.execute(delete(User).where(User.id == staff.id))
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


def test_a_number_change_racing_an_intake_at_the_new_number_loses_to_it_without_a_deadlock(
    committed_sessions: sessionmaker[Session],
    committed: Committed,
    committed_api: TestClient,
) -> None:
    token = create_access_token(
        user_id=committed.staff.id, role=committed.staff.role, tutor_id=None
    )
    outcome: dict[str, object] = {}

    def patch() -> None:
        try:
            response = committed_api.patch(
                f"/api/clients/{committed.guardian_id}",
                json={"phone_number": committed.new_number},
                headers={"Authorization": f"Bearer {token}"},
            )
            outcome["result"] = response.status_code
        except Exception as exc:  # noqa: BLE001 - a deadlock surfaces here; asserted below
            outcome["result"] = repr(exc)

    with committed_sessions() as turn:
        # The inbound turn from M holds its thread for the whole turn.
        turn.execute(
            select(Conversation).where(Conversation.id == committed.new_thread_id).with_for_update()
        ).one()
        patching = threading.Thread(target=patch)
        patching.start()
        patching.join(PATCH_SETTLE_SECONDS)

        # Intake ends by creating its Guardian at M, which the waiting PATCH has not written.
        turn.add(Guardian(name="Intake", phone_number=committed.new_number))
        turn.commit()

    patching.join()
    assert outcome["result"] == 409
    with committed_sessions() as session:
        guardian = session.get_one(Guardian, committed.guardian_id)
        assert guardian.phone_number == committed.old_number


def test_a_number_change_merging_a_thread_waits_for_the_bot_turn_running_there(
    committed_sessions: sessionmaker[Session],
    committed: Committed,
    committed_api: TestClient,
) -> None:
    """A turn holds the thread's row lock only at its start and end, so mid-turn the merge
    would otherwise delete the thread at M under a message the turn is about to commit there,
    and fail. It waits for the turn instead, and the turn's message moves with the rest."""
    token = create_access_token(
        user_id=committed.staff.id, role=committed.staff.role, tutor_id=None
    )
    due_at = datetime.datetime.now(tz=datetime.UTC)
    with committed_sessions() as session:
        session.execute(
            update(Conversation)
            .where(Conversation.id == committed.new_thread_id)
            .values(turn_due_at=due_at)
        )
        session.commit()
    turn_running = threading.Event()
    release_turn = threading.Event()
    outcome: dict[str, object] = {}

    def turn(db: Session, conversation_id: uuid.UUID) -> None:
        if conversation_id != committed.new_thread_id:
            return
        # A handoff note recorded mid-turn: inserted, not committed, no row lock on the thread.
        db.add(
            Message(
                conversation_id=conversation_id,
                author_kind=MessageAuthor.SYSTEM,
                system_kind=SystemMessageKind.HANDOFF_NOTE,
                body=TURN_NOTE,
                status=MessageStatus.SENT,
                created_at=datetime.datetime.now(tz=datetime.UTC),
            )
        )
        db.flush()
        turn_running.set()
        release_turn.wait(TURN_HOLD_SECONDS)
        db.commit()

    def patch() -> None:
        response = committed_api.patch(
            f"/api/clients/{committed.guardian_id}",
            json={"phone_number": committed.new_number},
            headers={"Authorization": f"Bearer {token}"},
        )
        outcome["result"] = response.status_code

    worker = threading.Thread(
        target=lambda: run_due_turns(committed_sessions, now=due_at, take_turn=turn)
    )
    worker.start()
    assert turn_running.wait(TURN_HOLD_SECONDS)
    patching = threading.Thread(target=patch)
    patching.start()
    patching.join(PATCH_SETTLE_SECONDS)
    is_waiting = patching.is_alive()
    release_turn.set()
    worker.join()
    patching.join()

    assert is_waiting is True
    assert outcome["result"] == 200
    with committed_sessions() as session:
        thread = session.scalars(
            select(Conversation).where(Conversation.phone_number == committed.new_number)
        ).one()
        bodies = session.scalars(select(Message.body).where(Message.conversation_id == thread.id))
        assert thread.guardian_id == committed.guardian_id
        assert TURN_NOTE in list(bodies)
        assert session.get(Conversation, committed.new_thread_id) is None


def test_a_message_arriving_while_the_number_change_waits_is_still_answered_after_the_merge(
    committed_sessions: sessionmaker[Session],
    committed: Committed,
    committed_api: TestClient,
) -> None:
    """The change waits for the turn at M; a new message at M stamps M's turn meanwhile. The
    merge deletes M's row, so the turn has to move to the Guardian's thread."""
    token = create_access_token(
        user_id=committed.staff.id, role=committed.staff.role, tutor_id=None
    )
    due_at = datetime.datetime.now(tz=datetime.UTC)
    with committed_sessions() as session:
        session.execute(
            update(Conversation)
            .where(Conversation.id == committed.new_thread_id)
            .values(turn_due_at=due_at)
        )
        session.commit()
    turn_running = threading.Event()
    release_turn = threading.Event()
    statuses: list[int] = []

    def turn(db: Session, conversation_id: uuid.UUID) -> None:
        if conversation_id == committed.new_thread_id:
            turn_running.set()
            release_turn.wait(TURN_HOLD_SECONDS)

    def patch() -> None:
        response = committed_api.patch(
            f"/api/clients/{committed.guardian_id}",
            json={"phone_number": committed.new_number},
            headers={"Authorization": f"Bearer {token}"},
        )
        statuses.append(response.status_code)

    worker = threading.Thread(
        target=lambda: run_due_turns(committed_sessions, now=due_at, take_turn=turn)
    )
    worker.start()
    assert turn_running.wait(TURN_HOLD_SECONDS)
    patching = threading.Thread(target=patch)
    patching.start()
    patching.join(PATCH_SETTLE_SECONDS)
    # What the webhook does for a message at M, on its own connection, while the PATCH waits.
    with committed_sessions() as session:
        thread = conversation_service.resolve_or_create(session, phone_number=committed.new_number)
        message_service.record_inbound(
            session,
            conversation=thread,
            body="Are you there?",
            twilio_sid=f"SMin{uuid.uuid4().hex}",
        )
        stamped = due_at + datetime.timedelta(seconds=4)
        conversation_service.mark_turn_due(session, conversation=thread, at=stamped)
        session.commit()
    release_turn.set()
    worker.join()
    patching.join()

    assert statuses == [200]
    with committed_sessions() as session:
        merged = session.scalars(
            select(Conversation).where(Conversation.phone_number == committed.new_number)
        ).one()
        assert merged.guardian_id == committed.guardian_id
        assert merged.turn_due_at == stamped


def test_staff_creating_a_guardian_that_deadlocks_with_an_intake_turn_gets_a_409_not_a_500(
    committed_sessions: sessionmaker[Session],
    committed: Committed,
    committed_api: TestClient,
) -> None:
    """The turn at M has inserted its Guardian and then waits for the chat's row at its end
    lock; the POST holds that row and waits on the turn's Guardian. PostgreSQL aborts the POST
    (the first to wait); its one retry then waits for the turn and finds the number taken."""
    token = create_access_token(
        user_id=committed.staff.id, role=committed.staff.role, tutor_id=None
    )
    statuses: list[int] = []

    def post() -> None:
        response = committed_api.post(
            "/api/clients",
            json={"name": "Staff Entry", "phone_number": committed.new_number},
            headers={"Authorization": f"Bearer {token}"},
        )
        statuses.append(response.status_code)

    with committed_sessions() as turn:
        turn.add(Guardian(name="Intake", phone_number=committed.new_number))
        turn.flush()
        posting = threading.Thread(target=post)
        posting.start()
        _wait_until_a_guardian_insert_waits(committed_sessions)
        # The turn's end lock, now waiting on the POST: the deadlock.
        conversation_service.lock(turn, conversation_id=committed.new_thread_id)
        turn.commit()
    posting.join()

    assert statuses == [409]
    with committed_sessions() as session:
        names = session.scalars(
            select(Guardian.name).where(Guardian.phone_number == committed.new_number)
        ).all()
        assert names == ["Intake"]


def _wait_until_a_guardian_insert_waits(sessions: sessionmaker[Session]) -> None:
    """Until another connection's insert into `guardians` is waiting on a lock."""
    deadline = time.monotonic() + TURN_HOLD_SECONDS
    is_waiting = False
    while not is_waiting and time.monotonic() < deadline:
        with sessions() as session:
            is_waiting = bool(
                session.scalar(
                    text(
                        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
                        " AND wait_event_type = 'Lock' AND query ILIKE 'INSERT INTO guardians%'"
                    )
                )
            )
        time.sleep(POLL_SECONDS)
    assert is_waiting


TURN_NOTE = "Asked the office about a refund."
POLL_SECONDS = 0.05
# How long the fake turn holds its lock at most; the test releases it well before.
TURN_HOLD_SECONDS = 10.0
