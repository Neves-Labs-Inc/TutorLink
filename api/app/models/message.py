"""Every message in a conversation — what the client sent, what the bot replied, and what an
admin typed while holding the thread.

There is deliberately no `direction` column. Inbound and outbound are already derivable from
`author_kind` — `client` is inbound, `bot` and `admin` are outbound — and storing both would
create two facts that can disagree, with nothing in the schema to say which one is right.

`author_user_id` is the admin who *typed* this message, which is not the same question as
`conversations.taken_over_by_user_id`'s admin who is *holding* the thread: a takeover can
change hands while the thread stays open.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import (
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
    in_values_predicate,
    message_author_enum,
    message_status_enum,
    varchar_enum,
)
from app.models.mixins import HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.conversation import Conversation

# `admin` requires the user who typed it, `client` and `bot` forbid one, and `system` may carry
# the Staff member who caused the notice (NULL for a weekly reminder).
ADMIN_AUTHOR_PAIR_PREDICATE = (
    "author_kind = 'system' OR (author_kind = 'admin') = (author_user_id IS NOT NULL)"
)
SYSTEM_KIND_PAIR_PREDICATE = "(author_kind = 'system') = (system_kind IS NOT NULL)"
SYSTEM_KIND_LENGTH = 32


class Message(HasID, HasTimestamps, Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(ADMIN_AUTHOR_PAIR_PREDICATE, name="ck_messages_admin_author_pair"),
        CheckConstraint(SYSTEM_KIND_PAIR_PREDICATE, name="ck_messages_system_kind_pair"),
        CheckConstraint(
            in_values_predicate("system_kind", SystemMessageKind), name="ck_messages_system_kind"
        ),
        Index("ix_messages_conversation_id_created_at", "conversation_id", "created_at"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False
    )
    author_kind: Mapped[MessageAuthor] = mapped_column(message_author_enum, nullable=False)
    # Required for `admin`, forbidden for `client` and `bot`, optional for `system`.
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # UNIQUE because Twilio retries a webhook whose delivery it believes failed, so the same
    # message can arrive more than once: the insert *is* the idempotency check, and a retry
    # conflicts on this index rather than appearing twice in the thread an admin is reading.
    #
    # Nullable, and PostgreSQL treats NULLs as distinct under a unique index — which is what
    # makes a bot reply recordable at all. A TwiML reply has no SID at the moment it is written,
    # and every bot reply in the system would otherwise collide with the first one.
    twilio_sid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    status: Mapped[MessageStatus] = mapped_column(message_status_enum, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    system_kind: Mapped[SystemMessageKind | None] = mapped_column(
        varchar_enum(SystemMessageKind, length=SYSTEM_KIND_LENGTH), nullable=True
    )

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
