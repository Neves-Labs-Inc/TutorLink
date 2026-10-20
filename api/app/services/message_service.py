"""The message rows — what the client sent, what the bot replied, what an admin typed.

Same transaction contract as `conversation_service`: nothing here commits, the caller owns the
boundary, and no FastAPI import appears anywhere below (§4, §6).

**The insert is the idempotency check.** Twilio retries a webhook whose delivery it believes
failed, and the retry arrives as the same message with the same `MessageSid`. `record_inbound`
does **not** pre-read the SID: `docs/api-design.md:480-486` refuses that shape by name, because
two retries landing together both read nothing and both insert. `UNIQUE (messages.twilio_sid)`
is the guard, the conflict is caught around a savepoint that leaves the `Session` usable, and
the caller is told "already recorded" by a `None` return rather than by an exception — a
redelivery is an ordinary event on this path, not a failure. This is the one place the
`client_service` idiom is deliberately used **without** its named pre-check predicate, and the
contract is the reason.

**Every insert moves `conversations.last_message_at`** through
`conversation_service.touch_last_message`, so no caller has to remember to, and the inbox's
ordering key is the newest message's `created_at` exactly. `created_at` is set explicitly from
Python's clock rather than left to the column's `now()` default: `now()` is transaction start
time, a bot turn writes its confirmation and reply messages inside one transaction, and two
messages sharing a timestamp would let `ORDER BY created_at DESC` return them in either order
depending on the plan. Same clock as
`conversation_service.mark_read`, for the reason that module's docstring gives.

**A terminal status is reachable without a `twilio_sid`.** `advance_status` is keyed on the SID
because it applies what Twilio reported, and Twilio reports nothing about a send that never got
far enough to earn one — a REST send it refused outright. A row whose outcome is known *here*
is advanced by `mark_failed`, keyed on the row the caller already holds, so no writer has to own
a SID it was never given. The caller's evidence decides which function it uses: a callback
carries a SID, a local failure carries the row.

`failed` is the only status that rule can reach this way, and deliberately. `received` and
`sent` are written at insert time, and `sent` without a SID is only the Staff-only notes that
are never sent. `delivered` is not a fact any caller here can hold: only Twilio knows a message
arrived and it says so with the SID that names the row, so a SID-less `mark_delivered` would
have no honest caller and would only be a way to write a delivery that never happened.

Do **not** infer "this send was refused" from a `queued` row with a NULL SID. That coincidence
held before `mark_failed` existed and is not an invariant — anything that queues a message
before sending it breaks it, which is what `record_admin_message` does for the whole window
between the record and the send.

`list_thread` goes through `conversation_service.get`, so an id that does not exist raises
`ConversationNotFound` and the router answers 404 rather than serving an empty page for a
conversation nobody has. That call and `touch_last_message` are everything this module asks of
`conversation_service`; nothing crosses the other way.
"""

import datetime
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.booking_reminder import BookingReminder
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import MessageAuthor, MessageStatus, RedactedField, SystemMessageKind
from app.models.message import Message
from app.models.user import User
from app.services import conversation_service


@dataclass(frozen=True, slots=True)
class ThreadMessage:
    """A message and the admin who typed it, `None` for a client's or the bot's.

    Carried rather than navigated for the reason `ConversationListItem` gives: `author_user_id`
    is a plain nullable foreign key, and a router that resolved it itself would stop being a
    thin HTTP shell.
    """

    message: Message
    author: User | None
    # The Children a `booking_reminder` line named, matched on its SID; `None` for other lines.
    reminder_child_names: list[str] | None = None


def record_inbound(
    db: Session, *, conversation: Conversation, body: str, twilio_sid: str
) -> Message | None:
    """Record what the client sent. `None` means this SID was already recorded.

    The webhook records **before** it branches on the conversation's status
    (`api-design.md:475-478`): the whole point of a handoff is that the admin can read what the
    client said while the bot was silent, so a paused conversation is logged as fully as a
    running one.

    A `None` return is a redelivery and not an error — see the module docstring. Nothing is
    written on that path, `last_message_at` included: the message it repeats is already in the
    thread and already moved the watermark.
    """
    # The savepoint wraps the insert and nothing else, so the conflict this expects cannot be
    # confused with any other failure and unwinding it leaves the `Session` usable for the rest
    # of the request. The constraint is matched by the exception, never by its name —
    # PostgreSQL keeps a migrated database's original index name while `create_all` produces
    # its own, so name matching passes every test here and misses in production.
    try:
        with db.begin_nested():
            message = _insert(
                db,
                conversation=conversation,
                author_kind=MessageAuthor.CLIENT,
                body=body,
                status=MessageStatus.RECEIVED,
                twilio_sid=twilio_sid,
                author_user_id=None,
            )
    except IntegrityError:
        return None

    return message


