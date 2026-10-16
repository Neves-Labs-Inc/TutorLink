"""Migration 0051 against a real database: one brand colour per email, up and down.

Built the way `test_migration_0050.py` builds its scratch database: migrated to 0050, moved
across 0051 both ways, and dropped whatever happens.
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
BEFORE = "0050"
AFTER = "0051"
SHARED_COLOR = "email_brand_color"
INVITE_COLOR = "email_invite_brand_color"
RESET_COLOR = "email_reset_brand_color"
# 0034's rows: neither direction may touch the other email settings.
TEMPLATE_KEYS = (
    "email_invite_subject",
    "email_invite_body",
    "email_reset_subject",
    "email_reset_body",
)

Row = tuple[str, str, bool]


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0050, and the Alembic config pointed at it."""
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


def _setting(engine: Engine, key: str) -> Row | None:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT value, value_type, is_developer_only FROM system_settings WHERE key = :key"
            ),
            {"key": key},
        ).one_or_none()

    return None if row is None else (row.value, row.value_type, row.is_developer_only)


def _template_rows(engine: Engine) -> dict[str, Row | None]:
    return {key: _setting(engine, key) for key in TEMPLATE_KEYS}


def _set_value(engine: Engine, key: str, value: str, *, is_developer_only: bool = False) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE system_settings SET value = :value, is_developer_only = :flag"
                " WHERE key = :key"
            ),
            {"key": key, "value": value, "flag": is_developer_only},
        )


def test_the_upgrade_gives_both_emails_the_default_colour(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch

    command.upgrade(config, AFTER)

    assert _setting(engine, INVITE_COLOR) == ("#74C8C9", "string", False)
    assert _setting(engine, RESET_COLOR) == ("#74C8C9", "string", False)
    assert _setting(engine, SHARED_COLOR) is None


def test_the_upgrade_copies_a_saved_colour_and_its_flags(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    _set_value(engine, SHARED_COLOR, "#0B6E4F", is_developer_only=True)
    templates_before = _template_rows(engine)

    command.upgrade(config, AFTER)

    assert _setting(engine, INVITE_COLOR) == ("#0B6E4F", "string", True)
    assert _setting(engine, RESET_COLOR) == ("#0B6E4F", "string", True)
    assert _setting(engine, SHARED_COLOR) is None
    assert _template_rows(engine) == templates_before


def test_the_downgrade_restores_the_shared_colour_from_the_invite(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    templates_before = _template_rows(engine)
    command.upgrade(config, AFTER)
    _set_value(engine, INVITE_COLOR, "#111111")
    _set_value(engine, RESET_COLOR, "#222222")

    command.downgrade(config, BEFORE)

    assert _setting(engine, SHARED_COLOR) == ("#111111", "string", False)
    assert _setting(engine, INVITE_COLOR) is None
    assert _setting(engine, RESET_COLOR) is None
    assert _template_rows(engine) == templates_before
