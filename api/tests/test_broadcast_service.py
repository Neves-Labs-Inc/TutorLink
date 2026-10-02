"""`broadcast_service`: the PostgreSQL `LISTEN`/`NOTIFY` fan-out behind the admin socket (REQ-P7.4).

**The first test here is the whole point of the module and the one way to get this file
wrong.** A test that notifies and listens inside one process passes against an in-process
`set[WebSocket]` registry, which is exactly the design P7-K exists to refuse — so it would prove
nothing while looking like proof. The first test therefore notifies from a **second
interpreter**, and every other channel assertion notifies on one connection and listens on
another, against the real test database. `LISTEN`/`NOTIFY` are per-database, so every party —
this process's listener, its `publish`, and the second interpreter — is pointed at the same
`<database>_test`; a double modelling the channel in memory would be the single-connection test
wearing a costume.

**A notice carries ids, never the payload,** so the wire format is asserted on a raw `psycopg`
listener rather than through `listen()`: what crosses the channel is the pinned
`{"type", "message_id" | "conversation_id", "client_message_id"}` and nothing else, and a
20 000-character message still fits because its body never travels.

The registry tests are the other half: the channel carries a notice between processes, and the
per-process registry carries the rebuilt event to the sockets inside one. Those run against fake
sinks, because the property under test — a socket that raises is dropped and the others still
get the event — is one no healthy WebSocket will produce on demand.
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Callable, Generator
from pathlib import Path
from types import SimpleNamespace

import psycopg
import pytest
from psycopg import sql
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.services import broadcast_service
from app.services.broadcast_service import (
    CHANNEL,
    LIVENESS_SECONDS,
    BroadcastEvent,
    ConversationNotice,
    ConversationUpdated,
    MessageCreated,
    MessageNotice,
    MessageUpdated,
    MessageUpdatedNotice,
    Notice,
    deliver,
    listen,
    listen_dsn,
    publish,
    register,
    registered,
    unregister,
)

RECEIVE_TIMEOUT_SECONDS = 5.0

# PostgreSQL's own cap on a NOTIFY payload: "shorter than 8000 bytes".
NOTIFY_PAYLOAD_CAP_BYTES = 8000

LISTENER_NAME = "tutorlink-broadcast-test-listener"

CONVERSATION_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
MESSAGE_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")

# The other process. It imports the same module and calls the same `publish`, so what crosses
# the boundary is the real wire format and not a payload this test wrote by hand.
PUBLISH_SCRIPT = """
import sys

from app.services.broadcast_service import MessageCreated, publish

publish(MessageCreated.model_validate_json(sys.argv[1]))
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


def _message_created(
    *, client_message_id: str | None = None, body: str = "hello"
) -> MessageCreated:
    return MessageCreated(
        conversation_id=CONVERSATION_ID,
        message={"id": str(MESSAGE_ID), "body": body, "twilio_sid": None},
        client_message_id=client_message_id,
    )


def _message_updated() -> MessageUpdated:
    return MessageUpdated(
        conversation_id=CONVERSATION_ID,
        message={"id": str(MESSAGE_ID), "status": "delivered"},
    )


@pytest.fixture(autouse=True)
def _empty_registry() -> Generator[None, None, None]:
    """The registry is module state, so a leak from one test is a failure in the next one."""
    yield

    for sink in registered():
        unregister(sink)