def record_bot_reply(
    db: Session,
    *,
    conversation: Conversation,
    body: str,
    redacted_fields: Sequence[RedactedField] = (),
) -> Message:
    """Record a bot reply `queued` with no SID, before it is sent.

    The bot answers through the REST send API (docs/specs/whatsapp-bot-agent.md §7), so a reply
    is recorded first and `attach_twilio_sid` stores the SID once Twilio accepts it; the status
    callback then advances it like an office reply. A send that fails for good is `mark_failed`.

    `redacted_fields` are the private fields saved in the turn this reply ends: it may echo
    them, so the bot's history shows it as a placeholder (spec §5).
    """
    message = _insert(
        db,
        conversation=conversation,
        author_kind=MessageAuthor.BOT,
        body=body,
        status=MessageStatus.QUEUED,
        twilio_sid=None,
        author_user_id=None,
    )
    if redacted_fields:
        message.redacted_fields = list(dict.fromkeys(field.value for field in redacted_fields))
        db.flush()

    return message


def record_admin_message(
    db: Session,
    *,
    conversation: Conversation,
    body: str,
    author_user_id: uuid.UUID,
    twilio_sid: str | None,
) -> Message:
    """Record what an admin typed on the socket, `queued` for the delivery callback to advance.

    This is the message kind the `queued → sent → delivered` lifecycle actually describes: it
    goes out through Twilio's REST API, which returns a `MessageSid` the callback can match.

    `twilio_sid` is optional because the SID does not exist yet at the moment the socket should
    be writing this row. The send is made *after* the record — if the process died between the
    two the client would otherwise have a message the thread does not show — and
    `attach_twilio_sid` stores what the send returns.
    """
    return _insert(
        db,
        conversation=conversation,
        author_kind=MessageAuthor.ADMIN,
        body=body,
        status=MessageStatus.QUEUED,
        twilio_sid=twilio_sid,
        author_user_id=author_user_id,
    )


def record_system_notice(
    db: Session,
    *,
    conversation: Conversation,
    body: str,
    system_kind: SystemMessageKind,
    author_user_id: uuid.UUID | None,
) -> Message:
    """Record a notice to the Guardian, `queued` like an admin message: it goes out through
    the REST API after the record is committed.

    `author_user_id` is the Staff member who caused it, which is what lets the Staff-facing
    line name them even when the Guardian was sent the nameless notice. `None` when the
    Guardian caused it, as with a reminder consent confirmed under Takeover.
    """
    return _insert(
        db,
        conversation=conversation,
        author_kind=MessageAuthor.SYSTEM,
        body=body,
        status=MessageStatus.QUEUED,
        twilio_sid=None,
        author_user_id=author_user_id,
        system_kind=system_kind,
    )


def record_number_change_note(
    db: Session, *, conversation: Conversation, body: str, author_user_id: uuid.UUID
) -> Message:
    """Record the Staff-only line that a Guardian's number changed, by `author_user_id`.

    `sent` with no SID because it is never sent: the Guardian is not told, nothing queues it
    and nothing retries it. It marks where the thread's earlier messages went, and the 24-hour
    window counts only what the Guardian wrote after it.
    """
    return _insert(
        db,
        conversation=conversation,
        author_kind=MessageAuthor.SYSTEM,
        body=body,
        status=MessageStatus.SENT,
        twilio_sid=None,
        author_user_id=author_user_id,
        system_kind=SystemMessageKind.NUMBER_CHANGE_NOTE,
    )


def record_handoff_note(db: Session, *, conversation: Conversation, body: str) -> Message:
    """Record the bot's Staff-only summary of why it handed the chat to the office.

    `sent` with no SID because, like a number change note, it is never sent to WhatsApp. No
    author: the bot wrote it, not a Staff member.
    """
    return _insert(
        db,
        conversation=conversation,
        author_kind=MessageAuthor.SYSTEM,
        body=body,
        status=MessageStatus.SENT,
        twilio_sid=None,
        author_user_id=None,
        system_kind=SystemMessageKind.HANDOFF_NOTE,
    )


