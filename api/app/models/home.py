"""Homes, and the two links that attach children and guardians to them.

Tutoring happens at the client's home, so a session needs an address and a way in. Those used
to be columns on `parents`, which worked only while a child had exactly one of each. A child
with separated guardians has two homes, either guardian may book into either, and siblings
share the same pair — none of which a single fused row can express.

Both junctions here are hard-delete, matching `tutor_subjects`: a link is not an entity.
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
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.child import Child
    from app.models.guardian import Guardian


class Home(Base):
    __tablename__ = "homes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # The bot has to ask "which home?" when a child has two, and reading two full street
    # addresses back over WhatsApp is a poor prompt. Nullable, so it costs nothing unused.
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    access_code: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    child_links: Mapped[list["ChildHome"]] = relationship(back_populates="home")
    guardian_links: Mapped[list["GuardianHome"]] = relationship(back_populates="home")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="home")


class ChildHome(Base):
    """Which homes a child is tutored at. Many-to-many, which is what accommodates siblings
    sharing a home and one child having two."""

    __tablename__ = "child_homes"
    __table_args__ = (
        UniqueConstraint("child_id", "home_id", name="uq_child_homes_child_home"),
        Index("ix_child_homes_home_id", "home_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    child_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("children.id"), nullable=False
    )
    home_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("homes.id"), nullable=False
    )

    child: Mapped["Child"] = relationship(back_populates="home_links")
    home: Mapped["Home"] = relationship(back_populates="child_links")


class GuardianHome(Base):
    """Which homes belong to a guardian.

    Explicit rather than derived through children, for three reasons: a couple sharing one
    home before separation cannot be expressed by a single owner column; a tutor standing
    outside an address needs to know *which* guardian to call, which is ambiguous once a child
    has two; and intake collects the address before any child row exists, so the home needs
    somewhere to attach at that moment.
    """

    __tablename__ = "guardian_homes"
    __table_args__ = (
        UniqueConstraint("guardian_id", "home_id", name="uq_guardian_homes_guardian_home"),
        Index("ix_guardian_homes_home_id", "home_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    guardian_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardians.id"), nullable=False
    )
    home_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("homes.id"), nullable=False
    )

    guardian: Mapped["Guardian"] = relationship()
    home: Mapped["Home"] = relationship(back_populates="guardian_links")
