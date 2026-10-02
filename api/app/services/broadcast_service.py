"""Fan-out of the live-update events to every admin socket in the deployment (REQ-P7.4).

Three call sites want one way to say "a message was recorded" or "a conversation changed": the
webhook (on every inbound message and on the bot's reply), the takeover path, and the socket's
own `send` handler; and the status callback wants "a message's delivery status moved". This
module is that one way.

**It is PostgreSQL `LISTEN`/`NOTIFY` and not an in-process `set[WebSocket]`, and the difference
is invisible until it matters (P7-K).** More than one API process exists on every topology this
project runs: ECS deploys are canaries, so the outgoing and incoming tasks serve side by side
for the length of every deploy; autoscaling may add a second task; and `uvicorn --workers N`
does the same on one host. Twilio's POST and an admin's WebSocket are two independent
connections with no affinity to each other, so they land on different processes routinely.
With an in-process registry the webhook broadcasts into process A's empty set while the admin
sits on process B: nothing raises, nothing logs, the socket stays open and healthy, and the
admin simply never sees the client's message. The contract's own safety net
(`docs/api-design.md:1668-1673` — the socket is not a delivery guarantee, refetch on reconnect)
never fires, because nothing tells the client to reconnect. The database is already the one
thing every process shares, so the fan-out adds no infrastructure.

**The channel is `chat_broadcast`, and it is shared with nothing.** It is a PostgreSQL
identifier — `LISTEN` takes an identifier, not a string — so it is written without anything
that would need quoting. No other code in this project listens or notifies.

**One channel for the whole deployment, not one per conversation.** The socket is
conversation-wide by contract (`api-design.md:1602-1606`), so per-conversation channels would
buy no filtering and would add a subscription lifecycle to get wrong.

**A notice carries ids, never the payload.** PostgreSQL refuses a `NOTIFY` payload of 8000
bytes or more, and a WhatsApp body alone can exceed that once it is UTF-8 encoded, so a
`MessageCreated` that carried its message would be refused for exactly the long messages an
admin most needs to see. `publish` sends `{type, message_id, client_message_id}`, `{type, message_id}` or
`{type, conversation_id}` instead, and the one
subscriber in each process — the socket route's pump — reads the row back and rebuilds the
event with the same functions `GET /api/conversations/...` serialises with. That makes the
socket frame identical to what the REST refetch returns, by construction rather than by two
serialisers agreeing. `client_message_id` is the one field the database cannot give back, so it
travels in the notice; it is the only unbounded one, and is dropped (with a warning) on the one
path that could push a notice past the cap — the composer's bubble then reconciles on refetch.

**Publishing is synchronous, after the commit, on its own short connection.** The publishers
are ordinary `def` routes, and each calls this only once the write it announces is committed:
the pump rebuilds from the database, so a notice that raced its row would find nothing and be
dropped. The `pg_notify` runs in its own transaction that commits at once, which also keeps two
notices from being folded into one — PostgreSQL delivers identical payloads sent inside one
transaction only once.

**Subscribing is asynchronous, on one dedicated connection per process.** `listen` opens a
single `psycopg.AsyncConnection` in autocommit mode — `LISTEN` takes effect only when its
transaction commits, so a listener inside a transaction is silently subscribed to nothing — and
never opens a transaction afterwards, because a session idling in one blocks the server from
cleaning its notification queue. **No connection pooler may ever sit on that connection.** A
pooled connection (RDS Proxy, PgBouncer in transaction mode) is handed to whoever asks next, so
the `LISTEN` would stay behind on a server connection this process no longer holds — the
in-process-registry bug one layer down, and just as silent. If a proxy is ever added for the
publishers, this one connection bypasses it.

**`publish` fails open, and logs.** A `SQLAlchemyError` here is swallowed rather than raised,
because every publisher calls this *after* its write is committed: raising would turn a
database error on the notify into a 500 on the webhook — which Twilio then retries for hours
while the parent waits on a reply the API is refusing to return — or a 500 on a takeover that
actually succeeded. Failing closed does not get the event to the admin either, so it buys
nothing for the reader it is meant to protect and costs a completed, user-visible action. It
logs because the dropped event is otherwise untraceable.

No FastAPI import anywhere in this module (CONSTITUTION §6): a socket is registered through the
structural `EventSink` protocol, which `starlette.websockets.WebSocket` satisfies as it stands.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import aclosing, asynccontextmanager
from typing import Annotated, Literal, Protocol

import psycopg
from psycopg import sql
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from sqlalchemy import text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError

from app.config import get_settings
from app.db import engine

CHANNEL = "chat_broadcast"

# PostgreSQL's cap is "shorter than 8000 bytes"; the margin keeps a notice clear of it without
# anyone having to count the JSON punctuation around the ids.
NOTICE_LIMIT_BYTES = 7900

# How long the listener waits in silence before it proves the connection is still there. A
# connection that died without a word — a dropped route, not a terminated backend — raises
# nothing on its own, and the pump would sit on it serving no one.
LIVENESS_SECONDS = 30

_NOTIFY = text("SELECT pg_notify(:channel, :payload)")
_LISTEN = sql.SQL("LISTEN {}").format(sql.Identifier(CHANNEL))

logger = logging.getLogger(__name__)


class _Event(BaseModel):
    """Frozen so the three publishers cannot disagree about one event by editing it in flight."""

    model_config = ConfigDict(frozen=True)

    def frame(self) -> dict[str, object]:
        """The server frame exactly as `api-design.md:1634-1653` specifies it.

        `exclude_none` drops `client_message_id` when this is not echoing a send — the contract
        lists it as present only then, and the dashboard's `MessageCreatedFrame` types it
        optional. It does **not** reach into `message` or `conversation`: those are already
        serialised payloads, and a `null` inside one is a real field the client expects.
        """
        return self.model_dump(mode="json", exclude_none=True)


class MessageCreated(_Event):
    """A message was recorded, whatever its author.

    `message` is an already-serialised `MessageRead` — this module carries the payload and
    knows nothing about `messages` beyond that. `client_message_id` is echoed back on a send so
    the composer can match its optimistic bubble to the persisted row instead of rendering the
    message twice (`api-design.md:1662-1666`).
    """

    type: Literal["message.created"] = "message.created"
    conversation_id: uuid.UUID
    message: dict[str, object]
    client_message_id: str | None = None


class ConversationUpdated(_Event):
    """A takeover was claimed or released, or `last_message_at` moved.

    `conversation` is an already-serialised `ConversationRead`.
    """

    type: Literal["conversation.updated"] = "conversation.updated"
    conversation: dict[str, object]


class MessageUpdated(_Event):
    """A message's delivery status moved: Twilio's status callback advanced the row.

    `message` is an already-serialised `MessageRead`, as on `MessageCreated`. There is no echo:
    nothing about a status change originates in a composer.
    """

    type: Literal["message.updated"] = "message.updated"
    conversation_id: uuid.UUID
    message: dict[str, object]


type BroadcastEvent = MessageCreated | ConversationUpdated | MessageUpdated


class _Notice(BaseModel):
    model_config = ConfigDict(frozen=True)


class MessageNotice(_Notice):
    """What crosses the channel for a `MessageCreated`: the row to read back, and the echo."""

    type: Literal["message.created"] = "message.created"
    message_id: uuid.UUID
    client_message_id: str | None


class ConversationNotice(_Notice):
    """What crosses the channel for a `ConversationUpdated`: the row to read back."""

    type: Literal["conversation.updated"] = "conversation.updated"
    conversation_id: uuid.UUID


class MessageUpdatedNotice(_Notice):
    """What crosses the channel for a `MessageUpdated`: the row to read back."""

    type: Literal["message.updated"] = "message.updated"
    message_id: uuid.UUID


type Notice = MessageNotice | ConversationNotice | MessageUpdatedNotice

_notice_adapter: TypeAdapter[Notice] = TypeAdapter(Annotated[Notice, Field(discriminator="type")])


class EventSink(Protocol):
    """What the local fan-out needs of a connected socket, and nothing more.

    Structural rather than `WebSocket` so that §6 holds: this module never imports FastAPI or
    Starlette, and a test can register an object that counts or raises.
    """

    async def send_json(self, data: object) -> None: ...


_sinks: set[EventSink] = set()


def publish(event: BroadcastEvent) -> None:
    """Announce one event to every API process, including this one. Call after the commit.

    Fails open on a database error — see the module docstring. Only `SQLAlchemyError` is
    swallowed; a serialisation bug is a bug and travels.
    """
    payload = _notice_for(event).model_dump_json()

    try:
        with _notify_engine().begin() as connection:
            connection.execute(_NOTIFY, {"channel": CHANNEL, "payload": payload})
    except SQLAlchemyError:
        logger.exception(
            "dropped a %s broadcast: the notify did not reach the database", event.type
        )


@asynccontextmanager
async def listen() -> AsyncIterator[AsyncIterator[Notice]]:
    """Hold this process's one `LISTEN`, and iterate the notices sent on the channel.

    A context manager rather than a bare generator for two reasons. `LISTEN` has executed —
    and, in autocommit, taken effect — before the body runs, so a caller cannot miss a notice
    sent between opening the iterator and the subscription starting; and the connection is
    closed on the way out, including when the pump that owned it is cancelled.

    The iterator never ends quietly: a dropped connection raises `psycopg.Error` into the
    caller's `async for`, because a pump that returns instead would leave every socket in this
    process open, registered, and silently receiving nothing.
    """
    connection = await psycopg.AsyncConnection.connect(listen_dsn(), autocommit=True)
    notices = _notices(connection)

    try:
        await connection.execute(_LISTEN)
        yield notices
    finally:
        await notices.aclose()
        await connection.close()


def listen_dsn() -> str:
    """The application's database, as a libpq URL the raw listener connection can open.

    `DATABASE_URL` is a SQLAlchemy URL (`postgresql+psycopg://`), which libpq refuses. Only the
    driver name changes: the query string carries `sslmode=require` in production, and a
    listener that dropped it would connect in the clear or not at all.
    """
    url = make_url(get_settings().database_url)

    return url.set(drivername="postgresql").render_as_string(hide_password=False)


def register(sink: EventSink) -> None:
    """Add a socket to this process's fan-out."""
    _sinks.add(sink)


