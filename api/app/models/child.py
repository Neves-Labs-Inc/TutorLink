import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.mixins import HasActiveFlag, HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.guardian import ChildGuardian
    from app.models.home import ChildHome
    from app.models.user import User

NOTES_MAX_LENGTH = 2000

# Grades run K to 12, with Kindergarten stored as 0. Shared by every column that holds a grade.
LOWEST_GRADE = 0
HIGHEST_GRADE = 12


def grade_range_predicate(column: str) -> str:
    return f"{column} BETWEEN {LOWEST_GRADE} AND {HIGHEST_GRADE}"


class Child(HasID, HasTimestamps, HasActiveFlag, Base):
    __tablename__ = "children"
    __table_args__ = (
        CheckConstraint(grade_range_predicate("grade_level"), name="ck_children_grade_level_range"),
        # Evaluated is one fact with two halves; either alone has no coherent meaning.
        CheckConstraint(
            "(evaluated_at IS NULL) = (evaluated_by_user_id IS NULL)",
            name="ck_children_evaluated_pair",
        ),
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    date_of_birth: Mapped[datetime.date | None] = mapped_column(Date, nullable=True)
    # The Overall grade. NULL until Staff set it; per-subject levels live in
    # `child_subject_levels`.
    grade_level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    school_name: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluated_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    evaluated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )

    # No `parent_id`: a child has many guardians and many homes, and neither is derivable from
    # the other. A guardian's homes are their own; the homes a child is tutored at are theirs.
    guardian_links: Mapped[list["ChildGuardian"]] = relationship(back_populates="child")
    home_links: Mapped[list["ChildHome"]] = relationship(back_populates="child")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="child")
    evaluated_by: Mapped["User | None"] = relationship()
