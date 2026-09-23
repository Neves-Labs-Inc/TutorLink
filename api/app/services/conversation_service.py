"""One WhatsApp thread — opening it, reading the inbox, and the takeover that pauses the bot.

Same transaction contract as `client_service`: nothing here commits, the caller owns the
boundary. `claim` and `release` take a row lock that is only released by that commit or
rollback, so a caller that holds the transaction open across further work holds the lock with
it. This module knows nothing about FastAPI, status codes or request bodies; it raises the
domain exceptions below and `app.routers.conversations` maps them.

**`phone_number` is stored exactly as it arrives and is never rewritten afterwards.**
`resolve_or_create` is called from the webhook with Twilio's `From` minus the `whatsapp:`
prefix and nothing else done to it (decision **P7-H**): an inbound message is proof of
dialability by delivery, and `phone_service`'s strict `is_valid_number` refusing it would drop
a real client's message behind a 400 that Twilio then retries forever. That asymmetry with
every other write path in the codebase is deliberate, not an oversight. Matching against
`guardians.phone_number` still compares like with like, because that column is E.164-normalised
on write by the same library and Twilio delivers E.164.

Nothing here assigns `phone_number` after the insert, and that is the invariant rather than an
omission (issue #55, decision **D-L**, `phone_service.py:1-30`, `erd.md:274-279`): correcting a
guardian's number moves `guardians.phone_number` and leaves the thread where it is. The next
inbound message from the new number opens a *second* conversation carrying the same
`guardian_id`, which is why `ix_conversations_guardian_id` is not unique. Re-pointing the thread
would make the archive claim messages went to a number Twilio never sent them to.

**A duplicate phone number is refused twice**, per the normative idiom `client_service` ships:
the named predicate `_conversation_for` answers the ordinary case, `UNIQUE (phone_number)` is
what survives a race between two first messages, and the savepoint around the insert is what
leaves the `Session` usable when it fires. The predicate is a named seam rather than an inline
query so the constraint path is reachable by a test (**D-I**).

**Every timestamp this module writes comes from Python's clock**, as `auth_service` writes
`revoked_at`. One clock matters here: `unread` compares `messages.created_at` against
`conversations.last_read_at`, and a server-side `now()` on one side of that comparison with a
process-side `datetime` on the other would make the watermark wrong by whatever the two clocks
disagree by. `resolve_or_create` therefore sets `last_message_at` explicitly rather than letting
the column's `now()` default fire.
"""

import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, ScalarSelect, Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, FlagReason
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User

_LIKE_ESCAPE = "\\"
_LIKE_WILDCARDS = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


@dataclass(frozen=True, slots=True)
class ConversationListItem:
    """One inbox row: the conversation and the three things the list renders beside it.

    `guardian` and `holder` ride along rather than being navigated because `Conversation`
    carries no relationship to either — both are plain nullable foreign keys — so a router
    that wanted the nested objects would have to query for them itself and would stop being a
    thin HTTP shell. Same reasoning as `client_service.ClientDetail`.
    """

    conversation: Conversation
    guardian: Guardian | None
    holder: User | None
    last_message_preview: str | None
    unread: bool


@dataclass(frozen=True, slots=True)
class ConversationDetail:
    """A conversation with the two counts the thread header shows."""

    conversation: Conversation
    guardian: Guardian | None
    holder: User | None
    message_count: int
    unread_count: int


class ConversationServiceError(Exception):
    """Base class for every failure this module reports."""


class ConversationNotFound(ConversationServiceError):
    """No `conversations` row for the requested id."""


class ConversationHeldByAnother(ConversationServiceError):
    """Another admin holds the takeover.

    Carries the holder because the 409 names them: silently reassigning the claim would take a
    live conversation out from under the first admin with no trace, and the only useful next
    step is to go and ask them (`api-design.md:1562-1566`).
    """

    def __init__(self, holder: User) -> None:
        super().__init__(f"conversation is held by {holder.email}")
        self.holder = holder


