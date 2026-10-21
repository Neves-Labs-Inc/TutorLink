"""Migration 0046: who entered a Time off row (`created_by`), up and down.

Built the way `test_migration_0045.py` builds its scratch database: migrated to 0045, moved
across 0046 both ways, and dropped whatever happens.
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
BEFORE = "0045"
AFTER = "0046"
TABLE = "tutor_availability_exceptions"
COLUMN = "created_by"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0045, and the Alembic config pointed at it."""
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


def _execute(engine: Engine, statement: str, values: dict[str, object]) -> None:
    with engine.begin() as connection:
        connection.execute(text(statement), values)


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """A Tutor, an Admin, and one Time off row of the Tutor's written before the column."""
    ids = {name: uuid.uuid4() for name in ("tutor", "admin", "row")}
    _execute(
        engine,
        "INSERT INTO users (id, email, name, role) VALUES"
        " (:tutor, 'tutor@example.com', 'Tutor', 'tutor'),"
        " (:admin, 'admin@example.com', 'Admin', 'admin')",
        dict(ids),
    )
    _execute(
        engine,
        f"INSERT INTO {TABLE} (id, user_id, start_date, end_date)"
        " VALUES (:row, :tutor, '2099-09-01', '2099-09-02')",
        dict(ids),
    )
    return ids


def _created_by(engine: Engine, row_id: uuid.UUID) -> object:
    with engine.connect() as connection:
        return connection.execute(
            text(f"SELECT {COLUMN} FROM {TABLE} WHERE id = :id"), {"id": row_id}
        ).scalar_one()


def test_existing_rows_have_no_creator_after_the_upgrade(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    assert _created_by(engine, ids["row"]) is None


def test_a_row_records_its_creator_after_the_upgrade(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)

    _execute(
        engine,
        f"UPDATE {TABLE} SET {COLUMN} = :admin WHERE id = :row",
        {"admin": ids["admin"], "row": ids["row"]},
    )

    assert _created_by(engine, ids["row"]) == ids["admin"]


def test_the_downgrade_drops_the_column_and_keeps_the_rows(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    _seed(engine)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    columns = {column["name"] for column in inspect(engine).get_columns(TABLE)}
    assert COLUMN not in columns
    with engine.connect() as connection:
        count = connection.execute(text(f"SELECT count(*) FROM {TABLE}")).scalar_one()
    assert count == 1
