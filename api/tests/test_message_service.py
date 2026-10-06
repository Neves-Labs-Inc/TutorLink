"""The message rows: recording the three kinds, the delivery callback, and the thread read.

Run against a live PostgreSQL through the `db` fixture, because the property the webhook leans
on hardest is the database's: `UNIQUE (messages.twilio_sid)` is the idempotency check itself
(`api-design.md:480-486`), so a retry has to be refused by the index rather than by a Python
branch that two concurrent retries would both pass.

Two things here are written to fail loudly rather than vacuously:

- **The duplicate path.** `record_inbound` has no pre-read to stub — the contract refuses one —
  so the second call really does reach the constraint. Dropping the unique index makes
  `test_a_redelivered_message_is_recorded_once` find two rows.
- **`total` under `before`.** A windowed count and a whole-conversation count agree whenever
  the window happens to be the whole thread, so every `before` test below pages a thread longer
  than its page and asserts the two numbers differ.

Timestamps that an assertion depends on are written explicitly; the service's own clock is
asserted on only for ordering, which is what it exists to make deterministic.
"""

import datetime
import pathlib
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import MessageAuthor, MessageStatus, UserRole
from app.models.message import Message
from app.models.user import User
from app.security import hash_password
from app.services import message_service
from app.services.conversation_service import ConversationNotFound
from app.services.message_service import (
    advance_status,
    attach_twilio_sid,
    get_thread_message,
    list_thread,
    mark_failed,
    record_admin_message,
    record_bot_reply,
    record_inbound,
)

NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)


def test_an_inbound_message_is_recorded_as_the_client_said_it(db: Session) -> None:
    conversation = _make_conversation(db)
    sid = _twilio_sid()

    message = record_inbound(
        db, conversation=conversation, body="Can we move Tommy?", twilio_sid=sid
    )

    assert message is not None
    assert message.author_kind is MessageAuthor.CLIENT
    assert message.status is MessageStatus.RECEIVED
    assert message.author_user_id is None
    assert message.twilio_sid == sid
    assert message.body == "Can we move Tommy?"


def test_recording_a_message_moves_the_conversations_ordering_key(db: Session) -> None:
    """`last_message_at` is the newest message's `created_at` exactly, which is what lets the
    inbox order and the unread watermark be decided from the conversation row alone."""
    conversation = _make_conversation(db, last_message_at=NOON)

    message = record_inbound(db, conversation=conversation, body="hello", twilio_sid=_twilio_sid())

    assert message is not None
    assert conversation.last_message_at == message.created_at
    assert conversation.last_message_at > NOON


def test_a_redelivered_message_is_recorded_once(db: Session) -> None:
    """Twilio retries a webhook whose delivery it believes failed, and the retry carries the
    same SID. The insert is the check: the second one conflicts and is discarded, and the
    caller learns it from the `None` rather than from an exception — a redelivery is an
    ordinary event on this path, not a failure."""
    conversation = _make_conversation(db)
    sid = _twilio_sid()

    first = record_inbound(db, conversation=conversation, body="hello", twilio_sid=sid)
    duplicate = record_inbound(db, conversation=conversation, body="hello", twilio_sid=sid)

    assert first is not None
    assert duplicate is None
    assert _message_count(db, conversation) == 1


def test_the_session_survives_a_redelivery(db: Session) -> None:
    """The savepoint's whole purpose: an `IntegrityError` that is expected must not leave the
    request's transaction unusable for the work that follows it — and the webhook carries on to
    the bot branch after a duplicate."""
    conversation = _make_conversation(db)
    sid = _twilio_sid()
    record_inbound(db, conversation=conversation, body="hello", twilio_sid=sid)

    record_inbound(db, conversation=conversation, body="hello", twilio_sid=sid)
    reply = record_bot_reply(db, conversation=conversation, body="Hi there")

    assert reply.id is not None
    assert _message_count(db, conversation) == 2


def test_a_duplicate_does_not_move_the_ordering_key(db: Session) -> None:
    conversation = _make_conversation(db, last_message_at=NOON)
    sid = _twilio_sid()
    record_inbound(db, conversation=conversation, body="hello", twilio_sid=sid)
    recorded_at = conversation.last_message_at

    record_inbound(db, conversation=conversation, body="hello", twilio_sid=sid)

    assert conversation.last_message_at == recorded_at


def test_a_bot_reply_is_sent_with_no_sid(db: Session) -> None:
    """**D-P7-2** / amendment **P7-3**: a TwiML reply has no `MessageSid` at the moment it is
    written, so `POST /webhook/whatsapp/status` can never advance it and `queued` would park
    every bot line in the system at pending forever."""
    conversation = _make_conversation(db)

    reply = record_bot_reply(db, conversation=conversation, body="Thursday at 4pm works")

    assert reply.author_kind is MessageAuthor.BOT
    assert reply.status is MessageStatus.SENT
    assert reply.twilio_sid is None
    assert reply.author_user_id is None


