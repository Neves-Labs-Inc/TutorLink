"""Tutoring sessions."""

from __future__ import annotations

import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Index, Text, Time, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import BookingStatus, booking_status_enum

if TYPE_CHECKING:
    from app.models.availability import TutorAvailability
    from app.models.child import Child
    from app.models.subject import Subject
    from app.models.tutor import Tutor

LIVE_BOOKING_STATUSES = (BookingStatus.PENDING.value, BookingStatus.CONFIRMED.value)


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_bookings_tutor_date_status", "tutor_id", "scheduled_date", "status"),
        Index("ix_bookings_child_date", "child_id", "scheduled_date"),
        Index("ix_bookings_date_status", "scheduled_date", "status"),
        # REQ-008: at most one live (pending or confirmed) booking per tutor slot.
        Index(
            "uq_booking_live_slot",
            "tutor_id",
            "scheduled_date",
            "start_time",
            unique=True,
            postgresql_where=text("status IN ('pending', 'confirmed')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    child_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("children.id"), nullable=False
    )
    tutor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutors.id"), nullable=False
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id"), nullable=False
    )
    availability_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutor_availability.id"), nullable=False
    )
    scheduled_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    start_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    end_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    status: Mapped[BookingStatus] = mapped_column(booking_status_enum, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    child: Mapped[Child] = relationship(back_populates="bookings")
    tutor: Mapped[Tutor] = relationship(back_populates="bookings")
    subject: Mapped[Subject] = relationship(back_populates="bookings")
    availability: Mapped[TutorAvailability] = relationship(back_populates="bookings")
