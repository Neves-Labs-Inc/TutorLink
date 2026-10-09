"""Migration 0032 against a real database: the `password_links` table, up and down.

Built the way `test_migration_0029.py` builds its scratch database: migrated to 0031, moved
across 0032 both ways, and dropped whatever happens.
"""

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
BEFORE = "0031"
AFTER = "0032"
TABLE = "password_links"
TOKEN_HASH = "a" * 64


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0031, and the Alembic config pointed at it."""
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


def _seed_user(engine: Engine) -> uuid.UUID:
    user_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, name, hashed_password, role)"
                " VALUES (:id, 'staff@example.com', 'Staff', NULL, 'admin')"
            ),
            {"id": user_id},
        )

    return user_id


def _add_link(engine: Engine, *, user_id: uuid.UUID, purpose: str, token_hash: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                f"INSERT INTO {TABLE} (user_id, purpose, token_hash, email, expires_at)"
                " VALUES (:user_id, :purpose, :token_hash, 'staff@example.com', now())"
            ),
            {"user_id": user_id, "purpose": purpose, "token_hash": token_hash},
        )


def _table_names(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def test_the_upgrade_creates_the_table_with_its_check_and_index(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    user_id = _seed_user(engine)

    command.upgrade(config, AFTER)

    assert TABLE in _table_names(engine)
    _add_link(engine, user_id=user_id, purpose="invite", token_hash=TOKEN_HASH)
    with pytest.raises(IntegrityError, match="ck_password_links_purpose"):
        _add_link(engine, user_id=user_id, purpose="magic", token_hash="b" * 64)
    with pytest.raises(IntegrityError, match="token_hash"):
        _add_link(engine, user_id=user_id, purpose="reset", token_hash=TOKEN_HASH)
    index_names = {index["name"] for index in inspect(engine).get_indexes(TABLE)}
    assert "ix_password_links_user_id_purpose" in index_names


def test_the_downgrade_drops_the_table(scratch: tuple[Config, Engine]) -> None:
    config, engine = scratch
    user_id = _seed_user(engine)
    command.upgrade(config, AFTER)
    _add_link(engine, user_id=user_id, purpose="invite", token_hash=TOKEN_HASH)

    command.downgrade(config, BEFORE)

    assert TABLE not in _table_names(engine)