def test_two_bot_replies_in_one_thread_do_not_collide(db: Session) -> None:
    """PostgreSQL treats NULLs as distinct under a unique index, which is the only reason a
    second SID-less row is insertable at all."""
    conversation = _make_conversation(db)

    record_bot_reply(db, conversation=conversation, body="first")
    record_bot_reply(db, conversation=conversation, body="second")

    assert _message_count(db, conversation) == 2


def test_an_admin_message_is_queued_for_the_delivery_callback(db: Session) -> None:
    conversation = _make_conversation(db)
    admin = _make_user(db)

    message = record_admin_message(
        db, conversation=conversation, body="On my way", author_user_id=admin.id, twilio_sid=None
    )

    assert message.author_kind is MessageAuthor.ADMIN
    assert message.status is MessageStatus.QUEUED
    assert message.author_user_id == admin.id
    assert message.twilio_sid is None


def test_the_sid_is_attached_after_the_send(db: Session) -> None:
    """The socket records before it sends — a process that died between the two would otherwise
    leave the client holding a message the thread does not show — so the SID arrives second."""
    conversation = _make_conversation(db)
    admin = _make_user(db)
    sid = _twilio_sid()
    message = record_admin_message(
        db, conversation=conversation, body="On my way", author_user_id=admin.id, twilio_sid=None
    )

    attach_twilio_sid(db, message=message, twilio_sid=sid)
    advanced = advance_status(db, twilio_sid=sid, status=MessageStatus.DELIVERED, error_code=None)

    assert advanced is not None
    assert advanced.id == message.id
    assert advanced.status is MessageStatus.DELIVERED


@pytest.mark.parametrize("error_code", [None, "21610"], ids=["no code", "a twilio code"])
def test_a_send_that_never_earned_a_sid_can_still_reach_failed(
    db: Session, error_code: str | None
) -> None:
    """FU-6. `advance_status` is keyed on the SID, and a send Twilio refused outright never gets
    one, so the row it leaves behind is unreachable by every other writer in this module — it
    would sit `queued` forever with the failure recorded nowhere but an ephemeral socket frame
    (`api-design.md:1706`). `mark_failed` is keyed on the row instead, and writes the code it is
    given either way: a refusal that carried none must not inherit one from an earlier attempt.
    """
    conversation = _make_conversation(db)
    admin = _make_user(db)
    message = record_admin_message(
        db, conversation=conversation, body="On my way", author_user_id=admin.id, twilio_sid=None
    )
    message.error_code = "30008"

    failed = mark_failed(db, message=message, error_code=error_code)

    assert failed.status is MessageStatus.FAILED
    assert failed.twilio_sid is None
    assert failed.error_code == error_code


def test_a_failed_delivery_records_twilios_error_code(db: Session) -> None:
    conversation = _make_conversation(db)
    sid = _twilio_sid()
    record_inbound(db, conversation=conversation, body="hello", twilio_sid=sid)

    advanced = advance_status(db, twilio_sid=sid, status=MessageStatus.FAILED, error_code="63016")

    assert advanced is not None
    assert advanced.status is MessageStatus.FAILED
    assert advanced.error_code == "63016"


def test_an_unknown_sid_is_not_an_error(db: Session) -> None:
    """Retention deletes messages on a schedule and Twilio's callbacks are not bounded by it,
    so a status for a purged message is an ordinary event the router answers 204
    (`api-design.md:533-536`) — a 404 would teach Twilio to retry a row that no longer exists."""
    assert (
        advance_status(
            db, twilio_sid=_twilio_sid(), status=MessageStatus.DELIVERED, error_code=None
        )
        is None
    )


def test_the_thread_reads_newest_first(db: Session) -> None:
    """The only list in the API that is, deliberately (`api-design.md:1526-1537`): a thread is
    read from its end, and oldest-first would make page 1 the first twenty messages of a
    year-old conversation."""
    conversation = _make_conversation(db)
    _make_message(db, conversation, body="oldest", at=NOON)
    _make_message(db, conversation, body="middle", at=NOON + _minutes(1))
    _make_message(db, conversation, body="newest", at=NOON + _minutes(2))

    items, total = list_thread(db, conversation_id=conversation.id, before=None, limit=20, offset=0)

    assert [item.message.body for item in items] == ["newest", "middle", "oldest"]
    assert total == 3


def test_messages_written_in_one_transaction_still_order_by_arrival(db: Session) -> None:
    """The webhook records the inbound message and the bot's reply inside one transaction. A
    `now()` default would give both the same `created_at` — transaction start — and the thread
    could then show the reply above or below the message it answers depending on the plan."""
    conversation = _make_conversation(db)
    record_inbound(db, conversation=conversation, body="question", twilio_sid=_twilio_sid())
    record_bot_reply(db, conversation=conversation, body="answer")

    items, _ = list_thread(db, conversation_id=conversation.id, before=None, limit=20, offset=0)

    assert [item.message.body for item in items] == ["answer", "question"]


