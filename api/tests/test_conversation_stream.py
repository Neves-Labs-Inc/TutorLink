"""`WS /api/conversations/stream`: the handshake, the `send` path, and the fan-out (REQ-092).

**`test_a_message_published_by_another_process_reaches_this_socket` is the only test in this
file that discharges P7-K, and nothing here may be "simplified" into replacing it.** Task B
mutation-tested `broadcast_service`'s own suite: replacing the whole cross-process hop with an
in-process list — the `set[WebSocket]` design P7-K exists to refuse — left 14 of its 16 tests
passing. Two connections inside one interpreter prove nothing about a registry that ignores the
connections it was handed, and neither do two sockets on one `TestClient`. Only a **second
interpreter**, importing the same module and calling the same `publish` against the same
database, can tell the shipped design apart from the forbidden one (**P7-X**). The cheaper tests
below are kept because they guard the frames and the round trip; they are not the proof.

**Every party is on the test database.** `LISTEN`/`NOTIFY` are per-database, so the pump's
listener, this process's `publish` and the second interpreter are all pointed at
`<database>_test`. The pump rebuilds every frame from the row a notice names, so its reads are
pointed there too — at sessions on the `db` fixture's own connection, which is what lets them
see the rows a test wrote inside its rolled-back transaction. A notice issued on that rolled-back
connection would never be delivered, which is why `publish` has its own seam and does not use it.

**The frames are compared with what REST returns for the same row**, not with what the test
published: the notice carries only ids, and the claim under test is that the socket and the
refetch cannot disagree.

The pump-death tests are the same property from the other side. A pump that ends while its
sockets stay open, registered and silently receiving nothing looks healthy from the browser,
and `api-design.md:1668-1673`'s safety net — the socket is not a delivery guarantee, the client
refetches on reconnect — only fires if something makes the client reconnect. Both endings are
driven: the `LISTEN` connection killed from outside, and the listener ending quietly.

Every test runs the `TestClient` as a context manager, so every socket in one test shares one
event loop, as they do in a real process. Without it `TestClient` opens a portal per socket and
this process's pump would be a task on a loop the second socket knows nothing about.

No test reaches Twilio: `send_whatsapp_message` is replaced at the router's own reference, which
is also how the failure path — a message recorded and committed that Twilio then refuses — is
reachable at all.
"""

import asyncio
import contextlib
import datetime
import json
import os
import queue
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import AsyncIterator, Callable, Generator, Iterator
from pathlib import Path

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings
from app.dependencies import STAFF_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, MessageAuthor, MessageStatus, UserRole
from app.models.message import Message
from app.models.user import User
from app.routers import conversation_stream
from app.routers.conversation_stream import (
    AUTH_REQUIRED_ERROR,
    AUTH_TIMEOUT_ERROR,
    CONVERSATION_NOT_FOUND_ERROR,
    NOT_TAKEN_OVER_ERROR,
    PUMP_STOPPED_ERROR,
    SEND_FAILED_ERROR,
    TOKEN_EXPIRED_ERROR,
    UNEXPECTED_FRAME_ERROR,
    UNREADABLE_FRAME_ERROR,
    WINDOW_CLOSED_ERROR,
)
from app.security import ACCESS_TOKEN_TYPE, create_access_token, hash_password
from app.services import broadcast_service
from app.services.broadcast_service import (
    LIVENESS_SECONDS,
    ConversationUpdated,
    MessageCreated,
    MessageUpdated,
    registered,
    unregister,
)
from app.services.twilio_service import TwilioSendFailed
from tests.fake_twilio import CODE_OUTSIDE_WINDOW, FakeTwilio

STREAM_PATH = "/api/conversations/stream"
RECEIVE_TIMEOUT_SECONDS = 5.0
POLICY_VIOLATION = 1008
INTERNAL_ERROR = 1011
TWILIO_SID = "SM00000000000000000000000000000001"
LISTENER_NAME = "tutorlink-stream-test-listener"

# The other process. It imports the same module and calls the same `publish`, so what crosses
# the boundary is the real wire format and not a payload this test wrote by hand.
PUBLISH_SCRIPT = """
import sys

from app.services.broadcast_service import MessageCreated, publish

publish(MessageCreated.model_validate_json(sys.argv[1]))
"""


