"""Migration 0039 against a real database: the `office_phone` row, up and down.

Built the way `test_migration_0035.py` builds its scratch database: migrated to 0038, moved
across 0039 both ways, and dropped whatever happens.
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
BEFORE = "0038"
AFTER = "0039"
OFFICE_PHONE = "office_phone"
# 0035's row: the downgrade must leave other settings alone.
OTHER_KEY = "email_brand_color"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0038, and the Alembic config pointed at it."""
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


def _setting(engine: Engine, key: str) -> tuple[str, str, bool] | None:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT value, value_type, is_developer_only FROM system_settings WHERE key = :key"
            ),
            {"key": key},
        ).one_or_none()

    return None if row is None else (row.value, row.value_type, row.is_developer_only)


def test_the_upgrade_seeds_a_blank_office_phone_row(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    assert _setting(engine, OFFICE_PHONE) == ("", "string", False)


def test_the_downgrade_deletes_exactly_that_row(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    other_row_before = _setting(engine, OTHER_KEY)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert _setting(engine, OFFICE_PHONE) is None
    assert other_row_before is not None
    assert _setting(engine, OTHER_KEY) == other_row_before
