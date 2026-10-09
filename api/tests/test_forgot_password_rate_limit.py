"""Throttling on `POST /auth/password/forgot`, exercised over HTTP — spec 04, slice 5.

Modelled on `test_auth_rate_limit.py`, with one difference that shapes every assertion: a
throttled forgot answers the same 202 as a hit, so the refusal is visible only in what did not
happen — no email in `fake_mail.sent`, no `password_links` row — and in the `login_attempts`
rows read back through the rolled-back `db` session. The thresholds are rewritten through
`set_int_setting`, and the buckets are isolated by turning the other one off with 0.
"""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.login_attempt import LoginAttempt
from app.models.password_link import PasswordLink, PasswordLinkPurpose
from app.models.user import User
from app.security import hash_password
from app.services.rate_limit_service import (
    EMAIL_BUCKET_PREFIX,
    EMAIL_MAX_ATTEMPTS_SETTING,
    FORGOT_EMAIL_BUCKET_PREFIX,
    FORGOT_EMAIL_MAX_ATTEMPTS_SETTING,
    FORGOT_IP_BUCKET_PREFIX,
    FORGOT_IP_MAX_ATTEMPTS_SETTING,
    IP_BUCKET_PREFIX,
)
from tests.fake_mail import FakeMail

EMAIL = "admin@example.com"
OTHER_EMAIL = "someone-else@example.com"
PASSWORD = "correct horse battery staple"
FORGOT_BODY = {
    "detail": "If an account exists for that email, we sent a link to reset the password."
}

SetIntSetting = Callable[[str, int], None]
ClientFrom = Callable[[str], TestClient]


def test_the_ip_bucket_stops_sending_after_its_configured_count(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 2)
    _make_user(db)
    caller = client_from("203.0.113.40")

    responses = [_forgot(caller) for _attempt in range(3)]

    assert [response.status_code for response in responses] == [202, 202, 202]
    assert all(response.json() == FORGOT_BODY for response in responses)
    assert all("retry-after" not in response.headers for response in responses)
    assert len(fake_mail.sent) == 2
    assert _reset_link_count(db) == 2
    assert _bucket_size(db, FORGOT_IP_BUCKET_PREFIX + "203.0.113.40") == 2


def test_the_ip_bucket_throttles_every_address_from_that_peer(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 2)
    _make_user(db)
    _make_user(db, email=OTHER_EMAIL)
    caller = client_from("203.0.113.41")
    _forgot(caller, email="nobody-1@example.com")
    _forgot(caller, email="nobody-2@example.com")

    throttled = _forgot(caller, email=OTHER_EMAIL)

    assert throttled.status_code == 202
    assert throttled.json() == FORGOT_BODY
    assert fake_mail.sent == []
    assert _reset_link_count(db) == 0


def test_the_email_bucket_stops_sending_independently_of_the_ip_bucket(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 2)
    _make_user(db)
    _make_user(db, email=OTHER_EMAIL)
    caller = client_from("203.0.113.42")

    responses = [_forgot(caller) for _attempt in range(3)]
    # The same peer, a different account: a throttled address must not throttle the network.
    other_account = _forgot(caller, email=OTHER_EMAIL)

    assert [response.status_code for response in responses] == [202, 202, 202]
    assert all(response.json() == FORGOT_BODY for response in responses)
    assert other_account.status_code == 202
    assert [sent.to for sent in fake_mail.sent] == [EMAIL, EMAIL, OTHER_EMAIL]
    assert _bucket_size(db, FORGOT_EMAIL_BUCKET_PREFIX + EMAIL) == 2
    assert _bucket_size(db, FORGOT_IP_BUCKET_PREFIX + "203.0.113.42") == 0


def test_a_miss_counts_against_the_buckets_too(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    """There is no success to release: a request for an unknown address spends a slot."""
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 2)
    caller = client_from("203.0.113.43")

    for _attempt in range(3):
        _forgot(caller, email="nobody@example.com")

    assert _bucket_size(db, FORGOT_EMAIL_BUCKET_PREFIX + "nobody@example.com") == 2


def test_every_casing_of_an_address_shares_one_bucket(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 2)
    _make_user(db)
    caller = client_from("203.0.113.44")

    _forgot(caller, email="Admin@Example.com")
    _forgot(caller, email="  admin@example.com  ")
    _forgot(caller, email="ADMIN@EXAMPLE.COM")

    assert len(fake_mail.sent) == 2
    assert _bucket_keys_matching(db, f"%{EMAIL}%") == [FORGOT_EMAIL_BUCKET_PREFIX + EMAIL]


def test_a_zero_max_attempts_turns_the_limiter_off(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 0)
    _make_user(db)
    caller = client_from("203.0.113.45")

    for _attempt in range(6):
        _forgot(caller)

    assert len(fake_mail.sent) == 6
    # A disabled bucket is not merely unenforced: nothing is written for it at all.
    assert _bucket_size(db, FORGOT_EMAIL_BUCKET_PREFIX + EMAIL) == 0
    assert _bucket_size(db, FORGOT_IP_BUCKET_PREFIX + "203.0.113.45") == 0


def test_forgot_buckets_never_touch_login_buckets(
    db: Session, client_from: ClientFrom, set_int_setting: SetIntSetting, fake_mail: FakeMail
) -> None:
    """A throttled forgot does not block login for that address, and vice versa."""
    set_int_setting(FORGOT_IP_MAX_ATTEMPTS_SETTING, 0)
    set_int_setting(FORGOT_EMAIL_MAX_ATTEMPTS_SETTING, 1)
    set_int_setting(EMAIL_MAX_ATTEMPTS_SETTING, 1)
    _make_user(db)
    caller = client_from("203.0.113.46")
    _forgot(caller)
    _forgot(caller)

    login = _login(caller)
    login_throttled = _login(caller)
    forgot_after_login = _forgot(caller)

    assert login.status_code == 401
    assert login_throttled.status_code == 429
    assert forgot_after_login.status_code == 202
    assert len(fake_mail.sent) == 1
    assert _bucket_size(db, FORGOT_EMAIL_BUCKET_PREFIX + EMAIL) == 1
    assert _bucket_size(db, EMAIL_BUCKET_PREFIX + EMAIL) == 1
    assert _bucket_size(db, IP_BUCKET_PREFIX + "203.0.113.46") == 1
    assert _bucket_keys_matching(db, "ratelimit:forgot:%") == [FORGOT_EMAIL_BUCKET_PREFIX + EMAIL]


@pytest.fixture
def client_from(api: TestClient) -> ClientFrom:
    """Builds a `TestClient` reporting `ip` as its socket peer, on `api`'s overrides."""
    from app.main import app

    def build(ip: str) -> TestClient:
        return TestClient(app, client=(ip, 51000))

    return build


def _forgot(client: TestClient, *, email: str = EMAIL) -> Response:
    return client.post("/auth/password/forgot", json={"email": email})


def _login(client: TestClient, *, email: str = EMAIL) -> Response:
    return client.post("/auth/token", data={"username": email, "password": "not the password"})


def _make_user(db: Session, *, email: str = EMAIL) -> User:
    user = User(
        email=email,
        name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


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


def _reset_link_count(db: Session) -> int:
    return db.execute(
        select(func.count())
        .select_from(PasswordLink)
        .where(PasswordLink.purpose == PasswordLinkPurpose.RESET)
    ).scalar_one()
