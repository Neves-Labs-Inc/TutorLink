"""Migration 0045: the `child_assigned_tutors` link between a Child and a Staff user, up and
down.

Built the way `test_migration_0044.py` builds its scratch database: migrated to 0044, moved
across 0045 both ways, and dropped whatever happens.
"""

import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, make_url, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0044"
AFTER = "0045"
TABLE = "child_assigned_tutors"
UNIQUE_PAIR = "uq_child_assigned_tutors_child_user"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0044, and the Alembic config pointed at it."""
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
    """An Admin, a Tutor and a Child: the fewest rows an assignment needs."""
    ids = {name: uuid.uuid4() for name in ("admin", "tutor", "child")}
    _execute(
        engine,
        "INSERT INTO users (id, email, name, role) VALUES"
        " (:admin, 'admin@example.com', 'Admin', 'admin'),"
        " (:tutor, 'tutor@example.com', 'Tutor', 'tutor')",
        dict(ids),
    )
    _execute(
        engine,
        "INSERT INTO children (id, name, grade_level, school_name)"
        " VALUES (:child, 'Child', 7, 'Test School')",
        dict(ids),
    )
    return ids


def _assign(engine: Engine, ids: dict[str, uuid.UUID]) -> None:
    _execute(
        engine,
        f"INSERT INTO {TABLE} (child_id, user_id, created_by_user_id)"
        " VALUES (:child, :tutor, :admin)",
        dict(ids),
    )


def _assignments(engine: Engine) -> list[tuple[object, ...]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(f"SELECT child_id, user_id, created_by_user_id FROM {TABLE}")
        ).all()
    return [tuple(row) for row in rows]


def test_the_upgrade_creates_the_table_and_an_assignment_is_stored(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)
    _assign(engine, ids)

    assert _assignments(engine) == [(ids["child"], ids["tutor"], ids["admin"])]
    with engine.connect() as connection:
        created_at = connection.execute(text(f"SELECT created_at FROM {TABLE}")).scalar()
    assert created_at is not None


def test_the_same_child_and_user_are_linked_once(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    _assign(engine, ids)

    with pytest.raises(IntegrityError, match=UNIQUE_PAIR):
        _assign(engine, ids)


@pytest.mark.parametrize("deleted", ["child", "tutor"])
def test_deleting_the_child_or_the_user_deletes_the_assignment(
    scratch: tuple[Config, Engine], deleted: str
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    _assign(engine, ids)
    table = "children" if deleted == "child" else "users"

    _execute(engine, f"DELETE FROM {table} WHERE id = :id", {"id": ids[deleted]})

    assert _assignments(engine) == []


def test_deleting_the_creator_keeps_the_assignment(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    _assign(engine, ids)

    _execute(engine, "DELETE FROM users WHERE id = :id", {"id": ids["admin"]})

    assert _assignments(engine) == [(ids["child"], ids["tutor"], None)]


def test_the_downgrade_drops_the_table(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    _assign(engine, ids)

    command.downgrade(config, BEFORE)

    assert TABLE not in inspect(engine).get_table_names()
