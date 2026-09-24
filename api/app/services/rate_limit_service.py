"""Brute-force throttling for `POST /auth/token` (#3, OQ-7).

`POST /auth/token` is the only unauthenticated write surface in the system, and until this
module existed an attacker could spend passwords against it as fast as bcrypt would answer.
Two independent buckets throttle it, each with its own thresholds in `system_settings`:

- **per-IP**, keyed on the socket peer, is the wide net. It is what makes spraying one password
  across every account from one host expensive.
- **per-email**, keyed on the normalised submitted address, is the tight one. It is what makes
  guessing one account's password expensive from anywhere, including a rotating botnet.

**The attempt is reserved at check time, not recorded afterwards.** This is the single most
important thing in this module and the easiest to unpick. An earlier version read the count
before the password check and wrote the failure after it, which bounds nothing: `login` is a
sync `def`, so FastAPI runs it on the anyio worker threadpool, and every request that arrives
during one bcrypt round — the whole threadpool's worth — reads the same pre-increment count and
is admitted. The configured limit became a floor rather than a ceiling, and the overshoot
scaled with worker count. Making the read atomic does not help when the write is a bcrypt round
downstream; the write has to happen inside the same atomic step as the read.

So `reserve_login_attempt` prunes, counts, and — only if every bucket is under its limit —
inserts one `login_attempts` row per armed bucket, all while holding a transaction-scoped
advisory lock on each bucket key. The lock is what makes that one step: a second request for
the same bucket blocks on it until the first commits, and only then counts, so the count it
reads already includes the row the first one reserved.

The lock is `pg_advisory_xact_lock(8101, hashtext(bucket_key))`, so it is the hash that is
locked, not the key, and the locks are taken in ascending hash order with equal hashes taken
once. Ordering by key string is not the same thing: `hashtext` is 32 bits and the email half of
a key is whatever the caller typed, so two keys can share a hash, and then two requests can
take the same two locks in opposite orders, each hold the one the other is waiting for, and
have PostgreSQL break the deadlock by aborting one of them as a 500. One total order over the
values actually locked is what rules that out.

What the caller does next decides whether the rows survive:

- the password check fails: nothing more happens, and the reservation *is* the recorded failure;
- the password check succeeds: `release_login_attempt` deletes that request's own rows;
- the attempt was refused: nothing was inserted in any bucket, because every bucket is checked
  before any is written, and a request that never reached the password check is not a failed
  attempt.

Deleting one request's rows rather than the whole bucket is what keeps two properties true at
once. Only genuine failures ultimately count, so a shared office address signing in correctly all
morning is never throttled by its own success — including in the IP bucket, which the earlier
version could not clear at all. And the counter is not shared state that a third party's success
resets: an attacker parked at four of five failures cannot watch the budget spring back and
conclude that someone just signed in, which would identify a live account and timestamp its
sessions through exactly the side channel `authenticate_user`'s dummy-hash round exists to
close.

The window is a true sliding one — one row per attempt, stamped with the time, and every row
older than the window deleted on each touch of its bucket. A fixed counter reset on a timer
would let an attacker spend a full budget at the end of one window and another at the start of
the next, so the effective limit would be double the configured one at exactly the moment it
matters. Pruning on touch keeps a live bucket small; a bucket nobody touches again is left for
the nightly retention purge.

The time is the database's, read once per reservation after every lock is held, and it is the
only clock the stamp, the prune cutoff and `Retry-After` are measured against. Several API
processes on several hosts share these buckets, and each host's clock drifts on its own: with
per-process clocks, a row stamped on one host and pruned or measured on another lives for the
window plus or minus the skew between them, so the limit a bucket enforces, and the
`Retry-After` it reports, would depend on which host happened to serve each request. It is `clock_timestamp()`, not `now()`,
because `now()` is frozen at the start of the transaction, and a request that queued behind
another's lock would stamp its row, and measure its wait, from before it waited.

**Nothing here commits, and the caller's transaction is the whole contract.** The advisory
locks are `pg_advisory_xact_lock`, so they are released only when the caller's transaction
ends, and the reserved rows count against anyone else only once it commits. The caller has to
commit immediately after `reserve_login_attempt` — before the password check, both so the lock
is held for milliseconds rather than a bcrypt round and because a caller that commits only on
the success path rolls every failure back and counts nothing. It also relies on READ COMMITTED,
PostgreSQL's default: each statement after the lock takes a fresh snapshot and so sees the row
the previous lock holder committed. Under REPEATABLE READ the snapshot predates the lock wait,
the count misses those rows, and the overshoot this module exists to prevent comes back.

There is no fail-open path. The counters live in the same PostgreSQL the login already reads
its settings and its user from, so there is no separate store whose outage the limiter could
survive by admitting everyone: if the database is unreachable, login is down regardless.

This module knows nothing about FastAPI: the `Session` arrives as an argument and the router
turns a refused attempt into a 429.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import ceil

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.models.login_attempt import LoginAttempt
from app.services.auth_service import normalise_email
from app.services.settings_service import get_int_setting

IP_BUCKET_PREFIX = "ratelimit:login:ip:"
EMAIL_BUCKET_PREFIX = "ratelimit:login:email:"

IP_MAX_ATTEMPTS_SETTING = "login_rate_limit_ip_max_attempts"
IP_WINDOW_SECONDS_SETTING = "login_rate_limit_ip_window_seconds"
EMAIL_MAX_ATTEMPTS_SETTING = "login_rate_limit_email_max_attempts"
EMAIL_WINDOW_SECONDS_SETTING = "login_rate_limit_email_window_seconds"

# The first key of the two-key `pg_advisory_xact_lock(int, int)` form, so a bucket's lock
# cannot collide with an advisory lock another part of the system takes on its own namespace.
RATE_LIMIT_LOCK_NAMESPACE = 8101


@dataclass(frozen=True)
class RateLimitPolicy:
    max_attempts: int
    window_seconds: int

    @property
    def enabled(self) -> bool:
        """A `max_attempts` of 0 is the documented kill switch for this bucket.

        Zero rather than a boolean setting because `integer` is the only `value_type` the
        settings table knows how to render, and "no attempts are allowed" is not a reading
        anyone would want: a limiter that refuses every login is an outage, not a limit.
        """
        return self.max_attempts > 0


@dataclass(frozen=True)
class LoginRateLimitPolicies:
    ip: RateLimitPolicy
    email: RateLimitPolicy


@dataclass(frozen=True)
class LoginReservation:
    """A reservation, and what it costs to give back.

    `attempt_id` and `reserved_keys` are how `release_login_attempt` removes precisely the rows
    this request added and nothing else. They are not diagnostics — dropping them from the
    return value is what turns the release back into the bucket-wide delete this design
    replaced. Both are empty when nothing was reserved: a refusal, or every bucket disabled.
    """

    allowed: bool
    retry_after_seconds: int
    attempt_id: uuid.UUID | None
    reserved_keys: tuple[str, ...]


UNTHROTTLED = LoginReservation(
    allowed=True, retry_after_seconds=0, attempt_id=None, reserved_keys=()
)


def load_login_policies(db: Session) -> LoginRateLimitPolicies:
    """Read all four thresholds. Raises `SettingNotFound` if the rows are missing."""
    return LoginRateLimitPolicies(
        ip=RateLimitPolicy(
            max_attempts=get_int_setting(db, key=IP_MAX_ATTEMPTS_SETTING),
            window_seconds=get_int_setting(db, key=IP_WINDOW_SECONDS_SETTING),
        ),
        email=RateLimitPolicy(
            max_attempts=get_int_setting(db, key=EMAIL_MAX_ATTEMPTS_SETTING),
            window_seconds=get_int_setting(db, key=EMAIL_WINDOW_SECONDS_SETTING),
        ),
    )


def reserve_login_attempt(
    db: Session,
    *,
    client_ip: str | None,
    email: str,
    policies: LoginRateLimitPolicies,
) -> LoginReservation:
    """Take a slot in every armed bucket, or refuse and take none.

    One answer covering both buckets, deliberately: the caller must not be able to tell the
    client which limit tripped, because "your email is throttled" answers a question an
    unauthenticated caller may not ask.

    Does not commit. See the module docstring for why the caller must, straight away.
    """
    buckets = _buckets(client_ip=client_ip, email=email, policies=policies)

    if buckets:
        reservation = _reserve_every_bucket(db, buckets=buckets)
    else:
        # Both buckets disabled: no lock, no row, no query. Turning the limiter off does not
        # quietly keep filling the table.
        reservation = UNTHROTTLED

    return reservation


def release_login_attempt(db: Session, *, reservation: LoginReservation) -> None:
    """Give back the rows this attempt reserved, after it turns out not to be a failure.

    Scoped to this request's `attempt_id`, never the whole bucket: see the module docstring —
    a bucket-wide delete makes the counter observable shared state and reopens the account
    enumeration side channel. Does not commit.
    """
    if reservation.reserved_keys:
        db.execute(
            delete(LoginAttempt).where(
                LoginAttempt.attempt_id == reservation.attempt_id,
                LoginAttempt.bucket_key.in_(reservation.reserved_keys),
            )
        )


def _reserve_every_bucket(
    db: Session, *, buckets: list[tuple[str, RateLimitPolicy]]
) -> LoginReservation:
    keys = [key for key, _policy in buckets]
    _lock_buckets(db, keys=keys)

    # Read only once every lock is held: a request that waited behind another must not stamp
    # its row, or measure its wait, with the time it started waiting.
    now = _now(db)

    # Every bucket is consulted even after one is full, so `Retry-After` reports the longest
    # wait rather than the first: the attempt is blocked until all of them allow it.
    waits = [_seconds_until_room(db, key=key, policy=policy, now=now) for key, policy in buckets]
    retry_after_seconds = max(waits)

    if retry_after_seconds > 0:
        # Nothing is inserted anywhere. A refused attempt never reaches the password check, so
        # it is not a failed attempt and must not be charged to whichever bucket had room.
        # Without this, hammering one throttled account would drain the shared IP budget and
        # lock out everyone else behind that address — the limiter turning into the denial of
        # service it exists to prevent.
        reservation = LoginReservation(
            allowed=False,
            retry_after_seconds=retry_after_seconds,
            attempt_id=None,
            reserved_keys=(),
        )
    else:
        attempt_id = uuid.uuid4()
        reserved_keys = tuple(keys)
        db.execute(
            insert(LoginAttempt),
            [
                {"bucket_key": key, "attempt_id": attempt_id, "attempted_at": now}
                for key in reserved_keys
            ],
        )
        reservation = LoginReservation(
            allowed=True,
            retry_after_seconds=0,
            attempt_id=attempt_id,
            reserved_keys=reserved_keys,
        )

    return reservation


def _lock_buckets(db: Session, *, keys: list[str]) -> None:
    # Ascending by the hash actually locked, never by key string, and each hash once: see the
    # module docstring — two keys can share a hash, and a key-string order then lets two
    # requests take the same two locks in opposite orders and deadlock.
    key_hashes = db.execute(select(*(func.hashtext(key) for key in keys))).one()
    for key_hash in sorted(set(key_hashes)):
        _lock_bucket_hash(db, key_hash=key_hash)


def _lock_bucket_hash(db: Session, *, key_hash: int) -> None:
    # Transaction-scoped, never the session-scoped `pg_advisory_lock`: a session lock outlives
    # the transaction and survives into whatever request the pooled connection serves next,
    # while this one cannot outlive the caller's commit or rollback.
    db.execute(select(func.pg_advisory_xact_lock(RATE_LIMIT_LOCK_NAMESPACE, key_hash)))


def _now(db: Session) -> datetime:
    # The database's clock, not this process's, and `clock_timestamp()`, not the
    # transaction-start `now()`: see the module docstring.
    return db.execute(select(func.clock_timestamp())).scalar_one()


def _seconds_until_room(db: Session, *, key: str, policy: RateLimitPolicy, now: datetime) -> int:
    window = timedelta(seconds=policy.window_seconds)
    db.execute(
        delete(LoginAttempt).where(
            LoginAttempt.bucket_key == key, LoginAttempt.attempted_at <= now - window
        )
    )
    count, oldest = db.execute(
        select(func.count(), func.min(LoginAttempt.attempted_at)).where(
            LoginAttempt.bucket_key == key
        )
    ).one()

    # `oldest` cannot be None here: a full bucket has at least `max_attempts` rows, and this is
    # never called for a bucket whose `max_attempts` is 0.
    if count >= policy.max_attempts:
        seconds = max(1, ceil((oldest + window - now).total_seconds()))
    else:
        seconds = 0

    return seconds


def _buckets(
    *, client_ip: str | None, email: str, policies: LoginRateLimitPolicies
) -> list[tuple[str, RateLimitPolicy]]:
    buckets = [(_email_bucket_key(email), policies.email)]

    if client_ip is not None:
        # `client_ip` is None when the ASGI server reports no peer address. There is nothing to
        # key an IP bucket on, so that bucket is skipped rather than collapsed onto a shared
        # "unknown" key, which would throttle every such caller as if they were one attacker.
        buckets.append((IP_BUCKET_PREFIX + client_ip, policies.ip))

    return [(key, policy) for key, policy in buckets if policy.enabled]


def _email_bucket_key(email: str) -> str:
    # Normalised exactly as `authenticate_user` normalises it, via the same function, so the
    # bucket and the account lookup can never disagree about which address was tried. If
    # "Admin@x" and "admin@x" hashed to different buckets, varying the casing would multiply an
    # attacker's per-account budget by however many spellings they cared to type.
    return EMAIL_BUCKET_PREFIX + normalise_email(email)
