"""Migration 0029 against real rows: the `number_change_note` system kind, up and down.

Built the way `test_migration_0028.py` builds its scratch database: migrated to 0028, seeded,
moved across 0029 both ways, and dropped whatever happens. The Alembic config is built without
`alembic.ini` for the reason that file gives.
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
BEFORE = "0028"
AFTER = "0029"
NUMBER = "+12025550101"
NOTE_BODY = "Number changed from +12025550100 to +12025550101 by Staff"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0028, and the Alembic config pointed at it."""
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
    """A Staff member and a thread carrying one consent notice."""
    ids = {name: uuid.uuid4() for name in ("staff", "conversation")}
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, display_name, hashed_password, role)"
                " VALUES (:staff, 'staff@example.com', 'Staff', 'x', 'admin')"
            ),
            ids,
        )
        connection.execute(
            text(
                "INSERT INTO conversations (id, phone_number, last_message_at)"
                " VALUES (:conversation, :number, now())"
            ),
            {**ids, "number": NUMBER},
        )
        connection.execute(
            text(
                "INSERT INTO messages (conversation_id, author_kind, body, status, system_kind)"
                " VALUES (:conversation, 'system', 'Opted in', 'sent', 'consent_notice')"
            ),
            ids,
        )

    return ids


def _add_note(engine: Engine, ids: dict[str, uuid.UUID]) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO messages"
                " (conversation_id, author_kind, author_user_id, body, status, system_kind)"
                " VALUES (:conversation, 'system', :staff, :body, 'sent', 'number_change_note')"
            ),
            {**ids, "body": NOTE_BODY},
        )


def _kinds(engine: Engine) -> list[str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT system_kind FROM messages ORDER BY system_kind")
        ).all()

    return [row.system_kind for row in rows]


def test_a_number_change_note_is_refused_before_the_upgrade(
    scratch: tuple[Config, Engine],
) -> None:
    _config, engine = scratch
    ids = _seed(engine)

    with pytest.raises(IntegrityError, match="ck_messages_system_kind"):
        _add_note(engine, ids)


def test_the_upgrade_accepts_a_number_change_note_and_keeps_existing_lines(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)
    _add_note(engine, ids)

    assert _kinds(engine) == ["consent_notice", "number_change_note"]


def test_the_downgrade_deletes_number_change_notes_and_narrows_the_check_again(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)
    _add_note(engine, ids)

    command.downgrade(config, BEFORE)

    assert _kinds(engine) == ["consent_notice"]
    with pytest.raises(IntegrityError, match="ck_messages_system_kind"):
        _add_note(engine, ids)
