import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Index, String, Text, func, literal_column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.mixins import HasActiveFlag, HasID

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.tutor import TutorSubject


class Subject(HasID, HasActiveFlag, Base):
    __tablename__ = "subjects"
    # Names are unique ignoring case; migration 0036 builds the same index.
    __table_args__ = (
        Index("uq_subjects_name_lower", func.lower(literal_column("name")), unique=True),
    )

    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Shown to Spanish-speaking Guardians; NULL falls back to `name`.
    name_es: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    tutor_subjects: Mapped[list["TutorSubject"]] = relationship(back_populates="subject")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="subject")