def test_before_windows_the_page_without_narrowing_the_total(db: Session) -> None:
    """`before` is a paging marker, not a filter (§8). A windowed `total` would make the thread
    header lie about how much history exists."""
    conversation = _make_conversation(db)
    for minute in range(5):
        _make_message(db, conversation, body=f"message {minute}", at=NOON + _minutes(minute))

    items, total = list_thread(
        db, conversation_id=conversation.id, before=NOON + _minutes(2), limit=20, offset=0
    )

    assert [item.message.body for item in items] == ["message 1", "message 0"]
    assert total == 5


def test_the_thread_pages_without_repeating_a_row(db: Session) -> None:
    conversation = _make_conversation(db)
    for minute in range(3):
        _make_message(db, conversation, body=f"message {minute}", at=NOON + _minutes(minute))

    first, total = list_thread(db, conversation_id=conversation.id, before=None, limit=2, offset=0)
    second, _ = list_thread(db, conversation_id=conversation.id, before=None, limit=2, offset=2)

    assert [item.message.body for item in first] == ["message 2", "message 1"]
    assert [item.message.body for item in second] == ["message 0"]
    assert total == 3


def test_only_an_admins_message_carries_an_author(db: Session) -> None:
    """`author` answers "which admin typed this", which is not the same question as the
    conversation's holder: a takeover can change hands while the thread stays open."""
    conversation = _make_conversation(db)
    admin = _make_user(db)
    record_inbound(db, conversation=conversation, body="question", twilio_sid=_twilio_sid())
    record_bot_reply(db, conversation=conversation, body="answer")
    record_admin_message(
        db, conversation=conversation, body="typed", author_user_id=admin.id, twilio_sid=None
    )

    items, _ = list_thread(db, conversation_id=conversation.id, before=None, limit=20, offset=0)
    authors = {item.message.author_kind: item.author for item in items}

    assert authors[MessageAuthor.ADMIN] is not None
    assert authors[MessageAuthor.ADMIN].email == admin.email
    assert authors[MessageAuthor.CLIENT] is None
    assert authors[MessageAuthor.BOT] is None


def test_a_thread_for_an_unknown_conversation_is_not_found(db: Session) -> None:
    """An empty page would be a 200 for a conversation nobody has; the route owes a 404."""
    with pytest.raises(ConversationNotFound):
        list_thread(db, conversation_id=uuid.uuid4(), before=None, limit=20, offset=0)


def test_one_message_reads_back_with_the_admin_who_typed_it(db: Session) -> None:
    """The socket rebuilds `message.created` from this, so it must carry what `list_thread`
    carries for the same row — the author included — or the frame and the refetch disagree."""
    conversation = _make_conversation(db)
    admin = _make_user(db)
    message = record_admin_message(
        db, conversation=conversation, body="typed", author_user_id=admin.id, twilio_sid=None
    )

    found = get_thread_message(db, message_id=message.id)
    items, _ = list_thread(db, conversation_id=conversation.id, before=None, limit=20, offset=0)

    assert found is not None
    assert (found.message.id, found.author) == (message.id, admin)
    assert found == items[0]


def test_a_clients_message_reads_back_with_no_author(db: Session) -> None:
    conversation = _make_conversation(db)
    message = record_inbound(
        db, conversation=conversation, body="question", twilio_sid=_twilio_sid()
    )

    found = get_thread_message(db, message_id=message.id)

    assert found is not None
    assert (found.message.id, found.author) == (message.id, None)


def test_an_unknown_message_reads_back_as_none(db: Session) -> None:
    """A notice can name a row retention deleted after it was sent; that is a value, not a
    `ConversationNotFound`-style error the pump would have to catch."""
    assert get_thread_message(db, message_id=uuid.uuid4()) is None


def test_the_service_owns_no_http_and_no_transaction() -> None:
    """CONSTITUTION §4 and §6, pinned rather than reviewed."""
    source = pathlib.Path(message_service.__file__).read_text()

    assert "from fastapi" not in source
    assert "import fastapi" not in source
    assert "HTTPException" not in source
    assert "db.commit()" not in source


# --- helpers -------------------------------------------------------------------------------


def _minutes(count: int) -> datetime.timedelta:
    return datetime.timedelta(minutes=count)


def _twilio_sid() -> str:
    return f"SM{uuid.uuid4().hex}"


def _make_conversation(db: Session, *, last_message_at: datetime.datetime = NOON) -> Conversation:
    conversation = Conversation(
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}", last_message_at=last_message_at
    )
    db.add(conversation)
    db.flush()
    return conversation


def _make_message(
    db: Session, conversation: Conversation, *, body: str, at: datetime.datetime
) -> Message:
    message = Message(
        conversation_id=conversation.id,
        author_kind=MessageAuthor.CLIENT,
        body=body,
        status=MessageStatus.RECEIVED,
        twilio_sid=_twilio_sid(),
        created_at=at,
    )
    db.add(message)
    db.flush()
    return message


def _make_user(db: Session) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password("message-service-password"),
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()
    return user


def _message_count(db: Session, conversation: Conversation) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conversation.id)
        )
        or 0
    )
