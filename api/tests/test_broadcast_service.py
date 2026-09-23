"""`broadcast_service`: the Redis pub/sub fan-out behind the admin socket (REQ-P7.4).

**The first test here is the whole point of the module and the one way to get this file
wrong.** A test that publishes and subscribes on a single connection passes against an
in-process `set[WebSocket]` registry, which is exactly the design P7-K exists to refuse — so it
would prove nothing while looking like proof. Every cross-process assertion below therefore
publishes through one client and receives through another, and runs against a live Redis or
skips loudly; a double modelling pub/sub in memory would be the single-connection test wearing
a costume.

The registry tests are the other half: pub/sub carries an event between processes, and the
per-process registry carries it to the sockets inside one. Those run against fake sinks,
because the property under test — a socket that raises is dropped and the others still get the
event — is one no healthy WebSocket will produce on demand.
"""

import asyncio
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Callable, Generator
from pathlib import Path

import pytest
from redis import Redis
from redis.asyncio import Redis as AsyncRedis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import RedisError

from app.services import broadcast_service
from app.services.broadcast_service import (
    CHANNEL,
    BroadcastEvent,
    ConversationUpdated,
    MessageCreated,
    deliver,
    get_async_redis,
    publish,
    register,
    registered,
    subscribe,
    unregister,
)

RECEIVE_TIMEOUT_SECONDS = 5.0

CONVERSATION_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")

# The other process. It imports the same module and calls the same `publish`, so what crosses
# the boundary is the real wire format and not a payload this test wrote by hand.
PUBLISH_SCRIPT = """
import sys

from app.redis_client import get_redis
from app.services.broadcast_service import MessageCreated, publish

publish(get_redis(), MessageCreated.model_validate_json(sys.argv[1]))
"""


class FakeSink:
    """A socket for the fan-out's purposes: something with an awaitable `send_json`."""

    def __init__(self, *, fail_with: Exception | None = None) -> None:
        self.received: list[object] = []
        self.fail_with = fail_with

    async def send_json(self, data: object) -> None:
        if self.fail_with is not None:
            raise self.fail_with

        self.received.append(data)


def _message_created(*, client_message_id: str | None = None) -> MessageCreated:
    return MessageCreated(
        conversation_id=CONVERSATION_ID,
        message={"id": "abcd", "body": "hello", "twilio_sid": None},
        client_message_id=client_message_id,
    )


@pytest.fixture(autouse=True)
def _empty_registry() -> Generator[None, None, None]:
    """The registry is module state, so a leak from one test is a failure in the next one."""
    yield

    for sink in registered():
        unregister(sink)


@pytest.fixture
def live_redis() -> Generator[Redis, None, None]:
    """A real publisher on `REDIS_URL`, or a clean skip when nothing is listening.

    Mirrors `test_auth_rate_limit.py`'s `live_redis_factory`, for the same reason: the
    assertion is worthless against a double and equally worthless as a test that quietly
    disappears.
    """
    from app.config import get_settings

    client = Redis.from_url(get_settings().redis_url, decode_responses=True)
    try:
        client.ping()
    except RedisError:
        client.close()
        pytest.skip("no Redis on REDIS_URL; the cross-connection assertion needs a real server")

    try:
        yield client
    finally:
        client.close()


def test_an_event_published_by_another_process_is_received_here(live_redis: Redis) -> None:
    """P7-K, and the only test in the suite that can fail when this is an in-process registry.

    `live_redis` is taken for its skip, not its connection: the publisher here is a **second
    interpreter**, calling the same `publish` against the same Redis, which is what the Twilio
    webhook and an admin's WebSocket landing on two `uvicorn --workers` processes — or on the
    outgoing and incoming containers of a rolling deploy — actually look like. A registry held
    in module state passes every other test in this file and fails this one.
    """
    event = _message_created()

    received = asyncio.run(_receive(1, while_publishing=lambda: _publish_from_a_subprocess(event)))

    assert received == [event]


def test_an_event_published_on_one_connection_is_received_on_another(live_redis: Redis) -> None:
    """The same property at connection granularity, cheaply enough to parametrise over.

    Two clients, two connections, one interpreter. It is the subprocess test above that rules
    out an in-process registry; this one guards the serialisation either way.
    """
    event = _message_created()

    received = asyncio.run(_publish_and_receive(live_redis, [event]))

    assert received == [event]


@pytest.mark.parametrize(
    "event",
    [
        _message_created(),
        _message_created(client_message_id="composer-1"),
        ConversationUpdated(conversation={"id": str(CONVERSATION_ID), "status": "human"}),
    ],
    ids=["message.created", "message.created echoing a send", "conversation.updated"],
)
def test_every_event_shape_survives_the_round_trip(
    live_redis: Redis, event: BroadcastEvent
) -> None:
    """Three call sites serialise through this module; none of them may lose a field."""
    received = asyncio.run(_publish_and_receive(live_redis, [event]))

    assert received == [event]


def test_an_unreadable_payload_is_skipped_and_the_pump_keeps_serving(live_redis: Redis) -> None:
    """The rolling-deploy case, arriving from the other side.

    Two containers overlap for the seconds it takes to cut over, so one of them can publish a
    shape the other has never seen. Ending the pump there would leave every socket in this
    process open, registered and silently receiving nothing — which is the failure this whole
    module exists to prevent, reintroduced one layer up.
    """
    event = _message_created()

    def publish_both() -> None:
        live_redis.publish(CHANNEL, '{"type":"message.created"}')
        publish(live_redis, event)

    received = asyncio.run(_receive(1, while_publishing=publish_both))

    assert received == [event]


