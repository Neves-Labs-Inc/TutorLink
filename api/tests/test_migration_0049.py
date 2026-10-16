"""Migration 0049: the Mark done Undo and reply-window columns on `conversations`, up and down.

Built the way `test_migration_0048.py` builds its scratch database: migrated to 0048, moved
across 0049 both ways, and dropped whatever happens.
"""

import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.engine import Engine

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0048"
AFTER = "0049"
NEW_COLUMNS = {
    "handled_flag_reason": "flag_reason",
    "handled_flagged_at": "timestamptz",
    "handled_at": "timestamptz",
    "reply_window_flagged_for": "timestamptz",
}


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0048, and the Alembic config pointed at it."""
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


def _column_types(engine: Engine) -> dict[str, tuple[str, str]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT column_name, udt_name, is_nullable FROM information_schema.columns"
                " WHERE table_name = 'conversations'"
            )
        ).all()
    return {name: (udt, nullable) for name, udt, nullable in rows}


def test_the_upgrade_adds_four_nullable_columns(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    columns = _column_types(engine)
    assert {name: columns[name] for name in NEW_COLUMNS} == {
        name: (udt, "YES") for name, udt in NEW_COLUMNS.items()
    }


def test_an_existing_conversation_gets_nulls(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO conversations (phone_number, flag_reason) VALUES ('+15550001', 'stuck')"
            )
        )

    command.upgrade(config, AFTER)

    with engine.connect() as connection:
        row = connection.execute(text(f"SELECT {', '.join(NEW_COLUMNS)} FROM conversations")).one()
    assert tuple(row) == (None, None, None, None)


def test_a_handled_flag_reason_can_be_reply_window_closed(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO conversations (phone_number, handled_flag_reason, handled_flagged_at,"
                " handled_at, reply_window_flagged_for)"
                " VALUES ('+15550001', 'reply_window_closed', now(), now(), now())"
            )
        )
        reason = connection.execute(
            text("SELECT handled_flag_reason::text FROM conversations")
        ).scalar_one()

    assert reason == "reply_window_closed"


def test_the_downgrade_drops_the_columns(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    columns = {column["name"] for column in inspect(engine).get_columns("conversations")}
    assert columns.isdisjoint(NEW_COLUMNS)
