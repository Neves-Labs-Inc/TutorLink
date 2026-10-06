import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import UserRole, user_role_enum
from app.models.mixins import HasActiveFlag, HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.tutor import Tutor


class User(HasID, HasTimestamps, HasActiveFlag, Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_email_role", "email", "role"),)

    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    # Independent of `tutors.name` once set: nothing derives or syncs it.
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # True while `display_name` is the email's local part rather than a chosen name, so a
    # Guardian is never shown it (#109). Setting a name clears it.
    display_name_is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(user_role_enum, nullable=False)
    tutor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutors.id"), nullable=True
    )

    tutor: Mapped["Tutor | None"] = relationship(back_populates="users")
