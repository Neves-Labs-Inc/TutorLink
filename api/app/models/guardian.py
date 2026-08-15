"""Guardians, and the link from a guardian to a child.

`guardians` holds **identity only** — who this person is and how the bot reaches them. Where
tutoring happens lives in `homes`, because a child with separated guardians has two of those
and the old fused `parents` row could express only one.

"Guardian" rather than "parent": the person engaging the service may be a grandparent, a
step-parent, or a legal guardian. The API keeps calling them a *client*, which is the business
relationship rather than the relationship to the child; both are accurate on their own axis.
"""

import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.child import Child


class Guardian(Base):
    __tablename__ = "guardians"
    __table_args__ = (Index("ix_guardians_phone_number", "phone_number"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    phone_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    child_links: Mapped[list["ChildGuardian"]] = relationship(back_populates="guardian")


class ChildGuardian(Base):
    """Which guardians a child has. Many-to-many: siblings share guardians, and a child with
    separated guardians has two.

    Hard delete, no `is_active`, matching `tutor_subjects`. A junction is a link rather than an
    entity, and #21's soft-delete rule is about entities. Unlinking a guardian after a custody
    change is a DELETE and takes effect immediately.
    """

    __tablename__ = "child_guardians"
    __table_args__ = (
        UniqueConstraint("child_id", "guardian_id", name="uq_child_guardians_child_guardian"),
        Index("ix_child_guardians_guardian_id", "guardian_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    child_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("children.id"), nullable=False
    )
    guardian_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardians.id"), nullable=False
    )

    child: Mapped["Child"] = relationship(back_populates="guardian_links")
    guardian: Mapped["Guardian"] = relationship(back_populates="child_links")
