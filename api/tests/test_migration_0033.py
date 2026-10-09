"""Migration 0033 against a real database: the four forgot-password rate-limit rows, up and
down.

Built the way `test_migration_0032.py` builds its scratch database: migrated to 0032, moved
across 0033 both ways, and dropped whatever happens.
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
BEFORE = "0032"
AFTER = "0033"
KEY_PREFIX = "forgot_password_rate_limit_"
EXPECTED_ROWS = {
    "forgot_password_rate_limit_ip_max_attempts": "10",
    "forgot_password_rate_limit_ip_window_seconds": "900",
    "forgot_password_rate_limit_email_max_attempts": "3",
    "forgot_password_rate_limit_email_window_seconds": "3600",
}
# 0011's rows: the downgrade must leave the login limiter's settings alone.
LOGIN_KEY_PREFIX = "login_rate_limit_"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0032, and the Alembic config pointed at it."""
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


def _settings_with_prefix(engine: Engine, prefix: str) -> dict[str, tuple[str, str, bool]]:
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT key, value, value_type, is_developer_only FROM system_settings"
                " WHERE key LIKE :pattern"
            ),
            {"pattern": f"{prefix}%"},
        ).all()

    return {
        key: (value, value_type, developer_only) for key, value, value_type, developer_only in rows
    }


def test_the_upgrade_seeds_four_admin_tunable_integer_rows(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    rows = _settings_with_prefix(engine, KEY_PREFIX)
    assert {key: value for key, (value, _type, _flag) in rows.items()} == EXPECTED_ROWS
    assert all(value_type == "integer" for _value, value_type, _flag in rows.values())
    assert all(developer_only is False for _value, _type, developer_only in rows.values())


def test_the_downgrade_deletes_exactly_these_keys(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)
    login_rows_before = _settings_with_prefix(engine, LOGIN_KEY_PREFIX)

    command.downgrade(config, BEFORE)

    assert _settings_with_prefix(engine, KEY_PREFIX) == {}
    assert _settings_with_prefix(engine, LOGIN_KEY_PREFIX) == login_rows_before
    assert len(login_rows_before) == 4
