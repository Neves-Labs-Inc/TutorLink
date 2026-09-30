"""One WhatsApp thread, keyed on the phone number that opened it.

The row is keyed on `phone_number` rather than on `guardian_id` because the bot is already
talking before a guardian exists — intake collects the name several messages in. A conversation
that could not exist until intake succeeded would lose exactly the threads an admin most wants
to read: the ones that stalled part-way through it.

`phone_number` is never rewritten. Correcting a guardian's number on the client screen moves
`guardians.phone_number` and leaves the thread where it is: a thread records what was said to
one WhatsApp identity, and re-pointing it would make the archive claim messages went to a
number Twilio never sent them to. The next inbound message from the new number opens a second
conversation carrying the same `guardian_id`, which is why `ix_conversations_guardian_id` is
deliberately **not** unique.

There is no `is_active`: a conversation is never soft-deleted. The retention job hard-deletes a
thread once it has no surviving messages.
"""

import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    conversation_status_enum,
    flag_reason_enum,
)
from app.models.mixins import HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.child import Child
    from app.models.message import Message

TAKEOVER_PAIR_PREDICATE = "(status = 'human') = (taken_over_by_user_id IS NOT NULL)"


class Conversation(HasID, HasTimestamps, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        # Ties the two halves of the takeover state together, so `human` with nobody holding it
        # and a holder with the bot still running are both unrepresentable rather than merely
        # discouraged. Same reasoning as the paired NULL check on
        # `tutor_availability_exceptions`: a state with no coherent meaning is rejected by the
        # database, not left for the application to remember to avoid.
        CheckConstraint(TAKEOVER_PAIR_PREDICATE, name="ck_conversations_takeover_pair"),
        # Not unique: a guardian who has changed handsets has more than one thread, the older
        # one still readable as history.
        Index("ix_conversations_guardian_id", "guardian_id"),
        # DESC because the list screen reads newest first and nothing reads it the other way.
        Index("ix_conversations_last_message_at", text("last_message_at DESC")),
    )

    phone_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    # NULL until intake creates the guardian, and NULL forever on a thread that stalled before
    # it — which is why the conversation list has to render a bare phone number.
    guardian_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardians.id"), nullable=True
    )
    status: Mapped[ConversationStatus] = mapped_column(
        conversation_status_enum, nullable=False, server_default=text("'bot'")
    )
    taken_over_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    taken_over_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # NOT NULL with a `now()` default rather than nullable: a conversation only ever comes into
    # existence because a message arrived, so there is no moment at which "when did this thread
    # last say anything" has no answer — and a NULL would sort ahead of every real thread in the
    # DESC index above.
    last_message_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # One watermark shared by every admin, not one per admin. This is a shared inbox for a small
    # team and a takeover is already a shared act; a per-admin junction would buy per-person
    # unread counts nobody has asked for, at the cost of a second table on the list screen's
    # read path. NULL means nobody has read the thread yet.
    last_read_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set when the bot gives up, which is a different question from `status`'s "who is
    # answering" and has a different answer.
    flag_reason: Mapped[FlagReason | None] = mapped_column(flag_reason_enum, nullable=True)
    flagged_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The pending reactivation request, not the flag: `flag_reason` is one slot that a later
    # `stuck` overwrites, and this column is what survives it. Set by the bot through the
    # webhook, cleared only by an admin's approve or deny. At most one per conversation.
    reactivation_child_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("children.id"), nullable=True
    )

    messages: Mapped[list["Message"]] = relationship(back_populates="conversation")
    reactivation_child: Mapped["Child | None"] = relationship()
