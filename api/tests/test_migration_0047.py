"""Migration 0047: `cancellation_cutoff_hours` defaults to 6, up and down.

Built the way `test_migration_0046.py` builds its scratch database: migrated to 0046, moved
across 0047 both ways, and dropped whatever happens.
"""

import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.engine import Engine

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0046"
AFTER = "0047"
CANCELLATION_CUTOFF = "cancellation_cutoff_hours"
# 0004's row beside it: the migration must leave other settings alone.
OTHER_KEY = "session_length_minutes"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0046, and the Alembic config pointed at it."""
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


def _value(engine: Engine, key: str) -> str:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT value FROM system_settings WHERE key = :key"), {"key": key}
        ).scalar_one()


def test_the_upgrade_sets_the_cancellation_cutoff_to_six_hours(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    assert _value(engine, CANCELLATION_CUTOFF) == "6"


def test_the_upgrade_overwrites_a_cutoff_an_admin_already_changed(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE system_settings SET value = '12' WHERE key = :key"),
            {"key": CANCELLATION_CUTOFF},
        )

    command.upgrade(config, AFTER)

    assert _value(engine, CANCELLATION_CUTOFF) == "6"


def test_the_downgrade_restores_twenty_four_hours_and_leaves_other_rows(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    other_before = _value(engine, OTHER_KEY)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert _value(engine, CANCELLATION_CUTOFF) == "24"
    assert _value(engine, OTHER_KEY) == other_before
