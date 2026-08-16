import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production-use")


@pytest.fixture
def client() -> TestClient:
    # Imported lazily: app.db builds the engine at import time and needs the environment above.
    from app.main import app

    return TestClient(app)


@pytest.fixture(scope="session")
def _test_engine() -> Generator[Engine, None, None]:
    """An `Engine` bound to a dedicated `<database>_test`, created on first use.

    Session-scoped, so it is only built when a test actually asks for it: the pure-unit
    modules still collect and run with no PostgreSQL anywhere. Application imports are
    deferred into the fixture body for the same reason.
    """
    from app.config import get_settings
    from app.models import metadata
    from app.models.enums import booking_status_enum, exception_status_enum, user_role_enum

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

    engine = create_engine(test_url, pool_pre_ping=True)
    with engine.begin() as connection:
        # The shared ENUM objects carry `create_type=False`, so `create_all` will not emit
        # them; migration 0001 creates them by hand and the harness has to do the same.
        user_role_enum.create(connection, checkfirst=True)
        booking_status_enum.create(connection, checkfirst=True)
        exception_status_enum.create(connection, checkfirst=True)
    metadata.create_all(engine)

    yield engine

    engine.dispose()


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
