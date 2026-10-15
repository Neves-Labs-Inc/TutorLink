"""Migration 0038 against real rows: Time off re-keyed from a tutor profile to its Staff user,
the category and note folded into one reason, up and down.

Built the way `test_migration_0037.py` builds its scratch database: migrated to 0037, seeded,
moved across 0038 both ways, and dropped whatever happens.
"""

import datetime
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
BEFORE = "0037"
AFTER = "0038"
TABLE = "tutor_availability_exceptions"
DATE = datetime.date(2026, 9, 7)
NEW_COLUMNS = ("decided_by", "decided_at", "cancelled_by", "cancelled_at")


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0037, and the Alembic config pointed at it."""
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


def _seed(engine: Engine) -> dict[str, uuid.UUID]:
    """A Tutor with a user, and two of their Time off rows: one with a note, one without."""
    ids = {name: uuid.uuid4() for name in ("tutor_user", "tutor", "with_note", "blank_note")}
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, name, role)"
                " VALUES (:tutor_user, 'tutor@example.com', 'Tutor', 'tutor')"
            ),
            ids,
        )
        connection.execute(
            text(
                "INSERT INTO tutors (id, user_id, phone_number)"
                " VALUES (:tutor, :tutor_user, '+12025550100')"
            ),
            ids,
        )
        connection.execute(
            text(
                f"INSERT INTO {TABLE} (id, tutor_id, start_date, end_date, reason, notes) VALUES"
                " (:with_note, :tutor, :date, :date, 'personal', 'Dentist'),"
                " (:blank_note, :tutor, :date, :date, 'vacation', '   ')"
            ),
            {**ids, "date": DATE},
        )
    return ids


def _rows(engine: Engine, columns: str) -> dict[uuid.UUID, tuple[object, ...]]:
    with engine.connect() as connection:
        rows = connection.execute(text(f"SELECT id, {columns} FROM {TABLE}"))
        return {row[0]: tuple(row[1:]) for row in rows}


def _columns(engine: Engine) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(TABLE)}


def test_the_upgrade_keys_each_row_on_the_tutors_user(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    assert _rows(engine, "user_id") == {
        ids["with_note"]: (ids["tutor_user"],),
        ids["blank_note"]: (ids["tutor_user"],),
    }
    assert "tutor_id" not in _columns(engine)


def test_the_upgrade_folds_the_note_into_the_reason(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    assert _rows(engine, "reason") == {
        ids["with_note"]: ("Dentist",),
        ids["blank_note"]: ("vacation",),
    }
    assert "notes" not in _columns(engine)


def test_the_upgrade_trims_and_truncates_a_long_padded_note(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    long_row = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {TABLE} (id, tutor_id, start_date, end_date, reason, notes)"
                " VALUES (:id, :tutor, :date, :date, 'other', :notes)"
            ),
            {"id": long_row, "tutor": ids["tutor"], "date": DATE, "notes": f"  {'x' * 600}  "},
        )

    command.upgrade(config, AFTER)

    assert _rows(engine, "reason")[long_row] == ("x" * 500,)


def test_the_upgrade_trims_a_padded_note(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)
    padded_row = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {TABLE} (id, tutor_id, start_date, end_date, reason, notes)"
                " VALUES (:id, :tutor, :date, :date, 'sick', '  Flu  ')"
            ),
            {"id": padded_row, "tutor": ids["tutor"], "date": DATE},
        )

    command.upgrade(config, AFTER)

    assert _rows(engine, "reason")[padded_row] == ("Flu",)


def test_the_upgrade_leaves_the_decision_columns_null(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    assert _rows(engine, ", ".join(NEW_COLUMNS)) == {
        ids["with_note"]: (None, None, None, None),
        ids["blank_note"]: (None, None, None, None),
    }


def test_the_upgrade_adds_cancelled_to_the_status_enum(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    with engine.connect() as connection:
        labels = connection.execute(
            text("SELECT unnest(enum_range(NULL::exception_status))::text")
        ).scalars()
        assert set(labels) == {"pending", "approved", "rejected", "cancelled"}


def test_the_downgrade_restores_tutor_id_and_notes(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    assert _rows(engine, "tutor_id, reason, notes") == {
        ids["with_note"]: (ids["tutor"], "other", "Dentist"),
        ids["blank_note"]: (ids["tutor"], "other", "vacation"),
    }
    assert _columns(engine).isdisjoint({"user_id", *NEW_COLUMNS})


def test_the_downgrade_drops_rows_it_cannot_hold(scratch: tuple[Config, Engine]) -> None:
    """An Admin's row has no profile to name, and `cancelled` does not exist before 0038."""
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    admin_id, admin_row, cancelled_row = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, name, role)"
                " VALUES (:admin, 'admin@example.com', 'Admin', 'admin')"
            ),
            {"admin": admin_id},
        )
        connection.execute(
            text(
                f"INSERT INTO {TABLE} (id, user_id, start_date, end_date, status) VALUES"
                " (:admin_row, :admin, :date, :date, 'approved'),"
                " (:cancelled_row, :tutor_user, :date, :date, 'cancelled')"
            ),
            {
                "admin_row": admin_row,
                "admin": admin_id,
                "cancelled_row": cancelled_row,
                "tutor_user": ids["tutor_user"],
                "date": DATE,
            },
        )

    command.downgrade(config, BEFORE)

    assert set(_rows(engine, "tutor_id")) == {ids["with_note"], ids["blank_note"]}
    with engine.connect() as connection:
        labels = connection.execute(
            text("SELECT unnest(enum_range(NULL::exception_status))::text")
        ).scalars()
        assert set(labels) == {"pending", "approved", "rejected"}
