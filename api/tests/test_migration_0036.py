"""Migration 0036 against a real database: subject names unique ignoring case, up and down.

Built the way `test_migration_0035.py` builds its scratch database: migrated to 0035, moved
across 0036 both ways, and dropped whatever happens.
"""

import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0035"
AFTER = "0036"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0035, and the Alembic config pointed at it."""
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


def _insert_subject(engine: Engine, name: str) -> None:
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO subjects (name) VALUES (:name)"), {"name": name})


def _subject_names(engine: Engine) -> list[str]:
    with engine.connect() as connection:
        # Sorted here, not by the database, so the collation never decides the order.
        return sorted(connection.scalars(text("SELECT name FROM subjects")))


def test_after_the_upgrade_a_case_variant_of_a_name_is_refused(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    _insert_subject(engine, "Biology")

    command.upgrade(config, AFTER)

    with pytest.raises(IntegrityError):
        _insert_subject(engine, "BIOLOGY")


def test_the_upgrade_keeps_existing_names_as_they_are(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    _insert_subject(engine, " Biology ")
    _insert_subject(engine, "Chemistry")

    command.upgrade(config, AFTER)

    assert _subject_names(engine) == [" Biology ", "Chemistry"]


def test_the_upgrade_refuses_case_duplicates_and_names_them(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    _insert_subject(engine, "Biology")
    _insert_subject(engine, "biology")
    _insert_subject(engine, "Chemistry")

    with pytest.raises(RuntimeError) as raised:
        command.upgrade(config, AFTER)

    assert "Biology" in str(raised.value)
    assert "biology" in str(raised.value)
    assert "Chemistry" not in str(raised.value)
    assert _subject_names(engine) == ["Biology", "Chemistry", "biology"]


def test_the_downgrade_restores_exact_name_uniqueness(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    _insert_subject(engine, "Biology")
    _insert_subject(engine, "biology")
    with pytest.raises(IntegrityError):
        _insert_subject(engine, "Biology")
