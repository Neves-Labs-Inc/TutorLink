"""One WhatsApp thread — opening it, reading the inbox, the takeover that pauses the bot, and
the reactivation request an admin approves or denies.

Same transaction contract as `client_service`: nothing here commits, the caller owns the
boundary. `claim` and `release` take a row lock that is only released by that commit or
rollback, so a caller that holds the transaction open across further work holds the lock with
it. This module knows nothing about FastAPI, status codes or request bodies; it raises the
domain exceptions below and `app.routers.conversations` maps them.

**`phone_number` is stored exactly as it arrives.**
`resolve_or_create` is called from the webhook with Twilio's `From` minus the `whatsapp:`
prefix and nothing else done to it (decision **P7-H**): an inbound message is proof of
dialability by delivery, and `phone_service`'s strict `is_valid_number` refusing it would drop
a real client's message behind a 400 that Twilio then retries forever. That asymmetry with
every other write path in the codebase is deliberate, not an oversight. Matching against
`guardians.phone_number` still compares like with like, because that column is E.164-normalised
on write by the same library and Twilio delivers E.164.

**A thread follows the Guardian who owns it** (#126, reversing **D-L** / #55's "never
rewritten"). When Staff change a Guardian's number, `client_service` locks the Guardian's thread
(`lock_guardian_thread`) and re-keys it (`rekey`), and a Staff-only `number_change_note` line
records where the earlier messages went. Left behind, the thread's `guardian_id` would make the
bot treat the old number's next holder as this Guardian. `ix_conversations_guardian_id` is still
not unique: threads from before this rule can share a Guardian.

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

**A reactivation request is the column, not the flag** (OQ-71 (a), Phase 7D). Pending means
`reactivation_child_id` is set; `flag_reason = 'reactivation_request'` only puts the thread in
the flagged queue, and a later `flag()` may overwrite it without losing the request. There is at
most one pending request per conversation (OQ-74): `request_reactivation` refuses a second
rather than replacing the first. `resolve_reactivation` ends the request and clears the flag
**only if** it still says `reactivation_request` — a `stuck` that arrived afterwards is a
different problem the admin has not dealt with. Neither writes a message nor sends anything to
the guardian (OQ-72).

**Lock order is conversation → child** (P7D-E, the order `child_service` documents as P7C-S).
The webhook's inbound insert flushes `last_message_at`, which locks the conversation row before
the bot reads any child; `resolve_reactivation` locks the conversation first and only then the
child, through `child_service.update_child`. Taken the other way round, an approval racing a
guardian's turn on the same conversation could deadlock.

**WhatsApp's 24-hour window is measured from the Guardian's latest `client` message only**
(#109), and only one written after the thread's latest `number_change_note` (#126): earlier
ones came from a number this thread no longer replies to. Outbound messages never extend it: Twilio refuses a free-form send (63016) once the
Guardian has been silent for 24 hours, however much Staff or the bot wrote since. Exactly 24
hours is closed. `is_window_open` is the rule and `window_is_open` reads it for one thread.
`claim` and `transfer` refuse a thread outside it (`ConversationWindowClosed`): past the window
the Guardian is reached outside the bot, so there is nothing for Staff to take over.
"""

import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, ScalarSelect, Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    Language,
    MessageAuthor,
    SystemMessageKind,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User
from app.services import child_service
from app.services.phone_service import InvalidPhoneNumber, normalize_phone_number

# WhatsApp's customer-service window: free-form messages only within this of the last inbound.
WHATSAPP_WINDOW = datetime.timedelta(hours=24)

# Which of a Guardian's conversations (one per number they have written from) is theirs, and so
# carries the Guardian language: the most recently active, a tie going to the higher id. Every
# reader orders by this, so the Guardian screen and the weekly run always pick the same thread.
LATEST_CONVERSATION_FIRST = (Conversation.last_message_at.desc(), Conversation.id.desc())

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
    """A conversation with the two counts the thread header shows, and the child a pending
    reactivation request names (`None` when nothing is pending)."""

    conversation: Conversation
    guardian: Guardian | None
    holder: User | None
    message_count: int
    unread_count: int
    reactivation_child: Child | None
    last_client_message_at: datetime.datetime | None
    is_window_open: bool


@dataclass(frozen=True, slots=True)
class OwnershipChange:
    """A takeover, transfer or release, and whether it moved anything.

    `is_changed` is false for the no-op successes (a re-claim by the holder, a release of a
    thread the bot already has): those send the Guardian no notice.
    """

    detail: ConversationDetail
    is_changed: bool


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


