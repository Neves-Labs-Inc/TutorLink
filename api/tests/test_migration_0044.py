"""Migration 0044: the paired Time off clash acknowledgement on `bookings`, up and down.

Built the way `test_migration_0038.py` builds its scratch database: migrated to 0043, moved
across 0044 both ways, and dropped whatever happens.
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
from sqlalchemy.exc import IntegrityError

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0043"
AFTER = "0044"
TABLE = "bookings"
NEW_COLUMNS = {"clash_acknowledged_by", "clash_acknowledged_at"}
PAIR_CONSTRAINT = "ck_bookings_clash_acknowledgement_pair"
DATE = datetime.date(2026, 9, 7)
ACKNOWLEDGED_AT = datetime.datetime(2026, 9, 1, 12, 0, tzinfo=datetime.UTC)


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0043, and the Alembic config pointed at it."""
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


def _seed_booking(engine: Engine) -> dict[str, uuid.UUID]:
    """An Admin and an In office Evaluation booked with them: the fewest rows a Booking needs."""
    ids = {name: uuid.uuid4() for name in ("admin", "child", "booking")}
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, name, role)"
                " VALUES (:admin, 'admin@example.com', 'Admin', 'admin')"
            ),
            ids,
        )
        connection.execute(
            text(
                "INSERT INTO children (id, name, grade_level, school_name)"
                " VALUES (:child, 'Child', 7, 'Test School')"
            ),
            ids,
        )
        connection.execute(
            text(
                f"INSERT INTO {TABLE} (id, child_id, user_id, kind, location, scheduled_date,"
                " start_time, end_time, status) VALUES (:booking, :child, :admin, 'evaluation',"
                " 'in_office', :date, '10:00', '11:00', 'confirmed')"
            ),
            {**ids, "date": DATE},
        )
    return ids


def _columns(engine: Engine) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(TABLE)}


def _check_constraints(engine: Engine) -> set[str | None]:
    return {check["name"] for check in inspect(engine).get_check_constraints(TABLE)}


def _acknowledge(
    engine: Engine,
    booking_id: uuid.UUID,
    *,
    by: uuid.UUID | None,
    at: datetime.datetime | None,
) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                f"UPDATE {TABLE} SET clash_acknowledged_by = :by, clash_acknowledged_at = :at"
                " WHERE id = :id"
            ),
            {"by": by, "at": at, "id": booking_id},
        )


def test_the_upgrade_adds_both_columns_null_and_the_pair_check(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed_booking(engine)

    command.upgrade(config, AFTER)

    assert NEW_COLUMNS <= _columns(engine)
    assert PAIR_CONSTRAINT in _check_constraints(engine)
    with engine.connect() as connection:
        stored = connection.execute(
            text(
                f"SELECT clash_acknowledged_by, clash_acknowledged_at FROM {TABLE} WHERE id = :id"
            ),
            {"id": ids["booking"]},
        ).one()
    assert tuple(stored) == (None, None)


def test_a_full_pair_is_stored(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed_booking(engine)
    command.upgrade(config, AFTER)

    _acknowledge(engine, ids["booking"], by=ids["admin"], at=ACKNOWLEDGED_AT)

    with engine.connect() as connection:
        stored = connection.execute(
            text(
                f"SELECT clash_acknowledged_by, clash_acknowledged_at FROM {TABLE} WHERE id = :id"
            ),
            {"id": ids["booking"]},
        ).one()
    assert tuple(stored) == (ids["admin"], ACKNOWLEDGED_AT)


@pytest.mark.parametrize("half", ["by", "at"])
def test_a_half_set_pair_is_refused(scratch: tuple[Config, Engine], half: str) -> None:
    config, engine = scratch
    ids = _seed_booking(engine)
    command.upgrade(config, AFTER)

    with pytest.raises(IntegrityError, match=PAIR_CONSTRAINT):
        _acknowledge(
            engine,
            ids["booking"],
            by=ids["admin"] if half == "by" else None,
            at=ACKNOWLEDGED_AT if half == "at" else None,
        )


def test_the_acknowledging_user_must_exist(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed_booking(engine)
    command.upgrade(config, AFTER)

    with pytest.raises(IntegrityError):
        _acknowledge(engine, ids["booking"], by=uuid.uuid4(), at=ACKNOWLEDGED_AT)


def test_the_downgrade_drops_the_columns_and_the_check(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed_booking(engine)
    command.upgrade(config, AFTER)
    _acknowledge(engine, ids["booking"], by=ids["admin"], at=ACKNOWLEDGED_AT)

    command.downgrade(config, BEFORE)

    assert _columns(engine).isdisjoint(NEW_COLUMNS)
    assert PAIR_CONSTRAINT not in _check_constraints(engine)
