"""A Child's level in one subject, set by Staff after an evaluation.

Tutor matching compares this against `tutor_subjects.max_grade_level`. Rows stay when a subject
is deactivated, and go with the Child when the Child is deleted.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, SmallInteger, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.child import grade_range_predicate
from app.models.mixins import HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.subject import Subject
    from app.models.user import User


class ChildSubjectLevel(HasID, HasTimestamps, Base):
    __tablename__ = "child_subject_levels"
    __table_args__ = (
        # Leads with child_id, so it also serves "every level for this Child".
        UniqueConstraint("child_id", "subject_id", name="uq_child_subject_levels_child_subject"),
        CheckConstraint(grade_range_predicate("level"), name="ck_child_subject_levels_level_range"),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("children.id", ondelete="CASCADE"), nullable=False
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id"), nullable=False
    )
    level: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    set_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    subject: Mapped["Subject"] = relationship()
    set_by: Mapped["User"] = relationship()
