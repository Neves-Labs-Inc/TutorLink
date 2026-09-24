"""The forwarded-header trust boundary `create_app()` mounts — #33 (REQ-332 … REQ-335).

The trust decision is invisible from inside every shipped route: nothing in this API reports the
client address or the scheme, and adding an endpoint that did would be inventing a consumer to
make a mechanism demonstrable. So these tests attach a `/__probe` route to an app the test itself
built, and it exists only in this module. That is a large part of why `create_app()` exists —
Starlette refuses `add_middleware` once an app has served a request, so the trusted set could not
be varied on the shared module-level `app`.

Two directions have to be asserted, not one. Against the default of "trust nothing", a trust check
that never trusts anything looks exactly like a working one, so every positive case here is paired
with a negative: `test_an_untrusted_peer_keeps_its_own_address_and_scheme` and
`test_a_forged_forwarded_prefix_does_not_win` are the anti-spoof assertions and both go red if the
trusted set is ever widened to everything, while the trusted-peer cases go red if it is emptied.

The last two tests leave the probe behind and drive `POST /auth/token`, because the outage issue
#33 opens with is about the real consumer — `_client_ip` feeding `IP_BUCKET_PREFIX` — and no probe
route can prove that the per-IP login bucket separates two callers behind one proxy.
"""

from collections.abc import Callable, Generator

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.config import get_settings
from app.db import get_db
from app.main import create_app
from app.models.login_attempt import LoginAttempt
from app.services.rate_limit_service import EMAIL_MAX_ATTEMPTS_SETTING, IP_BUCKET_PREFIX

TRUSTED_PROXIES_ENV = "TRUSTED_PROXIES"
PROXY = "10.1.2.3"
SECOND_PROXY = "10.4.5.6"
PROXY_BLOCK = "10.1.0.0/16"
PROXY_IN_BLOCK = "10.1.9.9"
OUTSIDE_THE_BLOCK = "10.2.0.1"
DIRECT_PEER = "203.0.113.9"
FORWARDED_CLIENT = "198.51.100.1"
OTHER_FORWARDED_CLIENT = "198.51.100.2"
FORGED = "203.0.113.77"
PEER_PORT = 51000

AppTrusting = Callable[[str | None], FastAPI]
LoginApp = Callable[[str | None], FastAPI]
SetIntSetting = Callable[[str, int], None]


def test_nothing_is_mounted_when_no_proxy_is_trusted(app_trusting: AppTrusting) -> None:
    built = app_trusting(None)

    # Not "mounted but configured with an empty set": with the variable unset the application is
    # byte-for-byte what it was before the trust boundary existed.
    assert built.user_middleware == []


def test_the_middleware_is_the_outermost_one_when_a_proxy_is_trusted(
    app_trusting: AppTrusting,
) -> None:
    """`user_middleware[0]` is outermost, so index 0 is the assertion that matters.

    Starlette's `add_middleware` inserts at the front and the stack is wrapped in reverse
    (`starlette/applications.py:63-83,104-107`). Any middleware added to `create_app()` below the
    mount would take this slot and would read the proxy's address rather than the client's.
    """
    built = app_trusting(PROXY)

    assert [entry.cls for entry in built.user_middleware] == [ProxyHeadersMiddleware]


def test_an_unset_trusted_set_ignores_both_forwarded_headers(app_trusting: AppTrusting) -> None:
    built = app_trusting(None)

    probed = _probe(
        built,
        peer=(DIRECT_PEER, PEER_PORT),
        headers={"X-Forwarded-For": FORWARDED_CLIENT, "X-Forwarded-Proto": "https"},
    )

    # Both, not one: a default that honoured the scheme while ignoring the address would be a
    # half-open boundary nobody had decided on.
    assert probed == {"client": DIRECT_PEER, "scheme": "http"}


@pytest.mark.parametrize(
    ("trusted_proxies", "peer"),
    [
        pytest.param(PROXY, PROXY, id="bare-address"),
        pytest.param(PROXY_BLOCK, PROXY_IN_BLOCK, id="inside-a-cidr-block"),
        pytest.param(f"{PROXY},{SECOND_PROXY}", PROXY, id="first-of-two"),
        pytest.param(f"{PROXY},{SECOND_PROXY}", SECOND_PROXY, id="second-of-two"),
    ],
)
def test_a_trusted_peer_supplies_the_client_address(
    app_trusting: AppTrusting, trusted_proxies: str, peer: str
) -> None:
    built = app_trusting(trusted_proxies)

    probed = _probe(built, peer=(peer, PEER_PORT), headers={"X-Forwarded-For": FORWARDED_CLIENT})

    # The CIDR case is not redundant with the bare one: uvicorn keeps a block it cannot parse as
    # a literal string and compares it verbatim, so this is what proves the configured block
    # reaches `_TrustedHosts` as a network and matches an address inside it.
    assert probed["client"] == FORWARDED_CLIENT


