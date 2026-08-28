"""Brute-force throttling on `POST /auth/token`, exercised over HTTP — #3 (OQ-7).

Driven through the route rather than against `rate_limit_service` directly, because most of
what can go wrong here is wiring: checking the limit after the bcrypt round instead of before
it, counting successes as well as failures, clearing the wrong bucket on a successful login,
or leaking which limit tripped. None of those are visible from inside the service.

Every test rewrites its thresholds through `set_int_setting` rather than accepting the seeded
20/5. Small numbers keep the bcrypt rounds down, and reading a rewritten row back is also what
proves the limiter reads `system_settings` per request instead of caching it.

The buckets are isolated by turning the *other* one off with a `max_attempts` of 0, so a test
named for one bucket cannot pass because the other one refused the request.

Two tests here are not like the others and should not be folded in.
`test_concurrent_attempts_never_exceed_the_configured_maximum` calls the service directly under
threads, because the property it asserts is invisible to any sequential test and the `api`
fixture's single rolled-back `Session` is not safe to drive from several threads at once.
`test_a_throttled_request_never_reaches_the_password_hash` is what pins the ordering that makes
the reservation worth anything.
"""

import threading
import uuid
from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import RedisError
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.user import User
from app.routers.auth import RATE_LIMITED_ERROR
from app.security import hash_password
from app.services import auth_service
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
from tests.conftest import FakeRedis

EMAIL = "admin@example.com"
PASSWORD = "correct horse battery staple"
WRONG_PASSWORD = "not the password"

# Wider than the limit by enough that a read-then-write-later limiter admits visibly too many.
CONCURRENT_CALLERS = 32
CONCURRENT_MAX_ATTEMPTS = 5

SetIntSetting = Callable[[str, int], None]
ClientFrom = Callable[[str], TestClient]


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
    db: Session, client_from: ClientFrom, redis_double: FakeRedis
) -> None:
    _make_user(db)
    caller = client_from("203.0.113.12")
    _login(caller)

    success = _login(caller, password=PASSWORD)

    assert success.status_code == 200
    # One real failure went in and one real failure remains, in both buckets. A successful
    # login costs nothing, and — the part that matters — clears nothing it did not put there.
    assert _bucket_size(redis_double, EMAIL_BUCKET_PREFIX + EMAIL) == 1
    assert _bucket_size(redis_double, IP_BUCKET_PREFIX + "203.0.113.12") == 1


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
    client_from: ClientFrom, set_int_setting: SetIntSetting, redis_double: FakeRedis
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 0)
    caller = client_from("203.0.113.13")

    codes = [_login(caller).status_code for _attempt in range(6)]

    assert codes == [401] * 6
    # A disabled bucket is not merely unenforced: nothing is written for it at all, so turning
    # the limiter off does not quietly keep filling Redis.
    assert redis_double.sorted_sets == {}


def test_disabling_one_bucket_leaves_the_other_armed(
    client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    caller = client_from("203.0.113.14")

    codes = [_login(caller).status_code for _attempt in range(3)]

    assert codes == [401, 401, 429]


def test_an_unreachable_redis_fails_open_and_login_still_works(
    db: Session,
    client_from: ClientFrom,
    set_int_setting: SetIntSetting,
    redis_double: FakeRedis,
) -> None:
    _make_user(db)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 1)
    caller = client_from("203.0.113.15")
    redis_double.fail_with = RedisConnectionError("connection refused")

    first = _login(caller)
    second = _login(caller)
    success = _login(caller, password=PASSWORD)

    assert first.status_code == 401
    # A 429 here would mean the outage failed closed, which is the regression this asserts
    # against: an unreachable Redis must not lock every user out of the system.
    assert second.status_code == 401
    assert success.status_code == 200


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


