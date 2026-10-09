import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import UserRole, user_role_enum
from app.models.mixins import HasActiveFlag, HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.tutor import Tutor


class User(HasID, HasTimestamps, HasActiveFlag, Base):
    """The one record of a person. A Tutor or Manager's teaching profile hangs off it through
    `profile`; an Admin or Developer has none."""

    __tablename__ = "users"
    __table_args__ = (Index("ix_users_email_role", "email", "role"),)

    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # True while `name` is the email's local part rather than a chosen name, so a Guardian is
    # never shown it (#109). Setting a name clears it.
    name_is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    # NULL means the person cannot sign in: a Tutor the office created without a login.
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(user_role_enum, nullable=False)

    profile: Mapped["Tutor | None"] = relationship(back_populates="user", uselist=False)

    @property
    def profile_id(self) -> uuid.UUID | None:
        """The teaching profile's id — what tutor scoping and the access token key on."""
        return None if self.profile is None else self.profile.id
