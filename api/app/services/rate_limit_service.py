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

So `reserve_login_attempt` trims, counts, and — only if the count is under the limit — adds its
own member, all in one server-side script. What the caller does next decides whether that member
survives:

- the password check fails: nothing more happens, and the reservation *is* the recorded failure;
- the password check succeeds: `release_login_attempt` removes that one member;
- the attempt was refused: the reservations it did take are released, because a request that
  never reached the password check is not a failed attempt.

Removing one member rather than deleting the key is what keeps two properties true at once.
Only genuine failures ultimately count, so a shared office address signing in correctly all
morning is never throttled by its own success — including in the IP bucket, which the earlier
version could not clear at all. And the counter is not shared state that a third party's success
resets: an attacker parked at four of five failures cannot watch the budget spring back and
conclude that someone just signed in, which would identify a live account and timestamp its
sessions through exactly the side channel `authenticate_user`'s dummy-hash round exists to
close.

The window is a true sliding one — a sorted set of one member per attempt, scored by wall clock,
trimmed to the window on every touch. A fixed counter with a TTL would let an attacker spend a
full budget at the end of one window and another at the start of the next, so the effective
limit would be double the configured one at exactly the moment it matters.

This module knows nothing about FastAPI: the Redis client and the `Session` arrive as arguments
and the router turns a refused attempt into a 429.
"""

import time
import uuid
from dataclasses import dataclass
from math import ceil

from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy.orm import Session

from app.services.auth_service import normalise_email
from app.services.settings_service import get_int_setting

IP_BUCKET_PREFIX = "ratelimit:login:ip:"
EMAIL_BUCKET_PREFIX = "ratelimit:login:email:"

IP_MAX_ATTEMPTS_SETTING = "login_rate_limit_ip_max_attempts"
IP_WINDOW_SECONDS_SETTING = "login_rate_limit_ip_window_seconds"
EMAIL_MAX_ATTEMPTS_SETTING = "login_rate_limit_email_max_attempts"
EMAIL_WINDOW_SECONDS_SETTING = "login_rate_limit_email_window_seconds"

# Trim, count, and reserve as one indivisible step. A Lua script rather than WATCH/MULTI
# optimistic retry: Redis runs a script to completion with nothing interleaved, so there is no
# retry loop to get wrong and no contention ceiling — under the burst this exists to survive,
# a WATCH loop is at its least reliable exactly when it is most needed. Every value the script
# uses arrives in ARGV, so it is deterministic and replicates safely.
#
# Returns {admitted, oldest_score}. `oldest_score` is meaningful only when refused, and the
# ZRANGE that produces it cannot come back empty there: a refusal means ZCARD >= max_attempts,
# and this script is never called for a bucket whose max_attempts is 0.
RESERVE_ATTEMPT_SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_attempts = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

if redis.call('ZCARD', key) >= max_attempts then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {0, oldest[2]}
end

redis.call('ZADD', key, now, member)
-- Re-armed on every reservation, so a bucket nobody touches for a full window reaps itself and
-- the keyspace stays proportional to recent attempts rather than to every address that has ever
-- mistyped a password.
redis.call('EXPIRE', key, window)
return {1, '0'}
"""


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
class LoginAttempt:
    """A reservation, and what it costs to give back.

    `member` and `reserved_keys` are how `release_login_attempt` removes precisely what this
    request added and nothing else. They are not diagnostics — dropping them from the return
    value is what turns the release back into the bucket-wide delete this design replaced.
    """

    allowed: bool
    retry_after_seconds: int
    member: str
    reserved_keys: tuple[str, ...]


UNTHROTTLED = LoginAttempt(allowed=True, retry_after_seconds=0, member="", reserved_keys=())


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
    redis: Redis,
    *,
    client_ip: str | None,
    email: str,
    policies: LoginRateLimitPolicies,
) -> LoginAttempt:
    """Take a slot in every armed bucket, or refuse and take none.

    One answer covering both buckets, deliberately: the caller must not be able to tell the
    client which limit tripped, because "your email is throttled" answers a question an
    unauthenticated caller may not ask.
    """
    now = time.time()

    try:
        attempt = _reserve_every_bucket(
            redis,
            buckets=_buckets(client_ip=client_ip, email=email, policies=policies),
            now=now,
            member=uuid.uuid4().hex,
        )
    except RedisError:
        # Fail OPEN, and do not "fix" this to fail closed. Redis is a cache-tier dependency
        # here; making it a hard dependency of login means a Redis blip locks every admin and
        # tutor out of the system, which is a worse and far more likely failure than the
        # unthrottled state that existed before this module. Availability of the login path
        # outranks the limiter that protects it.
        attempt = UNTHROTTLED

    return attempt


def release_login_attempt(redis: Redis, *, attempt: LoginAttempt) -> None:
    """Give back the slots this attempt reserved, after it turns out not to be a failure."""
    try:
        _release(redis, attempt=attempt)
    except RedisError:
        # Same reasoning as `reserve_login_attempt`: an unreleased reservation costs one
        # legitimate user one slot for one window, an unanswerable login is an outage.
        pass


def _reserve_every_bucket(
    redis: Redis,
    *,
    buckets: list[tuple[str, RateLimitPolicy]],
    now: float,
    member: str,
) -> LoginAttempt:
    # Built once for both buckets. `register_script` only sha1s the source locally; the round
    # trip is the EVALSHA in the call below, with redis-py falling back to EVAL if the server
    # has never seen this script.
    reserve = redis.register_script(RESERVE_ATTEMPT_SCRIPT)
    reserved: list[str] = []
    refusals: list[int] = []

    for key, policy in buckets:
        # Every bucket is consulted even after one has refused, so `Retry-After` reports the
        # longest wait rather than the first: the attempt is blocked until all of them allow it.
        admitted, oldest_score = reserve(
            keys=[key], args=[now, policy.window_seconds, policy.max_attempts, member]
        )
        if admitted:
            reserved.append(key)
        else:
            refusals.append(max(1, ceil(float(oldest_score) + policy.window_seconds - now)))

    attempt = LoginAttempt(
        allowed=not refusals,
        retry_after_seconds=max(refusals, default=0),
        member=member,
        reserved_keys=tuple(reserved),
    )

    if refusals:
        # A refused attempt never reaches the password check, so it is not a failed attempt and
        # must not be charged to whichever bucket did admit it. Without this, hammering one
        # throttled account would drain the shared IP budget and lock out everyone else behind
        # that address — the limiter turning into the denial of service it exists to prevent.
        _release(redis, attempt=attempt)
        attempt = LoginAttempt(
            allowed=False,
            retry_after_seconds=attempt.retry_after_seconds,
            member=member,
            reserved_keys=(),
        )

    return attempt


def _release(redis: Redis, *, attempt: LoginAttempt) -> None:
    # ZREM of this request's own member, never DEL of the key. See the module docstring: a
    # bucket-wide delete makes the counter observable shared state and reopens the account
    # enumeration side channel.
    pipeline = redis.pipeline()
    for key in attempt.reserved_keys:
        pipeline.zrem(key, attempt.member)
    pipeline.execute()


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
