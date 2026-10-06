"""The WebSocket frames `WS /api/conversations/stream` reads and the two it writes itself.

`docs/api-design.md:1634-1653` lists four frames from the server, and only two of them are
built here. `message.created` and `conversation.updated` are `broadcast_service`'s events:
they arrive from any process in the deployment and already serialise themselves through
`BroadcastEvent.frame()`, so a second copy of those shapes in this module would be two answers
to one wire format. `ready` and `error` are the frames the socket writes to its own client and
nobody publishes.

`ErrorFrame` carries `detail`, so a failure on the socket reads exactly like a failure on REST
(`CONSTITUTION.md` §10), plus a `code` only on the window-closed refusal (#109).

There is no `MessageSend` here and no `MessageCreate` in `schemas/message.py`: sending lives on
this socket, and `api-design.md:1655-1660` refuses a REST twin for it outright.
"""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter


class AuthFrame(BaseModel):
    """The first frame, always. The token is read from here and never from the query string —
    a credential in a URL is written into every proxy log, access log and browser history entry
    along the path (`api-design.md:1620-1632`)."""

    type: Literal["auth"]
    access_token: str


class SendFrame(BaseModel):
    """An admin message typed into the composer.

    `client_message_id` is the composer's own id for the optimistic bubble, echoed back on the
    resulting `message.created` so the client can match the persisted row to what it already
    drew instead of rendering the message twice, and so a resend after a reconnect is
    recognised rather than sent again.

    An empty `body` is refused here rather than at Twilio: there is no message to deliver, and
    the row it would record is one an admin cannot have meant to send.
    """

    type: Literal["send"]
    conversation_id: uuid.UUID
    body: str = Field(min_length=1)
    client_message_id: str = Field(min_length=1)


type ClientFrame = AuthFrame | SendFrame

client_frame_adapter: TypeAdapter[ClientFrame] = TypeAdapter(
    Annotated[ClientFrame, Field(discriminator="type")]
)


class ReadyFrame(BaseModel):
    type: Literal["ready"] = "ready"


# The one refusal the composer branches on rather than just showing: the Guardian's 24-hour
# window has closed, so it disables itself and explains why.
WINDOW_CLOSED_CODE = "window_closed"


class ErrorFrame(BaseModel):
    """`code` is set only for a refusal the client acts on, and is left out of the frame
    otherwise, so every other error still reads exactly like a REST error body."""

    type: Literal["error"] = "error"
    detail: str
    code: str | None = None

    def frame(self) -> dict[str, str]:
        return self.model_dump(exclude_none=True)
