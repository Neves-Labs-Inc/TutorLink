"""The admin chat WebSocket: one socket per admin session carrying every conversation.

Two routers share the `/api/conversations` prefix on purpose (D-G, P4-F): this one and
`conversations.py`, so the two can be built concurrently. The paths do not shadow each other.

One socket carries every conversation rather than one per thread (`api-design.md:1602-1606`):
the list screen and the open thread share it, and an admin watching the inbox needs updates for
conversations they have not opened, so it has to be conversation-wide anyway.

**On `CONSTITUTION.md` §13 — divergence D-P7-5.** §13 says every `/api/*` route carries an auth
dependency from `app/dependencies.py`. This route is under `/api/*` and cannot, because a
browser cannot set an `Authorization` header on a WebSocket upgrade — the client API is a
`new WebSocket(url)` call and nothing else, which is the whole reason `api-design.md:1608-1632`
specifies a first-frame handshake instead. §13's intent, that there is no unauthenticated
`/api/*` surface, is met by that handshake: the socket is accepted but carries nothing until an
`auth` frame has been validated through `app/security.py` and the same admin role gate
`require_admin` applies, no other frame is accepted before then, a socket that has not
authenticated within ten seconds is closed `1008`, and the socket closes `1008` again when the
access token behind it expires. **The token is never read from the query string**
(`api-design.md:1624`): a credential there is written into every proxy log, access log and
browser history entry along the path, and it is the workaround this handshake exists to refuse.

**The pump is one per process, and its death closes every socket in that process.** It holds
this process's single `broadcast_service.listen()` — one dedicated PostgreSQL connection with
`LISTEN chat_broadcast` on it — for as long as any socket is open here, and stops it when the
last one goes. `listen` raises rather than returning quietly when that connection drops, and
this module has to translate that into closed sockets: a pump that ends while its sockets stay
open, registered and silently receiving nothing looks perfectly healthy from the browser, and
the contract's safety net (`api-design.md:1668-1673` — the socket is not a delivery guarantee,
the client refetches on reconnect) only fires if something makes the client reconnect. Closing
is what turns a silent stall into a reconnect-and-refetch.

`_sockets` is a lifecycle handle, not a fan-out registry: the fan-out is
`broadcast_service`'s and reaches this process through PostgreSQL `LISTEN`/`NOTIFY` (**P7-K**),
and what is kept here is only what `close()` needs, since an `EventSink` has no close.

**Every frame the pump delivers is rebuilt here from the database.** A notice carries ids and
not the payload — PostgreSQL refuses a `NOTIFY` of 8000 bytes or more and a WhatsApp body can
exceed that on its own — so the pump reads the row the notice names and serialises it with
`conversations.py`'s own `_read` and `_message`. The socket frame is therefore the object the
REST refetch returns, by construction. The read runs off the event loop through
`run_in_threadpool`, on a fresh session per notice for the reason given below, and ends its
transaction before the session closes. A row that is gone by the time it is read (retention, a
race with a delete) is skipped and the pump keeps serving; a read that **fails** is a database
the pump cannot reach, and it ends the pump like a dropped `LISTEN` does — closing every socket
is what sends the client to the refetch, where skipping would drop the event silently.

**A `Session` per operation, not one per socket — divergence from §3's `DbSession` idiom.**
That idiom is request-scoped and this route is not a request: a `Depends(get_db)` here holds
one `Session` for as long as the tab is open, and `SessionLocal` sets `expire_on_commit=False`,
so every row that session has ever loaded stays in its identity map. `conversation_service.get`
is a `db.get`, which answers from that map without going to the database at all, so the next
`send` an hour later would be judged against the copy of the conversation this socket read when
it was first opened — a takeover another admin released in the meantime would be invisible, and
the authorization below would be deciding on state that no longer exists. The socket opens a
session for the handshake read and one per `send` frame instead, as `cli.py` does for a process
that is not serving a request. The commits are unchanged and still end their transaction
explicitly: closing the session is what returns the connection, and ending the transaction is
what keeps a backend from sitting `idle in transaction` while it is still open.
"""

import asyncio
import contextlib
import datetime
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.db import SessionLocal, get_db
from app.dependencies import ADMIN_REQUIRED_ERROR, ADMIN_ROLES, CREDENTIALS_ERROR
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.user import User
from app.routers.conversations import _message, _read
from app.schemas.conversation import UserRef
from app.schemas.message import MessageRead
from app.schemas.stream import (
    AuthFrame,
    ErrorFrame,
    ReadyFrame,
    WINDOW_CLOSED_CODE,
    SendFrame,
    client_frame_adapter,
)
from app.security import ACCESS_TOKEN_TYPE, TokenError, decode_token
from app.services.broadcast_service import (
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
    publish,
    register,
    unregister,
)
from app.services import conversation_service
from app.services.conversation_service import ConversationNotFound
from app.services.message_service import (
    attach_twilio_sid,
    get_thread_message,
    mark_failed,
    record_admin_message,
)
from app.services.twilio_service import (
    TwilioSendFailed,
    TwilioServiceError,
    send_whatsapp_message,
)

