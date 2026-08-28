from typing import TYPE_CHECKING

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.mixins import HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.guardian import ChildGuardian
    from app.models.home import ChildHome


class Child(HasID, HasTimestamps, Base):
    __tablename__ = "children"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    grade_level: Mapped[int] = mapped_column(Integer, nullable=False)
    school_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # No `parent_id`: a child has many guardians and many homes, and neither is derivable from
    # the other. A guardian's homes are their own; the homes a child is tutored at are theirs.
    guardian_links: Mapped[list["ChildGuardian"]] = relationship(back_populates="child")
    home_links: Mapped[list["ChildHome"]] = relationship(back_populates="child")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="child")
