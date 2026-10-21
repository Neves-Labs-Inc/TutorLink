"""Throttling on `POST /auth/password/link`, exercised over HTTP.

Modelled on `test_forgot_password_rate_limit.py`. The lookup has one bucket, per IP, under its
own prefix but on the forgot-password IP thresholds, so the tests rewrite those through
`set_int_setting` and read the `login_attempts` rows back through the rolled-back `db` session.
"""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.login_attempt import LoginAttempt
from app.services.rate_limit_service import (
    EMAIL_MAX_ATTEMPTS_SETTING,
    FORGOT_EMAIL_MAX_ATTEMPTS_SETTING,
    FORGOT_IP_MAX_ATTEMPTS_SETTING,
    IP_MAX_ATTEMPTS_SETTING,
    LINK_IP_BUCKET_PREFIX,
)
from tests.fake_mail import FakeMail

UNKNOWN_TOKEN = "not-a-token-anyone-was-sent"
INVALID_LOOKUP_BODY = {"kind": None, "state": "invalid", "name": None, "email": None}

SetIntSetting = Callable[[str, int], None]
ClientFrom = Callable[[str], TestClient]


def test_past_the_ip_threshold_the_lookup_is_429_with_retry_after(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 2)
    caller = client_from("203.0.113.60")

    responses = [_look_up(caller) for _attempt in range(3)]

    assert [response.status_code for response in responses] == [200, 200, 429]
    assert all(response.json() == INVALID_LOOKUP_BODY for response in responses[:2])
    assert int(responses[2].headers["retry-after"]) > 0
    assert _bucket_size(db, LINK_IP_BUCKET_PREFIX + "203.0.113.60") == 2


def test_a_throttled_ip_does_not_throttle_another(
    client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 1)
    throttled = client_from("203.0.113.61")
    _look_up(throttled)

    refused = _look_up(throttled)
    other = _look_up(client_from("203.0.113.62"))

    assert refused.status_code == 429
    assert other.status_code == 200


def test_the_lookup_bucket_never_touches_login_or_forgot_buckets(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    """A throttled lookup leaves login and forgot answering from that peer, and vice versa."""
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 1)
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(IP_MAX_ATTEMPTS_SETTING, 1)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 0)
    caller = client_from("203.0.113.63")
    _look_up(caller)
    lookup_throttled = _look_up(caller)

    login = _login(caller)
    forgot = _forgot(caller)
    lookup_after = _look_up(caller)

    assert lookup_throttled.status_code == 429
    assert login.status_code == 401
    assert forgot.status_code == 202
    assert lookup_after.status_code == 429
    assert _bucket_keys_matching(db, "%203.0.113.63") == [
        "ratelimit:forgot:ip:203.0.113.63",
        LINK_IP_BUCKET_PREFIX + "203.0.113.63",
        "ratelimit:login:ip:203.0.113.63",
    ]
    assert _bucket_size(db, LINK_IP_BUCKET_PREFIX + "203.0.113.63") == 1


def test_a_zero_max_attempts_turns_the_lookup_limiter_off(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting
) -> None:
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 0)
    caller = client_from("203.0.113.64")

    responses = [_look_up(caller) for _attempt in range(4)]

    assert all(response.status_code == 200 for response in responses)
    assert _bucket_size(db, LINK_IP_BUCKET_PREFIX + "203.0.113.64") == 0


@pytest.fixture
def client_from(api: TestClient) -> ClientFrom:
    """Builds a `TestClient` reporting `ip` as its socket peer, on `api`'s overrides."""
    from app.main import app

    def build(ip: str) -> TestClient:
        return TestClient(app, client=(ip, 51000))

    return build


def _look_up(client: TestClient, *, token: str = UNKNOWN_TOKEN) -> Response:
    return client.post("/auth/password/link", json={"token": token})


def _login(client: TestClient) -> Response:
    return client.post(
        "/auth/token", data={"username": "nobody@example.com", "password": "not the password"}
    )


def _forgot(client: TestClient) -> Response:
    return client.post("/auth/password/forgot", json={"email": "nobody@example.com"})


def _bucket_size(db: Session, key: str) -> int:
    return db.execute(
        select(func.count()).select_from(LoginAttempt).where(LoginAttempt.bucket_key == key)
    ).scalar_one()


def _bucket_keys_matching(db: Session, pattern: str) -> list[str]:
    return list(
        db.execute(
            select(LoginAttempt.bucket_key)
            .where(LoginAttempt.bucket_key.ilike(pattern))
            .distinct()
            .order_by(LoginAttempt.bucket_key)
        ).scalars()
    )