AUTH_REQUIRED_ERROR = "The first frame must be an auth frame"
AUTH_TIMEOUT_ERROR = "No auth frame arrived in time"
TOKEN_EXPIRED_ERROR = "The access token has expired"
UNREADABLE_FRAME_ERROR = "Unreadable frame"
UNEXPECTED_FRAME_ERROR = "Expected a send frame"
CONVERSATION_NOT_FOUND_ERROR = "No such conversation"
NOT_TAKEN_OVER_ERROR = "Take over the conversation before sending a message"
SEND_FAILED_ERROR = "WhatsApp did not accept the message"
WINDOW_CLOSED_ERROR = (
    "The Guardian last wrote over 24 hours ago, so WhatsApp only allows a template message"
)
PUMP_STOPPED_ERROR = "The live-update subscription stopped"

# Ten seconds, from the contract (`api-design.md:1630`) rather than from `system_settings`: it
# is the window in which an accepted socket is allowed to carry no principal at all, and a
# deployment that could widen it at runtime would be able to widen that.
AUTH_TIMEOUT_SECONDS = 10.0

DbSession = Annotated[Session, Depends(get_db)]

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

_sockets: set[WebSocket] = set()
_pump: asyncio.Task[None] | None = None
_subscribed: asyncio.Event | None = None

# Where the pump's reads get their session. A seam so a test can hand it sessions that see the
# rows the test wrote inside its own rolled-back transaction.
_session_factory: Callable[[], Session] = SessionLocal


@dataclass(frozen=True, slots=True)
class _Admin:
    """The principal behind an authenticated socket, and the instant its token dies.

    Frozen and never the ORM `User`, for the reason `CurrentUser` is: a socket must not be able
    to widen its own authority. `expires_at` is carried because a socket outlives a request —
    the REST path re-reads the token, and therefore the `users` row, on every call, and the
    socket's equivalent is to stop reading frames when the access token expires and make the
    client come back with a fresh one.
    """

    user_id: uuid.UUID
    email: str
    expires_at: datetime.datetime


@router.websocket("/stream")
async def conversation_stream(websocket: WebSocket, db: DbSession) -> None:
    """Authenticate, then carry every broadcast event until the client or the token goes."""
    await websocket.accept()
    admin = await _authenticate(websocket, db)

    if admin is not None:
        await _serve(websocket, db, admin)


async def _authenticate(websocket: WebSocket, db: Session) -> _Admin | None:
    frame = await _auth_frame(websocket)
    admin = None

    if frame is not None:
        resolved = await run_in_threadpool(_resolve_admin, db, frame.access_token)

        if isinstance(resolved, _Admin):
            admin = resolved
        else:
            await _close(websocket, resolved)

    return admin


async def _auth_frame(websocket: WebSocket) -> AuthFrame | None:
    """The first frame, or `None` with the socket already closed.

    The timeout is what keeps an accepted-but-anonymous socket from living forever, so it
    covers the wait for the frame and not the validation after it.
    """
    frame = None

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_SECONDS)
    except TimeoutError:
        await _close(websocket, AUTH_TIMEOUT_ERROR)
    except WebSocketDisconnect:
        pass
    else:
        parsed = _parse(raw)

        if isinstance(parsed, AuthFrame):
            frame = parsed
        else:
            await _close(websocket, AUTH_REQUIRED_ERROR)

    return frame


def _resolve_admin(db: Session, token: str) -> _Admin | str:
    """The `Authorization` header's own validation, applied to the handshake frame.

    One credential, one validator, one role gate: `decode_token` and `ADMIN_ROLES` are the ones
    `get_current_user` and `require_admin` use, and the failure messages are theirs too, so a
    bad token is refused here for exactly the reason and in exactly the words REST refuses it.
    The `users` row is read rather than trusted from the claims for the reason
    `dependencies.py` gives: a deactivated account must lose access at its next use of the
    credential, not fifteen minutes later.

    Returns the close reason on failure. The commit persists nothing — this read is all that
    ran — and is here to **end the transaction**, which a socket must do explicitly: a request
    ends and returns its connection to the pool, while a socket lives for hours, and a backend
    left sitting `idle in transaction` for that long blocks VACUUM on every table it touched.
    """
    try:
        claims = decode_token(token, expected_type=ACCESS_TOKEN_TYPE)
    except TokenError:
        claims = None

    user = None if claims is None else db.get(User, claims.subject)

    if claims is None or user is None or not user.is_active:
        resolved: _Admin | str = CREDENTIALS_ERROR
    elif user.role not in ADMIN_ROLES:
        resolved = ADMIN_REQUIRED_ERROR
    else:
        resolved = _Admin(user_id=user.id, email=user.email, expires_at=claims.expires_at)

    db.commit()

    return resolved