def test_a_trusted_peer_supplies_the_scheme(app_trusting: AppTrusting) -> None:
    built = app_trusting(PROXY)

    probed = _probe(built, peer=(PROXY, PEER_PORT), headers={"X-Forwarded-Proto": "https"})

    assert probed["scheme"] == "https"


def test_an_untrusted_peer_keeps_its_own_address_and_scheme(app_trusting: AppTrusting) -> None:
    """The anti-spoof assertion: it must go red if the trusted set is widened or bypassed.

    `10.2.0.1` is one block away from the configured `10.1.0.0/16` — close enough that a
    membership test with a widened mask, such as `10.0.0.0/8`, or a set widened to `*`, would
    admit it.
    """
    built = app_trusting(PROXY_BLOCK)

    probed = _probe(
        built,
        peer=(OUTSIDE_THE_BLOCK, PEER_PORT),
        headers={"X-Forwarded-For": FORWARDED_CLIENT, "X-Forwarded-Proto": "https"},
    )

    assert probed == {"client": OUTSIDE_THE_BLOCK, "scheme": "http"}


def test_a_request_with_no_socket_peer_does_not_crash(app_trusting: AppTrusting) -> None:
    """ASGI permits `scope["client"]` to be absent, and the trust check reads it first."""
    built = app_trusting(PROXY)

    probed = _probe(
        built,
        peer=None,
        headers={"X-Forwarded-For": FORWARDED_CLIENT, "X-Forwarded-Proto": "https"},
    )

    assert probed == {"client": None, "scheme": "http"}


def test_a_forged_forwarded_prefix_does_not_win(app_trusting: AppTrusting) -> None:
    """A client that writes its own `X-Forwarded-For` before reaching the proxy loses.

    Caddy appends the address it actually received the request from, so a header the client wrote
    arrives as a prefix: `<forged>, <real>`. uvicorn scans the list from the right and takes the
    first entry that is not itself trusted, which skips past the forged prefix — but only while
    the trusted set contains the proxy and nothing else. Widening it does not merely admit more
    proxies: once the set covers the real client's address too, the scan skips past the real
    entry and returns the forged one instead.

    The negative assertion is the load-bearing one. Asserting only that the real address is
    chosen would pass just as happily under a leftmost implementation, which is the spoofable one.
    """
    built = app_trusting(PROXY)

    probed = _probe(
        built,
        peer=(PROXY, PEER_PORT),
        headers={"X-Forwarded-For": f"{FORGED}, {FORWARDED_CLIENT}"},
    )

    assert probed["client"] == FORWARDED_CLIENT
    assert probed["client"] != FORGED


def test_a_scheme_outside_the_allowlist_is_ignored_even_from_a_trusted_peer(
    app_trusting: AppTrusting,
) -> None:
    """Pinned because a scheme taken verbatim from a header would be a hole in whatever reads it
    next — the Phase 7 webhook signature check rebuilds the request URL from it."""
    built = app_trusting(PROXY)

    probed = _probe(
        built,
        peer=(PROXY, PEER_PORT),
        headers={"X-Forwarded-Proto": "gopher", "X-Forwarded-For": FORWARDED_CLIENT},
    )

    assert probed["scheme"] == "http"
    assert probed["client"] == FORWARDED_CLIENT


def test_two_clients_behind_one_trusted_proxy_occupy_two_ip_buckets(
    login_app: LoginApp, db: Session, set_int_setting: SetIntSetting
) -> None:
    """The outage in #33, through the real consumer rather than the probe.

    The email bucket is turned off so only IP keys can appear, matching the isolation idiom in
    `test_auth_rate_limit.py`: a test named for the IP bucket must not be able to pass because
    the other bucket refused the request. No user record is needed — the reservation is taken
    before `authenticate_user`, so a login against an unknown address still writes the bucket.
    """
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 0)
    built = login_app(PROXY)

    codes = [
        _failed_login(built, peer=PROXY, forwarded_for=FORWARDED_CLIENT),
        _failed_login(built, peer=PROXY, forwarded_for=OTHER_FORWARDED_CLIENT),
    ]

    assert codes == [401, 401]
    assert _ip_buckets_written(db) == {
        IP_BUCKET_PREFIX + FORWARDED_CLIENT,
        IP_BUCKET_PREFIX + OTHER_FORWARDED_CLIENT,
    }


