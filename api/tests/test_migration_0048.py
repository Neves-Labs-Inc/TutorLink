"""Migration 0048: `didnt_happen` on `booking_status` and `reply_window_closed` on `flag_reason`,
up and down.

Built the way `test_migration_0047.py` builds its scratch database: migrated to 0047, moved
across 0048 both ways, and dropped whatever happens.
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
BEFORE = "0047"
AFTER = "0048"
OVERLAP_CONSTRAINT = "excl_bookings_live_overlap"
ONE_LIVE_EVALUATION_INDEX = "uq_bookings_one_live_evaluation_per_child"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0047, and the Alembic config pointed at it."""
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


def _scalar(engine: Engine, statement: str, values: dict[str, object]) -> object:
    with engine.connect() as connection:
        return connection.execute(text(statement), values).scalar_one()


def _enum_values(engine: Engine, type_name: str) -> list[str]:
    with engine.connect() as connection:
        rows = connection.execute(text(f"SELECT unnest(enum_range(NULL::{type_name}))::text")).all()
    return [value for (value,) in rows]


def _seed_people(engine: Engine) -> dict[str, uuid.UUID]:
    """A Tutor and a Child: the fewest rows a Booking needs."""
    ids = {name: uuid.uuid4() for name in ("tutor", "child")}
    _execute(
        engine,
        "INSERT INTO users (id, email, name, role)"
        " VALUES (:tutor, 'tutor@example.com', 'Tutor', 'tutor')",
        dict(ids),
    )
    _execute(
        engine,
        "INSERT INTO children (id, name, grade_level, school_name)"
        " VALUES (:child, 'Child', 7, 'Test School')",
        dict(ids),
    )
    return ids


def _insert_evaluation(
    engine: Engine, ids: dict[str, uuid.UUID], status: str, start: str = "10:00"
) -> uuid.UUID:
    booking_id = uuid.uuid4()
    _execute(
        engine,
        "INSERT INTO bookings (id, child_id, user_id, kind, location, scheduled_date,"
        " start_time, end_time, status)"
        " VALUES (:id, :child, :tutor, 'evaluation', 'in_office', '2026-11-02',"
        " CAST(:start AS time), CAST(:start AS time) + interval '1 hour', :status)",
        {**ids, "id": booking_id, "start": start, "status": status},
    )
    return booking_id


def _insert_conversation(
    engine: Engine, flag_reason: str, reactivation_child_id: uuid.UUID | None = None
) -> uuid.UUID:
    conversation_id = uuid.uuid4()
    _execute(
        engine,
        "INSERT INTO conversations (id, phone_number, flag_reason, flagged_at,"
        " reactivation_child_id)"
        " VALUES (:id, :phone, :flag_reason, now(), :child)",
        {
            "id": conversation_id,
            "phone": f"+1555{uuid.uuid4().int % 10_000_000:07d}",
            "flag_reason": flag_reason,
            "child": reactivation_child_id,
        },
    )
    return conversation_id


def _flag(engine: Engine, conversation_id: uuid.UUID) -> tuple[object, object]:
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT flag_reason::text, flagged_at FROM conversations WHERE id = :id"),
            {"id": conversation_id},
        ).one()
    return row[0], row[1]


def test_the_upgrade_adds_both_values(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    assert _enum_values(engine, "booking_status") == [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "didnt_happen",
    ]
    assert _enum_values(engine, "flag_reason")[-1] == "reply_window_closed"


def test_a_booking_and_a_flag_can_carry_the_new_values(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed_people(engine)

    command.upgrade(config, AFTER)
    booking_id = _insert_evaluation(engine, ids, "didnt_happen")
    conversation_id = _insert_conversation(engine, "reply_window_closed")

    status = _scalar(engine, "SELECT status::text FROM bookings WHERE id = :id", {"id": booking_id})
    assert status == "didnt_happen"
    assert _flag(engine, conversation_id)[0] == "reply_window_closed"


def test_the_downgrade_turns_didnt_happen_into_cancelled(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed_people(engine)
    command.upgrade(config, AFTER)
    booking_id = _insert_evaluation(engine, ids, "didnt_happen")

    command.downgrade(config, BEFORE)

    status = _scalar(engine, "SELECT status::text FROM bookings WHERE id = :id", {"id": booking_id})
    assert status == "cancelled"
    assert "didnt_happen" not in _enum_values(engine, "booking_status")


def test_the_downgrade_keeps_the_live_booking_guarantees(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    ids = _seed_people(engine)
    command.upgrade(config, AFTER)
    command.downgrade(config, BEFORE)
    _insert_evaluation(engine, ids, "confirmed", start="10:00")

    with pytest.raises(IntegrityError, match=OVERLAP_CONSTRAINT):
        _insert_evaluation(engine, ids, "pending", start="10:30")
    with pytest.raises(IntegrityError, match=ONE_LIVE_EVALUATION_INDEX):
        _insert_evaluation(engine, ids, "pending", start="14:00")
    # Not live: neither guarantee reaches it.
    _insert_evaluation(engine, ids, "cancelled", start="10:30")


def test_the_downgrade_clears_a_reply_window_flag(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)
    conversation_id = _insert_conversation(engine, "reply_window_closed")
    other_id = _insert_conversation(engine, "stuck")

    command.downgrade(config, BEFORE)

    assert _flag(engine, conversation_id) == (None, None)
    assert _flag(engine, other_id)[0] == "stuck"
    assert "reply_window_closed" not in _enum_values(engine, "flag_reason")


def test_the_downgrade_falls_back_to_a_pending_reactivation_request(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed_people(engine)
    command.upgrade(config, AFTER)
    conversation_id = _insert_conversation(engine, "reply_window_closed", ids["child"])

    command.downgrade(config, BEFORE)

    reason, flagged_at = _flag(engine, conversation_id)
    assert reason == "reactivation_request"
    assert flagged_at is not None