class ConversationNotHeld(ConversationServiceError):
    """A transfer of a thread the bot holds: claiming it is the action for that."""


class ConversationAlreadyHeld(ConversationServiceError):
    """A transfer to the Staff member who already holds the thread."""


class ConversationWindowClosed(ConversationServiceError):
    """A claim or transfer of a thread whose Guardian last wrote 24 hours ago or more."""


class NoReactivationPending(ConversationServiceError):
    """Approve or deny on a conversation with no pending reactivation request."""


class ReactivationAlreadyPending(ConversationServiceError):
    """A second reactivation request on a conversation that already has one pending (OQ-74)."""


class FlagChanged(ConversationServiceError):
    """Mark handled with a `flagged_at` that is no longer the stored one (SA-38)."""


class FlagNeedsReactivationDecision(ConversationServiceError):
    """Mark handled on a `reactivation_request` flag, which only Approve or Deny ends (OQ-89)."""


def resolve_or_create(db: Session, *, phone_number: str) -> Conversation:
    """The thread for `phone_number`, opened on first contact.

    The webhook's entry point, and the reason this is not a plain `get`: a conversation exists
    because a message arrived, so first contact has to create one rather than fail. See the
    module docstring for why `phone_number` is taken verbatim, and for the one later write to
    it: a number change re-keys the Guardian's thread.
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


def lock_guardian_thread(
    db: Session, *, guardian_id: uuid.UUID, phone_number: str
) -> Conversation | None:
    """The thread at `phone_number` if it is `guardian_id`'s, locked for the rest of the
    transaction; `None` when there is none or it belongs to someone else.

    The first half of a number change: `client_service` takes this before it writes the
    Guardian's new number, so the lock order stays conversation first (an inbound turn locks
    the thread, then may touch the Guardian's row through a consent insert).
    """
    conversation = _conversation_for(db, phone_number=phone_number)

    if conversation is None or conversation.guardian_id != guardian_id:
        return None

    return conversation


def rekey(db: Session, *, conversation: Conversation, phone_number: str) -> bool:
    """Move a thread its Guardian owns to their new number. False when nothing moved.

    The second half of a number change, on a thread `lock_guardian_thread` returned. A thread
    already at `phone_number` is left alone for now, and so is this one: merging the two is a
    later change. The savepoint covers a first message from the new number that opened a
    thread there after the check: `UNIQUE (phone_number)` refuses the move, the savepoint
    unwinds it, and the number change goes on without it rather than as a 500.
    """
    # A plain read: locking the thread at the new number would wait on its turn while this
    # transaction holds the Guardian's row, which an Intake at that number then waits on.
    existing_id = db.scalars(
        select(Conversation.id).where(Conversation.phone_number == phone_number)
    ).first()

    if existing_id is not None:
        return False

    try:
        with db.begin_nested():
            conversation.phone_number = phone_number
            db.flush()
    except IntegrityError:
        return False

    return True


def owner_id(db: Session, *, conversation: Conversation) -> uuid.UUID | None:
    """The thread's Guardian while they still hold its number; `None` otherwise.

    A thread can stay linked to a Guardian who has since left its number: a move skipped
    because a thread already sat at the new number, a thread from before threads followed
    their Guardian (#126), or one keyed on a non-canonical number the move did not match.
    Trusting that link would hand the old Guardian's Children and consent to the number's next
    holder, so the webhook asks this instead and, on `None`, recognises the sender by number.
    """
    guardian = _guardian(db, conversation)

    if guardian is None:
        return None

    try:
        canonical = normalize_phone_number(db, raw=conversation.phone_number)
    except InvalidPhoneNumber:
        canonical = conversation.phone_number

    is_holding = guardian.phone_number in {conversation.phone_number, canonical}

    return guardian.id if is_holding else None


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


def claim(db: Session, *, conversation_id: uuid.UUID, user_id: uuid.UUID) -> OwnershipChange:
    """Claim the conversation for `user_id`, pausing the bot. Raises if another admin holds it,
    or if the Guardian's 24-hour window is closed.

    A re-claim by the current holder is a no-op success, not a conflict: a double-click or a
    retry after a dropped response asks for exactly the state the conversation is already in,
    and answering it with a 409 would put an error in front of an admin who got what they
    wanted (`api-design.md:1568-1571`).

    The three columns move together because the schema CHECK ties `status` to
    `taken_over_by_user_id` — a half-set state is unrepresentable and this must not try to
    write one.

    The holder's re-claim stays a no-op even with the window closed, and a closed window is
    refused before "held by another": naming a holder would invite a transfer that is refused too.
    """
    conversation = _locked(db, conversation_id=conversation_id)
    is_held_by_caller = (
        conversation.status is ConversationStatus.HUMAN
        and conversation.taken_over_by_user_id == user_id
    )

    if is_held_by_caller:
        return OwnershipChange(detail=_detail(db, conversation), is_changed=False)

    if not _is_window_open(db, conversation_id=conversation_id):
        raise ConversationWindowClosed(f"conversation {conversation_id} is outside the window")

    if conversation.status is ConversationStatus.HUMAN:
        raise ConversationHeldByAnother(_holder(db, conversation))

    conversation.status = ConversationStatus.HUMAN
    _hand_to(db, conversation, user_id=user_id)

    return OwnershipChange(detail=_detail(db, conversation), is_changed=True)


def transfer(db: Session, *, conversation_id: uuid.UUID, user_id: uuid.UUID) -> ConversationDetail:
    """Move a thread another Staff member holds to `user_id`.

    The deliberate way past `claim`'s `ConversationHeldByAnother` (#109): the caller has seen
    who holds it and chosen to take it anyway. Judged under the row lock, so two transfers
    racing each other cannot both read the old holder. A bot-held thread is refused (claim it
    instead), and so is a transfer to the current holder, which would move nothing. Past those,
    a closed window is refused, as for `claim`.
    """
    conversation = _locked(db, conversation_id=conversation_id)

    if conversation.status is ConversationStatus.BOT:
        raise ConversationNotHeld(f"conversation {conversation_id} is held by the bot")

    if conversation.taken_over_by_user_id == user_id:
        raise ConversationAlreadyHeld(
            f"conversation {conversation_id} is already held by {user_id}"
        )

    if not _is_window_open(db, conversation_id=conversation_id):
        raise ConversationWindowClosed(f"conversation {conversation_id} is outside the window")

    _hand_to(db, conversation, user_id=user_id)

    return _detail(db, conversation)


def release(db: Session, *, conversation_id: uuid.UUID) -> OwnershipChange:
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
        return OwnershipChange(detail=_detail(db, conversation), is_changed=False)

    conversation.status = ConversationStatus.BOT
    conversation.taken_over_by_user_id = None
    conversation.taken_over_at = None
    db.flush()

    return OwnershipChange(detail=_detail(db, conversation), is_changed=True)


def is_window_open(
    last_client_message_at: datetime.datetime | None, *, now: datetime.datetime
) -> bool:
    """Whether a free-form message may still reach the Guardian (see the module docstring)."""
    return last_client_message_at is not None and now - last_client_message_at < WHATSAPP_WINDOW


def window_is_open(db: Session, *, conversation_id: uuid.UUID) -> bool:
    """The window rule for one thread, read now. Checked before every send."""
    return _is_window_open(db, conversation_id=conversation_id)


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


def set_language(
    db: Session, *, conversation: Conversation, language: Language | None
) -> Conversation:
    """Store the Guardian language on this thread: what the bot detected (P7-C: the webhook
    writes what `bot_service` decided), or what Staff chose. `None` is "not detected", so
    English is used until the bot detects one again."""
    conversation.language = language
    db.flush()

    return conversation


def change_language(
    db: Session, *, conversation_id: uuid.UUID, language: Language | None
) -> ConversationDetail:
    """Staff's choice of the Guardian language on one thread, returned as the by-id read."""
    conversation = set_language(
        db, conversation=get(db, conversation_id=conversation_id), language=language
    )

    return _detail(db, conversation)


def flag(db: Session, *, conversation: Conversation, reason: FlagReason) -> Conversation:
    """Record why an admin needs to look at this thread.

    `flag_reason` and `flagged_at` are set together, and a second flag **overwrites** rather
    than accumulating: the column answers "why does this need attention now", and a thread that
    failed to parse and later got stuck needs the admin to see the state it is actually in.

    `flag()` never clears the flag. Exactly two paths do: `mark_handled` (an admin, for any
    reason but `reactivation_request`) and `resolve_reactivation` (Approve or Deny, for that
    reason only). Releasing a takeover does not, and neither does a later successful turn —
    `status` already says who is answering, and `flag_reason` is the independent question of why
    somebody had to look (`erd.md:290-299`, **P7-D**).

    One exception to overwriting: a `question` only lands on an unflagged thread or one already
    flagged `question`. Marking the question handled would clear the flag, and a booking or link
    request or a failed handoff has no column to bring it back, so it would drop out of every
    queue unseen. Every other reason still overwrites.
    """
    is_buried_question = reason is FlagReason.QUESTION and conversation.flag_reason not in (
        None,
        FlagReason.QUESTION,
    )
    if not is_buried_question:
        conversation.flag_reason = reason
        conversation.flagged_at = datetime.datetime.now(tz=datetime.UTC)
        db.flush()

    return conversation


def request_reactivation(
    db: Session, *, conversation: Conversation, child_id: uuid.UUID
) -> Conversation:
    """Record that the guardian asked for `child_id` to be reactivated, and flag the thread.

    The column is checked **first**, and a pending request is refused with
    `ReactivationAlreadyPending` before anything is written: the column, `flag_reason` and
    `flagged_at` are left exactly as they were, so the first request is never replaced and its
    flag time is never re-stamped (OQ-74, P7D-I). Through the webhook this is unreachable — the
    inbound insert holds the row lock from the bot's read of the column to the commit — so the
    guard is this function's own, not the caller's.

    Called by the webhook with the conversation it has already locked, as `flag` is.
    """
    if conversation.reactivation_child_id is not None:
        raise ReactivationAlreadyPending(
            f"conversation {conversation.id} already has a reactivation request pending"
        )

    conversation.reactivation_child_id = child_id

    return flag(db, conversation=conversation, reason=FlagReason.REACTIVATION_REQUEST)


def resolve_reactivation(db: Session, *, conversation_id: uuid.UUID, approve: bool) -> Conversation:
    """End the pending reactivation request: `approve` reactivates the child, deny does not.

    The conversation row is locked first and the child only afterwards, inside
    `child_service.update_child` — the webhook's order, so an approval racing a guardian's turn
    waits rather than deadlocks (P7D-E). Approving a child that is already active is a no-op on
    the child and still ends the request.

    The flag is cleared only while it is still `reactivation_request` (REQ-131.2): a later
    `stuck` or `parse_error` overwrote it and is a separate reason for an admin to look, which
    ending the request does not answer. No message is written and nothing is sent (OQ-72).
    """
    conversation = _locked(db, conversation_id=conversation_id)
    child_id = conversation.reactivation_child_id

    if child_id is None:
        raise NoReactivationPending(f"conversation {conversation_id} has no request pending")

    if approve:
        child_service.update_child(
            db,
            child_id=child_id,
            guardian_ids=None,
            home_ids=None,
            name=None,
            date_of_birth=None,
            grade_level=None,
            school_name=None,
            notes=None,
            is_active=True,
            expected_cancellations=None,
        )

    conversation.reactivation_child_id = None

    if conversation.flag_reason is FlagReason.REACTIVATION_REQUEST:
        conversation.flag_reason = None
        conversation.flagged_at = None

    db.flush()

    return conversation


def mark_handled(
    db: Session, *, conversation_id: uuid.UUID, flagged_at: datetime.datetime
) -> ConversationDetail:
    """Clear the flag an admin has dealt with, provided it is still the flag they saw.

    The user's OQ-54 answer (2026-09-23) reverses **P7-D**'s "nothing clears a flag": an admin
    marks a flagged thread handled and it leaves the `?flagged=true` queue.

    `flagged_at` is a compare token, not a value to write (SA-38). `flag()` re-stamps it on every
    flag, the same reason included, so a mismatch means the bot flagged the thread again after
    the admin looked — and a flag the admin never saw must not be cleared unseen. The comparison
    is by instant: both sides are aware and microsecond-exact. It is made under the row lock, so
    a re-flag that commits while this waits is the value compared against.

    A conversation that is not flagged is a no-op success, before the token is looked at — the
    `release` precedent: a double click or a second admin asks for the state already there.

    A `reactivation_request` flag is refused (OQ-89): Approve and Deny are the only way to end a
    request. When another reason is cleared while a request is still pending underneath it
    (P7D-A), the request resurfaces through `flag()` with a fresh `flagged_at` instead of the
    thread going unflagged. The invariant is `reactivation_child_id IS NOT NULL ⇒ flag_reason IS
    NOT NULL`; without the fallback a pending request would drop out of the flagged queue and be
    seen only by someone who happened to open the thread.

    Lock order: the conversation row only, the same first lock the webhook, takeover and
    `resolve_reactivation` take. No second row is locked, so this cannot join a cycle.

    No message is written and nothing is sent; `status`, the takeover and `last_read_at` are
    untouched.
    """
    conversation = _locked(db, conversation_id=conversation_id)

    if conversation.flag_reason is not None:
        if conversation.flagged_at != flagged_at:
            raise FlagChanged(f"conversation {conversation_id} was flagged again")

        if conversation.flag_reason is FlagReason.REACTIVATION_REQUEST:
            raise FlagNeedsReactivationDecision(
                f"conversation {conversation_id} has a reactivation request to decide"
            )

        if conversation.reactivation_child_id is not None:
            flag(db, conversation=conversation, reason=FlagReason.REACTIVATION_REQUEST)
        else:
            conversation.flag_reason = None
            conversation.flagged_at = None
            db.flush()

    return _detail(db, conversation)


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
    # Locked, and re-read rather than served from the identity map: an inbound turn that waits
    # here on a number change re-checks the key after it commits, so it either lands before
    # the move (and moves with the thread) or finds no thread at the old number and opens one.
    return db.execute(
        select(Conversation)
        .where(Conversation.phone_number == phone_number)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def lock(db: Session, *, conversation_id: uuid.UUID) -> Conversation:
    """The row, locked for the rest of the caller's transaction (see `_locked`).

    For a caller outside this module that must judge who holds the thread and act on it before
    anyone can change that, as `notice_service` does before recording or retrying a notice.
    Take it before any other row lock: the order is conversation first.
    """
    return _locked(db, conversation_id=conversation_id)


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
    last_client_message_at = _last_client_message_at(db, conversation.id)

    return ConversationDetail(
        conversation=conversation,
        guardian=_guardian(db, conversation),
        holder=_holder_or_none(db, conversation),
        message_count=_message_count(db, conversation, unread_only=False),
        unread_count=_message_count(db, conversation, unread_only=True),
        reactivation_child=_reactivation_child(db, conversation),
        last_client_message_at=last_client_message_at,
        is_window_open=is_window_open(
            last_client_message_at, now=datetime.datetime.now(tz=datetime.UTC)
        ),
    )


def _is_window_open(db: Session, *, conversation_id: uuid.UUID) -> bool:
    # `claim` and `transfer` read this rather than `window_is_open`, so a test can close the
    # window for the notice alone and reproduce a claim that raced the window closing.
    return is_window_open(
        _last_client_message_at(db, conversation_id),
        now=datetime.datetime.now(tz=datetime.UTC),
    )


def _hand_to(db: Session, conversation: Conversation, *, user_id: uuid.UUID) -> None:
    # Only `claim` moves `status`; the CHECK ties it to a non-NULL holder, which this sets.
    conversation.taken_over_by_user_id = user_id
    conversation.taken_over_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()


def _last_client_message_at(db: Session, conversation_id: uuid.UUID) -> datetime.datetime | None:
    # Only what the Guardian wrote since the latest number change opens the window: earlier
    # messages came from a number Twilio no longer sends this thread's replies to.
    number_changed_at = (
        select(func.max(Message.created_at))
        .where(
            Message.conversation_id == conversation_id,
            Message.system_kind == SystemMessageKind.NUMBER_CHANGE_NOTE,
        )
        .scalar_subquery()
    )

    return db.scalar(
        select(func.max(Message.created_at)).where(
            Message.conversation_id == conversation_id,
            Message.author_kind == MessageAuthor.CLIENT,
            or_(number_changed_at.is_(None), Message.created_at > number_changed_at),
        )
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


def _reactivation_child(db: Session, conversation: Conversation) -> Child | None:
    # Read by id rather than through the `reactivation_child` relationship: `resolve_reactivation`
    # clears the column in the same session, and an already-loaded relationship would still
    # name the child until the next expire.
    if conversation.reactivation_child_id is None:
        return None

    return db.get(Child, conversation.reactivation_child_id)


def _holder_or_none(db: Session, conversation: Conversation) -> User | None:
    if conversation.taken_over_by_user_id is None:
        return None

    return _holder(db, conversation)


def _holder(db: Session, conversation: Conversation) -> User:
    # `get_one` rather than a `None` branch: the CHECK makes a held conversation without a
    # holder unrepresentable and the foreign key makes the row exist, so there is no reachable
    # state for that branch to handle.
    return db.get_one(User, conversation.taken_over_by_user_id)
