"""Migration 0034 against a real database: the four email-template rows, up and down.

Built the way `test_migration_0033.py` builds its scratch database: migrated to 0033, moved
across 0034 both ways, and dropped whatever happens. The copy is asserted against literals from
the spec, so the seeded wording is checked against an independent source.
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
BEFORE = "0033"
AFTER = "0034"
KEY_PREFIX = "email_"
INVITE_BODY = (
    "Hi {name},\n"
    "\n"
    "{actor_name} has added you to TutorLink. To get started, choose your password using the"
    " link below:\n"
    "\n"
    "{link}\n"
    "\n"
    "This link works once and expires in 7 days. If it expires, ask {actor_name} to send you a"
    " new invite.\n"
    "\n"
    "See you soon,\n"
    "The TutorLink team"
)
RESET_BODY = (
    "Hi {name},\n"
    "\n"
    "We received a request to reset your TutorLink password. Choose a new one using the link"
    " below:\n"
    "\n"
    "{link}\n"
    "\n"
    "This link works once and expires in 48 hours. If you didn't ask for this, you can safely"
    " ignore this email and your password won't change.\n"
    "\n"
    "The TutorLink team"
)
EXPECTED_ROWS = {
    "email_invite_subject": "{actor_name} invited you to TutorLink",
    "email_invite_body": INVITE_BODY,
    "email_reset_subject": "Reset your TutorLink password",
    "email_reset_body": RESET_BODY,
}
# 0033's rows: the downgrade must leave other settings alone.
OTHER_KEY_PREFIX = "forgot_password_rate_limit_"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0033, and the Alembic config pointed at it."""
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


def test_the_upgrade_seeds_the_four_template_rows_with_the_default_copy(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    rows = _settings_with_prefix(engine, KEY_PREFIX)
    assert {key: value for key, (value, _type, _flag) in rows.items()} == EXPECTED_ROWS
    assert all(value_type == "string" for _value, value_type, _flag in rows.values())
    assert all(developer_only is False for _value, _type, developer_only in rows.values())


def test_the_downgrade_deletes_exactly_these_keys(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    command.upgrade(config, AFTER)
    other_rows_before = _settings_with_prefix(engine, OTHER_KEY_PREFIX)

    command.downgrade(config, BEFORE)

    assert _settings_with_prefix(engine, KEY_PREFIX) == {}
    assert _settings_with_prefix(engine, OTHER_KEY_PREFIX) == other_rows_before
    assert len(other_rows_before) == 4
