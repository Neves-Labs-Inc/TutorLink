"""Migration 0042 against real rows: `child_homes` dropped for the Home set derived from a
Child's Guardians, refused while a link the derived set would lose still exists, and recreated
from the derived set on the way down.

Built the way `test_migration_0038.py` builds its scratch database: migrated to the revision
before, seeded, moved across 0042 both ways, and dropped whatever happens.
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
BEFORE = "0041"
AFTER = "0042"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at the revision before 0042, and the Alembic config pointed at it."""
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
    """Two Guardians of one Child, sharing one Home and each holding one of their own; the
    Child's `child_homes` names only the shared Home."""
    ids = {name: uuid.uuid4() for name in ("mum", "dad", "child", "shared", "mums", "dads")}
    _insert(
        engine,
        "INSERT INTO guardians (id, name, phone_number) VALUES"
        " (:mum, 'Mum', '+12025550101'), (:dad, 'Dad', '+12025550102')",
        **ids,
    )
    _insert(
        engine,
        "INSERT INTO children (id, name, school_name) VALUES (:child, 'Ana', 'Lincoln')",
        **ids,
    )
    _insert(
        engine,
        "INSERT INTO homes (id, address, access_code) VALUES"
        " (:shared, '1 Elm', '1'), (:mums, '2 Elm', '2'), (:dads, '3 Elm', '3')",
        **ids,
    )
    _insert(
        engine,
        "INSERT INTO child_guardians (child_id, guardian_id) VALUES (:child, :mum), (:child, :dad)",
        **ids,
    )
    _insert(
        engine,
        "INSERT INTO guardian_homes (guardian_id, home_id) VALUES"
        " (:mum, :shared), (:dad, :shared), (:mum, :mums), (:dad, :dads)",
        **ids,
    )
    _insert(engine, "INSERT INTO child_homes (child_id, home_id) VALUES (:child, :shared)", **ids)
    return ids


def _tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def _child_homes(engine: Engine) -> list[tuple[uuid.UUID, uuid.UUID]]:
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT child_id, home_id FROM child_homes"))
        return sorted((row[0], row[1]) for row in rows)


def test_the_upgrade_drops_child_homes(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    _seed(engine)

    command.upgrade(config, AFTER)

    assert "child_homes" not in _tables(engine)


def test_the_upgrade_refuses_a_link_no_guardian_of_the_child_owns(
    scratch: tuple[Config, Engine],
) -> None:
    """Dropping it would silently take a Home away from the Child, so an operator resolves it
    first: link the Home to a Guardian, or delete the row."""
    config, engine = scratch
    ids = _seed(engine)
    stray = uuid.uuid4()
    _insert(
        engine,
        "INSERT INTO homes (id, address, access_code) VALUES (:stray, '9 Oak', '9')",
        stray=stray,
    )
    _insert(
        engine,
        "INSERT INTO child_homes (child_id, home_id) VALUES (:child, :stray)",
        child=ids["child"],
        stray=stray,
    )

    with pytest.raises(RuntimeError, match="1 child_homes row"):
        command.upgrade(config, AFTER)

    assert "child_homes" in _tables(engine)
    assert len(_child_homes(engine)) == 2


def test_the_downgrade_backfills_child_homes_from_the_derived_set(
    scratch: tuple[Config, Engine],
) -> None:
    """One row per distinct pair: the Home both Guardians share comes back once."""
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert _child_homes(engine) == sorted(
        (ids["child"], home) for home in (ids["shared"], ids["mums"], ids["dads"])
    )
    indexes = {index["name"] for index in inspect(engine).get_indexes("child_homes")}
    uniques = {
        constraint["name"] for constraint in inspect(engine).get_unique_constraints("child_homes")
    }
    assert "ix_child_homes_home_id" in indexes
    assert "uq_child_homes_child_home" in uniques