@pytest.fixture
def test_database(_test_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Engine:
    """Both ends of the channel on the test database.

    `publish` notifies through `_notify_engine` and `listen` connects through `listen_dsn`, and
    both default to the application's database. A notice sent on one database is never seen by
    a listener on another, so pointing only one of them here would make every test time out.
    The listener carries an `application_name` so a test can find its backend and kill it.
    """
    monkeypatch.setattr(broadcast_service, "_notify_engine", lambda: _test_engine)
    monkeypatch.setattr(broadcast_service, "listen_dsn", lambda: _listener_dsn(_test_engine))

    return _test_engine


@pytest.fixture
def raw_listener(test_database: Engine) -> Generator[psycopg.Connection, None, None]:
    """A plain `psycopg` connection listening on the channel, to read the notice as sent."""
    dsn = test_database.url.set(drivername="postgresql").render_as_string(hide_password=False)
    with psycopg.connect(dsn, autocommit=True) as connection:
        connection.execute(sql.SQL("LISTEN {}").format(sql.Identifier(CHANNEL)))
        yield connection


def test_an_event_published_by_another_process_is_received_here(test_database: Engine) -> None:
    """P7-K, and the only test in the suite that can fail when this is an in-process registry.

    The publisher here is a **second interpreter**, calling the same `publish` against the same
    database, which is what the Twilio webhook and an admin's WebSocket landing on two
    `uvicorn --workers` processes — or on the outgoing and incoming tasks of a canary deploy —
    actually look like. A registry held in module state passes every other test in this file
    and fails this one.
    """
    event = _message_created()

    received = asyncio.run(
        _receive(1, while_publishing=lambda: _publish_from_a_subprocess(test_database, event))
    )

    assert received == [MessageNotice(message_id=MESSAGE_ID, client_message_id=None)]


@pytest.mark.parametrize(
    ("event", "expected"),
    [
        (
            _message_created(),
            {"type": "message.created", "message_id": str(MESSAGE_ID), "client_message_id": None},
        ),
        (
            _message_created(client_message_id="composer-1"),
            {
                "type": "message.created",
                "message_id": str(MESSAGE_ID),
                "client_message_id": "composer-1",
            },
        ),
        (
            ConversationUpdated(conversation={"id": str(CONVERSATION_ID), "status": "human"}),
            {"type": "conversation.updated", "conversation_id": str(CONVERSATION_ID)},
        ),
        (
            _message_updated(),
            {"type": "message.updated", "message_id": str(MESSAGE_ID)},
        ),
    ],
    ids=[
        "message.created",
        "message.created echoing a send",
        "conversation.updated",
        "message.updated",
    ],
)
def test_publish_sends_exactly_the_pinned_notice(
    raw_listener: psycopg.Connection, event: BroadcastEvent, expected: dict[str, object]
) -> None:
    """The notice is the seam between B1 and every publisher, and between two task versions
    during a canary deploy: ids and the echo, nothing a reader could not get back from the row."""
    publish(event)

    assert [json.loads(payload) for payload in _payloads(raw_listener, 1)] == [expected]


def test_a_message_too_long_for_a_notice_still_fits_in_one(
    raw_listener: psycopg.Connection,
) -> None:
    """REQ-141.4. Twenty thousand two-byte characters are 40 000 bytes of UTF-8 — five times
    PostgreSQL's cap — and the notice is still a few dozen, because the body never travels."""
    publish(_message_created(body="é" * 20_000))

    [payload] = _payloads(raw_listener, 1)

    assert len(payload.encode()) < NOTIFY_PAYLOAD_CAP_BYTES
    assert json.loads(payload)["message_id"] == str(MESSAGE_ID)


def test_an_oversized_client_message_id_is_dropped_with_a_warning(
    raw_listener: psycopg.Connection, caplog: pytest.LogCaptureFixture
) -> None:
    """The echo is the one unbounded field that travels. Refusing the whole notice would cost
    every other admin the message; dropping the echo costs the sender a bubble that reconciles
    on refetch."""
    with caplog.at_level(logging.WARNING, logger=broadcast_service.__name__):
        publish(_message_created(client_message_id="x" * NOTIFY_PAYLOAD_CAP_BYTES))

    [payload] = _payloads(raw_listener, 1)

    assert json.loads(payload) == {
        "type": "message.created",
        "message_id": str(MESSAGE_ID),
        "client_message_id": None,
    }
    assert "oversized client_message_id" in caplog.text


def test_publish_logs_and_drops_the_event_when_the_database_is_unreachable(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Fail open, on purpose.

    Every publisher calls this after its write is committed, so raising would turn a database
    error on the notify into a 500 on a webhook Twilio then retries for hours, or on a takeover
    that succeeded. Failing closed would not get the event to the admin either. It logs,
    because the dropped event is otherwise untraceable.
    """
    unreachable = create_engine(
        "postgresql+psycopg://nobody@127.0.0.1:1/nothing", connect_args={"connect_timeout": 1}
    )
    monkeypatch.setattr(broadcast_service, "_notify_engine", lambda: unreachable)

    try:
        with caplog.at_level(logging.ERROR, logger=broadcast_service.__name__):
            publish(_message_created())
    finally:
        unreachable.dispose()

    assert "dropped a message.created broadcast" in caplog.text


def test_publish_does_not_swallow_a_failure_that_is_not_the_database(
    test_database: Engine,
) -> None:
    """The fail-open clause is `SQLAlchemyError` and nothing wider; a bug still travels."""
    malformed = MessageCreated(conversation_id=CONVERSATION_ID, message={"body": "no id"})

    with pytest.raises(KeyError):
        publish(malformed)


def test_an_unreadable_notice_is_skipped_and_the_listener_keeps_serving(
    test_database: Engine,
) -> None:
    """The canary-deploy case, arriving from the other side.

    Two task versions overlap for the whole deploy, so one of them can notify a shape the other
    has never seen. Ending the listener there would leave every socket in this process open,
    registered and silently receiving nothing — which is the failure this whole module exists
    to prevent, reintroduced one layer up.
    """
    event = ConversationUpdated(conversation={"id": str(CONVERSATION_ID)})

    def publish_all() -> None:
        for payload in ["not json", '{"type": "message.created"}', '{"type": "shout"}']:
            _notify_raw(test_database, payload)
        publish(event)

    received = asyncio.run(_receive(1, while_publishing=publish_all))

    assert received == [ConversationNotice(conversation_id=CONVERSATION_ID)]


def test_a_message_updated_crosses_the_channel_as_its_own_notice(test_database: Engine) -> None:
    """The round trip: a status change is read back as a `message.updated` notice, never as a
    `message.created` one, or the thread would append the message a second time."""
    received = asyncio.run(_receive(1, while_publishing=lambda: publish(_message_updated())))

    assert received == [MessageUpdatedNotice(message_id=MESSAGE_ID)]


def test_a_quiet_listener_probes_its_connection_and_keeps_serving(
    test_database: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A connection that died without a word raises nothing on its own, so a listener that
    only ever waited would sit on it forever. The probe is what turns silence into a check —
    and it must not cost a notice: one sent after several quiet periods still arrives."""
    monkeypatch.setattr(broadcast_service, "LIVENESS_SECONDS", 0.05)

    async def wait_out_the_quiet_then_publish() -> tuple[list[Notice], str | None]:
        async with listen() as notices:
            taking = asyncio.create_task(_take(notices, 1))
            await asyncio.sleep(0.3)
            last_query = _listener_query(test_database)
            publish(ConversationUpdated(conversation={"id": str(CONVERSATION_ID)}))
            received = await asyncio.wait_for(taking, timeout=RECEIVE_TIMEOUT_SECONDS)

        return received, last_query

    received, last_query = asyncio.run(wait_out_the_quiet_then_publish())

    assert received == [ConversationNotice(conversation_id=CONVERSATION_ID)]
    assert last_query == "SELECT 1"


def test_the_listener_raises_when_its_connection_is_killed(test_database: Engine) -> None:
    """A dropped connection must end the iterator with an error, never quietly.

    The pump turns that error into closing every socket in the process; a listener that simply
    returned, or kept waiting on a dead connection, would leave them open and receiving nothing.
    The wait is bounded by the liveness period and some slack: a terminated backend is noticed
    at once, and a silently dropped one by the next probe.
    """

    async def kill_while_listening() -> None:
        async with listen() as notices:
            _terminate_listener(test_database)
            await asyncio.wait_for(anext(notices), timeout=LIVENESS_SECONDS + 5)

    with pytest.raises(psycopg.OperationalError):
        asyncio.run(kill_while_listening())


def test_the_listener_keeps_the_query_string_of_the_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Production carries `sslmode=require` there; a listener that dropped it would connect in
    the clear or not at all. Only the driver name may change, because libpq refuses
    SQLAlchemy's `postgresql+psycopg`."""
    settings = SimpleNamespace(
        database_url="postgresql+psycopg://app:s3cret@db.example.com:5432/tutorlink?sslmode=require"
    )
    monkeypatch.setattr(broadcast_service, "get_settings", lambda: settings)

    assert listen_dsn() == "postgresql://app:s3cret@db.example.com:5432/tutorlink?sslmode=require"


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
                "message": {"id": str(MESSAGE_ID), "body": "hello", "twilio_sid": None},
            },
        ),
        (
            _message_created(client_message_id="composer-1"),
            {
                "type": "message.created",
                "conversation_id": str(CONVERSATION_ID),
                "message": {"id": str(MESSAGE_ID), "body": "hello", "twilio_sid": None},
                "client_message_id": "composer-1",
            },
        ),
        (
            ConversationUpdated(conversation={"id": "c1", "taken_over_by": None}),
            {"type": "conversation.updated", "conversation": {"id": "c1", "taken_over_by": None}},
        ),
        (
            _message_updated(),
            {
                "type": "message.updated",
                "conversation_id": str(CONVERSATION_ID),
                "message": {"id": str(MESSAGE_ID), "status": "delivered"},
            },
        ),
    ],
    ids=[
        "message.created",
        "message.created echoing a send",
        "conversation.updated",
        "message.updated",
    ],
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