def test_every_casing_of_an_address_shares_one_bucket(
    client_from: ClientFrom, set_int_setting: SetIntSetting, redis_double: FakeRedis
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
    assert list(redis_double.sorted_sets) == [EMAIL_BUCKET_PREFIX + EMAIL]


def test_the_window_sliding_forward_lets_attempts_through_again(
    client_from: ClientFrom, set_int_setting: SetIntSetting, redis_double: FakeRedis
) -> None:
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    set_int_setting(EMAIL_WINDOW_SECONDS_SETTING, 60)
    caller = client_from("203.0.113.18")
    _login(caller)
    _login(caller)

    blocked = _login(caller)
    redis_double.advance(61)
    after_the_window = _login(caller)

    assert blocked.status_code == 429
    assert after_the_window.status_code == 401
    # The key is armed to reap itself, so an address nobody retries stops occupying Redis.
    assert redis_double.expirations[EMAIL_BUCKET_PREFIX + EMAIL] == 60


def test_a_request_with_no_socket_peer_still_counts_against_the_email_bucket(
    api: TestClient, set_int_setting: SetIntSetting, redis_double: FakeRedis
) -> None:
    """`request.client` is None-able in ASGI, and the route must not crash on it."""
    from app.main import app

    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 2)
    peerless = TestClient(app, client=None)  # type: ignore[arg-type]

    codes = [_login(peerless).status_code for _attempt in range(3)]

    assert codes == [401, 401, 429]
    # No IP bucket at all rather than a shared "unknown" key that would throttle every such
    # caller as though they were one attacker.
    assert list(redis_double.sorted_sets) == [EMAIL_BUCKET_PREFIX + EMAIL]


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


@pytest.mark.parametrize("live", [False, True], ids=["against the double", "against real Redis"])
def test_concurrent_attempts_never_exceed_the_configured_maximum(
    live: bool, redis_double: FakeRedis, live_redis_factory: Callable[[], Redis]
) -> None:
    """The regression that motivated reserving at check time, and the only test that catches it.

    Every sequential test here passes just as happily against a read-then-write-later limiter:
    the overshoot only appears when requests overlap. `login` is a sync `def`, so FastAPI runs
    it on the anyio worker threadpool, and a burst wide enough to fill that pool used to be
    admitted in full because every request read the same count before any of them wrote.

    Run against both clients on purpose. The double models the script's atomicity with a lock,
    which is what makes it a fair target — but a double can only ever prove that the double is
    right, so the same assertion runs against a live Redis and proves the Lua.
    """
    redis = live_redis_factory() if live else redis_double
    policies = LoginRateLimitPolicies(
        ip=RateLimitPolicy(max_attempts=0, window_seconds=60),
        email=RateLimitPolicy(max_attempts=CONCURRENT_MAX_ATTEMPTS, window_seconds=60),
    )
    # A fresh address per run, so a live Redis carries nothing in from the last one.
    email = f"burst-{uuid.uuid4().hex}@example.com"
    ready = threading.Barrier(CONCURRENT_CALLERS)

    def attempt() -> bool:
        # Every thread waits here and is released together, which is what turns a sequence of
        # reservations into an actual race.
        ready.wait(timeout=10)
        return reserve_login_attempt(redis, client_ip=None, email=email, policies=policies).allowed

    try:
        with ThreadPoolExecutor(max_workers=CONCURRENT_CALLERS) as pool:
            futures = [pool.submit(attempt) for _ in range(CONCURRENT_CALLERS)]
            admitted = [future.result() for future in futures]
    finally:
        if live:
            # The double is thrown away with the test; a real server is not.
            redis.delete(EMAIL_BUCKET_PREFIX + email)

    assert sum(admitted) == CONCURRENT_MAX_ATTEMPTS


@pytest.fixture
def live_redis_factory() -> Generator[Callable[[], Redis], None, None]:
    """A real client on `REDIS_URL`, or a clean skip when nothing is listening.

    The concurrency assertion is worthless against a double alone, and equally worthless as a
    test that quietly disappears — so this skips loudly rather than passing vacuously.
    """
    clients: list[Redis] = []

    def build() -> Redis:
        from app.config import get_settings

        client = Redis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            client.ping()
        except RedisError:
            client.close()
            pytest.skip("no Redis on REDIS_URL; the atomicity assertion needs a real server")
        clients.append(client)

        return client

    try:
        yield build
    finally:
        for client in clients:
            client.close()


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


def _bucket_size(redis_double: FakeRedis, key: str) -> int:
    return len(redis_double.sorted_sets.get(key, {}))
