import datetime
import functools
import os
from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

# Imported, not `pytest_plugins`: only the rootdir conftest may declare plugins.
from tests.fake_twilio import fake_twilio  # noqa: F401

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production-use")
os.environ.setdefault("COOKIE_SECURE", "false")


@pytest.fixture
def client() -> TestClient:
    # Imported lazily: app.db builds the engine at import time and needs the environment above.
    from app.main import app

    return TestClient(app)


def pytest_sessionstart(session: pytest.Session) -> None:
    """Point the business clock's own session at `<db>_test`, before any module is collected.

    `clock.business_now` reads the zone from `system_settings` through `clock.SessionLocal`,
    which is bound to the application database the harness never builds. Some test modules
    read the clock at import time (`test_slot_routes.DATE`), so a per-test fixture is too late.
    The engine is still built lazily: a run that never reads the clock never needs PostgreSQL.
    """
    from app.services import clock

    clock.SessionLocal = lambda: Session(bind=_get_test_engine())


@pytest.fixture(scope="session")
def _test_engine() -> Generator[Engine, None, None]:
    """An `Engine` bound to a dedicated `<database>_test`, created on first use.

    Session-scoped, so it is only built when a test actually asks for it: the pure-unit
    modules still collect and run with no PostgreSQL anywhere.
    """
    engine = _get_test_engine()

    yield engine

    engine.dispose()


@functools.cache
def _get_test_engine() -> Engine:
    """Build `<database>_test` once per run; shared by `_test_engine` and the business clock.

    Application imports are deferred into the body so importing this module needs no database.
    """
    from app.config import get_settings
    from app.models import metadata
    from app.models.enums import (
        booking_status_enum,
        conversation_status_enum,
        exception_status_enum,
        flag_reason_enum,
        message_author_enum,
        message_status_enum,
        user_role_enum,
    )

    url = make_url(get_settings().database_url)
    test_url = url.set(database=f"{url.database}_test")

    admin_engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            exists = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": test_url.database},
            ).scalar()
            if not exists:
                try:
                    connection.execute(text(f'CREATE DATABASE "{test_url.database}"'))
                except ProgrammingError:
                    # Another pytest process created it between the check and the CREATE.
                    pass
    finally:
        admin_engine.dispose()

    # `hide_parameters` as in `app.db`, so no test can come to rely on parameters in error text.
    engine = create_engine(test_url, pool_pre_ping=True, hide_parameters=True)
    with engine.begin() as connection:
        # The shared ENUM objects carry `create_type=False`, so `create_all` will not emit
        # them; migration 0001 creates them by hand and the harness has to do the same.
        # `checkfirst` skips a type that exists, so a test database built before a new value
        # (0022's `manager`, 0023's `system`) lacks it: drop `<db>_test` after such a migration.
        user_role_enum.create(connection, checkfirst=True)
        booking_status_enum.create(connection, checkfirst=True)
        exception_status_enum.create(connection, checkfirst=True)
        conversation_status_enum.create(connection, checkfirst=True)
        message_author_enum.create(connection, checkfirst=True)
        message_status_enum.create(connection, checkfirst=True)
        flag_reason_enum.create(connection, checkfirst=True)
        # For the same reason: `excl_bookings_live_overlap` compares a UUID with `=` inside a
        # GiST index, which only `btree_gist` teaches PostgreSQL to do. Migration 0009 creates
        # the extension, and `create_all` will not, so the table would fail to create here.
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
    metadata.create_all(engine)
    _seed_login_rate_limit_settings(engine)

    return engine


