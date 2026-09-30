"""Brute-force throttling on `POST /auth/token`, exercised over HTTP — #3 (OQ-7).

Driven through the route rather than against `rate_limit_service` directly, because most of
what can go wrong here is wiring: checking the limit after the bcrypt round instead of before
it, counting successes as well as failures, clearing the wrong bucket on a successful login,
or leaking which limit tripped. None of those are visible from inside the service.

Every test rewrites its thresholds through `set_int_setting` rather than accepting the seeded
20/5. Small numbers keep the bcrypt rounds down, and reading a rewritten row back is also what
proves the limiter reads `system_settings` per request instead of caching it. The buckets are
observed as `login_attempts` rows read back through the same rolled-back `db` session the
route wrote them in, and time is moved by replacing `rate_limit_service._now` — the one read of
the database's clock per reservation — rather than by sleeping.

The buckets are isolated by turning the *other* one off with a `max_attempts` of 0, so a test
named for one bucket cannot pass because the other one refused the request.

Three tests here are not like the others and should not be folded in.
`test_concurrent_attempts_never_exceed_the_configured_maximum` and its lockless twin call the
service directly under threads, each thread on its own committed session, because the property
they assert is invisible to any sequential test and the `api` fixture's single rolled-back
`Session` can neither be driven from several threads nor contend for a lock with itself.
`test_a_throttled_request_never_reaches_the_password_hash` is what pins the ordering that makes
the reservation worth anything.

The two lock-order tests also call the service directly, on the rolled-back `db`, and record
the hashes it locks. A deadlock between two requests is as nondeterministic to provoke as the
overshoot above, but it has only one cause — two requests locking the same values in different
orders — and that is deterministic to observe.
"""

import threading
import uuid
from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.models.enums import UserRole
from app.models.login_attempt import LoginAttempt
from app.models.user import User
from app.routers.auth import RATE_LIMITED_ERROR
from app.security import hash_password
from app.services import auth_service, rate_limit_service
from app.services.rate_limit_service import (
    EMAIL_BUCKET_PREFIX,
    EMAIL_MAX_ATTEMPTS_SETTING,
    EMAIL_WINDOW_SECONDS_SETTING,
    IP_BUCKET_PREFIX,
    IP_MAX_ATTEMPTS_SETTING,
    IP_WINDOW_SECONDS_SETTING,
    LoginRateLimitPolicies,
    RateLimitPolicy,
    reserve_login_attempt,
)

EMAIL = "admin@example.com"
PASSWORD = "correct horse battery staple"
WRONG_PASSWORD = "not the password"

# Wider than the limit by enough that a read-then-write-later limiter admits visibly too many.
CONCURRENT_CALLERS = 32
CONCURRENT_MAX_ATTEMPTS = 5
BARRIER_TIMEOUT_SECONDS = 10

# Each pair's email and IP bucket keys share a `hashtext` value on PostgreSQL 17 (little-endian),
# found by searching generated keys. The tests assert the collision before relying on it.
FIRST_COLLISION = ("u22250@example.com", "10.0.199.46")
SECOND_COLLISION = ("u42311@example.com", "10.3.12.26")

BOTH_ARMED = LoginRateLimitPolicies(
    ip=RateLimitPolicy(max_attempts=5, window_seconds=60),
    email=RateLimitPolicy(max_attempts=5, window_seconds=60),
)

SetIntSetting = Callable[[str, int], None]
ClientFrom = Callable[[str], TestClient]


class Clock:
    """Stands in for `rate_limit_service._now`, so the window can slide without a `sleep`.

    `read` takes the session only because the real `_now` reads the database's clock through it.
    """

    def __init__(self) -> None:
        self.now = datetime.now(UTC)

    def read(self, db: Session) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


def test_the_ip_bucket_refuses_the_attempt_after_its_configured_count(
    client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 3)
    caller = client_from("203.0.113.10")

    # A different address each time, so no email bucket reaches its own limit of five and the
    # IP bucket is unambiguously what refuses the fourth attempt.
    codes = [_login(caller, email=f"nobody-{n}@example.com").status_code for n in range(4)]

    assert codes == [401, 401, 401, 429]


