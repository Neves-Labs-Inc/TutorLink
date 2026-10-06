"""Request and response shapes for `/api/conversations`.

There is no `ConversationCreate` and no `ConversationUpdate`. Nothing creates a conversation
over HTTP — the webhook opens one on the first inbound message — and of the nine routes exactly
one carries a request body: `FlagHandled`, on `POST /handled`. Takeover and release are empty
POST/DELETE, `POST /read` moves a watermark to now, approve and deny are empty POSTs, and
sending a message lives on the WebSocket rather than on a REST twin
(`docs/api-design.md:1655-1660`).

`FlagHandled` is a compare token, not data to write (`07D-CONTEXT.md` §4b, SA-38): it carries
the `flagged_at` the admin was looking at, and the flag is cleared only while the stored value
is still that one. A flag the bot raised after the admin opened the thread re-stamps
`flagged_at`, so it can never be cleared unseen. The field is `AwareDatetime` so that a
timezone-less value is a 400 at the boundary rather than a naive-versus-aware comparison
`TypeError` — a 500 — under the row lock.

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

`reactivation_request` is on `ConversationRead` only (Phase 7D, `07D-CONTEXT.md` §4): `null`
when nothing is pending, otherwise the child the guardian asked about, with its current
`is_active` so the thread can say when the child is already active again. The list shape does
not carry it — the list's `flag_reason` already carries the badge — and the frozen contract
predates the field (amendment P7D-2), so `docs/` is reported, never patched.

`flagged_at` is on `ConversationRead` only, for the same reason (REQ-134.9): it is the token the
thread echoes back to `POST /handled`, and the list has no Mark handled. The frozen contract's
example body predates it (amendment P7D-5), so `docs/` is reported, never patched.
"""

import datetime
import uuid

from pydantic import AwareDatetime, BaseModel

from app.models.enums import ConversationStatus, FlagReason


class GuardianRef(BaseModel):
    id: uuid.UUID
    name: str


class UserRef(BaseModel):
    id: uuid.UUID
    email: str


class ReactivationChildRef(BaseModel):
    id: uuid.UUID
    name: str
    is_active: bool


class ReactivationRequestRead(BaseModel):
    child: ReactivationChildRef


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
    flagged_at: datetime.datetime | None
    message_count: int
    unread_count: int
    created_at: datetime.datetime
    reactivation_request: ReactivationRequestRead | None
    # The composer's two facts (#109): whether a free-form reply can still reach the Guardian,
    # and the latest client message the 24-hour window is measured from.
    is_window_open: bool
    last_client_message_at: datetime.datetime | None


class FlagHandled(BaseModel):
    flagged_at: AwareDatetime
