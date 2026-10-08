"""A number change racing an Intake that finishes at the Guardian's new number.

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

import random
import threading
import uuid
from collections.abc import Generator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import get_db
from app.main import app
from app.models.bot_flow_state import BotFlowState
from app.models.conversation import Conversation
from app.models.enums import UserRole
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User
from app.security import create_access_token

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
            display_name="Test Staff",
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
