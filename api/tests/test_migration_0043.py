"""Migration 0043 against real rows: `homes.access_code` becomes nullable `directions` (up
to 500 characters), its "none" and blank placeholders turned into `NULL`, and back again on the
way down.

Built the way `test_migration_0042.py` builds its scratch database: migrated to the revision
before, seeded, moved across 0043 both ways, and dropped whatever happens.
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
BEFORE = "0042"
AFTER = "0043"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at the revision before 0043, and the Alembic config pointed at it."""
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


def _insert(engine: Engine, statement: str, **values: object) -> None:
    with engine.begin() as connection:
        connection.execute(text(statement), values)


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """One Home per kind of stored access code: the placeholder in two spellings, a blank one,
    and a real code."""
    codes = {"none": "none", "padded": "None ", "blank": "  ", "real": "Gate 1234"}
    ids = {name: uuid.uuid4() for name in codes}
    with engine.begin() as connection:
        for name, code in codes.items():
            connection.execute(
                text("INSERT INTO homes (id, address, access_code) VALUES (:id, '1 Elm', :code)"),
                {"id": ids[name], "code": code},
            )
    return ids


def _column_values(engine: Engine, column: str) -> dict[uuid.UUID, str | None]:
    with engine.connect() as connection:
        rows = connection.execute(text(f"SELECT id, {column} FROM homes"))
        return {row[0]: row[1] for row in rows}


def _column(engine: Engine, name: str) -> dict[str, object]:
    columns = {column["name"]: column for column in inspect(engine).get_columns("homes")}
    return dict(columns[name])


def test_the_upgrade_turns_placeholder_access_codes_into_null_directions(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    assert _column_values(engine, "directions") == {
        ids["none"]: None,
        ids["padded"]: None,
        ids["blank"]: None,
        ids["real"]: "Gate 1234",
    }


def test_the_upgrade_makes_directions_a_nullable_500_character_column(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    directions = _column(engine, "directions")
    assert directions["nullable"] is True
    assert str(directions["type"]) == "VARCHAR(500)"
    names = {column["name"] for column in inspect(engine).get_columns("homes")}
    assert "access_code" not in names


def test_the_downgrade_restores_access_code_with_none_for_null(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    long_directions = "x" * 500
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE homes SET directions = :value WHERE id = :id"),
            {"value": long_directions, "id": ids["real"]},
        )

    command.downgrade(config, BEFORE)

    assert _column_values(engine, "access_code") == {
        ids["none"]: "none",
        ids["padded"]: "none",
        ids["blank"]: "none",
        ids["real"]: "x" * 64,
    }
    access_code = _column(engine, "access_code")
    assert access_code["nullable"] is False
    assert str(access_code["type"]) == "VARCHAR(64)"
