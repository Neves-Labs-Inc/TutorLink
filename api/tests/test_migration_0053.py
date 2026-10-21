"""Migration 0053: the bot agent's runtime columns, the flag remap and `handoff_note`, up and down.

Built the way `test_migration_0049.py` builds its scratch database: migrated to 0052, moved
across 0053 both ways, and dropped whatever happens.
"""

import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DataError, IntegrityError

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0052"
AFTER = "0053"
NEW_CONVERSATION_COLUMNS = (
    "proposal_actions",
    "proposed_at",
    "no_progress_count",
    "outage_apology_sent_at",
    "turn_due_at",
)
TURN_DUE_INDEX = "ix_conversations_turn_due_at"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0052, and the Alembic config pointed at it."""
    url = make_url(get_settings().database_url)
    scratch_url = url.set(database=f"{url.database}_mig_{uuid.uuid4().hex[:8]}")
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{scratch_url.database}"'))
    monkeypatch.setenv("DATABASE_URL", scratch_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    config = Config()
    config.set_main_option("script_location", str(API_ROOT / "alembic"))
    engine = create_engine(scratch_url)
    try:
        command.upgrade(config, BEFORE)
        yield config, engine
    finally:
        engine.dispose()
        # The suite's own URL back, before anything caches the scratch one.
        monkeypatch.undo()
        get_settings.cache_clear()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{scratch_url.database}"'))
        admin.dispose()


def _insert_flagged(engine: Engine, phone: str, reason: str) -> uuid.UUID:
    conversation_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO conversations (id, phone_number, flag_reason, flagged_at,"
                " handled_flag_reason, handled_flagged_at, handled_at)"
                " VALUES (:id, :phone, :reason, now(), :reason, now(), now())"
            ),
            {"id": conversation_id, "phone": phone, "reason": reason},
        )
    return conversation_id


def _reasons(engine: Engine, conversation_id: uuid.UUID) -> tuple[str, str]:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT flag_reason::text, handled_flag_reason::text FROM conversations"
                " WHERE id = :id"
            ),
            {"id": conversation_id},
        ).one()
    return (row[0], row[1])


def _insert_conversation(engine: Engine, columns: str, values: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO conversations (phone_number, {columns}) VALUES ('+15550009', {values})"
            )
        )


def _seed_thread(engine: Engine) -> uuid.UUID:
    conversation_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO conversations (id, phone_number) VALUES (:id, '+15550010')"),
            {"id": conversation_id},
        )
        connection.execute(
            text(
                "INSERT INTO messages (conversation_id, author_kind, body, status, system_kind)"
                " VALUES (:id, 'system', 'Opted in', 'sent', 'consent_notice')"
            ),
            {"id": conversation_id},
        )
    return conversation_id


def _add_handoff_note(engine: Engine, conversation_id: uuid.UUID) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO messages (conversation_id, author_kind, body, status, system_kind)"
                " VALUES (:id, 'system', 'Wants a Friday slot', 'sent', 'handoff_note')"
            ),
            {"id": conversation_id},
        )


def test_the_upgrade_remaps_stuck_to_didnt_understand_and_parse_error_to_stuck(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    was_stuck = _insert_flagged(engine, "+15550001", "stuck")
    was_parse_error = _insert_flagged(engine, "+15550002", "parse_error")
    was_question = _insert_flagged(engine, "+15550003", "question")

    command.upgrade(config, AFTER)

    assert _reasons(engine, was_stuck) == ("didnt_understand", "didnt_understand")
    assert _reasons(engine, was_parse_error) == ("stuck", "stuck")
    assert _reasons(engine, was_question) == ("question", "question")


def test_parse_error_is_no_longer_a_flag_reason(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    with pytest.raises(DataError, match="parse_error"):
        _insert_flagged(engine, "+15550001", "parse_error")


def test_new_conversation_columns_start_null_and_zero(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    _insert_flagged(engine, "+15550001", "question")

    command.upgrade(config, AFTER)

    with engine.connect() as connection:
        row = connection.execute(
            text(f"SELECT {', '.join(NEW_CONVERSATION_COLUMNS)} FROM conversations")
        ).one()
    assert tuple(row) == (None, None, 0, None, None)


@pytest.mark.parametrize(
    ("columns", "values"),
    [
        ("proposed_at", "now()"),
        ("proposal_actions", "'[]'::jsonb"),
    ],
)
def test_a_half_set_proposal_is_refused(
    scratch: tuple[Config, Engine], columns: str, values: str
) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    with pytest.raises(IntegrityError, match="ck_conversations_proposal_pair"):
        _insert_conversation(engine, columns, values)


def test_a_whole_proposal_is_accepted(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    _insert_conversation(engine, "proposal_actions, proposed_at", '\'[{"kind": "book"}]\', now()')


def test_turn_due_at_has_a_partial_index(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    with engine.connect() as connection:
        definition = connection.execute(
            text("SELECT indexdef FROM pg_indexes WHERE indexname = :name"),
            {"name": TURN_DUE_INDEX},
        ).scalar_one()
    assert "WHERE (turn_due_at IS NOT NULL)" in definition


def test_redacted_fields_takes_only_the_listed_fields(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    _seed_thread(engine)
    command.upgrade(config, AFTER)

    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE messages SET redacted_fields ="
                " ARRAY['home_address', 'home_directions', 'child_date_of_birth', 'child_notes']"
            )
        )
    with pytest.raises(IntegrityError, match="ck_messages_redacted_fields"):
        with engine.begin() as connection:
            connection.execute(text("UPDATE messages SET redacted_fields = ARRAY['phone_number']"))


def test_a_handoff_note_is_refused_before_the_upgrade(scratch: tuple[Config, Engine]) -> None:
    _config, engine = scratch
    conversation_id = _seed_thread(engine)

    with pytest.raises(IntegrityError, match="ck_messages_system_kind"):
        _add_handoff_note(engine, conversation_id)


def test_the_upgrade_accepts_a_handoff_note(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    conversation_id = _seed_thread(engine)
    command.upgrade(config, AFTER)

    _add_handoff_note(engine, conversation_id)

    with engine.connect() as connection:
        kinds = connection.execute(
            text("SELECT system_kind FROM messages ORDER BY system_kind")
        ).scalars()
        assert list(kinds) == ["consent_notice", "handoff_note"]


def test_the_downgrade_restores_the_flags_and_drops_what_the_upgrade_added(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    was_stuck = _insert_flagged(engine, "+15550001", "stuck")
    was_parse_error = _insert_flagged(engine, "+15550002", "parse_error")
    conversation_id = _seed_thread(engine)
    command.upgrade(config, AFTER)
    _add_handoff_note(engine, conversation_id)

    command.downgrade(config, BEFORE)

    assert _reasons(engine, was_stuck) == ("stuck", "stuck")
    assert _reasons(engine, was_parse_error) == ("parse_error", "parse_error")
    conversation_columns = {c["name"] for c in inspect(engine).get_columns("conversations")}
    message_columns = {c["name"] for c in inspect(engine).get_columns("messages")}
    assert conversation_columns.isdisjoint(NEW_CONVERSATION_COLUMNS)
    assert "redacted_fields" not in message_columns
    with engine.connect() as connection:
        kinds = connection.execute(text("SELECT system_kind FROM messages")).scalars()
        assert list(kinds) == ["consent_notice"]
    with pytest.raises(IntegrityError, match="ck_messages_system_kind"):
        _add_handoff_note(engine, conversation_id)
