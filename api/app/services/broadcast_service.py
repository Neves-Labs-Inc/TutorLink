"""Fan-out of the two live-update events to every admin socket in the deployment (REQ-P7.4).

Three call sites want one way to say "a message was recorded" or "a conversation changed": the
webhook (on every inbound message and on the bot's reply), the takeover path, and the socket's
own `send` handler. This module is that one way.

**It is Redis pub/sub and not an in-process `set[WebSocket]`, and the difference is invisible
until it matters (P7-K).** More than one API process exists on every topology this project
would actually run — `uvicorn --workers N`, the seconds during which `docker compose up -d`
runs the outgoing and incoming containers together, and any later horizontal move. Twilio's
POST and an admin's WebSocket are two independent connections with no affinity to each other,
so they land on different processes routinely. With an in-process registry the webhook
broadcasts into process A's empty set while the admin sits on process B: nothing raises,
nothing logs, the socket stays open and healthy, and the admin simply never sees the client's
message. The contract's own safety net (`docs/api-design.md:1668-1673` — the socket is not a
delivery guarantee, refetch on reconnect) never fires, because nothing tells the client to
reconnect. Redis already carries four concerns here, so `PUBLISH`/`SUBSCRIBE` adds no
infrastructure.

**The channel is `chat:broadcast` and it is shared with nothing.** Epic #9's Traps section
requires the Redis concerns to stay apart: `bot:flow:` (30-minute flow state), `twilio:msg:`
(24-hour webhook dedupe), `ratelimit:login:*` (sliding windows) and Phase 2's refresh-token
revocation. This is a pub/sub channel rather than a key, so it holds no data and has no TTL to
share, but it is named under its own `chat:` prefix so nothing later reaches for a key under
the same name.

**One channel for the whole deployment, not one per conversation.** The socket is
conversation-wide by contract (`api-design.md:1602-1606`), so per-conversation channels would
buy no filtering and would add a subscription lifecycle to get wrong.

**Publishing is synchronous and subscribing is asynchronous, deliberately.** The three
publishers are ordinary `def` routes holding the `Redis` from `Depends(get_redis)`; the one
subscriber is the WebSocket route's pump, which is `async` and must not park a blocking socket
read on a thread it has no way to cancel. `redis.asyncio` ships in the same package, so the
second client costs a connection and no dependency.

**`publish` fails open, and logs.** A `RedisError` here is swallowed rather than raised,
because every publisher calls this *after* its write is committed: raising would turn a Redis
blip into a 500 on the webhook — which Twilio then retries for hours while the parent waits on
a reply the API is refusing to return — or a 500 on a takeover that actually succeeded. Failing
closed does not get the event to the admin either, so it buys nothing for the reader it is
meant to protect and costs a completed, user-visible action. Unlike `rate_limit_service`'s
deliberately silent fail-open, this one logs: the dropped event is otherwise untraceable, and
`GET /readyz` already reports an unreachable Redis to whoever is watching.

No FastAPI import anywhere in this module (CONSTITUTION §6): a socket is registered through the
structural `EventSink` protocol, which `starlette.websockets.WebSocket` satisfies as it stands.
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from redis import Redis
from redis.asyncio import Redis as AsyncRedis
from redis.asyncio.client import PubSub
from redis.exceptions import RedisError

from app.config import get_settings

CHANNEL = "chat:broadcast"

# A subscription that is not confirmed is not a subscription: `SUBSCRIBE` is written to the
# socket without waiting for the server, so a caller that started iterating immediately would
# miss anything published in the window before Redis processed it.
SUBSCRIBE_TIMEOUT_SECONDS = 5.0

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


type BroadcastEvent = MessageCreated | ConversationUpdated

_event_adapter: TypeAdapter[BroadcastEvent] = TypeAdapter(
    Annotated[BroadcastEvent, Field(discriminator="type")]
)


class EventSink(Protocol):
    """What the local fan-out needs of a connected socket, and nothing more.

    Structural rather than `WebSocket` so that §6 holds: this module never imports FastAPI or
    Starlette, and a test can register an object that counts or raises.
    """

    async def send_json(self, data: object) -> None: ...


_sinks: set[EventSink] = set()


def publish(redis: Redis, event: BroadcastEvent) -> None:
    """Send one event to every API process, including this one.

    Fails open on an unreachable Redis — see the module docstring. Only `RedisError` is
    swallowed; a serialisation bug is a bug and travels.
    """
    try:
        redis.publish(CHANNEL, event.model_dump_json(exclude_none=True))
    except RedisError:
        logger.exception("dropped a %s broadcast: Redis is unreachable", event.type)


@asynccontextmanager
async def subscribe(redis: AsyncRedis) -> AsyncIterator[AsyncIterator[BroadcastEvent]]:
    """Hold one subscription to the channel, and iterate the events published on it.

    A context manager rather than a bare generator for two reasons. The subscription is
    established and **confirmed** before the body runs, so a caller cannot miss an event
    published between opening the iterator and Redis processing its `SUBSCRIBE`; and the pubsub
    connection is released on the way out, including when the socket that owned it disconnects.

    The iterator never ends quietly: a dropped connection raises `RedisError` into the caller's
    `async for`, because a pump that returns instead would leave every socket in this process
    open, registered, and silently receiving nothing.
    """
    pubsub = redis.pubsub()
    await pubsub.subscribe(CHANNEL)
    try:
        confirmation = await pubsub.get_message(timeout=SUBSCRIBE_TIMEOUT_SECONDS)
        if confirmation is None or confirmation["type"] != "subscribe":
            raise RedisError(f"Redis did not confirm the subscription to {CHANNEL!r}")

        yield _events(pubsub)
    finally:
        await pubsub.aclose()


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

    The registry is per-process by design: pub/sub carries the event between processes and this
    carries it to the sockets inside one. Sends run concurrently so that one slow client does
    not delay the rest, and a sink that raises is dropped rather than allowed to fail the whole
    fan-out.
    """
    frame = event.frame()
    await asyncio.gather(*(_send(sink, frame) for sink in registered()))


@lru_cache(maxsize=1)
def get_async_redis() -> AsyncRedis:
    """The process-wide async client the subscriber pump runs on.

    Separate from `redis_client.get_redis()` because that one is synchronous and is what the
    publishing routes hold; same URL, same server, its own connection pool. Cached rather than
    built per call for the reason `get_redis`'s docstring gives — a client is a handle onto a
    pool, and one per socket would open a connection per connected admin.
    """
    return AsyncRedis.from_url(get_settings().redis_url, decode_responses=True)


async def _events(pubsub: PubSub) -> AsyncIterator[BroadcastEvent]:
    async for message in pubsub.listen():
        if message["type"] != "message":
            continue

        try:
            event = _event_adapter.validate_json(message["data"])
        except ValidationError:
            # A payload this process cannot read is the rolling-deploy case this design exists
            # for, arriving from the other side: the two containers overlap for seconds and one
            # of them may publish a shape the other has never seen. Skipping it costs one
            # update; letting it raise would end the pump for every socket in this process.
            logger.warning("skipped an unreadable broadcast payload on %s", CHANNEL)
            continue

        yield event


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
