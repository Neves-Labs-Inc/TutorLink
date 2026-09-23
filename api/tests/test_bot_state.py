"""`bot_state` — the 30-minute Redis flow state (REQ-072, REQ-076).

Pure units against a double. The double is local rather than `conftest.py`'s `FakeRedis`,
which models only the login reservation script; the four operations this module issues are
`GET`, `SET … EX`, `DEL` and nothing else, and a double that records the TTL it was given is
what makes REQ-072.1's thirty minutes assertable at all.

The two tests that matter beyond their own assertion:

- `test_a_missing_key_reads_as_no_state_rather_than_raising` is REQ-076. Expiry mid-flow is the
  normal case, not an error case, and a `KeyError` here would 500 the webhook and hand Twilio a
  retry loop over a message the parent sent thirty-one minutes after the last one.
- `test_the_flow_prefix_shares_no_ground_with_any_other_redis_key` is epic #9's Traps section.
  Four concerns live in one Redis, on four different clocks, and the failure of sharing a
  prefix is silent in both directions.
"""

import json

import pytest

from app.services.bot_state import (
    FLOW_STATE_PREFIX,
    FLOW_STATE_TTL_SECONDS,
    FlowState,
    clear_state,
    load_state,
    save_state,
    state_key,
)
from app.services.broadcast_service import CHANNEL as BROADCAST_CHANNEL
from app.services.rate_limit_service import EMAIL_BUCKET_PREFIX, IP_BUCKET_PREFIX

PHONE_NUMBER = "+15555550123"

# Task W's `MessageSid` dedupe key, as `07-RESEARCH.md` §2 and epic #9 spell it. A literal
# rather than an import because the webhook is built concurrently with this module and has no
# constant to name yet; the broadcast channel above is imported, so a rename there that
# collided with the flow prefix would fail here rather than in production.
DEDUPE_PREFIX = "twilio:msg:"


class FakeFlowRedis:
    """`GET` / `SET … EX` / `DEL`, in memory, recording the TTL each key was written with."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int | None] = {}

    def get(self, key: str) -> str | None:
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.values[key] = value
        self.ttls[key] = ex

    def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)
            self.ttls.pop(key, None)

    def expire_everything(self) -> None:
        """Stand in for the wall clock passing the TTL, without a `sleep`."""
        self.values.clear()
        self.ttls.clear()


@pytest.fixture
def redis() -> FakeFlowRedis:
    return FakeFlowRedis()


def test_a_saved_state_round_trips_through_redis(redis: FakeFlowRedis) -> None:
    save_state(
        redis,
        phone_number=PHONE_NUMBER,
        state=FlowState(step="book_date", collected_data={"book_subject_id": "x"}, misses=1),
    )

    loaded = load_state(redis, phone_number=PHONE_NUMBER)

    assert loaded == FlowState(
        step="book_date", collected_data={"book_subject_id": "x"}, misses=1, prompt=""
    )


def test_a_missing_key_reads_as_no_state_rather_than_raising(redis: FakeFlowRedis) -> None:
    """REQ-076.1. A message arriving after the TTL starts the flow over, with no error."""
    save_state(redis, phone_number=PHONE_NUMBER, state=FlowState(step="book_date"))
    redis.expire_everything()

    assert load_state(redis, phone_number=PHONE_NUMBER) is None


def test_every_write_carries_the_thirty_minute_ttl(redis: FakeFlowRedis) -> None:
    save_state(redis, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))

    assert FLOW_STATE_TTL_SECONDS == 30 * 60
    assert redis.ttls[state_key(PHONE_NUMBER)] == FLOW_STATE_TTL_SECONDS


def test_a_second_write_restarts_the_ttl_rather_than_leaving_the_first_one_running(
    redis: FakeFlowRedis,
) -> None:
    """The window is thirty minutes of silence, which is what makes a long intake possible."""
    save_state(redis, phone_number=PHONE_NUMBER, state=FlowState(step="intake_name"))
    redis.ttls[state_key(PHONE_NUMBER)] = 12

    save_state(redis, phone_number=PHONE_NUMBER, state=FlowState(step="intake_address"))

    assert redis.ttls[state_key(PHONE_NUMBER)] == FLOW_STATE_TTL_SECONDS


def test_clearing_removes_the_key_so_the_next_message_opens_a_new_flow(
    redis: FakeFlowRedis,
) -> None:
    save_state(redis, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))

    clear_state(redis, phone_number=PHONE_NUMBER)

    assert redis.values == {}
    assert load_state(redis, phone_number=PHONE_NUMBER) is None


def test_two_phone_numbers_hold_two_independent_flows(redis: FakeFlowRedis) -> None:
    save_state(redis, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))
    save_state(redis, phone_number="+15555550999", state=FlowState(step="book_date"))

    clear_state(redis, phone_number=PHONE_NUMBER)

    assert load_state(redis, phone_number=PHONE_NUMBER) is None
    assert load_state(redis, phone_number="+15555550999").step == "book_date"


def test_the_stored_record_is_step_and_collected_data(redis: FakeFlowRedis) -> None:
    """REQ-072.1's payload, plus the machine's own counters — and nothing from Postgres."""
    save_state(
        redis,
        phone_number=PHONE_NUMBER,
        state=FlowState(step="menu", collected_data={"guardian_name": "Ada"}),
    )

    record = json.loads(redis.values[state_key(PHONE_NUMBER)])

    assert record["step"] == "menu"
    assert record["collected_data"] == {"guardian_name": "Ada"}
    assert set(record) == {"step", "collected_data", "misses", "prompt"}


@pytest.mark.parametrize(
    "other_prefix",
    [IP_BUCKET_PREFIX, EMAIL_BUCKET_PREFIX, DEDUPE_PREFIX, BROADCAST_CHANNEL],
)
def test_the_flow_prefix_shares_no_ground_with_any_other_redis_key(other_prefix: str) -> None:
    """REQ-072.2. Sharing a prefix is silent both ways: the dedupe key's 24-hour TTL would keep
    a dead flow alive, and a `DEL` on one concern would wipe another."""
    assert not FLOW_STATE_PREFIX.startswith(other_prefix)
    assert not other_prefix.startswith(FLOW_STATE_PREFIX)


def test_the_key_is_the_prefix_and_the_phone_number(
    redis: FakeFlowRedis,
) -> None:
    save_state(redis, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))

    assert state_key(PHONE_NUMBER) == f"{FLOW_STATE_PREFIX}{PHONE_NUMBER}"
    assert list(redis.values) == [f"{FLOW_STATE_PREFIX}{PHONE_NUMBER}"]
