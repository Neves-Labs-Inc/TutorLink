"""`login_attempts`, against a real PostgreSQL.

`login_attempts`' primary key is `(bucket_key, attempt_id)` rather than `attempt_id` alone: one
reservation writes the same `attempt_id` to every bucket it arms, and the composite key is what
lets that fan-out land while still rejecting a genuine duplicate. The rejection runs inside its
own `begin_nested()`, the same reason every other model test in this suite does: a failed
statement aborts the surrounding transaction, and the `db` fixture's rollback is the outer one.
"""

import datetime
import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.login_attempt import LoginAttempt

ATTEMPTED_AT = datetime.datetime(2026, 9, 24, 10, 0, tzinfo=datetime.UTC)


def test_login_attempt_round_trip(db: Session) -> None:
    attempt_id = uuid.uuid4()
    db.add(
        LoginAttempt(
            bucket_key="ratelimit:login:email:tutor@example.com",
            attempt_id=attempt_id,
            attempted_at=ATTEMPTED_AT,
        )
    )
    db.flush()

    stored = db.get(LoginAttempt, ("ratelimit:login:email:tutor@example.com", attempt_id))
    assert stored is not None
    assert stored.attempted_at == ATTEMPTED_AT


def test_login_attempt_rejects_a_duplicate_bucket_key_and_attempt_id(db: Session) -> None:
    attempt_id = uuid.uuid4()
    db.add(
        LoginAttempt(
            bucket_key="ratelimit:login:ip:203.0.113.7",
            attempt_id=attempt_id,
            attempted_at=ATTEMPTED_AT,
        )
    )
    db.flush()

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(
            LoginAttempt(
                bucket_key="ratelimit:login:ip:203.0.113.7",
                attempt_id=attempt_id,
                attempted_at=ATTEMPTED_AT,
            )
        )
        db.flush()


def test_login_attempt_accepts_the_same_attempt_id_under_a_second_bucket_key(db: Session) -> None:
    attempt_id = uuid.uuid4()
    db.add(
        LoginAttempt(
            bucket_key="ratelimit:login:ip:203.0.113.7",
            attempt_id=attempt_id,
            attempted_at=ATTEMPTED_AT,
        )
    )
    db.add(
        LoginAttempt(
            bucket_key="ratelimit:login:email:tutor@example.com",
            attempt_id=attempt_id,
            attempted_at=ATTEMPTED_AT,
        )
    )
    db.flush()

    assert db.get(LoginAttempt, ("ratelimit:login:ip:203.0.113.7", attempt_id)) is not None
    assert db.get(LoginAttempt, ("ratelimit:login:email:tutor@example.com", attempt_id)) is not None