async def _serve(websocket: WebSocket, db: Session, admin: _Admin) -> None:
    """Register, subscribe, say `ready`, read frames, and leave nothing behind however it ends.

    **`ready` is sent only once this process's `LISTEN` has executed.** PostgreSQL delivers a
    notice only to a connection that was already listening when it was sent, so a socket told
    it was ready before the `LISTEN` took effect would silently miss everything published in
    that window — the race `broadcast_service.listen` closes by not yielding until then,
    arriving one level up. `ready` means the socket is receiving, and the first socket in a
    process is the one this matters to.

    The order is load-bearing on both sides. The socket is registered **before** the pump is
    ensured, so a socket that arrives while a dying pump is tearing down is one the pump's own
    close sweep still sees; and it is unregistered before the pump is stopped, so the last
    socket out is the one that stops it.
    """
    register(websocket)
    _sockets.add(websocket)

    await _ensure_pump().wait()

    try:
        if _pump is None:
            # The pump died while this socket waited on it. It cleared itself before sweeping,
            # so `None` here is not "not started yet" and this socket is not serving anybody.
            await _close(websocket, PUMP_STOPPED_ERROR, code=status.WS_1011_INTERNAL_ERROR)
        else:
            await websocket.send_json(ReadyFrame().model_dump())
            await _read_frames(websocket, db, admin)
    except WebSocketDisconnect:
        pass
    finally:
        _release(websocket)
        await _stop_pump_if_idle()


async def _read_frames(websocket: WebSocket, db: Session, admin: _Admin) -> None:
    """Read `send` frames until the client goes or the access token expires.

    The remaining lifetime of the token is the receive timeout, so an expired credential closes
    the socket even on a connection nobody is typing into. The client refreshes through
    `POST /auth/refresh` and reconnects; the refresh token stays in its HttpOnly cookie and is
    never seen by this route (`api-design.md:1626-1632`).
    """
    while True:
        remaining = (admin.expires_at - datetime.datetime.now(tz=datetime.UTC)).total_seconds()

        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=max(remaining, 0.0))
        except TimeoutError:
            await _close(websocket, TOKEN_EXPIRED_ERROR)
            break

        frame = _parse(raw)

        if isinstance(frame, SendFrame):
            failure = await run_in_threadpool(_send, db, admin=admin, frame=frame)
        elif isinstance(frame, AuthFrame):
            failure = ErrorFrame(detail=UNEXPECTED_FRAME_ERROR)
        else:
            failure = ErrorFrame(detail=frame)

        if failure is not None:
            await websocket.send_json(failure.frame())


def _send(db: Session, *, admin: _Admin, frame: SendFrame) -> ErrorFrame | None:
    """Handle one `send`. Returns the `error` frame, or `None` when it went out.

    A conversation the bot is still answering is refused and **nothing is recorded**: an admin
    must claim the thread before speaking into it, so the client never receives an admin line
    interleaved with a bot line answering the same message. The pause is what makes the admin
    the only outbound voice.

    So is a send after the Guardian's 24-hour window has closed (#109): Twilio would refuse it
    with 63016, and a line that could never be delivered is not one to record. The frame
    carries `window_closed` so the composer can disable itself.

    The trailing commit ends the transaction the refusals opened by reading, for the reason
    `_resolve_admin` gives: on the write path there is nothing left to commit, and on a refusal
    the alternative is a `SELECT` held open for as long as the admin keeps the tab open.
    """
    try:
        conversation = conversation_service.get(db, conversation_id=frame.conversation_id)
    except ConversationNotFound:
        conversation = None

    if conversation is None:
        failure: ErrorFrame | None = ErrorFrame(detail=CONVERSATION_NOT_FOUND_ERROR)
    elif conversation.status is not ConversationStatus.HUMAN:
        failure = ErrorFrame(detail=NOT_TAKEN_OVER_ERROR)
    elif not conversation_service.window_is_open(db, conversation_id=conversation.id):
        failure = ErrorFrame(detail=WINDOW_CLOSED_ERROR, code=WINDOW_CLOSED_CODE)
    else:
        failure = _record_and_send(db, admin=admin, frame=frame, conversation=conversation)

    db.commit()

    return failure