@pytest.fixture
def sockets(
    api: TestClient, db: Session, _test_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> Generator[TestClient, None, None]:
    """The app under one event loop, with the notify, the listener and the rebuild all on the
    test database. See the module docstring for why each of the three has to be pointed there.

    The rebuild gets a fresh `Session` per notice on the `db` fixture's connection rather than
    `db` itself: `_rebuild` closes its session, and closing the one the request handlers share
    would detach every row the test is holding.
    """
    monkeypatch.setattr(broadcast_service, "_notify_engine", lambda: _test_engine)
    monkeypatch.setattr(broadcast_service, "listen_dsn", lambda: _listener_dsn(_test_engine))
    monkeypatch.setattr(conversation_stream, "_session_factory", lambda: _session_beside(db))
    with api as entered:
        yield entered


@pytest.fixture(autouse=True)
def _drain_process_state() -> Generator[None, None, None]:
    """The registry and the pump handle are module state, so a leak is the next test's failure."""
    yield

    for sink in registered():
        unregister(sink)

    conversation_stream._sockets.clear()
    conversation_stream._forget_pump()


@pytest.fixture
def twilio(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """Stand in for the REST send, recording what it was asked to deliver."""
    sent: list[dict[str, str]] = []

    def send(*, to: str, body: str) -> str:
        sent.append({"to": to, "body": body})
        return TWILIO_SID

    monkeypatch.setattr(conversation_stream, "send_whatsapp_message", send)

    return sent


# --- the handshake --------------------------------------------------------------------------


def test_a_frame_before_auth_closes_the_socket(sockets: TestClient, db: Session) -> None:
    """No other frame is accepted before `auth` (`api-design.md:1628`), so a `send` that skips
    the handshake is refused rather than answered with an error frame."""
    conversation = _make_conversation(db, status=ConversationStatus.BOT)

    with sockets.websocket_connect(STREAM_PATH) as socket:
        socket.send_json(_send_frame(conversation.id))

        refusal = _expect_close(socket)

    assert (refusal.code, refusal.reason) == (POLICY_VIOLATION, AUTH_REQUIRED_ERROR)
    assert _messages(db, conversation.id) == []


def test_a_socket_that_never_authenticates_is_closed_with_1008(
    sockets: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ten seconds in the contract, shortened here: what is under test is that the wait ends by
    itself, on a socket nobody is typing into."""
    monkeypatch.setattr(conversation_stream, "AUTH_TIMEOUT_SECONDS", 0.05)

    with sockets.websocket_connect(STREAM_PATH) as socket:
        refusal = _expect_close(socket)

    assert (refusal.code, refusal.reason) == (POLICY_VIOLATION, AUTH_TIMEOUT_ERROR)


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER])
def test_a_valid_staff_token_gets_ready(sockets: TestClient, db: Session, role: UserRole) -> None:
    """Every Staff role has the chat (#108): a Manager as much as an Admin or a Developer."""
    user = _make_user(db, role=role)

    with sockets.websocket_connect(STREAM_PATH) as socket:
        socket.send_json({"type": "auth", "access_token": _token(user)})

        assert _receive(socket) == {"type": "ready"}


@pytest.mark.parametrize(
    ("principal", "expected_reason"),
    [
        (lambda db: _token(_make_user(db, role=UserRole.TUTOR)), STAFF_REQUIRED_ERROR),
        (lambda db: _token(_make_user(db, is_active=False)), CREDENTIALS_ERROR),
        (lambda db: _token(_make_user(db), lifetime=-_minutes(30)), CREDENTIALS_ERROR),
        (lambda db: "not.a.token", CREDENTIALS_ERROR),
    ],
    ids=["tutor", "deactivated admin", "expired token", "garbage"],
)
def test_a_token_that_is_not_a_live_admin_is_closed_with_1008(
    sockets: TestClient,
    db: Session,
    principal: Callable[[Session], str],
    expected_reason: str,
) -> None:
    """The `Authorization` header's own gate, with the same two messages: a credential that
    does not resolve is indistinguishable, and a live tutor is told what it lacks."""
    token = principal(db)

    with sockets.websocket_connect(STREAM_PATH) as socket:
        socket.send_json({"type": "auth", "access_token": token})

        refusal = _expect_close(socket)

    assert (refusal.code, refusal.reason) == (POLICY_VIOLATION, expected_reason)


def test_the_socket_closes_when_the_access_token_expires(sockets: TestClient, db: Session) -> None:
    """A socket outlives a request, so the credential behind it has to be made to run out.

    The REST path re-reads the token, and therefore the `users` row, on every call. The
    socket's equivalent is this close: the client refreshes through `POST /auth/refresh` and
    reconnects, and the refresh token stays in its HttpOnly cookie where this route never sees
    it (`api-design.md:1626-1632`).
    """
    user = _make_user(db)

    with sockets.websocket_connect(STREAM_PATH) as socket:
        socket.send_json({"type": "auth", "access_token": _token(user, lifetime=_seconds(1))})

        assert _receive(socket) == {"type": "ready"}
        refusal = _expect_close(socket)

    assert (refusal.code, refusal.reason) == (POLICY_VIOLATION, TOKEN_EXPIRED_ERROR)


def test_a_token_in_the_query_string_authenticates_nothing(
    sockets: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`api-design.md:1624` refuses the common workaround by name: a credential in a URL is
    written into every proxy log, access log and browser history entry along the path. The
    socket must not read one from there, so a client that only puts it there times out."""
    monkeypatch.setattr(conversation_stream, "AUTH_TIMEOUT_SECONDS", 0.05)
    user = _make_user(db)

    with sockets.websocket_connect(f"{STREAM_PATH}?access_token={_token(user)}") as socket:
        refusal = _expect_close(socket)

    assert (refusal.code, refusal.reason) == (POLICY_VIOLATION, AUTH_TIMEOUT_ERROR)


# --- send -----------------------------------------------------------------------------------


def test_a_send_on_a_human_conversation_is_recorded_sent_and_echoed(
    sockets: TestClient, db: Session, twilio: list[dict[str, str]]
) -> None:
    """The whole write path: recorded `queued`, sent, the SID attached, the frame echoed.

    `client_message_id` comes back so the composer can match its optimistic bubble to the
    persisted row instead of drawing the message twice, and so a resend after a reconnect is
    recognised rather than sent again.
    """
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)
    _make_inbound(db, conversation, body="Can we move Tommy?")

    with _authenticated(sockets, user) as socket:
        socket.send_json(_send_frame(conversation.id, body="on my way", client_id="composer-1"))

        frame = _receive(socket)

    message = _only_message(db, conversation.id)

    assert frame["type"] == "message.created"
    assert frame["conversation_id"] == str(conversation.id)
    assert frame["client_message_id"] == "composer-1"
    assert frame["message"]["id"] == str(message.id)
    assert frame["message"]["author"] == {"id": str(user.id), "display_name": user.display_name}
    assert frame["message"]["status"] == MessageStatus.QUEUED.value
    assert twilio == [{"to": conversation.phone_number, "body": "on my way"}]
    assert (message.author_kind, message.status) == (MessageAuthor.ADMIN, MessageStatus.QUEUED)
    assert (message.twilio_sid, message.author_user_id) == (TWILIO_SID, user.id)


def test_a_manager_sends_on_a_chat_they_hold(
    sockets: TestClient, db: Session, twilio: list[dict[str, str]]
) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=manager)
    _make_inbound(db, conversation, body="Hola")

    with _authenticated(sockets, manager) as socket:
        socket.send_json(_send_frame(conversation.id, body="Hi, Maria here"))

        frame = _receive(socket)

    assert frame["type"] == "message.created"
    assert frame["message"]["author"] == {"id": str(manager.id), "display_name": "Test User"}
    assert twilio == [{"to": conversation.phone_number, "body": "Hi, Maria here"}]
    assert _only_message(db, conversation.id).author_user_id == manager.id


def test_a_send_twilio_refuses_keeps_the_row_and_tells_the_sender(
    sockets: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Recorded before sent, and committed in between, so the refusal cannot unwrite the row.

    The other order leaves the client holding a WhatsApp message the thread never shows. The
    broadcast still goes out — REST is the source of truth and the other admins' threads must
    not disagree with the refetch — and the `error` frame is what tells the sender.

    The row is left **`failed`**, not `queued` (FU-6). The `error` frame is ephemeral by
    contract (`api-design.md:1706`): it is gone on reload, on reconnect, and for every admin who
    was not watching, so a `queued` row would be the system's only lasting answer to "did this
    go out" and it would say the opposite of the truth. The broadcast carries the same `failed`,
    because the frame is the message object as the refetch would produce it.
    """
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)
    _make_inbound(db, conversation, body="Can we move Tommy?")
    monkeypatch.setattr(conversation_stream, "send_whatsapp_message", _refuses)

    with _authenticated(sockets, user) as socket:
        socket.send_json(_send_frame(conversation.id))

        frames = _receive_two(socket)

    message = _only_message(db, conversation.id)

    assert frames["error"] == {"type": "error", "detail": SEND_FAILED_ERROR}
    assert frames["message.created"]["message"]["id"] == str(message.id)
    assert frames["message.created"]["message"]["status"] == MessageStatus.FAILED.value
    assert (message.status, message.twilio_sid) == (MessageStatus.FAILED, None)
    assert message.error_code is None


def test_a_send_twilio_refuses_with_a_code_stores_the_code_on_the_failed_row(
    sockets: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    """63016 (outside the 24-hour window) is the refusal staff need explained, so the code
    Twilio gave is kept on the row rather than reduced to a bare `failed`."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)
    _make_inbound(db, conversation, body="Can we move Tommy?")
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW)

    with _authenticated(sockets, user) as socket:
        socket.send_json(_send_frame(conversation.id))

        frames = _receive_two(socket)

    message = _only_message(db, conversation.id)

    assert frames["error"] == {"type": "error", "detail": SEND_FAILED_ERROR}
    assert (message.status, message.twilio_sid) == (MessageStatus.FAILED, None)
    assert message.error_code == "63016"


def test_a_send_after_the_window_closed_is_refused_and_records_nothing(
    sockets: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    """Twilio would refuse it with 63016, so it is refused before anything is written, and the
    frame carries `window_closed` for the composer to disable itself (#109). The Guardian's
    last message is a day old; the admin's own line after it does not reopen the window."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)
    inbound = _make_inbound(db, conversation, body="Can we move Tommy?")
    inbound.created_at = datetime.datetime.now(tz=datetime.UTC) - datetime.timedelta(hours=24)
    _make_admin_message(db, conversation, author=user, status=MessageStatus.DELIVERED)
    db.flush()

    with _authenticated(sockets, user) as socket:
        socket.send_json(_send_frame(conversation.id))

        frame = _receive(socket)

    assert frame == {"type": "error", "detail": WINDOW_CLOSED_ERROR, "code": "window_closed"}
    assert len(_messages(db, conversation.id)) == 1
    assert fake_twilio.sent == []


def test_a_transfer_reaches_the_previous_holders_socket(
    sockets: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    """The previous holder's open thread locks because their socket hears who holds it now."""
    previous = _make_user(db)
    staff = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=previous)
    _make_inbound(db, conversation, body="Can we move Tommy?")

    with _authenticated(sockets, previous) as socket:
        response = sockets.post(
            f"/api/conversations/{conversation.id}/transfer", headers=_bearer(staff)
        )
        frames = _receive_two(socket)

    assert response.status_code == 200
    assert frames["conversation.updated"]["conversation"]["taken_over_by"]["id"] == str(staff.id)
    assert frames["message.created"]["message"]["system_kind"] == "transfer_notice"


def test_a_send_on_a_bot_conversation_is_refused_and_records_nothing(
    sockets: TestClient, db: Session, twilio: list[dict[str, str]]
) -> None:
    """An admin must claim the thread before speaking into it, so the client never receives an
    admin line interleaved with a bot line answering the same message."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.BOT)

    with _authenticated(sockets, user) as socket:
        socket.send_json(_send_frame(conversation.id))

        frame = _receive(socket)

    assert frame == {"type": "error", "detail": NOT_TAKEN_OVER_ERROR}
    assert _messages(db, conversation.id) == []
    assert twilio == []


def test_a_send_on_an_unknown_conversation_is_refused(
    sockets: TestClient, db: Session, twilio: list[dict[str, str]]
) -> None:
    user = _make_user(db)

    with _authenticated(sockets, user) as socket:
        socket.send_json(_send_frame(uuid.uuid4()))

        frame = _receive(socket)

    assert frame == {"type": "error", "detail": CONVERSATION_NOT_FOUND_ERROR}
    assert twilio == []


@pytest.mark.parametrize(
    ("payload", "expected_detail"),
    [
        ("{not json", UNREADABLE_FRAME_ERROR),
        ({"type": "shout", "body": "hello"}, UNREADABLE_FRAME_ERROR),
        ({"type": "send", "body": "hello"}, UNREADABLE_FRAME_ERROR),
        (
            {
                "type": "send",
                "conversation_id": str(uuid.uuid4()),
                "body": "",
                "client_message_id": "composer-1",
            },
            UNREADABLE_FRAME_ERROR,
        ),
        ({"type": "auth", "access_token": "another-one"}, UNEXPECTED_FRAME_ERROR),
    ],
    ids=["not json", "unknown type", "missing field", "empty body", "a second auth"],
)
def test_a_frame_the_contract_does_not_carry_is_an_error_frame(
    sockets: TestClient,
    db: Session,
    twilio: list[dict[str, str]],
    payload: object,
    expected_detail: str,
) -> None:
    """An `error` frame's payload is `detail` and nothing else — the same shape as a REST error
    body (§10) — and the socket stays open, because a typo is not a reason to drop an admin's
    inbox."""
    user = _make_user(db)

    with _authenticated(sockets, user) as socket:
        socket.send_text(payload if isinstance(payload, str) else json.dumps(payload))

        frame = _receive(socket)

    assert frame == {"type": "error", "detail": expected_detail}
    assert twilio == []


# --- the fan-out ----------------------------------------------------------------------------


def test_a_message_published_by_another_process_reaches_this_socket(
    sockets: TestClient, db: Session, _test_engine: Engine
) -> None:
    """P7-K, and the only test here that can fail when the fan-out is in-process.

    The publisher is a **second interpreter** calling the same `publish` against the same
    database, which is what the Twilio webhook and an admin's socket landing on two
    `uvicorn --workers` processes — or on the outgoing and incoming tasks of a canary deploy —
    actually look like. A registry held in module state passes every other test in this file
    and fails this one, which is the whole reason it spawns a process rather than opening a
    second client (**P7-X**, `test_broadcast_service.py`).

    The event it publishes carries nothing but the message's id, and the frame still arrives
    whole: the pump read the row back, and the frame is the one the thread's refetch returns.
    """
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.BOT)
    message = _make_inbound(db, conversation, body="from another process")
    event = MessageCreated(conversation_id=conversation.id, message={"id": str(message.id)})

    with _authenticated(sockets, user) as socket:
        _publish_from_a_subprocess(_test_engine, event)

        frame = _receive(socket)

    assert frame == {
        "type": "message.created",
        "conversation_id": str(conversation.id),
        "message": _thread_item(sockets, user, conversation.id),
    }


def test_a_conversation_updated_from_another_connection_reaches_this_socket(
    sockets: TestClient, db: Session
) -> None:
    """A takeover claimed or released elsewhere, so the other admins' list screens move.

    It publishes the instant `ready` lands, which is also what makes `ready` a promise: a
    socket told it was ready before its process's `LISTEN` had executed would silently miss
    whatever was published in that window, and this test would be the one to see it.
    """
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)

    with _authenticated(sockets, user) as socket:
        broadcast_service.publish(ConversationUpdated(conversation={"id": str(conversation.id)}))

        frame = _receive(socket)

    assert frame == {
        "type": "conversation.updated",
        "conversation": _conversation(sockets, user, conversation.id),
    }


def test_a_message_longer_than_a_notice_reaches_the_socket_in_full(
    sockets: TestClient, db: Session
) -> None:
    """REQ-141.4. Twenty thousand two-byte characters are five times PostgreSQL's `NOTIFY` cap
    in UTF-8, and a WhatsApp body can be that long. The notice carries the id; the body comes
    back from the row."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.BOT)
    body = "é" * 20_000
    message = _make_inbound(db, conversation, body=body)

    with _authenticated(sockets, user) as socket:
        broadcast_service.publish(
            MessageCreated(
                conversation_id=conversation.id, message={"id": str(message.id), "body": body}
            )
        )

        frame = _receive(socket)

    assert frame["message"]["id"] == str(message.id)
    assert frame["message"]["body"] == body


def test_a_notice_for_a_message_that_is_gone_is_skipped_and_the_socket_stays_open(
    sockets: TestClient, db: Session
) -> None:
    """REQ-141.9. The notice crosses processes after the commit and the row can be gone when
    it is read — retention deleted it. That costs one frame nobody could have rendered; it must
    not cost the pump, so the next notice still arrives on the same socket."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)

    with _authenticated(sockets, user) as socket:
        broadcast_service.publish(
            MessageCreated(conversation_id=conversation.id, message={"id": str(uuid.uuid4())})
        )
        broadcast_service.publish(ConversationUpdated(conversation={"id": str(conversation.id)}))

        frame = _receive(socket)
        still_registered = registered()

    assert frame["type"] == "conversation.updated"
    assert frame["conversation"]["id"] == str(conversation.id)
    assert len(still_registered) == 1


def test_a_message_updated_notice_is_rebuilt_into_the_status_frame(
    sockets: TestClient, db: Session
) -> None:
    """#72: the frame carries the row as the thread's refetch returns it, status included, so
    the dashboard swaps the bubble in place rather than waiting for a reload."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)
    message = _make_admin_message(db, conversation, author=user, status=MessageStatus.DELIVERED)

    with _authenticated(sockets, user) as socket:
        broadcast_service.publish(
            MessageUpdated(conversation_id=conversation.id, message={"id": str(message.id)})
        )

        frame = _receive(socket)

    assert frame == {
        "type": "message.updated",
        "conversation_id": str(conversation.id),
        "message": _thread_item(sockets, user, conversation.id),
    }
    assert frame["message"]["status"] == "delivered"


def test_a_message_updated_notice_for_a_message_that_is_gone_is_skipped(
    sockets: TestClient, db: Session
) -> None:
    """Retention can delete the row between the callback's commit and the pump's read; that
    costs one frame and never the pump."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.HUMAN, holder=user)

    with _authenticated(sockets, user) as socket:
        broadcast_service.publish(
            MessageUpdated(conversation_id=conversation.id, message={"id": str(uuid.uuid4())})
        )
        broadcast_service.publish(ConversationUpdated(conversation={"id": str(conversation.id)}))

        frame = _receive(socket)

    assert frame["type"] == "conversation.updated"


def test_one_socket_disconnecting_leaves_the_other_serving(
    sockets: TestClient, db: Session
) -> None:
    """Criterion 7: the pump keeps serving the sockets that remain, and the one that went is
    gone from the registry rather than left to be discovered by a failing write."""
    user = _make_user(db)
    conversation = _make_conversation(db, status=ConversationStatus.BOT)
    event = ConversationUpdated(conversation={"id": str(conversation.id)})

    with _authenticated(sockets, user) as staying:
        with _authenticated(sockets, user):
            assert len(registered()) == 2

        _wait_until(lambda: len(registered()) == 1)
        broadcast_service.publish(event)

        frame = _receive(staying)

    assert frame["conversation"]["id"] == str(conversation.id)


def test_a_killed_listen_connection_closes_every_socket_in_this_process(
    sockets: TestClient, db: Session, _test_engine: Engine
) -> None:
    """Criterion 7a, and P7-K arriving from the other direction.

    A pump that ends while its sockets stay open, registered and silently receiving nothing is
    indistinguishable from a working one at the browser, and the contract's safety net
    (`api-design.md:1668-1673` — the socket is not a delivery guarantee, the client refetches
    on reconnect) never fires, because nothing tells the client to reconnect. Closing is what
    turns the stall into a reconnect-and-refetch.

    The connection is killed for real — `pg_terminate_backend` from a second connection, which
    is what a database failover or restart does to it — and **both** sockets must close,
    within the liveness period and some slack.

    **The pump is killed while the sockets are already serving**, after `ready`, and that is
    the whole shape of the test. A pump that is dead before a socket is served is closed by the
    socket's own handshake, so killing it at connect time would leave the close sweep untested
    and the criterion would pass with it deleted (**P7-X**: the gate has to fail against the
    behaviour it forbids). Here nothing but the sweep can close these sockets.
    """
    user = _make_user(db)

    with _authenticated(sockets, user) as first, _authenticated(sockets, user) as second:
        _terminate_listener(_test_engine)

        closures = [
            _expect_close(socket, timeout=LIVENESS_SECONDS + RECEIVE_TIMEOUT_SECONDS)
            for socket in (first, second)
        ]

    assert [(closed.code, closed.reason) for closed in closures] == [
        (INTERNAL_ERROR, PUMP_STOPPED_ERROR)
    ] * 2
    assert registered() == frozenset()
    assert conversation_stream._sockets == set()


def test_a_listener_that_ends_quietly_closes_every_socket_in_this_process(
    sockets: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The same sweep for the ending that raises nothing. `listen` is built never to end
    without an error, and the pump must not rely on that: an iterator that simply runs out is
    a stopped pump all the same."""
    dies = threading.Event()
    monkeypatch.setattr(conversation_stream, "listen", _listener_ending_on(dies))
    user = _make_user(db)

    with _authenticated(sockets, user) as socket:
        dies.set()

        closed = _expect_close(socket)

    assert (closed.code, closed.reason) == (INTERNAL_ERROR, PUMP_STOPPED_ERROR)
    assert registered() == frozenset()
    assert conversation_stream._sockets == set()


def test_the_module_takes_no_tutor_scope() -> None:
    """§15: an unread `TutorScope` arms the `do_orm_execute` guard, and every query this socket
    makes is against a tutor-owned table's neighbour — chat is an admin surface with no
    tutor-scoped view of it."""
    source = Path(conversation_stream.__file__).read_text()

    assert "TutorScope" not in source


# --- helpers --------------------------------------------------------------------------------


@contextlib.contextmanager
def _authenticated(client: TestClient, user: User) -> Iterator[WebSocketTestSession]:
    with client.websocket_connect(STREAM_PATH) as socket:
        socket.send_json({"type": "auth", "access_token": _token(user)})

        assert _receive(socket) == {"type": "ready"}

        yield socket


def _receive(socket: WebSocketTestSession, timeout: float = RECEIVE_TIMEOUT_SECONDS) -> dict:
    """One frame, or a failure — never a hang.

    `WebSocketTestSession.receive` blocks forever, so a frame that never arrives would stall
    the whole suite instead of failing this test. The reader is a daemon thread for the same
    reason: when nothing comes, nothing is left to join.
    """
    outcome: queue.Queue[tuple[str, object]] = queue.Queue(maxsize=1)

    def read() -> None:
        try:
            outcome.put(("frame", socket.receive_json()))
        except BaseException as exc:
            outcome.put(("raised", exc))

    threading.Thread(target=read, daemon=True).start()

    try:
        kind, value = outcome.get(timeout=timeout)
    except queue.Empty:
        pytest.fail(f"no frame arrived within {timeout} seconds")

    if kind == "raised":
        raise value

    return value


def _receive_two(socket: WebSocketTestSession) -> dict[str, dict]:
    """Two frames by type, because a broadcast and an `error` are not ordered against each
    other: one travels through the database and the pump, the other straight down the socket."""
    frames = [_receive(socket), _receive(socket)]

    return {frame["type"]: frame for frame in frames}


def _expect_close(
    socket: WebSocketTestSession, timeout: float = RECEIVE_TIMEOUT_SECONDS
) -> WebSocketDisconnect:
    with pytest.raises(WebSocketDisconnect) as refusal:
        _receive(socket, timeout)

    return refusal.value


def _wait_until(condition: Callable[[], bool], timeout: float = RECEIVE_TIMEOUT_SECONDS) -> None:
    """Wait for something the app's own loop does off the back of a disconnect."""
    deadline = datetime.datetime.now(tz=datetime.UTC) + _seconds(timeout)

    while not condition() and datetime.datetime.now(tz=datetime.UTC) < deadline:
        time.sleep(0.02)

    assert condition()


def _publish_from_a_subprocess(engine: Engine, event: MessageCreated) -> None:
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


def _listener_dsn(engine: Engine) -> str:
    """The test database as libpq takes it, named so a test can find the pump's backend."""
    url = engine.url.set(drivername="postgresql").update_query_dict(
        {"application_name": LISTENER_NAME}
    )

    return url.render_as_string(hide_password=False)


def _session_beside(db: Session) -> Session:
    """A session on `db`'s connection, so it reads what the test wrote and has not committed.

    `create_savepoint` for the reason the `db` fixture uses it: the rebuild's commit releases a
    savepoint of its own and never touches the transaction the test rolls back.
    """
    return Session(
        bind=db.get_bind(),
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )


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


def _listener_ending_on(dies: threading.Event) -> Callable[[], object]:
    @contextlib.asynccontextmanager
    async def listen() -> AsyncIterator[_EndingNotices]:
        yield _EndingNotices(dies)

    return listen


class _EndingNotices:
    """A listener that serves until the test says otherwise, then runs out without an error.

    It carries no notices because none are needed: what is under test is the ending, and the
    socket has to be past `ready` and serving when it arrives.
    """

    def __init__(self, dies: threading.Event) -> None:
        self._dies = dies

    def __aiter__(self) -> "_EndingNotices":
        return self

    async def __anext__(self) -> object:
        while not self._dies.is_set():
            await asyncio.sleep(0.01)

        raise StopAsyncIteration


def _conversation(client: TestClient, user: User, conversation_id: uuid.UUID) -> dict:
    """`GET /api/conversations/{id}` — the object a `conversation.updated` frame must equal."""
    response = client.get(f"/api/conversations/{conversation_id}", headers=_bearer(user))

    assert response.status_code == 200, response.text

    return response.json()


def _thread_item(client: TestClient, user: User, conversation_id: uuid.UUID) -> dict:
    """The newest row of `GET /api/conversations/{id}/messages` — what a `message.created`
    frame's `message` must equal."""
    response = client.get(f"/api/conversations/{conversation_id}/messages", headers=_bearer(user))

    assert response.status_code == 200, response.text

    return response.json()["items"][0]


def _bearer(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(user)}"}


def _refuses(*, to: str, body: str) -> str:
    raise TwilioSendFailed(
        f"failed to send WhatsApp message to {to!r}", code=None, is_retryable=False
    )


def _send_frame(
    conversation_id: uuid.UUID, *, body: str = "hello", client_id: str = "composer-1"
) -> dict[str, str]:
    return {
        "type": "send",
        "conversation_id": str(conversation_id),
        "body": body,
        "client_message_id": client_id,
    }


def _token(user: User, lifetime: datetime.timedelta | None = None) -> str:
    """The access token the dashboard would send, or one with a lifetime of this test's choosing.

    Hand-minted only when the expiry is the thing under test — `create_access_token` reads
    `access_token_expire_minutes`, whose granularity is a minute.
    """
    if lifetime is None:
        return create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)

    settings = get_settings()
    issued_at = datetime.datetime.now(tz=datetime.UTC)
    claims = {
        "sub": str(user.id),
        "role": user.role.value,
        "tutor_id": None,
        "typ": ACCESS_TOKEN_TYPE,
        "jti": str(uuid.uuid4()),
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + lifetime).timestamp()),
    }

    return jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN, is_active: bool = True) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password("conversation-stream-password"),
        role=role,
        is_active=is_active,
    )
    db.add(user)
    db.flush()

    return user


def _make_conversation(
    db: Session, *, status: ConversationStatus, holder: User | None = None
) -> Conversation:
    now = datetime.datetime.now(tz=datetime.UTC)
    conversation = Conversation(
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
        status=status,
        taken_over_by_user_id=None if holder is None else holder.id,
        taken_over_at=None if holder is None else now,
        last_message_at=now,
    )
    db.add(conversation)
    db.flush()

    return conversation


def _make_inbound(db: Session, conversation: Conversation, *, body: str) -> Message:
    message = Message(
        conversation_id=conversation.id,
        author_kind=MessageAuthor.CLIENT,
        body=body,
        status=MessageStatus.RECEIVED,
        twilio_sid=f"SM{uuid.uuid4().hex}",
        created_at=datetime.datetime.now(tz=datetime.UTC),
    )
    db.add(message)
    db.flush()

    return message


def _make_admin_message(
    db: Session, conversation: Conversation, *, author: User, status: MessageStatus
) -> Message:
    message = Message(
        conversation_id=conversation.id,
        author_kind=MessageAuthor.ADMIN,
        author_user_id=author.id,
        body="I'll take it from here.",
        status=status,
        twilio_sid=f"SM{uuid.uuid4().hex}",
        created_at=datetime.datetime.now(tz=datetime.UTC),
    )
    db.add(message)
    db.flush()

    return message


def _messages(db: Session, conversation_id: uuid.UUID) -> list[Message]:
    """The thread's outbound lines: what a `send` could have written. The Guardian's own
    messages are left out, because a send needs one inside the 24-hour window."""
    db.expire_all()

    return list(
        db.scalars(
            select(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.author_kind != MessageAuthor.CLIENT,
            )
            .order_by(Message.created_at)
        ).all()
    )


def _only_message(db: Session, conversation_id: uuid.UUID) -> Message:
    messages = _messages(db, conversation_id)

    assert len(messages) == 1

    return messages[0]


def _minutes(count: int) -> datetime.timedelta:
    return datetime.timedelta(minutes=count)


def _seconds(count: float) -> datetime.timedelta:
    return datetime.timedelta(seconds=count)
