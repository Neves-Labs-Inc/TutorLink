"""`conversations` and `messages` constraints, and migration 0014's round trip, against a real
PostgreSQL.

Metadata assertions prove a constraint is declared, not that the database rejects anything.
Every case below is an INSERT that either lands or comes back as an `IntegrityError`, so a
constraint that is dropped or written the wrong way round fails here rather than in production.

The two paired CHECKs are each tested in **both** directions. A check written as a one-way
implication — `status <> 'human' OR taken_over_by_user_id IS NOT NULL` — passes half of these
and leaves the other half representable, which is exactly the state the constraint exists to
make impossible.

Each rejection runs inside its own `begin_nested()`. A failed statement aborts the surrounding
transaction, and the `db` fixture's rollback is the outer one — without the savepoint the next
statement in the same test dies with `InFailedSqlTransaction` and hides what it meant to prove.
"""

import datetime
import os
import pathlib
import uuid
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, inspect, make_url, select, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User
from app.security import hash_password

ALEMBIC_DIRECTORY = pathlib.Path(__file__).resolve().parents[1] / "alembic"

TAKEOVER_PAIR_CONSTRAINT = "ck_conversations_takeover_pair"
ADMIN_AUTHOR_PAIR_CONSTRAINT = "ck_messages_admin_author_pair"
PHONE_NUMBER_CONSTRAINT = "conversations_phone_number_key"
TWILIO_SID_CONSTRAINT = "messages_twilio_sid_key"

CHAT_RETENTION_DAYS_SETTING = "chat_retention_days"
CHAT_RETENTION_DAYS_DEFAULT = "365"

CHAT_ENUM_TYPES = ("conversation_status", "message_author", "message_status", "flag_reason")
CHAT_TABLES = ("conversations", "messages")

FLAGGED_AT = datetime.datetime(2026, 9, 22, 10, 0, tzinfo=datetime.UTC)


def test_one_conversation_per_phone_number(db: Session) -> None:
    """The thread is keyed on the WhatsApp identity. A second row for the same number would
    split one client's history in two, with nothing to say which half is current."""
    number = _phone_number()
    db.add(_conversation(number))
    db.flush()

    with pytest.raises(IntegrityError, match=PHONE_NUMBER_CONSTRAINT), db.begin_nested():
        db.add(_conversation(number))
        db.flush()


def test_a_conversation_without_a_guardian_is_accepted(db: Session) -> None:
    """The bot is already talking before intake collects a name, and a thread that stalled
    part-way through intake is the one an admin most wants to read."""
    conversation = _conversation(_phone_number())
    db.add(conversation)
    db.flush()

    assert conversation.guardian_id is None
    assert conversation.status is ConversationStatus.BOT


def test_two_conversations_may_share_a_guardian(db: Session) -> None:
    """`ix_conversations_guardian_id` is deliberately not unique: a guardian who changes
    handsets gets a second thread, and the older one stays readable as history."""
    guardian = _make_guardian(db)
    db.add(_conversation(_phone_number(), guardian_id=guardian.id))
    db.add(_conversation(_phone_number(), guardian_id=guardian.id))
    db.flush()

    assert _conversation_count(db, guardian_id=guardian.id) == 2


def test_a_human_conversation_without_a_holder_is_rejected(db: Session) -> None:
    with pytest.raises(IntegrityError, match=TAKEOVER_PAIR_CONSTRAINT), db.begin_nested():
        db.add(_conversation(_phone_number(), status=ConversationStatus.HUMAN))
        db.flush()


def test_a_holder_on_a_bot_conversation_is_rejected(db: Session) -> None:
    """The other direction, and the one a one-way implication would let through: an admin
    recorded as holding a thread the bot is still answering."""
    admin = _make_admin(db)

    with pytest.raises(IntegrityError, match=TAKEOVER_PAIR_CONSTRAINT), db.begin_nested():
        db.add(
            _conversation(
                _phone_number(),
                status=ConversationStatus.BOT,
                taken_over_by_user_id=admin.id,
            )
        )
        db.flush()


def test_both_coherent_takeover_states_are_accepted(db: Session) -> None:
    admin = _make_admin(db)
    db.add(_conversation(_phone_number()))
    db.add(
        _conversation(
            _phone_number(),
            status=ConversationStatus.HUMAN,
            taken_over_by_user_id=admin.id,
            taken_over_at=FLAGGED_AT,
        )
    )
    db.flush()

    assert _conversation_count(db) == 2


