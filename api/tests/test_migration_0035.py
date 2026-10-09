"""Migration 0035 against a real database: the `email_brand_color` row, up and down.

Built the way `test_migration_0034.py` builds its scratch database: migrated to 0034, moved
across 0035 both ways, and dropped whatever happens.
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
BEFORE = "0034"
AFTER = "0035"
BRAND_COLOR = "email_brand_color"
# 0034's rows: the downgrade must leave other settings alone.
OTHER_KEY_PREFIX = "email_"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0034, and the Alembic config pointed at it."""
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


def _settings_with_prefix(engine: Engine, prefix: str) -> dict[str, tuple[str, str, bool]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT key, value, value_type, is_developer_only FROM system_settings"
                " WHERE key LIKE :pattern"
            ),
            {"pattern": f"{prefix}%"},
        ).all()

    return {
        key: (value, value_type, developer_only) for key, value, value_type, developer_only in rows
    }


def test_the_upgrade_seeds_the_brand_colour_row(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    assert _settings_with_prefix(engine, BRAND_COLOR) == {BRAND_COLOR: ("#74C8C9", "string", False)}


def test_the_downgrade_deletes_exactly_that_row(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    other_rows_before = _settings_with_prefix(engine, OTHER_KEY_PREFIX)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert _settings_with_prefix(engine, BRAND_COLOR) == {}
    assert _settings_with_prefix(engine, OTHER_KEY_PREFIX) == other_rows_before
    assert len(other_rows_before) == 4