def unregister(sink: EventSink) -> None:
    """Remove a socket. Idempotent: the fan-out drops a failing sink on its own."""
    _sinks.discard(sink)


def registered() -> frozenset[EventSink]:
    """The sockets this process is currently fanning out to."""
    return frozenset(_sinks)


async def deliver(event: BroadcastEvent) -> None:
    """Write one event to every socket registered in **this** process.

    The registry is per-process by design: the channel carries the notice between processes
    and this carries the rebuilt event to the sockets inside one. Sends run concurrently so
    that one slow client does not delay the rest, and a sink that raises is dropped rather than
    allowed to fail the whole fan-out.
    """
    frame = event.frame()
    await asyncio.gather(*(_send(sink, frame) for sink in registered()))


def _notice_for(event: BroadcastEvent) -> Notice:
    if isinstance(event, ConversationUpdated):
        notice: Notice = ConversationNotice(conversation_id=event.conversation["id"])
    elif isinstance(event, MessageUpdated):
        notice = MessageUpdatedNotice(message_id=event.message["id"])
    else:
        notice = MessageNotice(
            message_id=event.message["id"], client_message_id=event.client_message_id
        )

        if len(notice.model_dump_json().encode()) >= NOTICE_LIMIT_BYTES:
            logger.warning(
                "dropped an oversized client_message_id from the notice for message %s",
                notice.message_id,
            )
            notice = MessageNotice(message_id=notice.message_id, client_message_id=None)

    return notice