def resolve_or_create(db: Session, *, phone_number: str) -> Conversation:
    """The thread for `phone_number`, opened on first contact.

    The webhook's entry point, and the reason this is not a plain `get`: a conversation exists
    because a message arrived, so first contact has to create one rather than fail. See the
    module docstring for why `phone_number` is taken verbatim and never rewritten.
    """
    existing = _conversation_for(db, phone_number=phone_number)

    if existing is not None:
        return existing

    conversation = Conversation(
        phone_number=phone_number,
        last_message_at=datetime.datetime.now(tz=datetime.UTC),
    )

    try:
        with db.begin_nested():
            db.add(conversation)
            db.flush()
    except IntegrityError:
        # Two first messages from one number arriving together both find nothing and both
        # insert; the loser blocks on the unique index until the winner commits and then
        # conflicts. The row it wanted now exists and is the one to carry on with, so this is
        # a re-read rather than an error — the webhook has an inbound message to record either
        # way, and a 500 here is a message Twilio retries forever. The savepoint is what leaves
        # the `Session` usable for that re-read; the constraint is matched by the exception,
        # never by its name (`client_service.create_client`).
        winner = _conversation_for(db, phone_number=phone_number)

        if winner is None:
            raise

        return winner

    return conversation


def get(db: Session, *, conversation_id: uuid.UUID) -> Conversation:
    """The row itself, for a caller that is about to write to it. Raises unless it exists."""
    conversation = db.get(Conversation, conversation_id)

    if conversation is None:
        raise ConversationNotFound(f"no conversation {conversation_id}")

    return conversation


def get_detail(db: Session, *, conversation_id: uuid.UUID) -> ConversationDetail:
    """The by-id read: the conversation, its nested rows, and the header's two counts."""
    return _detail(db, get(db, conversation_id=conversation_id))


