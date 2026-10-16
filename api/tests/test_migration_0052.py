"""Migration 0052: `users.welcome_seen_at`, up and down.

Built the way `test_migration_0051.py` builds its scratch database: migrated to 0051, moved
across 0052 both ways, and dropped whatever happens.
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
BEFORE = "0051"
AFTER = "0052"
COLUMN = "welcome_seen_at"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0051, and the Alembic config pointed at it."""
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


def _column(engine: Engine) -> tuple[str, str] | None:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT udt_name, is_nullable FROM information_schema.columns"
                " WHERE table_name = 'users' AND column_name = :column"
            ),
            {"column": COLUMN},
        ).one_or_none()
    return None if row is None else (row.udt_name, row.is_nullable)


def test_the_upgrade_adds_a_nullable_timestamp_and_existing_users_get_null(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO users (email, name, role) VALUES ('a@example.com', 'A', 'tutor')")
        )

    command.upgrade(config, AFTER)

    assert _column(engine) == ("timestamptz", "YES")
    with engine.connect() as connection:
        assert connection.execute(text(f"SELECT {COLUMN} FROM users")).scalar_one() is None


def test_the_downgrade_drops_the_column(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert _column(engine) is None
