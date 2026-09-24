"""`retention_service`'s purge and its two reaps against real timestamps, and the
`purge-messages` CLI command end to end through `run_guarded_purge`.

Every case inserts a message with an explicit `created_at`, and every flow state or login
attempt with an explicit `expires_at` or `attempted_at`, rather than waiting on wall-clock time,
so "old" and "recent" are unambiguous regardless of how long the suite takes to reach this file.
The reaps measure against the database's `now()`, which inside the rolled-back `db` fixture is
the start of the test's transaction — minutes, not hours, from the Python clock the rows are
stamped with.

The lock-held CLI case holds the retention lock on a second, independent connection: the `db`
fixture's own connection would simply re-acquire it, since an advisory lock is reentrant for
the session that holds it.
"""

import datetime
import logging
import uuid

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

import app.cli as cli_module
from app.cli import _run_purge_messages
from app.models.bot_flow_state import BotFlowState
from app.models.conversation import Conversation
from app.models.enums import MessageAuthor, MessageStatus
from app.models.login_attempt import LoginAttempt
from app.models.message import Message
from app.models.system_setting import SystemSetting
from app.services.rate_limit_service import (
    EMAIL_WINDOW_SECONDS_SETTING,
    IP_WINDOW_SECONDS_SETTING,
)
from app.services import retention_scheduler
from app.services.retention_scheduler import (
    RETENTION_LOCK_KEY,
    RETENTION_LOCK_NAMESPACE,
    run_guarded_purge,
)
from app.services.retention_service import (
    CHAT_RETENTION_DAYS_SETTING,
    purge_expired_messages,
    reap_expired_flow_states,
    reap_expired_login_attempts,
)

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


def test_an_expired_flow_state_is_reaped_and_a_live_one_is_kept(db: Session) -> None:
    now = datetime.datetime.now(datetime.UTC)
    expired = _add_flow_state(db, expires_at=now - datetime.timedelta(minutes=5))
    live = _add_flow_state(db, expires_at=now + datetime.timedelta(hours=1))

    deleted = reap_expired_flow_states(db)

    assert deleted == 1
    assert db.get(BotFlowState, expired.phone_number) is None
    assert db.get(BotFlowState, live.phone_number) is not None


def test_login_attempts_are_reaped_only_past_the_larger_of_the_two_windows(db: Session) -> None:
    # Thirty minutes is past the 15-minute IP window and inside the one-hour email window, so it
    # is the row that tells "the larger window" apart from "either window".
    _set_int_setting(db, IP_WINDOW_SECONDS_SETTING, 15 * 60)
    _set_int_setting(db, EMAIL_WINDOW_SECONDS_SETTING, 60 * 60)
    now = datetime.datetime.now(datetime.UTC)
    stale = _add_login_attempt(db, attempted_at=now - datetime.timedelta(hours=2))
    inside_larger_window = _add_login_attempt(db, attempted_at=now - datetime.timedelta(minutes=30))
    fresh = _add_login_attempt(db, attempted_at=now - datetime.timedelta(minutes=1))

    deleted = reap_expired_login_attempts(db)

    assert deleted == 1
    assert _login_attempt_ids(db) >= {inside_larger_window, fresh}
    assert stale not in _login_attempt_ids(db)


def test_both_reaps_run_when_chat_retention_is_zero(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    # Expiry is not retention: a client who keeps chat history forever still has dead bot flows
    # and login attempts no window counts, and neither table may grow without bound.
    _set_retention_days(db, 0)
    now = datetime.datetime.now(datetime.UTC)
    flow_state = _add_flow_state(db, expires_at=now - datetime.timedelta(minutes=5))
    attempt_id = _add_login_attempt(db, attempted_at=now - datetime.timedelta(days=2))
    conversation = _make_conversation(db)
    _add_message(db, conversation.id, created_at=OLD)

    with caplog.at_level(logging.INFO, logger=retention_scheduler.__name__):
        run = run_guarded_purge(lambda: db)

    assert [record.getMessage() for record in caplog.records] == [
        "retention purge: ran, chat purge disabled (chat_retention_days=0)"
        " flow_states=1 login_attempts=1"
    ]
    assert run.ran is True
    assert run.purge is not None and run.purge.ran is False
    assert run.flow_states_deleted == 1
    assert run.login_attempts_deleted == 1
    assert db.get(BotFlowState, flow_state.phone_number) is None
    assert attempt_id not in _login_attempt_ids(db)
    assert db.get(Conversation, conversation.id) is not None


def test_purge_messages_command_runs_end_to_end(db: Session, capsys, monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)
    conversation = _make_conversation(db)
    _add_message(db, conversation.id, created_at=OLD)
    flow_state = _add_flow_state(
        db, expires_at=datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=5)
    )

    exit_code = _run_purge_messages()

    assert exit_code == 0
    captured = capsys.readouterr()
    assert "purged 1 message(s) and 1 conversation(s)" in captured.out
    assert "reaped 1 expired flow state(s) and 0 expired login attempt(s)" in captured.out
    assert db.get(Conversation, conversation.id) is None
    assert db.get(BotFlowState, flow_state.phone_number) is None


def test_purge_messages_command_exits_1_and_deletes_nothing_while_the_lock_is_held(
    db: Session, _test_engine: Engine, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)
    conversation_id = _make_conversation(db).id
    _add_message(db, conversation_id, created_at=OLD)
    # Under the `db` fixture this only releases a savepoint, and it has to: the skip path rolls
    # its own transaction back, which here is that savepoint, and would take the setup with it.
    db.commit()

    with _test_engine.connect() as holder, holder.begin():
        holder.execute(
            select(func.pg_advisory_xact_lock(RETENTION_LOCK_NAMESPACE, RETENTION_LOCK_KEY))
        )
        exit_code = _run_purge_messages()

    assert exit_code == 1
    captured = capsys.readouterr()
    assert "skipped: another instance holds the lock" in captured.err
    assert captured.out == ""
    assert db.get(Conversation, conversation_id) is not None


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


def _add_flow_state(db: Session, *, expires_at: datetime.datetime) -> BotFlowState:
    flow_state = BotFlowState(
        phone_number=_phone_number(),
        step="awaiting_name",
        collected_data={},
        misses=0,
        prompt="What is your name?",
        expires_at=expires_at,
    )
    db.add(flow_state)
    db.flush()

    return flow_state


def _add_login_attempt(db: Session, *, attempted_at: datetime.datetime) -> uuid.UUID:
    attempt_id = uuid.uuid4()
    db.add(
        LoginAttempt(
            bucket_key=f"ratelimit:login:email:{attempt_id}@example.com",
            attempt_id=attempt_id,
            attempted_at=attempted_at,
        )
    )
    db.flush()

    return attempt_id


def _login_attempt_ids(db: Session) -> set[uuid.UUID]:
    return set(db.scalars(select(LoginAttempt.attempt_id)).all())


def _set_retention_days(db: Session, days: int) -> None:
    _set_int_setting(db, CHAT_RETENTION_DAYS_SETTING, days)


def _set_int_setting(db: Session, key: str, value: int) -> None:
    db.execute(update(SystemSetting).where(SystemSetting.key == key).values(value=str(value)))
    db.flush()


def _phone_number() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"