def _record_and_send(
    db: Session,
    *,
    admin: _Admin,
    frame: SendFrame,
    conversation: Conversation,
) -> ErrorFrame | None:
    """Record, commit, send, attach, broadcast — in that order, which is the only safe one.

    Recording before sending is what keeps the thread honest across a crash: the other order
    leaves the client holding a WhatsApp message the thread never shows and nothing to
    reconcile it against. The commit sits between the two because an uncommitted row is not a
    record. The SID is attached afterwards because Twilio mints it on the way out, and without
    it `POST /webhook/whatsapp/status` has nothing to match the delivery callback against and
    the admin's line stays `queued` for good (`message_service.py:123-161`).

    A send Twilio refuses still broadcasts. The row is committed either way, REST is the source
    of truth, and a `message.created` the other admins never see would leave their threads
    disagreeing with the one the refetch produces; the `error` frame is what tells the sender
    their message did not go out.

    **The refusal is written to the row, not only to that frame.** `mark_failed` is what makes
    `failed` reachable for a send that never earned a SID — the socket's `error` frame is
    ephemeral by contract (`api-design.md:1706`), gone on reload and never seen by the admins
    who were not looking, so a row left `queued` would be the system's only lasting answer to
    "did this go out" and it would be the wrong one.

    **The broadcast goes out after the last commit, and that is what fixes the frame's
    status.** The notice carries only the message's id and the pump rebuilds the frame from the
    row, so whatever the row says when the pump reads it is what every admin sees — which is
    the status the refetch will produce. Announcing before the final commit would let a pump in
    another process read the row still `queued`, or not see the `failed` it is about to become.
    """
    message = record_admin_message(
        db,
        conversation=conversation,
        body=frame.body,
        author_user_id=admin.user_id,
        twilio_sid=None,
    )
    conversation_id = conversation.id
    phone_number = conversation.phone_number
    db.commit()

    try:
        twilio_sid = send_whatsapp_message(to=phone_number, body=frame.body)
    except TwilioServiceError as exc:
        # A missing configuration carries no Twilio code; a refusal does, and staff need it.
        error_code = exc.code if isinstance(exc, TwilioSendFailed) else None
        # No traceback: the chained Twilio error quotes the Guardian's number.
        logger.error(
            "admin message %s was recorded but Twilio did not accept it: %s (code %s)",
            message.id,
            exc,
            error_code,
        )
        mark_failed(db, message=message, error_code=error_code)
        failure = ErrorFrame(detail=SEND_FAILED_ERROR)
    else:
        attach_twilio_sid(db, message=message, twilio_sid=twilio_sid)
        failure = None

    read = MessageRead(
        id=message.id,
        author_kind=message.author_kind,
        author=UserRef(id=admin.user_id, email=admin.email),
        body=message.body,
        status=message.status,
        created_at=message.created_at,
        system_kind=message.system_kind,
        error_code=message.error_code,
        reminder_child_names=None,
    )
    db.commit()

    publish(
        MessageCreated(
            conversation_id=conversation_id,
            message=read.model_dump(mode="json"),
            client_message_id=frame.client_message_id,
        ),
    )

    return failure


def _parse(raw: str) -> AuthFrame | SendFrame | str:
    """One client frame, or the detail of the `error` this socket answers it with."""
    try:
        frame: AuthFrame | SendFrame | str = client_frame_adapter.validate_json(raw)
    except ValidationError:
        frame = UNREADABLE_FRAME_ERROR

    return frame


def _ensure_pump() -> asyncio.Event:
    """Start this process's subscriber if it is not already running, and hand back the flag
    every socket waits on before it is told it is ready.

    Nothing is awaited between the check and the assignment, so two sockets connecting in one
    tick cannot start two pumps and no lock is needed. The flag is created here rather than at
    import for the reason the task is: an `asyncio.Event` binds to the loop that first waits on
    it, and this module outlives any one loop.
    """
    global _pump, _subscribed

    if _pump is None:
        _subscribed = asyncio.Event()
        _pump = asyncio.create_task(_pump_events(_subscribed))

    return _subscribed


