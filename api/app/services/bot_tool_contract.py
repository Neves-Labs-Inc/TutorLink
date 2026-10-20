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
from app.models.enums import RedactedField


@dataclass(frozen=True)
class ToolContext:
    db: Session
    # A detached copy of the row: not locked, not in the session. The turn applies what a tool
    # changes on it to the row at the end, under the lock. Change the conversation only here.
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
    # The private fields this call saved. The turn marks its own reply with them, since the
    # reply may echo a value back and is recorded after the tools ran (spec §5).
    redacted: tuple[RedactedField, ...] = ()


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    # Strict JSON Schema: additionalProperties false; an optional property is simply not in
    # `required` (never nullable: the API caps union-typed parameters across a request).
    input_schema: dict[str, Any]
    run: Callable[[ToolContext, dict[str, Any]], ToolResult]