def test_the_same_two_clients_collapse_into_one_bucket_with_no_proxy_trusted(
    login_app: LoginApp, db: Session, set_int_setting: SetIntSetting
) -> None:
    """The failure mode #33 reports, asserted rather than skipped.

    It is what gives the test above its meaning: identical requests, one bucket, keyed on the
    proxy's own address — so every user behind the proxy shares one login budget.
    """
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 0)
    built = login_app(None)

    codes = [
        _failed_login(built, peer=PROXY, forwarded_for=FORWARDED_CLIENT),
        _failed_login(built, peer=PROXY, forwarded_for=OTHER_FORWARDED_CLIENT),
    ]

    assert codes == [401, 401]
    assert _ip_buckets_written(db) == {IP_BUCKET_PREFIX + PROXY}


@pytest.fixture
def app_trusting(monkeypatch: pytest.MonkeyPatch) -> Generator[AppTrusting, None, None]:
    """Builds an app for one trusted set and gives it the probe route.

    The probe is attached to the freshly built app before it serves anything, and never to the
    shipped one. `get_settings.cache_clear()` runs on the way in *and* on the way out: the cache
    is process-wide, so a rewritten `TRUSTED_PROXIES` left in it would be handed to every later
    test in the session, including the ones asserting `cookie_secure` and `secret_key`.
    """

    def build(trusted_proxies: str | None) -> FastAPI:
        built = _build_app(monkeypatch, trusted_proxies)

        @built.get("/__probe")
        def probe(request: Request) -> dict[str, str | None]:
            return {
                "client": request.client.host if request.client is not None else None,
                "scheme": request.url.scheme,
            }

        return built

    try:
        yield build
    finally:
        get_settings.cache_clear()


@pytest.fixture
def login_app(monkeypatch: pytest.MonkeyPatch, db: Session) -> Generator[LoginApp, None, None]:
    """An app built the same way, wired to the rolled-back session.

    `conftest.py`'s `api` fixture installs its override on the module-level app and cannot help
    here, so this installs its own. The `login_attempts` rows the request writes land in that
    same session, which is what makes them the assertion target: their `bucket_key`s name the
    buckets a request landed in.
    """

    def build(trusted_proxies: str | None) -> FastAPI:
        built = _build_app(monkeypatch, trusted_proxies)
        built.dependency_overrides[get_db] = lambda: db

        return built

    try:
        yield build
    finally:
        get_settings.cache_clear()


def _build_app(monkeypatch: pytest.MonkeyPatch, trusted_proxies: str | None) -> FastAPI:
    if trusted_proxies is None:
        monkeypatch.delenv(TRUSTED_PROXIES_ENV, raising=False)
    else:
        monkeypatch.setenv(TRUSTED_PROXIES_ENV, trusted_proxies)
    get_settings.cache_clear()

    return create_app()


def _probe(
    built: FastAPI, *, peer: tuple[str, int] | None, headers: dict[str, str]
) -> dict[str, str | None]:
    return TestClient(built, client=peer).get("/__probe", headers=headers).json()


def _failed_login(built: FastAPI, *, peer: str, forwarded_for: str) -> int:
    client = TestClient(built, client=(peer, PEER_PORT))
    response = client.post(
        "/auth/token",
        data={"username": "nobody@example.com", "password": "not the password"},
        headers={"X-Forwarded-For": forwarded_for},
    )

    return response.status_code


def _ip_buckets_written(db: Session) -> set[str]:
    # Scoped to the addresses these tests put on the wire, so a stray committed row in the
    # long-lived test database cannot turn an exact-set assertion into a false failure.
    candidates = [
        IP_BUCKET_PREFIX + address for address in (PROXY, FORWARDED_CLIENT, OTHER_FORWARDED_CLIENT)
    ]

    return set(
        db.execute(
            select(LoginAttempt.bucket_key).where(LoginAttempt.bucket_key.in_(candidates))
        ).scalars()
    )
