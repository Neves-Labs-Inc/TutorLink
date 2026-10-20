"""`take_turn` against other connections: the webhook and Takeover mid-turn, and the yes race.

These run on committed data, each session on its own connection, because only separate
connections can contend for the conversation row's lock. Rows are deleted afterwards.
"""

import contextlib
import threading
import time
import uuid
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from sqlalchemy import delete, exists, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, FlagReason, MessageAuthor, UserRole
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User
from app.services import (
    bot_messages,
    bot_tools_profile,
    bot_worker,
    client_service,
    conversation_service,
    message_service,
)
from app.services.bot_tool_contract import ToolContext, ToolResult, ToolSpec
from app.services.bot_turn import TurnDeps, TurnOutcome, take_turn
from tests.fake_twilio import FakeTwilio
from tests.test_bot_turn import SYSTEM_PROMPT, FakeModel, Step, build_context, call, reply, tool

# Long enough for an unblocked write on a loaded test database, short enough to fail fast.
UNBLOCKED_WITHIN_SECONDS = 10.0
SAVED_NAME = "Maria Concurrent"


@dataclass
class Chat:
    sessions: sessionmaker[Session]
    conversation_id: uuid.UUID
    phone_number: str
    staff_id: uuid.UUID

    def guardian_says(self, body: str) -> Message:
        """What the webhook does for an inbound message, on its own connection."""
        with self.sessions() as session:
            conversation = conversation_service.resolve_or_create(
                session, phone_number=self.phone_number
            )
            message = message_service.record_inbound(
                session,
                conversation=conversation,
                body=body,
                twilio_sid=f"SMcc{uuid.uuid4().hex}",
            )
            session.commit()
        assert message is not None
        return message

    def run(self, script: list[Step | Exception], tools: tuple[ToolSpec, ...]) -> TurnOutcome:
        deps = TurnDeps(
            model=FakeModel(script=list(script)),
            tools=tools,
            system_prompt=lambda: SYSTEM_PROMPT,
            build_context=build_context,
            sleep=lambda seconds: None,
        )
        with self.sessions() as session:
            return take_turn(session, conversation_id=self.conversation_id, deps=deps)

    def conversation(self) -> Conversation:
        with self.sessions() as session:
            return session.get_one(Conversation, self.conversation_id)

    def bot_lines(self) -> list[Message]:
        with self.sessions() as session:
            return list(
                session.scalars(
                    select(Message)
                    .where(
                        Message.conversation_id == self.conversation_id,
                        Message.author_kind == MessageAuthor.BOT,
                    )
                    .order_by(Message.created_at)
                )
            )


@pytest.fixture
def chat(_test_engine: Engine) -> Generator[Chat, None, None]:
    yield from _chat_at(_test_engine, phone_number=f"+1555{uuid.uuid4().int % 10**7:07d}")


@pytest.fixture
def intake_chat(_test_engine: Engine) -> Generator[Chat, None, None]:
    """A chat at a number libphonenumber accepts, so the real `create_guardian` can save."""
    suffix = uuid.uuid4().int
    yield from _chat_at(
        _test_engine, phone_number=f"+1202{200 + suffix % 800}{suffix // 1000 % 10000:04d}"
    )


def _chat_at(engine: Engine, *, phone_number: str) -> Generator[Chat, None, None]:
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with sessions() as session:
        staff = User(
            email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
            name="Laura",
            hashed_password="not-a-hash",
            role=UserRole.ADMIN,
        )
        conversation = Conversation(phone_number=phone_number)
        session.add_all([staff, conversation])
        session.commit()
        ids = (conversation.id, staff.id)

    try:
        yield Chat(sessions, conversation_id=ids[0], phone_number=phone_number, staff_id=ids[1])
    finally:
        with sessions() as session:
            session.execute(delete(Message).where(Message.conversation_id == ids[0]))
            session.execute(delete(Conversation).where(Conversation.id == ids[0]))
            session.execute(delete(Guardian).where(Guardian.phone_number == phone_number))
            session.execute(delete(User).where(User.id == ids[1]))
            session.commit()


@contextlib.contextmanager
def bot_worker_lock(chat: Chat) -> Iterator[None]:
    """The chat's turn lock, held as the worker holds it around `take_turn`."""
    with bot_worker._chat_lock(chat.sessions, chat.conversation_id) as connection:
        assert connection is not None
        yield


def _in_another_thread(action: Callable[[], object]) -> bool:
    """Run `action` on its own thread; whether it finished without waiting on the turn."""
    worker = threading.Thread(target=action, daemon=True)
    worker.start()
    worker.join(UNBLOCKED_WITHIN_SECONDS)
    # Not joined again: a write still waiting on the turn would wait forever on this join.
    return not worker.is_alive()


