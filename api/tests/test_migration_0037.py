"""Migration 0037 against a real database: `is_active` becomes `is_archived`, up and down.

Built the way `test_migration_0036.py` builds its scratch database: migrated to 0036, moved
across 0037 both ways, and dropped whatever happens.
"""

import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.engine import Connection, Engine

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0036"
AFTER = "0037"

# Per archivable table: the column naming a row, and the other columns 0036 requires.
REQUIRED = {
    "users": ("name", {"email": ":email", "role": "'tutor'"}),
    "children": ("name", {"school_name": "'School'"}),
    "guardians": ("name", {"phone_number": ":key"}),
    "homes": ("label", {"address": "'Street'", "access_code": "'1234'"}),
    "subjects": ("name", {}),
}
TABLES = list(REQUIRED)


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0036, and the Alembic config pointed at it."""
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


def _insert(connection: Connection, table: str, key: str, is_active: bool | None) -> None:
    """A row named `key`; `is_active=None` leaves the flag to the column default."""
    key_column, required = REQUIRED[table]
    values = {key_column: ":key", **required}
    if is_active is not None:
        values["is_active"] = ":is_active"
    statement = f"INSERT INTO {table} ({', '.join(values)}) VALUES ({', '.join(values.values())})"
    parameters = {"key": key, "email": f"{key}@example.com", "is_active": is_active}
    connection.execute(text(statement), parameters)


def _insert_active_and_inactive(engine: Engine) -> None:
    with engine.begin() as connection:
        for table in TABLES:
            _insert(connection, table, f"{table}-active", is_active=True)
            _insert(connection, table, f"{table}-inactive", is_active=False)


def _flags(engine: Engine, table: str, column: str) -> dict[str, bool]:
    key_column, _ = REQUIRED[table]
    with engine.connect() as connection:
        rows = connection.execute(text(f"SELECT {key_column}, {column} FROM {table}"))
        return {name: flag for name, flag in rows}


def _columns(engine: Engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


@pytest.mark.parametrize("table", TABLES)
def test_the_upgrade_archives_exactly_the_inactive_rows(
    scratch: tuple[Config, Engine], table: str
) -> None:
    config, engine = scratch
    _insert_active_and_inactive(engine)

    command.upgrade(config, AFTER)

    assert _flags(engine, table, "is_archived") == {
        f"{table}-active": False,
        f"{table}-inactive": True,
    }
    assert "is_active" not in _columns(engine, table)


@pytest.mark.parametrize("table", TABLES)
def test_a_row_inserted_after_the_upgrade_is_not_archived(
    scratch: tuple[Config, Engine], table: str
) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    with engine.begin() as connection:
        _insert(connection, table, "fresh", is_active=None)

    assert _flags(engine, table, "is_archived") == {"fresh": False}


@pytest.mark.parametrize("table", TABLES)
def test_the_downgrade_restores_is_active(scratch: tuple[Config, Engine], table: str) -> None:
    config, engine = scratch
    _insert_active_and_inactive(engine)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert _flags(engine, table, "is_active") == {
        f"{table}-active": True,
        f"{table}-inactive": False,
    }
    assert "is_archived" not in _columns(engine, table)


def test_tutors_and_availability_keep_is_active(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    assert "is_active" in _columns(engine, "tutors")
    assert "is_active" in _columns(engine, "tutor_availability")
