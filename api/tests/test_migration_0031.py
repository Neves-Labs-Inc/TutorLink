"""Migration 0031 against real rows: Staff as a user, kind, Location and availability mode,
up and down.

Built the way `test_migration_0029.py` builds its scratch database: migrated to 0030, seeded,
moved across 0031 both ways, and dropped whatever happens. The Alembic config is built without
`alembic.ini` for the reason that file gives.
"""

import datetime
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
BEFORE = "0030"
AFTER = "0031"
DATE = datetime.date(2026, 9, 7)
TEN = datetime.time(10, 0)
ELEVEN = datetime.time(11, 0)
TWELVE = datetime.time(12, 0)


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0030, and the Alembic config pointed at it."""
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
    """A Tutor with a user, an Admin, a Child at a home, a Subject, one range and one booking."""
    ids = {
        name: uuid.uuid4()
        for name in (
            "tutor_user",
            "tutor",
            "admin",
            "child",
            "subject",
            "home",
            "availability",
            "booking",
        )
    }
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, name, hashed_password, role) VALUES"
                " (:tutor_user, 'tutor@example.com', 'Tutor', NULL, 'tutor'),"
                " (:admin, 'admin@example.com', 'Admin', 'x', 'admin')"
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
                "INSERT INTO children (id, name, grade_level, school_name)"
                " VALUES (:child, 'Child', 7, 'School')"
            ),
            ids,
        )
        connection.execute(text("INSERT INTO subjects (id, name) VALUES (:subject, 'Maths')"), ids)
        connection.execute(
            text(
                "INSERT INTO homes (id, address, access_code)"
                " VALUES (:home, '1 Test Street', '0000')"
            ),
            ids,
        )
        connection.execute(
            text(
                "INSERT INTO tutor_availability"
                " (id, tutor_id, day_of_week, start_time, end_time)"
                " VALUES (:availability, :tutor, :day, '09:00', '12:00')"
            ),
            {**ids, "day": DATE.weekday()},
        )
        connection.execute(
            text(
                "INSERT INTO bookings (id, child_id, tutor_id, subject_id, availability_id,"
                " home_id, scheduled_date, start_time, end_time, status)"
                " VALUES (:booking, :child, :tutor, :subject, :availability, :home,"
                " :date, :start, :end, 'confirmed')"
            ),
            {**ids, "date": DATE, "start": TEN, "end": ELEVEN},
        )

    return ids


def _insert_after(
    engine: Engine,
    ids: dict[str, uuid.UUID],
    *,
    user: str,
    kind: str,
    location: str,
    start: datetime.time,
    end: datetime.time,
    status: str = "confirmed",
) -> uuid.UUID:
    """A booking in the 0031 shape: a Regular one names the Subject and slot, an Evaluation
    neither; a home Location names the home, the office none."""
    booking_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO bookings (id, child_id, user_id, kind, location, subject_id,"
                " availability_id, home_id, scheduled_date, start_time, end_time, status)"
                " VALUES (:id, :child, :user, :kind, :location, :subject, :availability,"
                " :home, :date, :start, :end, :status)"
            ),
            {
                "id": booking_id,
                "child": ids["child"],
                "user": ids[user],
                "kind": kind,
                "location": location,
                "subject": ids["subject"] if kind == "regular" else None,
                "availability": ids["availability"] if kind == "regular" else None,
                "home": ids["home"] if location == "home" else None,
                "date": DATE,
                "start": start,
                "end": end,
                "status": status,
            },
        )

    return booking_id


def _bookings(engine: Engine, columns: str) -> list[tuple[object, ...]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(f"SELECT {columns} FROM bookings ORDER BY start_time")  # noqa: S608
        ).all()

    return [tuple(row) for row in rows]


def _columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"),
            {"table": table},
        ).all()

    return {row.column_name for row in rows}


def test_the_upgrade_makes_every_booking_regular_at_a_home_with_its_tutor_as_staff(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    assert _bookings(engine, "user_id, kind, location, home_id, subject_id") == [
        (ids["tutor_user"], "regular", "home", ids["home"], ids["subject"])
    ]
    assert "tutor_id" not in _columns(engine, "bookings")


def test_the_upgrade_marks_every_existing_range_as_traveler(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    _seed(engine)

    command.upgrade(config, AFTER)

    with engine.connect() as connection:
        mode = connection.execute(text("SELECT mode FROM tutor_availability")).scalar_one()
    assert mode == "traveler"


def test_the_upgrade_refuses_two_live_bookings_of_one_user_whatever_their_kind(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)

    with pytest.raises(IntegrityError, match="excl_bookings_live_overlap"):
        _insert_after(
            engine,
            ids,
            user="tutor_user",
            kind="evaluation",
            location="in_office",
            start=datetime.time(10, 30),
            end=datetime.time(11, 30),
        )


def test_the_downgrade_drops_what_the_old_schema_cannot_hold_and_restores_tutor_id(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    _insert_after(
        engine,
        ids,
        user="admin",
        kind="evaluation",
        location="in_office",
        start=ELEVEN,
        end=TWELVE,
    )
    _insert_after(
        engine,
        ids,
        user="tutor_user",
        kind="regular",
        location="in_office",
        start=ELEVEN,
        end=TWELVE,
    )

    command.downgrade(config, BEFORE)

    assert _bookings(engine, "tutor_id, start_time") == [(ids["tutor"], TEN)]
    assert _columns(engine, "bookings").isdisjoint({"user_id", "kind", "location"})
    assert "mode" not in _columns(engine, "tutor_availability")
    # 0030 is usable again: a booking in its shape lands.
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO bookings (child_id, tutor_id, subject_id, availability_id,"
                " home_id, scheduled_date, start_time, end_time, status)"
                " VALUES (:child, :tutor, :subject, :availability, :home,"
                " :date, :start, :end, 'confirmed')"
            ),
            {**ids, "date": DATE, "start": ELEVEN, "end": TWELVE},
        )
    assert len(_bookings(engine, "id")) == 2