def _propose(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
    ctx.conversation.proposal_actions = [{"kind": "book"}]
    ctx.conversation.proposed_at = ctx.now
    ctx.db.flush()
    return ToolResult(status="ok", content={"summary": "Sam, Tuesday 4 PM"}, progress=True)


def _commit(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
    """Ticket 08's rule: the yes is a Guardian message newer than `proposed_at`."""
    proposed_at = ctx.conversation.proposed_at
    is_yes = proposed_at is not None and ctx.db.scalar(
        select(
            exists().where(
                Message.conversation_id == ctx.conversation.id,
                Message.author_kind == MessageAuthor.CLIENT,
                Message.created_at > proposed_at,
            )
        )
    )
    if not is_yes:
        return ToolResult(status="refused", content={"reason": "no yes"})

    ctx.conversation.proposal_actions = None
    ctx.conversation.proposed_at = None
    ctx.db.flush()
    return ToolResult(status="ok", content={"committed": True}, progress=True)


def _save_guardian(ctx: ToolContext) -> None:
    ctx.db.add(Guardian(name=SAVED_NAME, phone_number=ctx.conversation.phone_number))
    ctx.db.flush()


def test_a_webhook_message_mid_turn_does_not_wait_on_the_turn(
    chat: Chat, fake_twilio: FakeTwilio
) -> None:
    chat.guardian_says("I'm Maria")
    unblocked: list[bool] = []

    def save_then_guardian_writes(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        _save_guardian(ctx)
        # A staff-only line the turn records mid-turn, as a handoff does.
        message_service.record_handoff_note(ctx.db, conversation=ctx.conversation, body="note")
        unblocked.append(_in_another_thread(lambda: chat.guardian_says("also, hi")))
        return ToolResult(status="ok", content={"saved": True}, progress=True)

    outcome = chat.run(
        [call(("create_guardian", {})), reply("Thanks, Maria.")],
        (tool("create_guardian", save_then_guardian_writes),),
    )

    assert unblocked == [True]
    assert outcome.kind == "replied"
    assert [sent.body for sent in fake_twilio.sent] == ["Thanks, Maria."]


def test_a_takeover_mid_turn_does_not_wait_and_drops_the_reply_but_keeps_the_saves(
    chat: Chat, fake_twilio: FakeTwilio
) -> None:
    chat.guardian_says("I'm Maria")
    unblocked: list[bool] = []

    def take_over() -> None:
        with chat.sessions() as session:
            conversation_service.claim(
                session, conversation_id=chat.conversation_id, user_id=chat.staff_id
            )
            session.commit()

    def save_then_office_takes_over(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        _save_guardian(ctx)
        unblocked.append(_in_another_thread(take_over))
        return ToolResult(status="ok", content={"saved": True}, progress=True)

    outcome = chat.run(
        [call(("create_guardian", {})), reply("Thanks, Maria.")],
        (tool("create_guardian", save_then_office_takes_over),),
    )

    assert unblocked == [True]
    assert outcome == TurnOutcome(kind="skipped_takeover", sent_message_ids=())
    assert chat.bot_lines() == []
    assert fake_twilio.sent == []
    assert chat.conversation().status is ConversationStatus.HUMAN
    with chat.sessions() as session:
        assert session.scalar(select(Guardian.name).where(Guardian.name == SAVED_NAME))


def test_a_guardian_message_sent_during_the_propose_turn_never_commits_the_proposal(
    chat: Chat, fake_twilio: FakeTwilio
) -> None:
    chat.guardian_says("Can Sam do Tuesday at 4?")

    def propose_while_guardian_writes(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        result = _propose(ctx, tool_input)
        assert _in_another_thread(lambda: chat.guardian_says("ok"))
        return result

    tools = (tool("propose", propose_while_guardian_writes), tool("commit_proposal", _commit))
    chat.run([call(("propose", {})), reply("Should I book it?")], tools)

    # The next turn runs on the mid-turn "ok": it was written before the offer was seen.
    refused = chat.run([call(("commit_proposal", {})), reply("Should I book it?")], tools)

    assert refused.kind == "replied"
    assert chat.conversation().proposal_actions == [{"kind": "book"}]

    chat.guardian_says("yes")
    chat.run([call(("commit_proposal", {})), reply("Done.")], tools)

    assert chat.conversation().proposal_actions is None


def test_a_guardian_message_sent_while_the_offer_is_being_sent_is_not_the_yes(
    chat: Chat, fake_twilio: FakeTwilio
) -> None:
    chat.guardian_says("Can Sam do Tuesday at 4?")
    written: list[Message] = []
    fake_twilio.during_next_send(lambda sid: written.append(chat.guardian_says("ok")))

    chat.run([call(("propose", {})), reply("Should I book it?")], (tool("propose", _propose),))

    proposed_at = chat.conversation().proposed_at
    assert proposed_at is not None
    assert written[0].created_at < proposed_at


def test_a_database_error_at_the_end_lock_is_an_outage(chat: Chat, fake_twilio: FakeTwilio) -> None:
    """A number change racing the turn can deadlock it, or hold the row past a lock timeout,
    where the turn records its reply. That is an outage like any other: the saves roll back,
    the chat is flagged "Bot got stuck" and the Guardian gets the apology."""
    chat.guardian_says("I'm Maria")
    holder_has_lock = threading.Event()

    def hold_the_row() -> None:
        with chat.sessions() as session:
            conversation_service.lock(session, conversation_id=chat.conversation_id)
            holder_has_lock.set()
            time.sleep(ROW_HOLD_SECONDS)
            session.commit()

    def save_while_another_writer_holds_the_row(
        ctx: ToolContext, tool_input: dict[str, Any]
    ) -> ToolResult:
        _save_guardian(ctx)
        # Only this turn's transaction gives up quickly; the outage's fresh one waits.
        ctx.db.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT_MS}ms'"))
        threading.Thread(target=hold_the_row, daemon=True).start()
        assert holder_has_lock.wait(UNBLOCKED_WITHIN_SECONDS)
        return ToolResult(status="ok", content={"saved": True}, progress=True)

    outcome = chat.run(
        [call(("create_guardian", {})), reply("Thanks, Maria.")],
        (tool("create_guardian", save_while_another_writer_holds_the_row),),
    )

    assert outcome.kind == "outage"
    assert chat.conversation().flag_reason is FlagReason.STUCK
    assert [sent.body for sent in fake_twilio.sent] == [bot_messages.render("OUTAGE_APOLOGY", "en")]
    with chat.sessions() as session:
        assert session.scalar(select(Guardian.name).where(Guardian.name == SAVED_NAME)) is None


LOCK_TIMEOUT_MS = 200
ROW_HOLD_SECONDS = 1.0


@pytest.mark.parametrize("other_write", ["webhook", "takeover"])
def test_an_intake_turn_that_creates_the_guardian_does_not_hold_the_chat(
    intake_chat: Chat, fake_twilio: FakeTwilio, other_write: str
) -> None:
    """The real `create_guardian`: Intake used to lock the chat's row for the rest of the turn
    (through `client_service.create_client`), so the webhook and Takeover waited on it."""
    chat = intake_chat
    chat.guardian_says("I'm Maria")
    unblocked: list[bool] = []
    create_guardian = next(s for s in bot_tools_profile.TOOLS if s.name == "create_guardian")

    def take_over() -> None:
        with chat.sessions() as session:
            conversation_service.claim(
                session, conversation_id=chat.conversation_id, user_id=chat.staff_id
            )
            session.commit()

    def create_then_other_writes(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        result = create_guardian.run(ctx, tool_input)
        write = (lambda: chat.guardian_says("also, hi")) if other_write == "webhook" else take_over
        unblocked.append(_in_another_thread(write))
        return result

    chat.run(
        [call(("create_guardian", {"name": SAVED_NAME})), reply("Thanks, Maria.")],
        (tool("create_guardian", create_then_other_writes),),
    )

    assert unblocked == [True]
    with chat.sessions() as session:
        guardian_id = session.scalar(select(Guardian.id).where(Guardian.name == SAVED_NAME))
        assert guardian_id is not None
        assert session.get_one(Conversation, chat.conversation_id).guardian_id == guardian_id


def test_a_staff_create_at_the_number_waits_for_the_intake_turn_and_is_the_409(
    intake_chat: Chat, fake_twilio: FakeTwilio
) -> None:
    """No deadlock: the Staff write holds the turn off the chat (`hold_turns`) rather than
    holding the row while it waits on the turn's new Guardian, so Intake wins the number."""
    chat = intake_chat
    chat.guardian_says("I'm Maria")
    create_guardian = next(s for s in bot_tools_profile.TOOLS if s.name == "create_guardian")
    staff_outcome: list[str] = []
    started = threading.Event()

    def staff_creates() -> None:
        with chat.sessions() as session:
            started.set()
            try:
                client_service.create_client(
                    session, name="Staff Maria", phone_number=chat.phone_number, home=None
                )
                session.commit()
                staff_outcome.append("created")
            except client_service.PhoneNumberTaken:
                staff_outcome.append("409")

    worker = threading.Thread(target=staff_creates, daemon=True)

    def create_then_staff_starts(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        result = create_guardian.run(ctx, tool_input)
        worker.start()
        started.wait(UNBLOCKED_WITHIN_SECONDS)
        # Give the Staff write time to reach its wait on the turn.
        time.sleep(0.5)
        return result

    with bot_worker_lock(chat):
        outcome = chat.run(
            [call(("create_guardian", {"name": SAVED_NAME})), reply("Thanks, Maria.")],
            (tool("create_guardian", create_then_staff_starts),),
        )
    worker.join(UNBLOCKED_WITHIN_SECONDS)

    assert outcome.kind == "replied"
    assert staff_outcome == ["409"]
