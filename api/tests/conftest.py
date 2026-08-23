import os
import threading
from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from redis.exceptions import RedisError
from sqlalchemy import create_engine, make_url, select, text
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
        # For the same reason: `excl_bookings_live_overlap` compares a UUID with `=` inside a
        # GiST index, which only `btree_gist` teaches PostgreSQL to do. Migration 0009 creates
        # the extension, and `create_all` will not, so the table would fail to create here.
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
    metadata.create_all(engine)
    _seed_login_rate_limit_settings(engine)

    yield engine

    engine.dispose()


def _seed_login_rate_limit_settings(engine: Engine) -> None:
    """Insert the `system_settings` rows migration 0011 seeds.

    `create_all` reproduces the schema and none of the data a migration writes, and `POST
    /auth/token` now reads these four on every request — without them every login test fails
    with `SettingNotFound`. Same reason the ENUMs and `btree_gist` are created by hand above:
    the harness has to stand in for whatever a migration did that isn't in the metadata.

    Committed rather than written through the rolled-back `db` fixture, because
    `session_per_request_api` opens its own sessions and would not see an uncommitted row.
    `ON CONFLICT DO NOTHING` keeps this idempotent — the test database outlives the run.
    """
    from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER
    from app.services.rate_limit_service import (
        EMAIL_MAX_ATTEMPTS_SETTING,
        EMAIL_WINDOW_SECONDS_SETTING,
        IP_MAX_ATTEMPTS_SETTING,
        IP_WINDOW_SECONDS_SETTING,
    )

    defaults = {
        IP_MAX_ATTEMPTS_SETTING: "20",
        IP_WINDOW_SECONDS_SETTING: "900",
        EMAIL_MAX_ATTEMPTS_SETTING: "5",
        EMAIL_WINDOW_SECONDS_SETTING: "900",
    }
    statement = text(
        "INSERT INTO system_settings (key, value, value_type, is_developer_only)"
        " VALUES (:key, :value, :value_type, false) ON CONFLICT (key) DO NOTHING"
    )
    with engine.begin() as connection:
        for key, value in defaults.items():
            connection.execute(
                statement,
                {"key": key, "value": value, "value_type": SETTING_VALUE_TYPE_INTEGER},
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
def api(db: Session, redis_double: "FakeRedis") -> Generator[TestClient, None, None]:
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
def redis_double() -> Generator["FakeRedis", None, None]:
    """A `FakeRedis` installed over `get_redis`, mirroring how `api` overrides `get_db`.

    Every route test gets one, not only the rate-limit ones: login now touches Redis on both
    the success and the failure path, and a shared live Redis would carry one test's failed
    attempts into the next one's budget. A per-test double makes that impossible instead of
    unlikely.
    """
    from app.main import app
    from app.redis_client import get_redis

    fake = FakeRedis()
    app.dependency_overrides[get_redis] = lambda: fake
    try:
        yield fake
    finally:
        del app.dependency_overrides[get_redis]


class FakeRedis:
    """The two operations `rate_limit_service` issues — the reservation script and ZREM — held
    in memory.

    A double rather than a live Redis or a new `fakeredis` dependency, because it is the only
    way to exercise the paths a healthy server will not produce on demand: `fail_with` makes
    every command raise, which is what proves the fail-open behaviour, and `advance` ages the
    recorded entries so the sliding window can be tested without a `sleep`.

    **It does not interpret Lua.** `register_script` recognises the one script this codebase
    has and reproduces its *effect* in Python, under a lock that also covers `execute()` — so
    the double serialises whole commands the way Redis's single-threaded command loop does, and
    a threaded test against it is measuring something real rather than passing by accident.
    That is deliberately not proof that the Lua itself is atomic; `test_auth_rate_limit.py`
    runs the same concurrency test against a live Redis for that, and skips if none is up.
    """

    def __init__(self) -> None:
        self.sorted_sets: dict[str, dict[str, float]] = {}
        self.expirations: dict[str, int] = {}
        self.fail_with: RedisError | None = None
        self.lock = threading.Lock()

    def register_script(self, script: str) -> "FakeReservationScript":
        # Imported here rather than at module scope for the same reason as `client`: importing
        # a service at collection time drags `app.db` in with it.
        from app.services.rate_limit_service import RESERVE_ATTEMPT_SCRIPT

        if script != RESERVE_ATTEMPT_SCRIPT:
            raise NotImplementedError("the double models only the login reservation script")

        # Real `register_script` sha1s the source locally and does no I/O, so it does not raise
        # even when the server is gone; only the call does. The double is wrong the same way.
        return FakeReservationScript(self)

    def pipeline(self) -> "FakePipeline":
        # Same reasoning: buffering is local, only `execute()` reaches the server.
        return FakePipeline(self)

    def advance(self, seconds: float) -> None:
        """Age every recorded entry, standing in for the wall clock moving forward."""
        for members in self.sorted_sets.values():
            for member in members:
                members[member] -= seconds

    def raise_if_failing(self) -> None:
        if self.fail_with is not None:
            raise self.fail_with

    def forget_if_empty(self, key: str) -> None:
        """Redis drops a sorted set the moment its last member goes; so does this."""
        if key in self.sorted_sets and not self.sorted_sets[key]:
            del self.sorted_sets[key]


class FakeReservationScript:
    """`RESERVE_ATTEMPT_SCRIPT`'s effect, applied with the store lock held throughout.

    Trim, count, and reserve have to be indivisible or the double would admit the concurrent
    overshoot the script exists to prevent — and a concurrency test written against a double
    that does not serialise proves nothing at all.
    """

    def __init__(self, store: FakeRedis) -> None:
        self._store = store

    def __call__(self, keys: list[str], args: list[object]) -> list[object]:
        self._store.raise_if_failing()
        key = keys[0]
        now, window, max_attempts, member = (
            float(args[0]),  # type: ignore[arg-type]
            int(args[1]),  # type: ignore[arg-type]
            int(args[2]),  # type: ignore[arg-type]
            str(args[3]),
        )

        with self._store.lock:
            members = self._store.sorted_sets.get(key, {})
            for stale in [held for held, score in members.items() if score <= now - window]:
                del members[stale]

            if len(members) >= max_attempts:
                # Redis renders a score as a bulk string; `repr` round-trips through `float`
                # the same way, which is all the service does with it.
                reply = [0, repr(min(members.values()))]
            else:
                members[member] = now
                self._store.sorted_sets[key] = members
                self._store.expirations[key] = window
                reply = [1, "0"]

            self._store.forget_if_empty(key)

        return reply


class FakePipeline:
    """Queues commands and applies them on `execute()`, as a MULTI/EXEC block does."""

    def __init__(self, store: FakeRedis) -> None:
        self._store = store
        self._queued: list[Callable[[], object]] = []

    def zrem(self, key: str, *members: str) -> "FakePipeline":
        return self._queue(lambda: self._zrem(key, members))

    def execute(self) -> list[object]:
        self._store.raise_if_failing()
        # Under the same lock the script takes: a release landing in the middle of a
        # reservation is something real Redis cannot do, so the double must not either.
        with self._store.lock:
            results = [command() for command in self._queued]
        self._queued.clear()

        return results

    def _queue(self, command: Callable[[], object]) -> "FakePipeline":
        self._queued.append(command)

        return self

    def _zrem(self, key: str, members: tuple[str, ...]) -> int:
        held = self._store.sorted_sets.get(key, {})
        removed = [member for member in members if held.pop(member, None) is not None]
        self._store.forget_if_empty(key)

        return len(removed)


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
