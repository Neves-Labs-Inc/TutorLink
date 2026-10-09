"""Migration 0030 against real rows: one record per person, up and down.

Built the way `test_migration_0029.py` builds its scratch database: migrated to 0029, seeded
with raw SQL, moved across 0030 both ways, and dropped whatever happens. The Alembic config is
built without `alembic.ini` for the reason that file gives.

The seed is the three shapes the old schema allowed: a Tutor with a login (`users.tutor_id`
set), a Tutor with no login at all, and a Manager with no profile.
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
BEFORE = "0029"
AFTER = "0030"
LINKED_TUTOR_NAME = "Linked Tutor"
LINKED_TUTOR_EMAIL = "linked@tutors.example.com"
LINKED_LOGIN_EMAIL = "linked@example.com"
UNLINKED_TUTOR_NAME = "Unlinked Tutor"
UNLINKED_TUTOR_EMAIL = "unlinked@example.com"
MANAGER_EMAIL = "manager@example.com"


@pytest.fixture
def scratch(monkeypatch: pytest.MonkeyPatch) -> Generator[tuple[Config, Engine], None, None]:
    """A fresh database at 0029, and the Alembic config pointed at it."""
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
    """A linked Tutor and its login, an unlinked Tutor, and a Manager."""
    ids = {name: uuid.uuid4() for name in ("linked", "unlinked", "login", "manager")}
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO tutors (id, name, phone_number, email, is_active) VALUES"
                " (:linked, :linked_name, '+12025550101', :linked_email, true),"
                " (:unlinked, :unlinked_name, '+12025550102', :unlinked_email, false)"
            ),
            {
                **ids,
                "linked_name": LINKED_TUTOR_NAME,
                "linked_email": LINKED_TUTOR_EMAIL,
                "unlinked_name": UNLINKED_TUTOR_NAME,
                "unlinked_email": UNLINKED_TUTOR_EMAIL,
            },
        )
        connection.execute(
            text(
                "INSERT INTO users"
                " (id, email, display_name, display_name_is_default, hashed_password, role,"
                " tutor_id) VALUES"
                " (:login, :login_email, 'Linked Login', false, 'x', 'tutor', :linked),"
                " (:manager, :manager_email, 'manager', true, 'x', 'manager', NULL)"
            ),
            {**ids, "login_email": LINKED_LOGIN_EMAIL, "manager_email": MANAGER_EMAIL},
        )

    return ids


def _add_second_login(engine: Engine, ids: dict[str, uuid.UUID]) -> uuid.UUID:
    second = uuid.uuid4()
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, display_name, hashed_password, role, tutor_id)"
                " VALUES (:second, 'second@example.com', 'Second', 'x', 'tutor', :linked)"
            ),
            {"second": second, "linked": ids["linked"]},
        )

    return second


def _columns(engine: Engine, table: str) -> set[str]:
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name = :table"),
            {"table": table},
        ).all()

    return {row.column_name for row in rows}


def _users(engine: Engine) -> dict[str, dict[str, object]]:
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT * FROM users")).mappings().all()

    return {str(row["email"]): dict(row) for row in rows}


def _tutors(engine: Engine) -> dict[uuid.UUID, dict[str, object]]:
    with engine.connect() as connection:
        rows = connection.execute(text("SELECT * FROM tutors")).mappings().all()

    return {row["id"]: dict(row) for row in rows}


def test_two_logins_on_one_tutor_abort_the_upgrade_naming_the_pair(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    second = _add_second_login(engine, ids)

    with pytest.raises(RuntimeError) as raised:
        command.upgrade(config, AFTER)

    message = str(raised.value)
    assert str(ids["linked"]) in message
    assert str(ids["login"]) in message
    assert str(second) in message
    # Nothing was written: the old columns stand and the new one never appeared.
    assert "display_name" in _columns(engine, "users")
    assert "user_id" not in _columns(engine, "tutors")
    assert len(_users(engine)) == 3


def test_the_upgrade_gives_every_tutor_a_user_and_drops_the_old_columns(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)

    command.upgrade(config, AFTER)

    users = _users(engine)
    tutors = _tutors(engine)
    created = users[UNLINKED_TUTOR_EMAIL]
    assert (created["role"], created["name"], created["name_is_default"]) == (
        "tutor",
        UNLINKED_TUTOR_NAME,
        False,
    )
    assert (created["hashed_password"], created["is_active"]) == (None, True)
    assert tutors[ids["unlinked"]]["user_id"] == created["id"]
    assert tutors[ids["linked"]]["user_id"] == ids["login"]
    assert users[LINKED_LOGIN_EMAIL]["name"] == "Linked Login"
    assert users[MANAGER_EMAIL]["name_is_default"] is True
    assert ids["manager"] not in {row["user_id"] for row in tutors.values()}
    assert (
        _columns(engine, "users") & {"display_name", "display_name_is_default", "tutor_id"} == set()
    )
    assert _columns(engine, "tutors") & {"name", "email"} == set()
    assert {"phone_number", "bio", "is_active"} <= _columns(engine, "tutors")


def test_the_downgrade_restores_the_old_shape_and_drops_password_less_users(
    scratch: tuple[Config, Engine],
) -> None:
    config, engine = scratch
    ids = _seed(engine)
    command.upgrade(config, AFTER)

    command.downgrade(config, BEFORE)

    users = _users(engine)
    tutors = _tutors(engine)
    assert set(users) == {LINKED_LOGIN_EMAIL, MANAGER_EMAIL}
    assert users[LINKED_LOGIN_EMAIL]["tutor_id"] == ids["linked"]
    assert users[LINKED_LOGIN_EMAIL]["display_name"] == "Linked Login"
    assert users[MANAGER_EMAIL]["display_name_is_default"] is True
    # Lossy by decision: the profile's name and email come back from the user that owned it.
    assert (tutors[ids["linked"]]["name"], tutors[ids["linked"]]["email"]) == (
        "Linked Login",
        LINKED_LOGIN_EMAIL,
    )
    assert (tutors[ids["unlinked"]]["name"], tutors[ids["unlinked"]]["email"]) == (
        UNLINKED_TUTOR_NAME,
        UNLINKED_TUTOR_EMAIL,
    )
    assert "user_id" not in _columns(engine, "tutors")
    # Usable at 0029 again: the old NOT NULLs and uniques hold, so 0030 can run once more.
    command.upgrade(config, AFTER)