@pytest.mark.parametrize("status", [ConversationStatus.BOT, ConversationStatus.HUMAN])
def test_a_flag_is_independent_of_who_is_answering(db: Session, status: ConversationStatus) -> None:
    """The whole reason `flag_reason` is not merged into `status`. A `bot` conversation can be
    flagged and unattended, and a `human` one can carry a flag raised before the takeover —
    one column would lose whichever half is not currently true."""
    admin = _make_admin(db)
    conversation = _conversation(
        _phone_number(),
        status=status,
        taken_over_by_user_id=admin.id if status is ConversationStatus.HUMAN else None,
        taken_over_at=FLAGGED_AT if status is ConversationStatus.HUMAN else None,
        flag_reason=FlagReason.STUCK,
        flagged_at=FLAGGED_AT,
    )
    db.add(conversation)
    db.flush()

    assert conversation.flag_reason is FlagReason.STUCK
    assert conversation.status is status


def test_one_message_per_twilio_sid(db: Session) -> None:
    """The webhook-retry guard. Twilio retries a delivery it believes failed, so the insert
    itself is the idempotency check: the retry conflicts here rather than appearing twice in
    the thread an admin is reading."""
    conversation = _make_conversation(db)
    sid = _twilio_sid()
    db.add(_message(conversation.id, twilio_sid=sid))
    db.flush()

    with pytest.raises(IntegrityError, match=TWILIO_SID_CONSTRAINT), db.begin_nested():
        db.add(_message(conversation.id, twilio_sid=sid))
        db.flush()


def test_messages_without_a_twilio_sid_are_repeatable(db: Session) -> None:
    """PostgreSQL treats NULLs as distinct under a unique index, and that is what makes a bot
    reply recordable at all: a TwiML reply has no SID at the moment the row is written, so
    every bot reply in the system would otherwise collide with the first one."""
    conversation = _make_conversation(db)
    for _ in range(3):
        db.add(_message(conversation.id, author_kind=MessageAuthor.BOT, status=MessageStatus.SENT))
    db.flush()

    assert _message_count(db, conversation.id) == 3


def test_an_admin_message_without_an_author_is_rejected(db: Session) -> None:
    conversation = _make_conversation(db)

    with pytest.raises(IntegrityError, match=ADMIN_AUTHOR_PAIR_CONSTRAINT), db.begin_nested():
        db.add(_message(conversation.id, author_kind=MessageAuthor.ADMIN))
        db.flush()


@pytest.mark.parametrize("author_kind", [MessageAuthor.CLIENT, MessageAuthor.BOT])
def test_a_non_admin_message_carrying_an_author_is_rejected(
    db: Session, author_kind: MessageAuthor
) -> None:
    """The other direction. `author_user_id` answers "which admin typed this", so attaching one
    to a message the client or the bot wrote attributes it to somebody who did not write it."""
    conversation = _make_conversation(db)
    admin = _make_admin(db)

    with pytest.raises(IntegrityError, match=ADMIN_AUTHOR_PAIR_CONSTRAINT), db.begin_nested():
        db.add(_message(conversation.id, author_kind=author_kind, author_user_id=admin.id))
        db.flush()


def test_an_admin_message_with_an_author_is_accepted(db: Session) -> None:
    conversation = _make_conversation(db)
    admin = _make_admin(db)
    db.add(
        _message(
            conversation.id,
            author_kind=MessageAuthor.ADMIN,
            author_user_id=admin.id,
            twilio_sid=_twilio_sid(),
            status=MessageStatus.QUEUED,
        )
    )
    db.flush()

    assert _message_count(db, conversation.id) == 1


def test_migration_0014_round_trips(_migration_engine: Engine) -> None:
    """`alembic upgrade head` from an empty database, then `downgrade base`.

    The enum types are the half that a downgrade silently gets wrong: a native PostgreSQL enum
    outlives `DROP TABLE`, so a type this migration creates but does not drop would survive
    `downgrade base` and make the *next* upgrade fail with "type already exists" — on a
    developer's machine, long after the migration was reviewed. Asserting the types are gone is
    what makes this a round trip rather than a one-way check.
    """
    config = _alembic_config()

    command.upgrade(config, "head")

    inspector = inspect(_migration_engine)
    table_names = set(inspector.get_table_names())
    assert set(CHAT_TABLES) <= table_names
    with _migration_engine.connect() as connection:
        assert _existing_enum_types(connection) == set(CHAT_ENUM_TYPES)
        retention = connection.execute(
            text("SELECT value FROM system_settings WHERE key = :key"),
            {"key": CHAT_RETENTION_DAYS_SETTING},
        ).scalar_one()
    assert retention == CHAT_RETENTION_DAYS_DEFAULT

    command.downgrade(config, "base")

    inspector = inspect(_migration_engine)
    assert set(inspector.get_table_names()) - {"alembic_version"} == set()
    with _migration_engine.connect() as connection:
        assert _existing_enum_types(connection) == set()


