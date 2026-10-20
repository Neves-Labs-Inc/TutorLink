"""Migration 0054: `bot_flow_state` is dropped, and the downgrade brings it back empty.

Built the way `test_migration_0053.py` builds its scratch database: migrated to 0053, moved
across 0054 both ways, and dropped whatever happens.
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
BEFORE = "0053"
AFTER = "0054"
TABLE = "bot_flow_state"
TABLE_COLUMNS = {"phone_number", "step", "collected_data", "misses", "prompt", "expires_at"}


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0053, and the Alembic config pointed at it."""
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


def _has_table(engine: Engine) -> bool:
    return inspect(engine).has_table(TABLE)


def test_upgrade_drops_the_flow_state_table_with_its_rows(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {TABLE} (phone_number, step, collected_data, misses, prompt,"
                " expires_at) VALUES ('+15551234567', 'menu', '{}', 0, 'Hi', now())"
            )
        )

    command.upgrade(config, AFTER)

    assert not _has_table(engine)


def test_downgrade_recreates_the_flow_state_table_empty(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert {column["name"] for column in inspect(engine).get_columns(TABLE)} == TABLE_COLUMNS
    assert inspect(engine).get_pk_constraint(TABLE)["constrained_columns"] == ["phone_number"]
    with engine.connect() as connection:
        assert connection.execute(text(f"SELECT count(*) FROM {TABLE}")).scalar_one() == 0
