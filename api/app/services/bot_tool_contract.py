"""The shapes every bot agent tool shares with the turn loop (docs/specs/whatsapp-bot-agent.md).

Types only. Each tool module exports `TOOLS: tuple[ToolSpec, ...]`.

- A rule refusal is `ToolResult(status="refused")`, carrying `{"reason": ...}` in `content`.
- Any exception raised by `run` is an unexpected tool error; the turn loop treats it as an
  outage.
- Write tools are idempotent: a retried identical call doesn't save twice.
"""

import datetime
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.conversation import Conversation


@dataclass(frozen=True)
class ToolContext:
    db: Session
    # Row-locked by the turn.
    conversation: Conversation
    # Aware UTC instant for this turn.
    now: datetime.datetime


@dataclass(frozen=True)
class CommittedAction:
    kind: Literal["book", "cancel", "reschedule"]
    # The saved (new or cancelled) Booking.
    booking_id: uuid.UUID


@dataclass(frozen=True)
class ToolResult:
    status: Literal["ok", "refused"]
    # JSON the model sees; a refusal carries {"reason": ...}. `Any` because it is free JSON.
    content: dict[str, Any]
    # A successful save, proposal, commit or handoff.
    progress: bool = False
    # Set only by `commit_proposal`.
    committed: tuple[CommittedAction, ...] = ()


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    # Strict JSON Schema: additionalProperties false, every property required (nullable when
    # optional).
    input_schema: dict[str, Any]
    run: Callable[[ToolContext, dict[str, Any]], ToolResult]
