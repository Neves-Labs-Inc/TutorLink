"""A Child's Assigned Tutors: the Tutors and Managers it may be booked with through the bot.

Keyed by user, not by teaching profile; the bot maps a user to their profile as it does for any
Booking. A hard-deleted link, like `child_guardians`: archiving a Staff member or promoting them
to Admin deletes their rows, and nothing brings them back. The rows go with the Child or the
user if either is ever deleted; the creator is history only, so losing them clears the column.
"""

import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import HasID


class ChildAssignedTutor(HasID, Base):
    __tablename__ = "child_assigned_tutors"
    __table_args__ = (
        # Leads with child_id, so it also serves "every Assigned Tutor of these Children".
        UniqueConstraint("child_id", "user_id", name="uq_child_assigned_tutors_child_user"),
        # Archive and promotion delete by user, and Staff detail reads by user.
        Index("ix_child_assigned_tutors_user_id", "user_id"),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("children.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