def _notify_engine() -> Engine:
    return engine


async def _notices(connection: psycopg.AsyncConnection) -> AsyncGenerator[Notice, None]:
    while True:
        received = False

        async with aclosing(connection.notifies(timeout=LIVENESS_SECONDS)) as notifies:
            async for notify in notifies:
                received = True
                notice = _parse(notify.payload)

                if notice is not None:
                    yield notice

        if not received:
            await connection.execute("SELECT 1")


def _parse(payload: str) -> Notice | None:
    try:
        notice: Notice | None = _notice_adapter.validate_json(payload)
    except ValidationError:
        # A notice this process cannot read is the canary-deploy case this design exists for,
        # arriving from the other side: two task versions overlap for the whole deploy and one
        # of them may send a shape the other has never seen. Skipping it costs one update;
        # letting it raise would end the pump for every socket in this process.
        logger.warning("skipped an unreadable broadcast notice on %s", CHANNEL)
        notice = None

    return notice


async def _send(sink: EventSink, frame: dict[str, object]) -> None:
    try:
        await sink.send_json(frame)
    except Exception:
        # Broad on purpose, and narrower than it looks: §6 keeps Starlette out of this module,
        # so there is no `WebSocketDisconnect` to name, and a closed socket raises whatever its
        # transport raises. `CancelledError` is a `BaseException` and still propagates, so
        # shutting the pump down is not mistaken for a dead socket.
        unregister(sink)
        logger.warning("dropped a socket that raised on write", exc_info=True)