def test_the_email_bucket_refuses_the_attempt_independently_of_the_ip_bucket(
    client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    caller = client_from("203.0.113.11")

    codes = [_login(caller).status_code for _attempt in range(3)]
    # The same address, a different account: the per-IP limit is untouched at 20, so a throttled
    # account must not throttle the network it was tried from.
    other_account = _login(caller, email="someone-else@example.com")

    assert codes == [401, 401, 429]
    assert other_account.status_code == 401


def test_a_successful_login_gives_back_only_its_own_slot(
    db: Session, client_from: ClientFrom
) -> None:
    _make_user(db)
    caller = client_from("203.0.113.12")
    _login(caller)

    success = _login(caller, password=PASSWORD)

    assert success.status_code == 200
    # One real failure went in and one real failure remains, in both buckets. A successful
    # login costs nothing, and — the part that matters — clears nothing it did not put there.
    assert _bucket_size(db, EMAIL_BUCKET_PREFIX + EMAIL) == 1
    assert _bucket_size(db, IP_BUCKET_PREFIX + "203.0.113.12") == 1


def test_a_successful_login_does_not_reset_another_callers_budget(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    """The counter must not be shared state a third party's success mutates.

    Deleting the bucket on success would let an attacker park at one failure short of the
    limit and poll: a budget that silently springs back proves a real login just happened,
    which identifies the address as a live, in-use account and timestamps its sessions.
    `authenticate_user` pays a dummy bcrypt round on every miss precisely to keep that
    unknowable, and a bucket-wide reset would give it away through the side door.
    """
    _make_user(db)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    attacker = client_from("203.0.113.20")
    victim = client_from("203.0.113.21")
    _login(attacker)

    signed_in = _login(victim, password=PASSWORD)
    probes = [_login(attacker).status_code for _attempt in range(2)]

    assert signed_in.status_code == 200
    # The attacker's one spent attempt is still spent, so the second lands on the limit. Were
    # the bucket reset, both probes would come back 401 and the reset would be observable.
    assert probes == [401, 429]


def test_a_zero_max_attempts_turns_the_limiter_off(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 0)
    caller = client_from("203.0.113.13")

    codes = [_login(caller).status_code for _attempt in range(6)]

    assert codes == [401] * 6
    # A disabled bucket is not merely unenforced: nothing is written for it at all, so turning
    # the limiter off does not quietly keep filling the table.
    assert _bucket_size(db, EMAIL_BUCKET_PREFIX + EMAIL) == 0
    assert _bucket_size(db, IP_BUCKET_PREFIX + "203.0.113.13") == 0


def test_disabling_one_bucket_leaves_the_other_armed(
    client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    caller = client_from("203.0.113.14")

    codes = [_login(caller).status_code for _attempt in range(3)]

    assert codes == [401, 401, 429]


def test_the_429_carries_retry_after_and_one_message_for_any_email(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    _make_user(db)
    # Only the shared IP bucket is armed, which is what lets a real and an unknown address be
    # refused by the same bucket and therefore compared.
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 1)
    set_int_setting(IP_WINDOW_SECONDS_SETTING, 60)
    caller = client_from("203.0.113.16")
    _login(caller)

    known = _login(caller)
    unknown = _login(caller, email="nobody@example.com")

    assert known.status_code == 429
    assert unknown.status_code == 429
    assert known.json() == {"detail": RATE_LIMITED_ERROR}
    assert unknown.json() == known.json()
    assert 1 <= int(known.headers["retry-after"]) <= 60


@pytest.mark.parametrize(
    ("ip_window_seconds", "email_window_seconds"),
    [(60, 120), (120, 60)],
    ids=["the email bucket waits longer", "the ip bucket waits longer"],
)
def test_a_refusal_writes_nothing_and_reports_the_longest_wait(
    db: Session,
    client_from: ClientFrom,
    set_int_setting: SetIntSetting,
    clock: Clock,
    ip_window_seconds: int,
    email_window_seconds: int,
) -> None:
    """Both buckets full, so the answer has to be the later of the two, whichever that is.

    Reporting the first bucket's wait would send the client back while the second still
    refuses it. And the refusal must leave both buckets exactly as full as it found them: a
    request that never reached the password check is not a failed attempt.
    """
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 1)
    set_int_setting(IP_WINDOW_SECONDS_SETTING, ip_window_seconds)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 1)
    set_int_setting(EMAIL_WINDOW_SECONDS_SETTING, email_window_seconds)
    caller = client_from("203.0.113.23")
    _login(caller)
    clock.advance(10)

    refused = _login(caller)

    assert refused.status_code == 429
    assert refused.headers["retry-after"] == "110"
    assert _bucket_size(db, EMAIL_BUCKET_PREFIX + EMAIL) == 1
    assert _bucket_size(db, IP_BUCKET_PREFIX + "203.0.113.23") == 1


def test_every_casing_of_an_address_shares_one_bucket(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    caller = client_from("203.0.113.17")

    codes = [
        _login(caller, email="Admin@Example.com").status_code,
        _login(caller, email="  admin@example.com  ").status_code,
        _login(caller, email="ADMIN@EXAMPLE.COM").status_code,
    ]

    assert codes == [401, 401, 429]
    assert _bucket_keys_matching(db, f"%{EMAIL}%") == [EMAIL_BUCKET_PREFIX + EMAIL]


def test_the_window_sliding_forward_lets_attempts_through_again(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, clock: Clock
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    set_int_setting(EMAIL_WINDOW_SECONDS_SETTING, 60)
    caller = client_from("203.0.113.18")
    _login(caller)
    _login(caller)

    blocked = _login(caller)
    clock.advance(61)
    after_the_window = _login(caller)

    assert blocked.status_code == 429
    assert after_the_window.status_code == 401
    # The two expired rows are pruned by the touch that found them expired, so a live bucket
    # holds only what is inside its window rather than every attempt it has ever seen.
    assert _bucket_size(db, EMAIL_BUCKET_PREFIX + EMAIL) == 1


def test_a_request_with_no_socket_peer_still_counts_against_the_email_bucket(
    api: TestClient, db: Session, set_int_setting: SetIntSetting
) -> None:
    """`request.client` is None-able in ASGI, and the route must not crash on it."""
    from app.main import app

    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    peerless = TestClient(app, client=None)  # type: ignore[arg-type]

    codes = [_login(peerless).status_code for _attempt in range(3)]

    assert codes == [401, 401, 429]
    # No IP bucket at all rather than a shared "unknown" key that would throttle every such
    # caller as though they were one attacker.
    assert _keys_reserved_alongside(db, EMAIL_BUCKET_PREFIX + EMAIL) == [
        EMAIL_BUCKET_PREFIX + EMAIL
    ]


def test_a_throttled_request_never_reaches_the_password_hash(
    client_from: ClientFrom, set_int_setting: SetIntSetting, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of reserving before `authenticate_user`.

    bcrypt is the endpoint's real cost and the thing the limit is protecting; a 429 that has
    already paid for a hash has protected nothing. This is also what stops the reservation
    drifting back to a record-after-the-fact, which is unbounded under concurrency.
    """
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 1)
    caller = client_from("203.0.113.22")
    _login(caller)

    def refuse_to_hash(plain: str, hashed_password: str) -> bool:
        raise AssertionError("a throttled request must not pay for a password hash")

    monkeypatch.setattr(auth_service, "verify_password", refuse_to_hash)
    throttled = _login(caller)

    assert throttled.status_code == 429


def test_concurrent_attempts_never_exceed_the_configured_maximum(
    committed_sessions: sessionmaker[Session],
) -> None:
    """The regression that motivated reserving at check time, and the only test that catches it.

    Every sequential test here passes just as happily against a read-then-write-later limiter:
    the overshoot only appears when requests overlap. `login` is a sync `def`, so FastAPI runs
    it on the anyio worker threadpool, and a burst wide enough to fill that pool used to be
    admitted in full because every request read the same count before any of them wrote.

    Thirty-two real connections, each already open before the barrier releases them, each
    reserving and committing in its own transaction exactly as `login` does — so they really do
    contend for the bucket's advisory lock, and the count each one reads is only as good as that
    lock makes it.
    """
    admitted = _race(committed_sessions, hold_every_transaction_open=False)

    assert sum(admitted) == CONCURRENT_MAX_ATTEMPTS


def test_without_the_advisory_lock_the_same_race_admits_everyone(
    committed_sessions: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Proves the lock, not luck or the thread scheduler, is what makes the test above pass.

    The lock statement is replaced with `SELECT 1`, and every transaction is held open until all
    thirty-two have reserved. That forces the worst interleaving deterministically rather than
    hoping the scheduler produces it: each request prunes and counts while every other
    request's row is still uncommitted and invisible to it, so every one of them sees an empty
    bucket and is admitted. With the lock in place that interleaving cannot happen at all — the
    second request would block on the lock until the first committed, which is why the test
    above cannot hold its transactions open the same way.
    """

    def select_one_instead_of_locking(db: Session, *, key_hash: int) -> None:
        db.execute(select(1))

    monkeypatch.setattr(rate_limit_service, "_lock_bucket_hash", select_one_instead_of_locking)

    admitted = _race(committed_sessions, hold_every_transaction_open=True)

    assert sum(admitted) == CONCURRENT_CALLERS


def test_requests_whose_keys_collide_crosswise_take_their_locks_in_the_same_order(
    db: Session, locked_hashes: list[int]
) -> None:
    """The deadlock a key-string lock order allows, built from two real `hashtext` collisions.

    Each request's email key shares a hash with the other request's IP key. Sorted by key string
    — every email key sorts before every IP key — the first request would lock A then B and the
    second B then A: each holds what the other waits for, and PostgreSQL aborts one as a 500.
    """
    first_email, first_ip = FIRST_COLLISION
    second_email, second_ip = SECOND_COLLISION
    first_hash = _hashtext(db, EMAIL_BUCKET_PREFIX + first_email)
    second_hash = _hashtext(db, EMAIL_BUCKET_PREFIX + second_email)
    assert _hashtext(db, IP_BUCKET_PREFIX + first_ip) == first_hash
    assert _hashtext(db, IP_BUCKET_PREFIX + second_ip) == second_hash

    reserve_login_attempt(db, client_ip=second_ip, email=first_email, policies=BOTH_ARMED)
    reserve_login_attempt(db, client_ip=first_ip, email=second_email, policies=BOTH_ARMED)

    in_hash_order = sorted([first_hash, second_hash])
    assert locked_hashes == in_hash_order + in_hash_order


def test_two_buckets_sharing_one_hash_take_one_lock_and_both_reserve(
    db: Session, locked_hashes: list[int]
) -> None:
    email, ip = FIRST_COLLISION
    shared_hash = _hashtext(db, EMAIL_BUCKET_PREFIX + email)
    assert _hashtext(db, IP_BUCKET_PREFIX + ip) == shared_hash

    reservation = reserve_login_attempt(db, client_ip=ip, email=email, policies=BOTH_ARMED)

    assert locked_hashes == [shared_hash]
    assert sorted(reservation.reserved_keys) == [
        EMAIL_BUCKET_PREFIX + email,
        IP_BUCKET_PREFIX + ip,
    ]


@pytest.fixture
def locked_hashes(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Every hash `rate_limit_service` locks, in the order it locks them, still locking for real."""
    locked: list[int] = []
    lock = rate_limit_service._lock_bucket_hash

    def record_then_lock(db: Session, *, key_hash: int) -> None:
        locked.append(key_hash)
        lock(db, key_hash=key_hash)

    monkeypatch.setattr(rate_limit_service, "_lock_bucket_hash", record_then_lock)

    return locked


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    frozen = Clock()
    monkeypatch.setattr(rate_limit_service, "_now", frozen.read)

    return frozen


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> Generator[sessionmaker[Session], None, None]:
    """Sessions on their own engine, one real connection each, committing for real.

    `NullPool` rather than `_test_engine`'s pool: that pool hands out at most fifteen
    connections, so the other seventeen threads would queue for one and the "concurrent" run
    would quietly serialise into a sequential one that any limiter passes.
    """
    engine = create_engine(_test_engine.url, poolclass=NullPool)
    try:
        yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    finally:
        engine.dispose()


@pytest.fixture
def client_from(api: TestClient) -> ClientFrom:
    """Builds a `TestClient` reporting `ip` as its socket peer.

    Depends on `api` for the dependency overrides it installs, not for the client it returns:
    the default `TestClient` reports "testclient" as the peer for every caller, so two
    addresses could not be told apart and the per-IP bucket would be untestable.
    """
    from app.main import app

    def build(ip: str) -> TestClient:
        return TestClient(app, client=(ip, 51000))

    return build


def _race(sessions: sessionmaker[Session], *, hold_every_transaction_open: bool) -> list[bool]:
    policies = LoginRateLimitPolicies(
        ip=RateLimitPolicy(max_attempts=0, window_seconds=60),
        email=RateLimitPolicy(max_attempts=CONCURRENT_MAX_ATTEMPTS, window_seconds=60),
    )
    # A fresh address per run: these rows are committed, so nothing may be carried in from the
    # last run or from the other variant.
    email = f"burst-{uuid.uuid4().hex}@example.com"
    started = threading.Barrier(CONCURRENT_CALLERS)
    all_reserved = threading.Barrier(CONCURRENT_CALLERS)

    def attempt() -> bool:
        with sessions() as session:
            session.connection()
            # Every thread waits here with its connection already open and is released
            # together, which is what turns a sequence of reservations into an actual race.
            started.wait(timeout=BARRIER_TIMEOUT_SECONDS)
            reservation = reserve_login_attempt(
                session, client_ip=None, email=email, policies=policies
            )
            if hold_every_transaction_open:
                all_reserved.wait(timeout=BARRIER_TIMEOUT_SECONDS)
            session.commit()

        return reservation.allowed

    try:
        with ThreadPoolExecutor(max_workers=CONCURRENT_CALLERS) as pool:
            futures = [pool.submit(attempt) for _ in range(CONCURRENT_CALLERS)]
            admitted = [future.result() for future in futures]
    finally:
        with sessions() as cleanup:
            cleanup.execute(
                delete(LoginAttempt).where(LoginAttempt.bucket_key == EMAIL_BUCKET_PREFIX + email)
            )
            cleanup.commit()

    return admitted


def _login(client: TestClient, *, email: str = EMAIL, password: str = WRONG_PASSWORD) -> Response:
    return client.post("/auth/token", data={"username": email, "password": password})


def _make_user(db: Session) -> User:
    user = User(
        email=EMAIL,
        hashed_password=hash_password(PASSWORD),
        role=UserRole.ADMIN,
        tutor_id=None,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


def _bucket_size(db: Session, key: str) -> int:
    return db.execute(
        select(func.count()).select_from(LoginAttempt).where(LoginAttempt.bucket_key == key)
    ).scalar_one()


def _hashtext(db: Session, key: str) -> int:
    return db.execute(select(func.hashtext(key))).scalar_one()


def _bucket_keys_matching(db: Session, pattern: str) -> list[str]:
    return list(
        db.execute(
            select(LoginAttempt.bucket_key)
            .where(LoginAttempt.bucket_key.ilike(pattern))
            .distinct()
            .order_by(LoginAttempt.bucket_key)
        ).scalars()
    )


def _keys_reserved_alongside(db: Session, key: str) -> list[str]:
    attempt_ids = select(LoginAttempt.attempt_id).where(LoginAttempt.bucket_key == key)

    return list(
        db.execute(
            select(LoginAttempt.bucket_key)
            .where(LoginAttempt.attempt_id.in_(attempt_ids))
            .distinct()
            .order_by(LoginAttempt.bucket_key)
        ).scalars()
    )
