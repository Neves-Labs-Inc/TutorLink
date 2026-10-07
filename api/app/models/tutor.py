import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.child import grade_range_predicate
from app.models.mixins import HasActiveFlag, HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.availability import TutorAvailability, TutorAvailabilityException
    from app.models.booking import Booking
    from app.models.subject import Subject
    from app.models.user import User


class Tutor(HasID, HasTimestamps, HasActiveFlag, Base):
    __tablename__ = "tutors"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)

    users: Mapped[list["User"]] = relationship(back_populates="tutor")
    tutor_subjects: Mapped[list["TutorSubject"]] = relationship(back_populates="tutor")
    availability: Mapped[list["TutorAvailability"]] = relationship(back_populates="tutor")
    exceptions: Mapped[list["TutorAvailabilityException"]] = relationship(back_populates="tutor")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="tutor")


class TutorSubject(HasID, Base):
    __tablename__ = "tutor_subjects"
    __table_args__ = (
        UniqueConstraint("tutor_id", "subject_id", name="uq_tutor_subjects_tutor_subject"),
        Index("ix_tutor_subjects_tutor_id_subject_id", "tutor_id", "subject_id"),
        CheckConstraint(
            grade_range_predicate("max_grade_level"),
            name="ck_tutor_subjects_max_grade_level_range",
        ),
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
