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
    message_author_enum,
    message_status_enum,
)
from app.models.mixins import HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.conversation import Conversation

ADMIN_AUTHOR_PAIR_PREDICATE = "(author_kind = 'admin') = (author_user_id IS NOT NULL)"


class Message(HasID, HasTimestamps, Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(ADMIN_AUTHOR_PAIR_PREDICATE, name="ck_messages_admin_author_pair"),
        Index("ix_messages_conversation_id_created_at", "conversation_id", "created_at"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False
    )
    author_kind: Mapped[MessageAuthor] = mapped_column(message_author_enum, nullable=False)
    # Set only when `author_kind` is `admin`; the paired CHECK above enforces both directions.
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

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
