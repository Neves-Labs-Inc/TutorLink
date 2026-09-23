"""`retention_service.purge_expired_messages` against real timestamps, and the
`purge-messages` CLI command end to end.

Every case inserts a message with an explicit `created_at` rather than waiting on wall-clock
time, so "old" and "recent" are unambiguous regardless of how long the suite takes to reach
this file.
"""

import datetime
import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

import app.cli as cli_module
from app.cli import _run_purge_messages
from app.models.conversation import Conversation
from app.models.enums import MessageAuthor, MessageStatus
from app.models.message import Message
from app.models.system_setting import SystemSetting
from app.services.retention_service import CHAT_RETENTION_DAYS_SETTING, purge_expired_messages

NOW = datetime.datetime(2026, 9, 22, 12, 0, tzinfo=datetime.UTC)
OLD = NOW - datetime.timedelta(days=400)
RECENT = NOW - datetime.timedelta(days=10)


def test_messages_older_than_retention_are_deleted_and_recent_ones_survive(db: Session) -> None:
    conversation = _make_conversation(db)
    _add_message(db, conversation.id, created_at=OLD)
    recent_message = _add_message(db, conversation.id, created_at=RECENT)

    result = purge_expired_messages(db)

    assert result.ran is True
    assert result.messages_deleted == 1
    remaining = db.scalars(
        select(Message.id).where(Message.conversation_id == conversation.id)
    ).all()
    assert remaining == [recent_message.id]


def test_a_conversation_emptied_by_the_purge_is_deleted(db: Session) -> None:
    conversation = _make_conversation(db)
    _add_message(db, conversation.id, created_at=OLD)

    result = purge_expired_messages(db)

    assert result.conversations_deleted == 1
    assert db.get(Conversation, conversation.id) is None


def test_a_conversation_with_a_surviving_message_is_not_deleted(db: Session) -> None:
    conversation = _make_conversation(db)
    _add_message(db, conversation.id, created_at=OLD)
    _add_message(db, conversation.id, created_at=RECENT)

    result = purge_expired_messages(db)

    assert result.conversations_deleted == 0
    assert db.get(Conversation, conversation.id) is not None


def test_retention_of_zero_deletes_nothing_and_reports_that_it_did_not_run(db: Session) -> None:
    _set_retention_days(db, 0)
    conversation = _make_conversation(db)
    _add_message(db, conversation.id, created_at=OLD)

    result = purge_expired_messages(db)

    assert result.ran is False
    assert result.messages_deleted == 0
    assert result.conversations_deleted == 0
    assert db.get(Conversation, conversation.id) is not None


def test_purge_messages_command_runs_end_to_end(db: Session, capsys, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)
    conversation = _make_conversation(db)
    _add_message(db, conversation.id, created_at=OLD)

    exit_code = _run_purge_messages()

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "purged 1 message(s) and 1 conversation(s)" in captured.out
    assert db.get(Conversation, conversation.id) is None


def _make_conversation(db: Session) -> Conversation:
    conversation = Conversation(phone_number=_phone_number())
    db.add(conversation)
    db.flush()

    return conversation


def _add_message(
    db: Session, conversation_id: uuid.UUID, *, created_at: datetime.datetime
) -> Message:
    message = Message(
        conversation_id=conversation_id,
        author_kind=MessageAuthor.CLIENT,
        body="Hello",
        status=MessageStatus.RECEIVED,
        created_at=created_at,
    )
    db.add(message)
    db.execute(
        update(Conversation)
        .where(Conversation.id == conversation_id)
        .values(last_message_at=created_at)
    )
    db.flush()

    return message


def _set_retention_days(db: Session, days: int) -> None:
    db.execute(
        update(SystemSetting)
        .where(SystemSetting.key == CHAT_RETENTION_DAYS_SETTING)
        .values(value=str(days))
    )
    db.flush()


def _phone_number() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"
