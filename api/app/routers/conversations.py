"""The admin chat REST surface: listing conversations, a thread, takeover/transfer/release and
the notices they send, the approve/deny that ends a reactivation request, and marking a flagged
thread handled.

Two routers share the `/api/conversations` prefix on purpose (D-G, P4-F): this one and
`conversation_stream.py`, so the two can be built concurrently. The paths do not shadow each
other.

**`OfficePrincipal` on every route, and the tutor-scope dependency on none of them** (§14, §15).
This is not the "a route that lists is scoped to a tutor" case: chat is an admin surface, the
RBAC table (`docs/api-design.md:1423-1424`) answers a tutor token with 403 on every one of
these, and there is no tutor-scoped view of a conversation to narrow to. Taking a scope
nobody reads would arm the unapplied-scope guard and turn every query in this module into a
500 — `client_bookings.py:36-37` documents that exact mistake. The name is deliberately
absent from this file, prose included, so that the grep criterion 8 names is a real gate.

**Takeover, release, approve, deny and mark handled publish `conversation.updated` after the
commit**, on every 200 including a no-op, so the other admins' list screens move without a
reload. `POST /read` publishes nothing: the watermark is shared,
but a read is not an event anybody else needs pushed. `broadcast_service.publish` fails open
and logs rather than raising, deliberately — the write has already committed by the time it is
reached, so raising would turn a database error on the notify into a 500 on an action that
succeeded, and it would not get the event to the admin either.

Two routes here take a request body. `PATCH` sets the Guardian language (`null` is "not
detected", so English is used) and publishes `conversation.updated`; nothing is sent to the
Guardian. `FlagHandled` on `POST /handled` is a compare token rather than data: the
`flagged_at` the admin saw, so that a flag the bot raised after they opened the thread is
refused with a 409 instead of being cleared unseen (`07D-CONTEXT.md` §4b, SA-38). There is
no `POST /api/conversations/{id}/messages`: sending lives on the socket and
`docs/api-design.md:1655-1660` refuses a REST twin outright.

**Takeover, transfer and release tell the Guardian** (#109) through `notice_service`, which
owns their commits: the ownership change first, then the notice line, then the send. Each
publishes `conversation.updated` and then `message.created` for the notice line; a no-op
takeover or release sends and publishes no notice. Retry re-sends a failed takeover or transfer
notice on the same row and publishes `message.updated`. Takeover, transfer and Retry are refused
with a 409 once the Guardian's 24-hour window has closed (never a 403: the Staff member may act
on the chat, the chat just cannot be acted on); past the window the Guardian is reached outside
the bot.

**Approve, deny and mark handled need no takeover** (`07D-CONTEXT.md` §4, §4b): none of them
answers the guardian, so there is nothing for the bot to be paused for. None writes a message or
sends anything to the guardian (OQ-72); the only event is `conversation.updated`.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.enums import ConversationStatus
from app.models.child import Child
from app.models.guardian import Guardian
from app.models.user import User
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.conversation import (
    ConversationRead,
    ConversationSummary,
    ConversationUpdate,
    FlagHandled,
    GuardianRef,
    ReactivationChildRef,
    ReactivationRequestRead,
    UserRef,
)
from app.schemas.message import MessageRead
from app.services import notice_service
from app.services.broadcast_service import (
    ConversationUpdated,
    MessageCreated,
    MessageUpdated,
    publish,
)
from app.services.conversation_service import (
    ConversationAlreadyHeld,
    ConversationDetail,
    ConversationHeldByAnother,
    ConversationListItem,
    ConversationNotFound,
    ConversationNotHeld,
    ConversationWindowClosed,
    FlagChanged,
    FlagNeedsReactivationDecision,
    NoReactivationPending,
    change_language,
    get_detail,
    list_conversations,
    mark_handled,
    mark_read,
    resolve_reactivation,
)
from app.services.message_service import ThreadMessage, list_thread
from app.services.notice_service import (
    NoticeNotFound,
    NoticeNotRetryable,
    NoticeOutcome,
    NoticeOutdated,
    NoticeWindowClosed,
)

CONVERSATION_NOT_FOUND_ERROR = "Conversation not found"
HELD_BY_ANOTHER_ERROR = "This conversation has already been taken over by {name}"
NO_REACTIVATION_PENDING_ERROR = "No reactivation request is pending"
FLAG_CHANGED_ERROR = "The flag changed since you opened this conversation; review it and try again"
REACTIVATION_FLAG_ERROR = "Approve or deny the reactivation request instead"
NOT_HELD_ERROR = "The assistant has this conversation; take it over instead"
ALREADY_HELD_ERROR = "You already hold this conversation"
MESSAGE_NOT_FOUND_ERROR = "Message not found"
NOT_RETRYABLE_ERROR = "Only a failed takeover or transfer notice can be retried"
NOTICE_OUTDATED_ERROR = "This takeover has ended, so its notice can no longer be sent"
TAKEOVER_WINDOW_CLOSED_ERROR = (
    "The Guardian last wrote more than 24 hours ago, so this chat can't be taken over."
    " Reach them outside the bot."
)
RETRY_WINDOW_CLOSED_ERROR = (
    "The Guardian last wrote more than 24 hours ago, so this notice can't be sent."
    " Reach them outside the bot."
)

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", response_model=Page[ConversationSummary])
def list_all(
    user: OfficePrincipal,
    db: DbSession,
    conversation_status: Annotated[ConversationStatus | None, Query(alias="status")] = None,
    unread: bool | None = None,
    flagged: bool | None = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[ConversationSummary]:
    # Aliased because `status` is FastAPI's status-code module, imported above. Single-valued
    # rather than repeatable: the contract offers `bot` or `human` and a conversation is in
    # exactly one of them, so asking for both is asking for no filter at all.
    conversations, total = list_conversations(
        db,
        status=conversation_status,
        unread=unread,
        flagged=flagged,
        q=q,
        limit=page_size,
        offset=(page - 1) * page_size,
    )

    return Page[ConversationSummary](
        items=[_summary(row) for row in conversations],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{conversation_id}", response_model=ConversationRead)
def read_one(conversation_id: uuid.UUID, user: OfficePrincipal, db: DbSession) -> ConversationRead:
    try:
        detail = get_detail(db, conversation_id=conversation_id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    return _read(detail)


@router.patch("/{conversation_id}", response_model=ConversationRead)
def update(
    conversation_id: uuid.UUID, payload: ConversationUpdate, user: OfficePrincipal, db: DbSession
) -> ConversationRead:
    try:
        detail = change_language(db, conversation_id=conversation_id, language=payload.language)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    db.commit()
    conversation = _read(detail)
    _publish_update(conversation)

    return conversation


@router.get("/{conversation_id}/messages", response_model=Page[MessageRead])
def read_thread(
    conversation_id: uuid.UUID,
    user: OfficePrincipal,
    db: DbSession,
    before: datetime.datetime | None = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[MessageRead]:
    # `total` is the whole conversation's message count and `before` narrows only `items`, so a
    # thread paged with `before` set deliberately returns fewer rows than its `total` reports
    # (§8, `api-design.md:1526-1537`). `before` is a paging marker, not a filter: the thread
    # header says how much history exists, and a windowed count would make it lie. Do not
    # "fix" the two into agreement.
    try:
        messages, total = list_thread(
            db,
            conversation_id=conversation_id,
            before=before,
            limit=page_size,
            offset=(page - 1) * page_size,
        )
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    return Page[MessageRead](
        items=[_message(row) for row in messages],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/{conversation_id}/takeover", response_model=ConversationRead)
def take_over(conversation_id: uuid.UUID, user: OfficePrincipal, db: DbSession) -> ConversationRead:
    try:
        outcome = notice_service.take_over(db, conversation_id=conversation_id, user_id=user.id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc
    except ConversationWindowClosed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, TAKEOVER_WINDOW_CLOSED_ERROR) from exc
    except ConversationHeldByAnother as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            HELD_BY_ANOTHER_ERROR.format(name=exc.holder.name),
        ) from exc

    return _publish_outcome(outcome)


@router.post("/{conversation_id}/transfer", response_model=ConversationRead)
def transfer_to_me(
    conversation_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> ConversationRead:
    # The broadcast is what locks the previous holder's open thread: their composer reads
    # `taken_over_by` from the `conversation.updated` frame.
    try:
        outcome = notice_service.transfer(db, conversation_id=conversation_id, user_id=user.id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc
    except ConversationNotHeld as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NOT_HELD_ERROR) from exc
    except ConversationAlreadyHeld as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_HELD_ERROR) from exc
    except ConversationWindowClosed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, TAKEOVER_WINDOW_CLOSED_ERROR) from exc

    return _publish_outcome(outcome)


@router.delete("/{conversation_id}/takeover", response_model=ConversationRead)
def release_takeover(
    conversation_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> ConversationRead:
    # No holder check, and that asymmetry with `take_over` is the contract rather than an
    # omission (`api-design.md:1579-1583`): a claim only its owner could undo leaves a client
    # talking to nobody when that admin closes their laptop, and it is what answers a
    # deactivated holder (**OQ-28**) without any automatic machinery.
    try:
        outcome = notice_service.hand_back(db, conversation_id=conversation_id, user_id=user.id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    return _publish_outcome(outcome)


@router.post("/{conversation_id}/messages/{message_id}/retry", response_model=MessageRead)
def retry_notice(
    conversation_id: uuid.UUID, message_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> MessageRead:
    try:
        row = notice_service.retry(db, conversation_id=conversation_id, message_id=message_id)
    except NoticeNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, MESSAGE_NOT_FOUND_ERROR) from exc
    except NoticeNotRetryable as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NOT_RETRYABLE_ERROR) from exc
    except NoticeOutdated as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NOTICE_OUTDATED_ERROR) from exc
    except NoticeWindowClosed as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, RETRY_WINDOW_CLOSED_ERROR) from exc

    message = _message(row)
    publish(
        MessageUpdated(conversation_id=conversation_id, message=message.model_dump(mode="json"))
    )

    return message


@router.post("/{conversation_id}/read", response_model=ConversationRead)
def mark_thread_read(
    conversation_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> ConversationRead:
    try:
        detail = mark_read(db, conversation_id=conversation_id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    db.commit()

    return _read(detail)


@router.post("/{conversation_id}/reactivation/approve", response_model=ConversationRead)
def approve_reactivation(
    conversation_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> ConversationRead:
    return _resolve_reactivation(db, conversation_id=conversation_id, approve=True)


@router.post("/{conversation_id}/reactivation/deny", response_model=ConversationRead)
def deny_reactivation(
    conversation_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> ConversationRead:
    return _resolve_reactivation(db, conversation_id=conversation_id, approve=False)


@router.post("/{conversation_id}/handled", response_model=ConversationRead)
def mark_flag_handled(
    conversation_id: uuid.UUID,
    payload: FlagHandled,
    user: OfficePrincipal,
    db: DbSession,
) -> ConversationRead:
    try:
        detail = mark_handled(db, conversation_id=conversation_id, flagged_at=payload.flagged_at)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc
    except FlagChanged as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, FLAG_CHANGED_ERROR) from exc
    except FlagNeedsReactivationDecision as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, REACTIVATION_FLAG_ERROR) from exc

    db.commit()
    conversation = _read(detail)
    _publish_update(conversation)

    return conversation


def _resolve_reactivation(
    db: Session, *, conversation_id: uuid.UUID, approve: bool
) -> ConversationRead:
    try:
        resolve_reactivation(db, conversation_id=conversation_id, approve=approve)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc
    except NoReactivationPending as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, NO_REACTIVATION_PENDING_ERROR) from exc

    detail = get_detail(db, conversation_id=conversation_id)
    db.commit()
    conversation = _read(detail)
    _publish_update(conversation)

    return conversation


def _publish_update(conversation: ConversationRead) -> None:
    publish(ConversationUpdated(conversation=conversation.model_dump(mode="json")))


def _publish_outcome(outcome: NoticeOutcome) -> ConversationRead:
    """Announce the ownership change, then its notice line, and return the conversation."""
    conversation = _read(outcome.detail)
    _publish_update(conversation)

    if outcome.notice is not None:
        publish(
            MessageCreated(
                conversation_id=conversation.id,
                message=_message(outcome.notice).model_dump(mode="json"),
            )
        )

    return conversation


def _summary(row: ConversationListItem) -> ConversationSummary:
    # Built field by field rather than with `model_validate`: the constitution forbids an ORM
    # instance crossing the HTTP boundary, and an explicit constructor makes adding a column to
    # `conversations` a decision to expose it rather than an accident.
    return ConversationSummary(
        id=row.conversation.id,
        phone_number=row.conversation.phone_number,
        guardian=_guardian_ref(row.guardian),
        status=row.conversation.status,
        taken_over_by=_user_ref(row.holder),
        last_message_at=row.conversation.last_message_at,
        last_message_preview=row.last_message_preview,
        unread=row.unread,
        flag_reason=row.conversation.flag_reason,
    )


def _read(detail: ConversationDetail) -> ConversationRead:
    return ConversationRead(
        id=detail.conversation.id,
        phone_number=detail.conversation.phone_number,
        guardian=_guardian_ref(detail.guardian),
        status=detail.conversation.status,
        taken_over_by=_user_ref(detail.holder),
        taken_over_at=detail.conversation.taken_over_at,
        last_message_at=detail.conversation.last_message_at,
        last_read_at=detail.conversation.last_read_at,
        flag_reason=detail.conversation.flag_reason,
        flagged_at=detail.conversation.flagged_at,
        message_count=detail.message_count,
        unread_count=detail.unread_count,
        created_at=detail.conversation.created_at,
        reactivation_request=_reactivation_request(detail.reactivation_child),
        is_window_open=detail.is_window_open,
        last_client_message_at=detail.last_client_message_at,
        language=detail.conversation.language,
    )


def _message(row: ThreadMessage) -> MessageRead:
    return MessageRead(
        id=row.message.id,
        author_kind=row.message.author_kind,
        author=_user_ref(row.author),
        body=row.message.body,
        status=row.message.status,
        created_at=row.message.created_at,
        system_kind=row.message.system_kind,
        error_code=row.message.error_code,
        reminder_child_names=row.reminder_child_names,
    )


def _guardian_ref(guardian: Guardian | None) -> GuardianRef | None:
    if guardian is None:
        reference = None
    else:
        reference = GuardianRef(id=guardian.id, name=guardian.name)

    return reference


def _reactivation_request(child: Child | None) -> ReactivationRequestRead | None:
    if child is None:
        request = None
    else:
        request = ReactivationRequestRead(
            child=ReactivationChildRef(id=child.id, name=child.name, is_active=child.is_active)
        )

    return request


def _user_ref(user: User | None) -> UserRef | None:
    if user is None:
        reference = None
    else:
        reference = UserRef(id=user.id, name=user.name)

    return reference
