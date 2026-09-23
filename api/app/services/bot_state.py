"""The bot's live flow state: which step a phone number is on, and what it has collected.

Redis, keyed by phone number, **30-minute TTL** (`docs/erd.md:484-492`). Nothing here is
written to Postgres as well (REQ-072.4): what was *said* is relational and lives in
`messages`; only *where the parent is in the flow* is ephemeral, and a second copy of it in a
column would be the half that goes stale.

**The key prefix is `bot:flow:` and it is shared with nothing.** Epic #9's Traps section says
in its own words: do not share a TTL or a key prefix between the conversation state, the
webhook's `MessageSid` dedupe key (`twilio:msg:`, 24h) and Phase 2's refresh-token revocation
store. They expire on different clocks for different reasons, and one prefix would let a
dedupe key's 24-hour TTL keep a dead flow alive — or a `DEL` on one concern wipe another.

**A missing key is a fresh start, never an error** (REQ-076). `load_state` answers `None` and
the caller opens the flow from the beginning with no stale `collected_data`. That is also what
a conversation held by an admin for more than thirty minutes gets on release: a takeover does
not touch this key and does not freeze the TTL, decided deliberately at `erd.md:501-504`.

`misses` and `prompt` are the flow machine's own bookkeeping rather than REQ-072.1's
`{step, collected_data}` payload, and they are kept out of `collected_data` on purpose — it is
what makes "the bail-out leaves the state untouched" (REQ-078.2) checkable against the data
the parent actually supplied.
"""

import json
from dataclasses import dataclass, field
from typing import Any

from redis import Redis

FLOW_STATE_PREFIX = "bot:flow:"
FLOW_STATE_TTL_SECONDS = 30 * 60


@dataclass(slots=True)
class FlowState:
    """One phone number's position in one flow.

    Mutable, unlike this codebase's other transfer objects: a turn's handler advances the same
    record the turn loaded, and `reply_for` writes it back once at the end of the turn.
    """

    step: str
    collected_data: dict[str, Any] = field(default_factory=dict)
    misses: int = 0
    prompt: str = ""


def state_key(phone_number: str) -> str:
    return f"{FLOW_STATE_PREFIX}{phone_number}"


def load_state(redis: Redis, *, phone_number: str) -> FlowState | None:
    """The stored flow, or `None` when the key has expired or was never written."""
    raw = redis.get(state_key(phone_number))

    if raw is None:
        state = None
    else:
        record = json.loads(raw)
        state = FlowState(
            step=record["step"],
            collected_data=record["collected_data"],
            misses=record["misses"],
            prompt=record["prompt"],
        )

    return state


def save_state(redis: Redis, *, phone_number: str, state: FlowState) -> None:
    """Write the flow back and restart the 30-minute clock.

    Every write refreshes the TTL, so the window is thirty minutes of *silence* rather than
    thirty minutes from the first message — which is what makes a long intake possible at all.
    """
    record = {
        "step": state.step,
        "collected_data": state.collected_data,
        "misses": state.misses,
        "prompt": state.prompt,
    }
    redis.set(state_key(phone_number), json.dumps(record), ex=FLOW_STATE_TTL_SECONDS)


def clear_state(redis: Redis, *, phone_number: str) -> None:
    """Drop the flow. The next message opens a new one from the beginning."""
    redis.delete(state_key(phone_number))