@pytest.fixture
def _migration_engine(monkeypatch: pytest.MonkeyPatch) -> Generator[Engine, None, None]:
    """An `Engine` bound to a throwaway, genuinely empty database, dropped when the test ends.

    Separate from `_test_engine` on purpose: that one is built by `metadata.create_all` and is
    shared by the whole session, so running a migration chain over it would both find the
    schema already there and destroy it for every other test.

    `alembic/env.py` takes its URL from `Settings` and ignores whatever the `Config` carries,
    which is the point of that file — so redirecting the migration means replacing
    `app.config.get_settings` for the duration. `env.py` resolves it on every run, so the
    patch reaches it. Without this the chain would run against the developer's own database.

    The name carries the process id because this fixture drops the database before creating it,
    and two suites running at once — one developer's `pytest` beside another's — would otherwise
    take turns destroying each other's schema half way through a migration chain.
    """
    from app.config import get_settings

    settings = get_settings()
    url = make_url(settings.database_url)
    migration_url = url.set(database=f"{url.database}_migrations_{os.getpid()}")
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: settings.model_copy(
            update={"database_url": migration_url.render_as_string(hide_password=False)}
        ),
    )

    admin_engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{migration_url.database}"'))
            connection.execute(text(f'CREATE DATABASE "{migration_url.database}"'))

        engine = create_engine(migration_url)
        try:
            yield engine
        finally:
            engine.dispose()

        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{migration_url.database}"'))
    finally:
        admin_engine.dispose()


def _alembic_config() -> Config:
    """An alembic `Config` built without `alembic.ini`, so `env.py` skips `fileConfig` and
    leaves pytest's own logging alone. The URL is `env.py`'s business, not this config's."""
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIRECTORY))

    return config


def _existing_enum_types(connection: Connection) -> set[str]:
    rows = connection.execute(
        text("SELECT typname FROM pg_type WHERE typname = ANY(:names)"),
        {"names": list(CHAT_ENUM_TYPES)},
    )

    return {row[0] for row in rows}


def _conversation(
    phone_number: str,
    *,
    guardian_id: uuid.UUID | None = None,
    status: ConversationStatus = ConversationStatus.BOT,
    taken_over_by_user_id: uuid.UUID | None = None,
    taken_over_at: datetime.datetime | None = None,
    flag_reason: FlagReason | None = None,
    flagged_at: datetime.datetime | None = None,
) -> Conversation:
    return Conversation(
        phone_number=phone_number,
        guardian_id=guardian_id,
        status=status,
        taken_over_by_user_id=taken_over_by_user_id,
        taken_over_at=taken_over_at,
        flag_reason=flag_reason,
        flagged_at=flagged_at,
    )


def _message(
    conversation_id: uuid.UUID,
    *,
    author_kind: MessageAuthor = MessageAuthor.CLIENT,
    author_user_id: uuid.UUID | None = None,
    twilio_sid: str | None = None,
    status: MessageStatus = MessageStatus.RECEIVED,
) -> Message:
    return Message(
        conversation_id=conversation_id,
        author_kind=author_kind,
        author_user_id=author_user_id,
        body="Hello",
        twilio_sid=twilio_sid,
        status=status,
    )


def _make_conversation(db: Session) -> Conversation:
    conversation = _conversation(_phone_number())
    db.add(conversation)
    db.flush()

    return conversation


def _make_guardian(db: Session) -> Guardian:
    guardian = Guardian(phone_number=_phone_number(), name="Test Guardian")
    db.add(guardian)
    db.flush()

    return guardian


def _make_admin(db: Session) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password("conversation-password"),
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()

    return user


def _phone_number() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"


def _twilio_sid() -> str:
    return f"SM{uuid.uuid4().hex}"


def _conversation_count(db: Session, *, guardian_id: uuid.UUID | None = None) -> int:
    statement = select(func.count()).select_from(Conversation)
    if guardian_id is not None:
        statement = statement.where(Conversation.guardian_id == guardian_id)

    return db.execute(statement).scalar_one()


def _message_count(db: Session, conversation_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count()).select_from(Message).where(Message.conversation_id == conversation_id)
    ).scalar_one()