def _seed_login_rate_limit_settings(engine: Engine) -> None:
    """Insert the `system_settings` rows migrations 0004, 0011-0014, 0018, 0021 and 0025 seed.

    `create_all` reproduces the schema and none of the data a migration writes, and `POST
    /auth/token` now reads the four rate-limit rows on every request — without them every login
    test fails with `SettingNotFound`. The same holds for `default_phone_country_code` (0012),
    which every client and tutor write path reads through `phone_service`, for the five
    scheduling rows (0004 and 0013), which `scheduling_service.load_scheduling_settings` reads on
    every slot query and every booking write, and for `retention_purge_hour_utc` (0018), which
    `retention_scheduler` reads on every scheduling pass. Same reason the ENUMs and `btree_gist`
    are created by hand above: the harness has to stand in for whatever a migration did that
    isn't in the metadata.

    Committed rather than written through the rolled-back `db` fixture, because
    `session_per_request_api` opens its own sessions and would not see an uncommitted row.
    `ON CONFLICT DO NOTHING` keeps this idempotent — the test database outlives the run.

    0021's rows are listed with their own type and visibility, because the template ids are
    developer-only strings and the settings screens tell the two apart.
    """
    from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SETTING_VALUE_TYPE_STRING
    from app.services.phone_service import DEFAULT_COUNTRY_CODE_SETTING
    from app.services.rate_limit_service import (
        EMAIL_MAX_ATTEMPTS_SETTING,
        EMAIL_WINDOW_SECONDS_SETTING,
        IP_MAX_ATTEMPTS_SETTING,
        IP_WINDOW_SECONDS_SETTING,
    )
    from app.services.retention_scheduler import RETENTION_PURGE_HOUR_SETTING
    from app.services.retention_service import CHAT_RETENTION_DAYS_SETTING
    from app.services.scheduling_service import (
        BOOKING_LOOKAHEAD_SETTING,
        MAX_SLOTS_OFFERED_SETTING,
        MIN_BOOKING_LEAD_SETTING,
        SESSION_GAP_SETTING,
        SESSION_LENGTH_SETTING,
    )

    defaults = {
        IP_MAX_ATTEMPTS_SETTING: "20",
        IP_WINDOW_SECONDS_SETTING: "900",
        EMAIL_MAX_ATTEMPTS_SETTING: "5",
        EMAIL_WINDOW_SECONDS_SETTING: "900",
        DEFAULT_COUNTRY_CODE_SETTING: "1",
        SESSION_LENGTH_SETTING: "60",
        SESSION_GAP_SETTING: "30",
        BOOKING_LOOKAHEAD_SETTING: "90",
        MIN_BOOKING_LEAD_SETTING: "0",
        MAX_SLOTS_OFFERED_SETTING: "5",
        CHAT_RETENTION_DAYS_SETTING: "365",
        RETENTION_PURGE_HOUR_SETTING: "3",
    }
    rows = [(key, value, SETTING_VALUE_TYPE_INTEGER, False) for key, value in defaults.items()]
    rows += [
        ("reminder_weekday", "7", SETTING_VALUE_TYPE_INTEGER, False),
        ("reminder_hour", "18", SETTING_VALUE_TYPE_INTEGER, False),
        ("business_timezone", "America/New_York", SETTING_VALUE_TYPE_STRING, False),
        ("reminder_template_sid_en", "", SETTING_VALUE_TYPE_STRING, True),
        ("reminder_template_sid_es", "", SETTING_VALUE_TYPE_STRING, True),
    ]
    statement = text(
        "INSERT INTO system_settings (key, value, value_type, is_developer_only)"
        " VALUES (:key, :value, :value_type, :is_developer_only) ON CONFLICT (key) DO NOTHING"
    )
    with engine.begin() as connection:
        for key, value, value_type, is_developer_only in rows:
            connection.execute(
                statement,
                {
                    "key": key,
                    "value": value,
                    "value_type": value_type,
                    "is_developer_only": is_developer_only,
                },
            )


