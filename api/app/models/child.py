import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.mixins import HasActiveFlag, HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.guardian import ChildGuardian
    from app.models.home import ChildHome

NOTES_MAX_LENGTH = 2000


class Child(HasID, HasTimestamps, HasActiveFlag, Base):
    __tablename__ = "children"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    grade_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    school_name: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # No `parent_id`: a child has many guardians and many homes, and neither is derivable from
    # the other. A guardian's homes are their own; the homes a child is tutored at are theirs.
    guardian_links: Mapped[list["ChildGuardian"]] = relationship(back_populates="child")
    home_links: Mapped[list["ChildHome"]] = relationship(back_populates="child")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="child")