def requeue(db: Session, *, message: Message, body: str) -> Message:
    """Put a failed notice back to `queued` for a retry, with the copy the retry will send.

    The SID and error code are cleared: the retry earns its own SID, and a stale code would
    describe an attempt that is no longer the latest.
    """
    message.body = body
    message.status = MessageStatus.QUEUED
    message.error_code = None
    message.twilio_sid = None
    db.flush()

    return message


def attach_twilio_sid(db: Session, *, message: Message, twilio_sid: str) -> Message:
    """Store the SID Twilio returned for a message that was recorded before it was sent.

    Without it `advance_status` has nothing to match the delivery callback against and the
    admin's line stays `queued` for good.
    """
    message.twilio_sid = twilio_sid
    db.flush()

    return message


def mark_failed(db: Session, *, message: Message, error_code: str | None) -> Message:
    """Record that a message never went out, on a row that has no SID to be found by.

    The row is the key, not the SID: this is the path for an outcome the process already knows
    — a REST send Twilio refused — where `advance_status` has nothing to match on because the
    send never earned a `MessageSid`. Without it such a row stays `queued` forever and the only
    trace of the failure is the socket's `error` frame, which is ephemeral by contract
    (`api-design.md:1706`) and therefore not a record of anything.

    `error_code` is `None` when the refusal carried no Twilio code, which is the usual case for
    a send the API rejected before assigning one. It is written unconditionally rather than only
    when set, so a retry that fails differently cannot leave a stale code behind — the same
    reason `advance_status` writes it on every status.

    No delivery callback can move the row afterwards: the SID is attached only on the success
    path, so a row this marks carries none. Only a retry of a takeover or transfer notice
    (`requeue`) moves it again.
    """
    message.status = MessageStatus.FAILED
    message.error_code = error_code
    db.flush()

    return message


def bot_reply_conversation_id(db: Session, *, twilio_sid: str) -> uuid.UUID | None:
    """The chat of the bot reply carrying `twilio_sid`, read without a lock; `None` when no bot
    reply carries it. For a caller that must lock the chat before the message row."""
    return db.scalar(
        select(Message.conversation_id).where(
            Message.twilio_sid == twilio_sid, Message.author_kind == MessageAuthor.BOT
        )
    )


