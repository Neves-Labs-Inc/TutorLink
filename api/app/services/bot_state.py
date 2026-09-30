"""The bot's live flow state: which step a phone number is on, and what it has collected.

`bot_flow_state`, keyed by phone number, **30-minute TTL** carried in its own `expires_at`
column (`docs/erd.md:484-492`). Nothing here is written to Postgres a second time under another
name (REQ-072.4): what was *said* is relational and lives in `messages`; only *where the parent
is in the flow* is ephemeral, and a second copy of it in a column would be the half that goes
stale.

**Its own table, shared with nothing.** Epic #9's Traps section says in its own words: do not
share ground between the conversation state, the webhook's `MessageSid` dedupe key, the login
rate limiter and Phase 2's refresh-token revocation store. They expire on different clocks for
different reasons, and one shared key or prefix would let one concern's TTL keep another's row
alive, or a delete meant for one wipe another. `bot_flow_state` also carries no foreign key to
`conversations` (`erd.md`): a flow can be mid-intake before a conversation's guardian is known,
and nothing is written to both.

**A missing row is a fresh start, never an error** (REQ-076). `load_state` answers `None` and
the caller opens the flow from the beginning with no stale `collected_data`. So is a row whose
`expires_at` has passed but a nightly reap has not yet deleted — `load_state` filters on
`expires_at` and never returns one. That is also what a conversation held by an admin for more
than thirty minutes gets on release: a takeover does not touch this row and does not freeze its
expiry, decided deliberately at `erd.md:501-504`.

`misses` and `prompt` are the flow machine's own bookkeeping rather than REQ-072.1's
`{step, collected_data}` payload, and they are kept out of `collected_data` on purpose — it is
what makes "the bail-out leaves the state untouched" (REQ-078.2) checkable against the data the
parent actually supplied.

**Nothing here commits** (§4). Every write lands through the caller's `Session`, and the webhook
commits it in the same transaction as everything else the turn wrote — an improvement over a
key-per-write store, since a turn that fails and rolls back no longer leaves an advanced flow
behind.
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.bot_flow_state import BotFlowState

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


def load_state(db: Session, *, phone_number: str) -> FlowState | None:
    """The stored flow, or `None` when the row has expired or was never written.

    Selects columns rather than the `BotFlowState` entity: an instance already held in the
    session's identity map (from a plain `db.get`, say) would otherwise come back unrefreshed,
    and `collected_data` would alias that instance's own dict instead of the row as stored.
    """
    row = db.execute(
        select(
            BotFlowState.step,
            BotFlowState.collected_data,
            BotFlowState.misses,
            BotFlowState.prompt,
        ).where(
            BotFlowState.phone_number == phone_number,
            BotFlowState.expires_at > func.now(),
        )
    ).first()

    if row is None:
        state = None
    else:
        state = FlowState(
            step=row.step,
            collected_data=row.collected_data,
            misses=row.misses,
            prompt=row.prompt,
        )

    return state


def save_state(db: Session, *, phone_number: str, state: FlowState) -> None:
    """Write the flow back and restart the 30-minute clock.

    Every write refreshes `expires_at`, so the window is thirty minutes of *silence* rather than
    thirty minutes from the first message — which is what makes a long intake possible at all.
    The expiry is computed by the database clock, never Python's, so every instance agrees; an
    expired-but-unreaped row is simply overwritten by the upsert.
    """
    # `make_interval`'s positional form: years, months, weeks, days, hours, mins, secs. Only
    # `secs` is non-zero, the same interval `make_interval(secs => ...)` would name.
    stmt = insert(BotFlowState).values(
        phone_number=phone_number,
        step=state.step,
        collected_data=state.collected_data,
        misses=state.misses,
        prompt=state.prompt,
        expires_at=func.now() + func.make_interval(0, 0, 0, 0, 0, 0, FLOW_STATE_TTL_SECONDS),
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[BotFlowState.phone_number],
        set_={
            "step": stmt.excluded.step,
            "collected_data": stmt.excluded.collected_data,
            "misses": stmt.excluded.misses,
            "prompt": stmt.excluded.prompt,
            "expires_at": stmt.excluded.expires_at,
        },
    )
    db.execute(stmt)


def clear_state(db: Session, *, phone_number: str) -> None:
    """Drop the flow. The next message opens a new one from the beginning."""
    db.execute(delete(BotFlowState).where(BotFlowState.phone_number == phone_number))
