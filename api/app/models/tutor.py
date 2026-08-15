import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
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
    from app.models.availability import TutorAvailability, TutorAvailabilityException
    from app.models.booking import Booking
    from app.models.subject import Subject
    from app.models.user import User


class Tutor(Base):
    __tablename__ = "tutors"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    users: Mapped[list["User"]] = relationship(back_populates="tutor")
    tutor_subjects: Mapped[list["TutorSubject"]] = relationship(back_populates="tutor")
    availability: Mapped[list["TutorAvailability"]] = relationship(back_populates="tutor")
    exceptions: Mapped[list["TutorAvailabilityException"]] = relationship(back_populates="tutor")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="tutor")


class TutorSubject(Base):
    __tablename__ = "tutor_subjects"
    __table_args__ = (
        UniqueConstraint("tutor_id", "subject_id", name="uq_tutor_subjects_tutor_subject"),
        Index("ix_tutor_subjects_tutor_id_subject_id", "tutor_id", "subject_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    tutor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutors.id"), nullable=False
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id"), nullable=False
    )
    # A ceiling, not an enumeration: the rule is "at or below", so 8 covers grades 1-8.
    # Per subject, because a tutor may handle grade 12 maths but only grade 8 French.
    max_grade_level: Mapped[int] = mapped_column(Integer, nullable=False)

    tutor: Mapped["Tutor"] = relationship(back_populates="tutor_subjects")
    subject: Mapped["Subject"] = relationship(back_populates="tutor_subjects")
