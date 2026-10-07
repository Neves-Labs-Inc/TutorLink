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

`twilio_sid` is not on this shape: it exists for the delivery callback to match on. `error_code`
is (#109): a failed line shows why, as a Twilio code (`63016`) or one of the reasons stored
when nothing was sent (`window_closed`, `template_not_approved`). `system_kind` says which
notice a `system` line is, and `reminder_child_names` lists the Children a `booking_reminder`
line named (`null` on every other line).
"""

import datetime
import uuid

from pydantic import BaseModel

from app.models.enums import MessageAuthor, MessageStatus, SystemMessageKind
from app.schemas.conversation import UserRef


class MessageRead(BaseModel):
    id: uuid.UUID
    author_kind: MessageAuthor
    author: UserRef | None
    body: str
    status: MessageStatus
    created_at: datetime.datetime
    system_kind: SystemMessageKind | None
    error_code: str | None
    reminder_child_names: list[str] | None