async def _pump_events(subscribed: asyncio.Event) -> None:
    """Carry every published event to the sockets in this process, and close them when it ends.

    Whatever ends this loop — the `LISTEN` connection dropping or failing its liveness probe, a
    `LISTEN` that never executed, a rebuild whose read failed, or the iterator returning — every
    socket registered here is closed on the way out. See the module docstring: a dead pump that
    leaves them open is the failure P7-K exists to prevent, arriving from the other direction,
    and it is invisible from the browser.

    Cancellation is the one ending that does not go through that, and must not: it is this
    module stopping its own pump because the last socket left, and there is nothing to close.
    `CancelledError` is a `BaseException`, so it is not caught below and the close sweep is
    never reached.
    """
    try:
        async with listen() as notices:
            subscribed.set()

            async for notice in notices:
                event = await run_in_threadpool(_rebuild, notice)

                if event is not None:
                    await deliver(event)

        logger.error("the broadcast subscription ended; closing every socket in this process")
    except Exception:
        logger.exception("the broadcast subscription failed; closing every socket in this process")

    # Set again in case the `LISTEN` never executed: a socket waiting to be told it is ready
    # must not wait on a pump that has already stopped. It reads the cleared handle below and
    # closes itself rather than serving nobody.
    subscribed.set()
    _forget_pump()
    await _close_every_socket()


def _rebuild(notice: Notice) -> BroadcastEvent | None:
    """The event a notice names, read back from the database. `None` if its row is gone.

    Runs in a worker thread, on a session of its own, for the reasons the module docstring
    gives. The commit persists nothing — this is a read — and is here to **end the
    transaction** before the session closes, for `_resolve_admin`'s reason.
    """
    with _session_factory() as db:
        if isinstance(notice, MessageNotice):
            event: BroadcastEvent | None = _message_created(db, notice)
        elif isinstance(notice, MessageUpdatedNotice):
            event = _message_updated(db, notice)
        else:
            event = _conversation_updated(db, notice)

        db.commit()

    return event


def _message_created(db: Session, notice: MessageNotice) -> MessageCreated | None:
    row = get_thread_message(db, message_id=notice.message_id)

    if row is None:
        logger.info("skipped a broadcast for message %s, which no longer exists", notice.message_id)
        event = None
    else:
        event = MessageCreated(
            conversation_id=row.message.conversation_id,
            message=_message(row).model_dump(mode="json"),
            client_message_id=notice.client_message_id,
        )

    return event


def _message_updated(db: Session, notice: MessageUpdatedNotice) -> MessageUpdated | None:
    row = get_thread_message(db, message_id=notice.message_id)

    if row is None:
        logger.info(
            "skipped a status broadcast for message %s, which no longer exists", notice.message_id
        )
        event = None
    else:
        event = MessageUpdated(
            conversation_id=row.message.conversation_id,
            message=_message(row).model_dump(mode="json"),
        )

    return event


def _conversation_updated(db: Session, notice: ConversationNotice) -> ConversationUpdated | None:
    try:
        detail = conversation_service.get_detail(db, conversation_id=notice.conversation_id)
    except ConversationNotFound:
        logger.info(
            "skipped a broadcast for conversation %s, which no longer exists",
            notice.conversation_id,
        )
        event = None
    else:
        event = ConversationUpdated(conversation=_read(detail).model_dump(mode="json"))

    return event


def _forget_pump() -> None:
    global _pump, _subscribed

    _pump = None
    _subscribed = None


async def _stop_pump_if_idle() -> None:
    """Stop the subscriber once the last socket in this process has gone.

    A `LISTEN` nobody is reading for is a held database connection and a task that outlives
    every reason it existed, so the pump's lifetime is the sockets' lifetime.
    """
    if not _sockets and _pump is not None:
        pump = _pump
        _forget_pump()
        pump.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await pump


async def _close_every_socket() -> None:
    """Close and release every socket this process holds.

    Called only after `_forget_pump`, which is what makes it complete: a socket that registered
    while the pump was dying either started a replacement pump, or found the old one and is in
    this sweep. There is no order in which a socket ends up registered with no pump behind it.
    """
    for socket in tuple(_sockets):
        _release(socket)
        await _close(socket, PUMP_STOPPED_ERROR, code=status.WS_1011_INTERNAL_ERROR)


def _release(socket: WebSocket) -> None:
    unregister(socket)
    _sockets.discard(socket)


async def _close(
    websocket: WebSocket, reason: str, *, code: int = status.WS_1008_POLICY_VIOLATION
) -> None:
    """Refusing a socket is a `1008` (`api-design.md:1628-1632`); failing one is a `1011`.

    A socket that has already gone raises rather than closing twice, and it is the state this
    is trying to reach either way.
    """
    with contextlib.suppress(RuntimeError):
        await websocket.close(code=code, reason=reason)