@pytest.fixture
def db(_test_engine: Engine) -> Generator[Session, None, None]:
    """A `Session` inside a transaction that is rolled back when the test ends.

    `join_transaction_mode="create_savepoint"` turns a `session.commit()` made by the code
    under test into a savepoint release, so service code that commits is still undone by the
    outer rollback and no test can leak a row into the next one.
    """
    connection = _test_engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def api(db: Session) -> Generator[TestClient, None, None]:
    """A `TestClient` whose request handlers run against the rolled-back `db` session."""
    # Imported lazily for the same reason as `client`.
    from app.db import get_db
    from app.main import app

    def override_get_db() -> Generator[Session, None, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        del app.dependency_overrides[get_db]


@pytest.fixture
def set_int_setting(db: Session) -> Callable[[str, int], None]:
    """Rewrite a `system_settings` value for the duration of one test.

    Written through the `db` session so the change is rolled back with everything else, and so
    the request handler under test reads it back — which is also what proves the limiter reads
    its thresholds at request time rather than caching them at import.
    """
    from app.models.system_setting import SystemSetting

    def rewrite(key: str, value: int) -> None:
        row = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one()
        row.value = str(value)
        db.flush()

    return rewrite


@pytest.fixture(autouse=True)
def _business_zone_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    """Start every test with an empty business-zone cache.

    The cache is process-level, so a test that writes `business_timezone` would otherwise leak
    its zone into the next one.
    """
    from app.services import clock

    monkeypatch.setattr(clock, "_cached_zone", None)


@pytest.fixture
def freeze_business_clock(monkeypatch: pytest.MonkeyPatch) -> Callable[[datetime.datetime], None]:
    """Freeze `clock.business_now`, the one scheduling clock read; `business_today` follows it."""
    from app.services import clock

    def freeze(now: datetime.datetime) -> None:
        monkeypatch.setattr(clock, "business_now", lambda: now)

    return freeze


# The two DST Sundays the reminder scheduler must survive, as naive New York wall-clock values
# (the form `business_now` returns). 2027-03-14 02:00 never happens on a real clock: New York
# jumps from 01:59 to 03:00, which is exactly the case a 2 AM reminder hour has to handle.
FALL_BACK_SUNDAY_6PM = datetime.datetime(2026, 11, 1, 18, 0)
SPRING_FORWARD_SUNDAY_6PM = datetime.datetime(2027, 3, 14, 18, 0)
SPRING_FORWARD_SUNDAY_2AM = datetime.datetime(2027, 3, 14, 2, 0)


@pytest.fixture
def fall_back_sunday_6pm(
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> datetime.datetime:
    """Freeze the business clock at 18:00 on Sunday 2026-11-01, the day New York falls back."""
    freeze_business_clock(FALL_BACK_SUNDAY_6PM)

    return FALL_BACK_SUNDAY_6PM


@pytest.fixture
def spring_forward_sunday_6pm(
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> datetime.datetime:
    """Freeze the business clock at 18:00 on Sunday 2027-03-14, the day New York springs forward."""
    freeze_business_clock(SPRING_FORWARD_SUNDAY_6PM)

    return SPRING_FORWARD_SUNDAY_6PM


@pytest.fixture
def spring_forward_sunday_2am(
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> datetime.datetime:
    """Freeze the business clock at the 02:00 that 2027-03-14 skips in New York."""
    freeze_business_clock(SPRING_FORWARD_SUNDAY_2AM)

    return SPRING_FORWARD_SUNDAY_2AM


@pytest.fixture
def business_evening(
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> datetime.datetime:
    """Freeze the business clock at 22:00 on Monday 2026-09-28 in New York.

    UTC has already reached Tuesday the 29th by then, so a consumer still reading a UTC "today"
    disagrees with the business date by a whole day.
    """
    from zoneinfo import ZoneInfo

    from app.services.clock import to_business_wall_clock

    utc_instant = datetime.datetime(2026, 9, 29, 2, 0, tzinfo=datetime.UTC)
    now = to_business_wall_clock(utc_instant, ZoneInfo("America/New_York"))
    freeze_business_clock(now)

    return now
