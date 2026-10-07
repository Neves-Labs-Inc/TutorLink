"""Migration 0028 against real rows: the consent-number backfill, and its downgrade.

The suite's own database is built from the models, not the migrations, so this test builds a
scratch database of its own, migrates it to 0027, seeds rows the way that schema stored them,
and moves it across 0028 both ways. The database is dropped whatever happens.

The Alembic config is built without `alembic.ini`, so its logging setup never runs: it would
disable the app's loggers for every later test that reads them.
"""

import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.engine import Engine

from app.config import get_settings

API_ROOT = Path(__file__).resolve().parent.parent
BEFORE = "0027"
AFTER = "0028"
FIRST_NUMBER = "+12025550101"
SECOND_NUMBER = "+13125550102"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0027, and the Alembic config pointed at it."""
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
    """Two Guardians; the first with a row of every source, the second with an intake row."""
    ids = {name: uuid.uuid4() for name in ("staff", "first", "second")}
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, display_name, hashed_password, role)"
                " VALUES (:id, 'staff@example.com', 'Staff', 'x', 'admin')"
            ),
            {"id": ids["staff"]},
        )
        connection.execute(
            text(
                "INSERT INTO guardians (id, name, phone_number)"
                " VALUES (:first, 'First', :first_number), (:second, 'Second', :second_number)"
            ),
            {
                "first": ids["first"],
                "second": ids["second"],
                "first_number": FIRST_NUMBER,
                "second_number": SECOND_NUMBER,
            },
        )
        connection.execute(
            text(
                "INSERT INTO reminder_consents (guardian_id, action, source, set_by_user_id)"
                " VALUES (:first, 'opt_in', 'intake', NULL),"
                " (:first, 'opt_out', 'system', NULL),"
                " (:first, 'opt_in', 'message', NULL),"
                " (:first, 'opt_out', 'staff', :staff),"
                " (:second, 'opt_in', 'intake', NULL)"
            ),
            ids,
        )

    return ids


def _numbers(engine: Engine) -> set[tuple[uuid.UUID, str, str | None]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT guardian_id, source, phone_number FROM reminder_consents")
        ).all()

    return {(row.guardian_id, row.source, row.phone_number) for row in rows}


def _has_phone_column(engine: Engine) -> bool:
    with engine.connect() as connection:
        found = connection.execute(
            text(
                "SELECT 1 FROM information_schema.columns"
                " WHERE table_name = 'reminder_consents' AND column_name = 'phone_number'"
            )
        ).first()

    return found is not None


def test_the_upgrade_gives_non_staff_rows_their_guardians_number_and_staff_rows_none(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    assert _numbers(engine) == {
        (ids["first"], "intake", FIRST_NUMBER),
        (ids["first"], "system", FIRST_NUMBER),
        (ids["first"], "message", FIRST_NUMBER),
        (ids["first"], "staff", None),
        (ids["second"], "intake", SECOND_NUMBER),
    }


def test_the_downgrade_relabels_blocked_by_whatsapp_skips_as_takeover_and_drops_the_column(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO booking_reminders"
                " (guardian_id, week_start, language, child_ids, status, skip_reason)"
                " VALUES (:first, '2026-10-12', 'en', '{}', 'skipped', 'blocked_by_whatsapp')"
            ),
            ids,
        )

    command.downgrade(config, BEFORE)

    with engine.connect() as connection:
        reasons = connection.execute(text("SELECT skip_reason FROM booking_reminders")).all()
    assert [row.skip_reason for row in reasons] == ["takeover"]
    assert _has_phone_column(engine) is False
