"""The admin chat REST surface: listing conversations, a thread, and takeover/release.

Two routers share the `/api/conversations` prefix on purpose (D-G, P4-F): this one and
`conversation_stream.py`, so the two can be built concurrently. The paths do not shadow each
other.

**`AdminPrincipal` on all six, and the tutor-scope dependency on none of them** (§14, §15).
This is not the "a route that lists is scoped to a tutor" case: chat is an admin surface, the
RBAC table (`docs/api-design.md:1423-1424`) answers a tutor token with 403 on every one of
these, and there is no tutor-scoped view of a conversation to narrow to. Taking a scope
nobody reads would arm the unapplied-scope guard and turn every query in this module into a
500 — `client_bookings.py:36-37` documents that exact mistake. The name is deliberately
absent from this file, prose included, so that the grep criterion 8 names is a real gate.

**Takeover and release publish `conversation.updated` after the commit**, so the other admins'
list screens move without a reload. `POST /read` publishes nothing: the watermark is shared,
but a read is not an event anybody else needs pushed. `broadcast_service.publish` fails open
and logs rather than raising, deliberately — the write has already committed by the time it is
reached, so raising would turn a Redis blip into a 500 on an action that succeeded, and it
would not get the event to the admin either.

There is no request body anywhere here, and no `POST /api/conversations/{id}/messages`:
sending lives on the socket and `docs/api-design.md:1655-1660` refuses a REST twin outright.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from redis import Redis
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.models.enums import ConversationStatus
from app.models.guardian import Guardian
from app.models.user import User
from app.redis_client import get_redis
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.conversation import ConversationRead, ConversationSummary, GuardianRef, UserRef
from app.schemas.message import MessageRead
from app.services.broadcast_service import ConversationUpdated, publish
from app.services.conversation_service import (
    ConversationDetail,
    ConversationHeldByAnother,
    ConversationListItem,
    ConversationNotFound,
    claim,
    get_detail,
    list_conversations,
    mark_read,
    release,
)
from app.services.message_service import ThreadMessage, list_thread

CONVERSATION_NOT_FOUND_ERROR = "Conversation not found"
HELD_BY_ANOTHER_ERROR = "This conversation has already been taken over by {email}"

DbSession = Annotated[Session, Depends(get_db)]
RedisClient = Annotated[Redis, Depends(get_redis)]

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", response_model=Page[ConversationSummary])
def list_all(
    user: AdminPrincipal,
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
def read_one(conversation_id: uuid.UUID, user: AdminPrincipal, db: DbSession) -> ConversationRead:
    try:
        detail = get_detail(db, conversation_id=conversation_id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    return _read(detail)


@router.get("/{conversation_id}/messages", response_model=Page[MessageRead])
def read_thread(
    conversation_id: uuid.UUID,
    user: AdminPrincipal,
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
def take_over(
    conversation_id: uuid.UUID, user: AdminPrincipal, db: DbSession, redis: RedisClient
) -> ConversationRead:
    try:
        detail = claim(db, conversation_id=conversation_id, user_id=user.id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc
    except ConversationHeldByAnother as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, HELD_BY_ANOTHER_ERROR.format(email=exc.holder.email)
        ) from exc

    db.commit()
    conversation = _read(detail)
    _publish_update(redis, conversation)

    return conversation


@router.delete("/{conversation_id}/takeover", response_model=ConversationRead)
def release_takeover(
    conversation_id: uuid.UUID, user: AdminPrincipal, db: DbSession, redis: RedisClient
) -> ConversationRead:
    # No holder check, and that asymmetry with `take_over` is the contract rather than an
    # omission (`api-design.md:1579-1583`): a claim only its owner could undo leaves a client
    # talking to nobody when that admin closes their laptop, and it is what answers a
    # deactivated holder (**OQ-28**) without any automatic machinery.
    try:
        detail = release(db, conversation_id=conversation_id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    db.commit()
    conversation = _read(detail)
    _publish_update(redis, conversation)

    return conversation


@router.post("/{conversation_id}/read", response_model=ConversationRead)
def mark_thread_read(
    conversation_id: uuid.UUID, user: AdminPrincipal, db: DbSession
) -> ConversationRead:
    try:
        detail = mark_read(db, conversation_id=conversation_id)
    except ConversationNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CONVERSATION_NOT_FOUND_ERROR) from exc

    db.commit()

    return _read(detail)


def _publish_update(redis: Redis, conversation: ConversationRead) -> None:
    publish(redis, ConversationUpdated(conversation=conversation.model_dump(mode="json")))


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
        message_count=detail.message_count,
        unread_count=detail.unread_count,
        created_at=detail.conversation.created_at,
    )


def _message(row: ThreadMessage) -> MessageRead:
    return MessageRead(
        id=row.message.id,
        author_kind=row.message.author_kind,
        author=_user_ref(row.author),
        body=row.message.body,
        status=row.message.status,
        created_at=row.message.created_at,
    )


def _guardian_ref(guardian: Guardian | None) -> GuardianRef | None:
    if guardian is None:
        reference = None
    else:
        reference = GuardianRef(id=guardian.id, name=guardian.name)

    return reference


def _user_ref(user: User | None) -> UserRef | None:
    if user is None:
        reference = None
    else:
        reference = UserRef(id=user.id, email=user.email)

    return reference
