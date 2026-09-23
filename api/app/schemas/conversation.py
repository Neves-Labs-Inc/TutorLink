"""Response shapes for `/api/conversations`.

There is no `ConversationCreate` and no `ConversationUpdate`. Nothing creates a conversation
over HTTP — the webhook opens one on the first inbound message — and none of the six routes
carries a request body: takeover and release are empty POST/DELETE, `POST /read` moves a
watermark to now, and sending a message lives on the WebSocket rather than on a REST twin
(`docs/api-design.md:1655-1660`).

`flag_reason` is on both shapes per decision **P7-D** and proposed amendment **P7-2**: the
frozen contract's example bodies at `docs/api-design.md:1440-1457` and `:1471-1485` predate the
decision that `flagged_conversations` becomes two columns on `conversations`, so the field is
built here and `docs/` is reported, never patched (`CONSTITUTION.md` §1).

`ConversationRead` is what the takeover and release routes return too. The contract's example
body at `:1551-1559` shows five of its fields rather than a different shape — an abbreviated
example, not a second model, and returning the whole conversation is what lets the dashboard
replace its row without a second request.

`guardian` is `null` until intake creates the guardian, which is the ordinary state of a thread
the bot is still talking its way through and not an error (`erd.md:264-270`). `taken_over_by` is
`null` exactly when `status` is `bot`; the schema CHECK ties the two, so a holder on a bot
conversation cannot be rendered because it cannot be stored.
"""

import datetime
import uuid

from pydantic import BaseModel

from app.models.enums import ConversationStatus, FlagReason


class GuardianRef(BaseModel):
    id: uuid.UUID
    name: str


class UserRef(BaseModel):
    id: uuid.UUID
    email: str


class ConversationSummary(BaseModel):
    id: uuid.UUID
    phone_number: str
    guardian: GuardianRef | None
    status: ConversationStatus
    taken_over_by: UserRef | None
    last_message_at: datetime.datetime
    # The newest message's body, untruncated: the list decides how much of it fits, and a
    # server-side cut would be a second answer to that question in the wrong place.
    last_message_preview: str | None
    unread: bool
    flag_reason: FlagReason | None


class ConversationRead(BaseModel):
    id: uuid.UUID
    phone_number: str
    guardian: GuardianRef | None
    status: ConversationStatus
    taken_over_by: UserRef | None
    taken_over_at: datetime.datetime | None
    last_message_at: datetime.datetime
    last_read_at: datetime.datetime | None
    flag_reason: FlagReason | None
    message_count: int
    unread_count: int
    created_at: datetime.datetime
