"""Response shape for `GET /api/conversations/{id}/messages`.

There is no `MessageCreate`. An admin's outbound message is sent over the WebSocket, whose
frames are `schemas/stream.py`'s, and `docs/api-design.md:1655-1660` refuses a REST twin for it
outright — two paths into one state transition.

**There is no `direction` field**, deliberately. Inbound and outbound are derivable from
`author_kind` — `client` is inbound, `bot` and `admin` are outbound — and carrying both invites
a row where the two disagree (`api-design.md:1539-1543`, `erd.md:311-313`).

`author` is populated only for `author_kind = 'admin'`: a bot message has no user behind it and
a client message is identified by the conversation it is in. It answers "which admin typed
this", which is not the same question as `ConversationRead.taken_over_by`'s "which admin holds
the thread" — a takeover can change hands while the thread stays open.

`twilio_sid` and `error_code` are not on this shape. Neither appears in the contract's response
body and neither means anything to an admin reading a thread; they exist for the delivery
callback to match on.
"""

import datetime
import uuid

from pydantic import BaseModel

from app.models.enums import MessageAuthor, MessageStatus
from app.schemas.conversation import UserRef


class MessageRead(BaseModel):
    id: uuid.UUID
    author_kind: MessageAuthor
    author: UserRef | None
    body: str
    status: MessageStatus
    created_at: datetime.datetime