def advance_status(
    db: Session, *, twilio_sid: str, status: MessageStatus, error_code: str | None
) -> Message | None:
    """Apply Twilio's delivery callback. `None` means nothing changed: no row carries that SID,
    or the callback does not move the row forward.

    An unknown SID is **not an error**: retention deletes messages on a schedule and Twilio's
    callbacks are not bounded by it, so a status arriving for a purged message is an ordinary
    event and the router answers 204 (`api-design.md:533-536`). A 404 would only teach Twilio
    to retry a row that no longer exists.

    **Forward only**, mirroring `reminder_service.apply_delivery_status`. Twilio does not
    guarantee callback ordering and replays them, so a late `sent` or `failed` must not undo a
    `delivered`. Rank is queued < sent < delivered and a status applies only if it ranks higher;
    `failed` applies only while the row is `queued` or `sent`. Anything else — the same status
    again, an earlier one, anything once the row is `delivered` or `failed`, any callback for a
    `received` row — changes nothing and returns `None`, so the router publishes nothing. The
    row is locked so two callbacks racing on one SID apply in turn.

    `error_code` is written as given rather than only on `failed`, so a message that later
    succeeds does not keep a stale code from an earlier attempt.
    """
    message = db.scalars(
        select(Message)
        .where(Message.twilio_sid == twilio_sid)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()

    if message is None or not _moves_forward(message.status, status):
        return None

    message.status = status
    message.error_code = error_code
    db.flush()

    return message


_DELIVERY_RANK = {MessageStatus.QUEUED: 0, MessageStatus.SENT: 1, MessageStatus.DELIVERED: 2}


def _moves_forward(current: MessageStatus, reported: MessageStatus) -> bool:
    if reported is MessageStatus.FAILED:
        return current in (MessageStatus.QUEUED, MessageStatus.SENT)

    return (
        current in _DELIVERY_RANK
        and reported in _DELIVERY_RANK
        and _DELIVERY_RANK[reported] > _DELIVERY_RANK[current]
    )


def list_thread(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    before: datetime.datetime | None,
    limit: int,
    offset: int,
) -> tuple[list[ThreadMessage], int]:
    """One page of the thread, **newest first**, plus the conversation's whole message count.

    Newest first is the opposite of every other list in the API and is deliberate
    (`api-design.md:1526-1537`): a thread is read from its end, and oldest-first would make
    page 1 the first twenty messages of a year-old conversation, reachable only by paging to a
    number the client has to compute from `total`.

    **`before` is a paging marker, not a filter.** It pins the window to a fixed point so that
    a message arriving between two requests lands above it instead of shifting every row down
    one — but `total` still counts every message in the conversation, because the thread header
    says how much history exists and a windowed count would make it lie (§8).
    """
    conversation_service.get(db, conversation_id=conversation_id)

    matching = select(Message).where(Message.conversation_id == conversation_id)
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0
    windowed = matching if before is None else matching.where(Message.created_at < before)
    rows = db.execute(
        windowed.add_columns(User)
        .outerjoin(User, User.id == Message.author_user_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    reminder_names = _reminder_child_names(db, [message for message, _author in rows])
    items = [
        ThreadMessage(
            message=message, author=author, reminder_child_names=reminder_names.get(message.id)
        )
        for message, author in rows
    ]

    return items, total


def get_thread_message(db: Session, *, message_id: uuid.UUID) -> ThreadMessage | None:
    """One message and its author, in the shape `list_thread` carries it. `None` if it is gone.

    The live-update socket rebuilds every `message.created` frame from this rather than from
    what the publisher had in hand, so the frame is the object the thread's refetch returns.
    A missing row is an ordinary outcome on that path, not an error: the notice that names it
    crosses processes after the commit, and retention may have deleted the row by the time it
    is read. Unlike `list_thread` it does not go through `conversation_service.get` — the
    message's own id is the whole lookup, and its conversation is the row's foreign key.
    """
    row = db.execute(
        select(Message, User)
        .outerjoin(User, User.id == Message.author_user_id)
        .where(Message.id == message_id)
    ).one_or_none()

    if row is None:
        found = None
    else:
        names = _reminder_child_names(db, [row[0]])
        found = ThreadMessage(
            message=row[0], author=row[1], reminder_child_names=names.get(row[0].id)
        )

    return found


def _reminder_child_names(db: Session, messages: list[Message]) -> dict[uuid.UUID, list[str]]:
    """The reminded Children's names per `booking_reminder` line, in the reminder's order.

    Two queries for the whole page rather than two per line: the reminder rows by SID, then
    every Child they name.
    """
    message_ids_by_sid = {
        message.twilio_sid: message.id
        for message in messages
        if message.system_kind is SystemMessageKind.BOOKING_REMINDER and message.twilio_sid
    }
    names: dict[uuid.UUID, list[str]] = {}

    if message_ids_by_sid:
        reminders = db.scalars(
            select(BookingReminder).where(BookingReminder.twilio_sid.in_(message_ids_by_sid))
        ).all()
        child_ids = {child_id for reminder in reminders for child_id in reminder.child_ids}
        child_names = dict(
            db.execute(select(Child.id, Child.name).where(Child.id.in_(child_ids))).all()
        )
        names = {
            message_ids_by_sid[reminder.twilio_sid]: [
                child_names[child_id] for child_id in reminder.child_ids if child_id in child_names
            ]
            for reminder in reminders
            if reminder.twilio_sid is not None
        }

    return names


def _insert(
    db: Session,
    *,
    conversation: Conversation,
    author_kind: MessageAuthor,
    body: str,
    status: MessageStatus,
    twilio_sid: str | None,
    author_user_id: uuid.UUID | None,
    system_kind: SystemMessageKind | None = None,
) -> Message:
    recorded_at = datetime.datetime.now(tz=datetime.UTC)
    message = Message(
        conversation_id=conversation.id,
        author_kind=author_kind,
        author_user_id=author_user_id,
        body=body,
        twilio_sid=twilio_sid,
        status=status,
        created_at=recorded_at,
        system_kind=system_kind,
    )
    db.add(message)
    db.flush()
    conversation_service.touch_last_message(db, conversation=conversation, at=recorded_at)

    return message