async def _receive(count: int, *, while_publishing: Callable[[], object]) -> list[Notice]:
    """Listen, publish, and collect `count` notices, or fail rather than hang.

    `listen` has executed its `LISTEN` before the body runs, so publishing inside it cannot
    race the subscription.
    """
    async with listen() as notices:
        while_publishing()
        received = await asyncio.wait_for(_take(notices, count), timeout=RECEIVE_TIMEOUT_SECONDS)

    return received


async def _take(notices: AsyncIterator[Notice], count: int) -> list[Notice]:
    received = []
    async for notice in notices:
        received.append(notice)
        if len(received) == count:
            break

    return received


def _payloads(connection: psycopg.Connection, count: int) -> list[str]:
    notifies = connection.notifies(timeout=RECEIVE_TIMEOUT_SECONDS, stop_after=count)
    payloads = [notify.payload for notify in notifies if notify.channel == CHANNEL]

    assert len(payloads) == count, f"expected {count} notices, received {len(payloads)}"

    return payloads


def _notify_raw(engine: Engine, payload: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            text("SELECT pg_notify(:channel, :payload)"), {"channel": CHANNEL, "payload": payload}
        )


def _listener_dsn(engine: Engine) -> str:
    url = engine.url.set(drivername="postgresql").update_query_dict(
        {"application_name": LISTENER_NAME}
    )

    return url.render_as_string(hide_password=False)