def test_publish_drops_the_event_when_redis_is_unreachable() -> None:
    """Fail open, on purpose.

    Every publisher calls this after its write is committed, so raising would turn a Redis blip
    into a 500 on a webhook Twilio then retries for hours, or on a takeover that succeeded.
    Failing closed would not get the event to the admin either.
    """
    publish(_UnreachableRedis(), _message_created())


def test_publish_does_not_swallow_a_failure_that_is_not_redis() -> None:
    """The fail-open clause is `RedisError` and nothing wider; a bug still travels."""
    with pytest.raises(TypeError):
        publish(_BrokenRedis(), _message_created())


def test_every_registered_sink_receives_the_event() -> None:
    sinks = [FakeSink(), FakeSink()]
    for sink in sinks:
        register(sink)

    asyncio.run(deliver(_message_created()))

    assert [sink.received for sink in sinks] == [[_message_created().frame()]] * 2


def test_a_sink_that_raises_is_unregistered_and_delivery_continues() -> None:
    """One dead socket must cost one socket, not the fan-out."""
    failing = FakeSink(fail_with=RuntimeError("socket is closed"))
    healthy = FakeSink()
    register(failing)
    register(healthy)

    asyncio.run(deliver(_message_created()))

    assert healthy.received == [_message_created().frame()]
    assert registered() == frozenset({healthy})


def test_unregistering_stops_delivery_and_leaves_nothing_behind() -> None:
    sink = FakeSink()
    register(sink)
    unregister(sink)

    asyncio.run(deliver(_message_created()))

    assert sink.received == []
    assert registered() == frozenset()


def test_the_subscriber_client_is_one_per_process() -> None:
    """A client is a handle onto a pool; one per connected admin would be one connection each."""
    assert get_async_redis() is get_async_redis()


def test_unregistering_a_sink_that_is_already_gone_is_a_no_op() -> None:
    """The fan-out drops a failing sink itself, so the socket's own cleanup arrives second."""
    sink = FakeSink(fail_with=RuntimeError("socket is closed"))
    register(sink)

    asyncio.run(deliver(_message_created()))
    unregister(sink)

    assert registered() == frozenset()


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        (
            _message_created(),
            {
                "type": "message.created",
                "conversation_id": str(CONVERSATION_ID),
                "message": {"id": "abcd", "body": "hello", "twilio_sid": None},
            },
        ),
        (
            _message_created(client_message_id="composer-1"),
            {
                "type": "message.created",
                "conversation_id": str(CONVERSATION_ID),
                "message": {"id": "abcd", "body": "hello", "twilio_sid": None},
                "client_message_id": "composer-1",
            },
        ),
        (
            ConversationUpdated(conversation={"id": "c1", "taken_over_by": None}),
            {"type": "conversation.updated", "conversation": {"id": "c1", "taken_over_by": None}},
        ),
    ],
    ids=["message.created", "message.created echoing a send", "conversation.updated"],
)
def test_the_frame_is_the_one_the_contract_specifies(
    event: BroadcastEvent, expected: dict[str, object]
) -> None:
    """`api-design.md:1634-1653`, and the dashboard's `MessageCreatedFrame`.

    `client_message_id` is present only when echoing a send, and the `null`s inside the
    already-serialised payload are fields the client expects rather than absences to drop.
    """
    assert event.frame() == expected


def test_the_module_imports_no_web_framework() -> None:
    """CONSTITUTION §6: a service knows nothing about FastAPI."""
    source = Path(broadcast_service.__file__).read_text()

    assert "import fastapi" not in source
    assert "from fastapi" not in source
    assert "starlette" not in source.replace("starlette.websockets.WebSocket", "")


async def _publish_and_receive(redis: Redis, events: list[BroadcastEvent]) -> list[BroadcastEvent]:
    return await _receive(
        len(events), while_publishing=lambda: [publish(redis, event) for event in events]
    )


async def _receive(count: int, *, while_publishing: Callable[[], object]) -> list[BroadcastEvent]:
    """Subscribe, publish, and collect `count` events, or fail rather than hang.

    The async client is built inside the running loop and closed with it: `asyncio.run` gives
    every test its own loop, and a connection pooled on a loop that has ended is not reusable.
    """
    from app.config import get_settings

    redis = AsyncRedis.from_url(get_settings().redis_url, decode_responses=True)
    try:
        async with subscribe(redis) as events:
            while_publishing()

            return await asyncio.wait_for(_take(events, count), timeout=RECEIVE_TIMEOUT_SECONDS)
    finally:
        await redis.aclose()


async def _take(events: AsyncIterator[BroadcastEvent], count: int) -> list[BroadcastEvent]:
    received = []
    async for event in events:
        received.append(event)
        if len(received) == count:
            break

    return received


def _publish_from_a_subprocess(event: BroadcastEvent) -> None:
    """Run the real `publish` in a second interpreter, against the same Redis.

    The child inherits this process's environment, which `conftest.py` has already filled with
    the settings `app.config` requires, and runs from the `api/` directory so `app` imports.
    """
    api_directory = Path(broadcast_service.__file__).parents[2]
    completed = subprocess.run(
        [sys.executable, "-c", PUBLISH_SCRIPT, event.model_dump_json()],
        cwd=api_directory,
        capture_output=True,
        text=True,
        timeout=RECEIVE_TIMEOUT_SECONDS * 2,
    )

    assert completed.returncode == 0, completed.stderr


class _UnreachableRedis:
    def publish(self, channel: str, payload: str) -> int:
        raise RedisConnectionError("connection refused")


class _BrokenRedis:
    def publish(self, channel: str, payload: str) -> int:
        raise TypeError("publish() takes no keyword arguments")