def list_conversations(
    db: Session,
    *,
    status: ConversationStatus | None,
    unread: bool | None,
    flagged: bool | None,
    q: str | None,
    limit: int,
    offset: int,
) -> tuple[list[ConversationListItem], int]:
    """One page of the inbox, newest activity first, plus the total matching before paging.

    Ordered `last_message_at DESC` because the list is an inbox and nothing reads it the other
    way (`api-design.md:1434-1435`); `id` is the tiebreaker so that two conversations sharing a
    timestamp cannot be ordered differently by two executions and make page two repeat or skip
    a row page one already showed.

    `q` is a case-insensitive substring of the stored phone number **or** the linked guardian's
    name (`api-design.md:1437`), and is deliberately **not** phone-normalised (**P5-C**): a
    fragment such as `555` has no canonical form, and normalising it would turn a search into a
    400. A conversation with no guardian is still matched on its number, which is the whole
    point of the outer join — those are the threads an admin most wants to find.

    `unread` is computed against `last_read_at`, one watermark shared by every admin
    (`erd.md:281-284`). The same predicate decides the filter and the flag on each row, so the
    two can never disagree.
    """
    matching = _matching_conversations(status=status, unread=unread, flagged=flagged, q=q)
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0
    rows = db.execute(
        matching.add_columns(Guardian, User, _last_message_preview(), _unread())
        .outerjoin(User, User.id == Conversation.taken_over_by_user_id)
        .order_by(Conversation.last_message_at.desc(), Conversation.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        ConversationListItem(
            conversation=conversation,
            guardian=guardian,
            holder=holder,
            last_message_preview=preview,
            unread=unread_row,
        )
        for conversation, guardian, holder, preview, unread_row in rows
    ]

    return items, total


def claim(db: Session, *, conversation_id: uuid.UUID, user_id: uuid.UUID) -> ConversationDetail:
    """Claim the conversation for `user_id`, pausing the bot. Raises if another admin holds it.

    A re-claim by the current holder is a no-op success, not a conflict: a double-click or a
    retry after a dropped response asks for exactly the state the conversation is already in,
    and answering it with a 409 would put an error in front of an admin who got what they
    wanted (`api-design.md:1568-1571`).

    The three columns move together because the schema CHECK ties `status` to
    `taken_over_by_user_id` — a half-set state is unrepresentable and this must not try to
    write one.
    """
    conversation = _locked(db, conversation_id=conversation_id)

    if conversation.status is ConversationStatus.HUMAN:
        if conversation.taken_over_by_user_id != user_id:
            raise ConversationHeldByAnother(_holder(db, conversation))

        return _detail(db, conversation)

    conversation.status = ConversationStatus.HUMAN
    conversation.taken_over_by_user_id = user_id
    conversation.taken_over_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()

    return _detail(db, conversation)


def release(db: Session, *, conversation_id: uuid.UUID) -> ConversationDetail:
    """Hand the conversation back to the bot. Succeeds for **any** admin, not only the holder.

    The asymmetry with `claim` is intentional (`api-design.md:1579-1583`): a claim only its
    owner could undo means an admin who closes their laptop for the day leaves a client talking
    to nobody until they come back. Releasing is the safe direction — it hands the thread to
    the bot, which answers — so the cost of letting anyone do it is far below the cost of a
    conversation stuck in a pause. It is also the answer to a deactivated holder (**OQ-28**),
    which is why nothing automatic is needed there.

    Releasing a conversation that is already `bot` is a no-op success, for the same reason a
    re-claim by the holder is.
    """
    conversation = _locked(db, conversation_id=conversation_id)

    if conversation.status is ConversationStatus.BOT:
        return _detail(db, conversation)

    conversation.status = ConversationStatus.BOT
    conversation.taken_over_by_user_id = None
    conversation.taken_over_at = None
    db.flush()

    return _detail(db, conversation)


def mark_read(db: Session, *, conversation_id: uuid.UUID) -> ConversationDetail:
    """Move the shared read watermark to now, and report the recomputed counts.

    No row lock, unlike `claim` and `release`: nothing is judged here. Two admins reading the
    thread at the same time both want the watermark at roughly now, and the later write winning
    is the answer either of them would have got on their own.
    """
    conversation = get(db, conversation_id=conversation_id)
    conversation.last_read_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()

    return _detail(db, conversation)


def touch_last_message(
    db: Session, *, conversation: Conversation, at: datetime.datetime
) -> Conversation:
    """Move `last_message_at` to the moment a message was recorded.

    Called by `message_service` on every insert rather than by each of its callers, so the
    inbox's ordering key and the newest message's `created_at` are the same instant by
    construction. That equality is what lets `unread` be decided from the conversation row
    alone, without a correlated read of `messages`.
    """
    conversation.last_message_at = at
    db.flush()

    return conversation


def link_guardian(
    db: Session, *, conversation: Conversation, guardian_id: uuid.UUID
) -> Conversation:
    """Attach the guardian intake has just created to the thread that asked for it.

    One of the two mutations the webhook applies from a `BotTurn` (**P7-C**): the bot returns
    what it decided and this module writes it, so the flow machine stays testable without a
    `conversations` row.
    """
    conversation.guardian_id = guardian_id
    db.flush()

    return conversation


def flag(db: Session, *, conversation: Conversation, reason: FlagReason) -> Conversation:
    """Record why an admin needs to look at this thread.

    `flag_reason` and `flagged_at` are set together, and a second flag **overwrites** rather
    than accumulating: the column answers "why does this need attention now", and a thread that
    failed to parse and later got stuck needs the admin to see the state it is actually in.

    Nothing clears the flag here. Releasing a takeover does not, and neither does a later
    successful turn — `status` already says who is answering, and `flag_reason` is the
    independent question of why somebody had to look (`erd.md:290-299`, **P7-D**).
    """
    conversation.flag_reason = reason
    conversation.flagged_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()

    return conversation


def _matching_conversations(
    *,
    status: ConversationStatus | None,
    unread: bool | None,
    flagged: bool | None,
    q: str | None,
) -> Select[tuple[Conversation]]:
    # The guardian is outer-joined for every query, not only for `q`: it is a nullable FK to a
    # primary key, so the join cannot multiply a row and `total` stays a count of conversations
    # (CONSTITUTION §8).
    statement = select(Conversation).outerjoin(Guardian, Guardian.id == Conversation.guardian_id)
    pattern = _substring_pattern(q)

    if status is not None:
        statement = statement.where(Conversation.status == status)

    if unread is not None:
        statement = statement.where(_unread() if unread else ~_unread())

    if flagged is not None:
        statement = statement.where(
            Conversation.flag_reason.is_not(None) if flagged else Conversation.flag_reason.is_(None)
        )

    if pattern is not None:
        statement = statement.where(
            or_(
                Conversation.phone_number.ilike(pattern, escape=_LIKE_ESCAPE),
                Guardian.name.ilike(pattern, escape=_LIKE_ESCAPE),
            )
        )

    return statement


def _unread() -> ColumnElement[bool]:
    """Messages have arrived since the shared watermark — or nobody has read the thread yet.

    `last_message_at` is the newest message's `created_at` exactly (`touch_last_message`), so
    this answers the same question a correlated `EXISTS` over `messages` would, off the one row
    the list already has. Never NULL: the `IS NULL` branch decides the case where `last_read_at`
    is missing, so the comparison is only reached with both sides present.
    """
    return or_(
        Conversation.last_read_at.is_(None),
        Conversation.last_message_at > Conversation.last_read_at,
    )


def _last_message_preview() -> ScalarSelect[str]:
    return (
        select(Message.body)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
        .scalar_subquery()
    )


def _substring_pattern(raw: str | None) -> str | None:
    # `client_service`'s helper, deliberately duplicated rather than imported: it is that
    # module's private, and a shared search helper would tie two unrelated list endpoints
    # together for six lines.
    trimmed = "" if raw is None else raw.strip()

    if not trimmed:
        pattern = None
    else:
        pattern = f"%{trimmed.translate(_LIKE_WILDCARDS)}%"

    return pattern


def _conversation_for(db: Session, *, phone_number: str) -> Conversation | None:
    return db.scalars(select(Conversation).where(Conversation.phone_number == phone_number)).first()


def _locked(db: Session, *, conversation_id: uuid.UUID) -> Conversation:
    """Load the row for a decide-once write, locked for the rest of the transaction.

    **OB-17**, the shape `exception_service.py:91-99` and `booking_status_service.py:52-66`
    already ship. Without the lock two admins both read `bot`, both pass the check and both
    write, and whichever committed second silently discards the other's claim while handing its
    caller a 200. The second waiter blocks here, reads the claimed row, and gets the 409.

    `populate_existing` is the one addition to that shape. A lock whose read is served from the
    identity map judges the state the session loaded *before* it waited, which is exactly the
    stale value the lock exists to avoid — harmless only as long as no caller loads the
    conversation earlier in the same transaction, which is not a property this module can
    enforce on its callers. Every writer here flushes, so there is no pending in-memory change
    for the refresh to discard.
    """
    conversation = db.execute(
        select(Conversation)
        .where(Conversation.id == conversation_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()

    if conversation is None:
        raise ConversationNotFound(f"no conversation {conversation_id}")

    return conversation


def _detail(db: Session, conversation: Conversation) -> ConversationDetail:
    return ConversationDetail(
        conversation=conversation,
        guardian=_guardian(db, conversation),
        holder=_holder_or_none(db, conversation),
        message_count=_message_count(db, conversation, unread_only=False),
        unread_count=_message_count(db, conversation, unread_only=True),
    )


def _message_count(db: Session, conversation: Conversation, *, unread_only: bool) -> int:
    statement = (
        select(func.count()).select_from(Message).where(Message.conversation_id == conversation.id)
    )

    if unread_only and conversation.last_read_at is not None:
        statement = statement.where(Message.created_at > conversation.last_read_at)

    return db.scalar(statement) or 0


def _guardian(db: Session, conversation: Conversation) -> Guardian | None:
    if conversation.guardian_id is None:
        return None

    return db.get(Guardian, conversation.guardian_id)


def _holder_or_none(db: Session, conversation: Conversation) -> User | None:
    if conversation.taken_over_by_user_id is None:
        return None

    return _holder(db, conversation)


def _holder(db: Session, conversation: Conversation) -> User:
    # `get_one` rather than a `None` branch: the CHECK makes a held conversation without a
    # holder unrepresentable and the foreign key makes the row exist, so there is no reachable
    # state for that branch to handle.
    return db.get_one(User, conversation.taken_over_by_user_id)