def _listener_query(engine: Engine) -> str | None:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT query FROM pg_stat_activity WHERE application_name = :name"),
            {"name": LISTENER_NAME},
        ).scalar_one_or_none()


def _terminate_listener(engine: Engine) -> None:
    with engine.connect() as connection:
        terminated = connection.execute(
            text(
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity"
                " WHERE application_name = :name"
            ),
            {"name": LISTENER_NAME},
        ).all()

    assert terminated, "no listener backend to terminate"


def _publish_from_a_subprocess(engine: Engine, event: BroadcastEvent) -> None:
    """Run the real `publish` in a second interpreter, against the test database.

    The child inherits this process's environment, which `conftest.py` has already filled with
    the settings `app.config` requires, with `DATABASE_URL` replaced by the test database's —
    `NOTIFY` reaches only listeners on the same database — and runs from the `api/` directory
    so `app` imports.
    """
    api_directory = Path(broadcast_service.__file__).parents[2]
    environment = {**os.environ, "DATABASE_URL": engine.url.render_as_string(hide_password=False)}
    completed = subprocess.run(
        [sys.executable, "-c", PUBLISH_SCRIPT, event.model_dump_json()],
        cwd=api_directory,
        env=environment,
        capture_output=True,
        text=True,
        timeout=RECEIVE_TIMEOUT_SECONDS * 2,
    )

    assert completed.returncode == 0, completed.stderr
