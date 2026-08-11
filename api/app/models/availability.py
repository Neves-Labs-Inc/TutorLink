"""Recurring weekly availability and date-range exceptions."""

from __future__ import annotations

import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.tutor import Tutor


class TutorAvailability(Base):
    """One recurring weekly slot. `day_of_week` is 0 = Monday … 6 = Sunday."""

    __tablename__ = "tutor_availability"
    __table_args__ = (
        UniqueConstraint(
            "tutor_id", "day_of_week", "start_time", name="uq_tutor_availability_slot"
        ),
        CheckConstraint(
            "day_of_week BETWEEN 0 AND 6", name="ck_tutor_availability_day_of_week"
        ),
        Index("ix_tutor_availability_tutor_id_day_of_week", "tutor_id", "day_of_week"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    tutor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutors.id"), nullable=False
    )
    day_of_week: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    start_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    end_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    tutor: Mapped[Tutor] = relationship(back_populates="availability")
    bookings: Mapped[list[Booking]] = relationship(back_populates="availability")


class TutorAvailabilityException(Base):
    """Overrides the recurring schedule for a date or an inclusive date range."""

    __tablename__ = "tutor_availability_exceptions"
    __table_args__ = (
        Index(
            "ix_tutor_availability_exceptions_tutor_id_dates",
            "tutor_id",
            "start_date",
            "end_date",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    tutor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutors.id"), nullable=False
    )
    start_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    end_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    tutor: Mapped[Tutor] = relationship(back_populates="exceptions")
