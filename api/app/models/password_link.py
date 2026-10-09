"""A link emailed to a user so they can choose a password: an Invite or a password reset.

Row per link, as `refresh_tokens`: only the SHA-256 of the token is stored, the plaintext
exists in the email alone. A link is **live** while `used_at` and `revoked_at` are NULL and
`expires_at` is ahead of now; `password_link_service` owns that predicate.
"""

import datetime
import enum
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import in_values_predicate, varchar_enum
from app.models.mixins import HasID

PURPOSE_LENGTH = 16
# Hex SHA-256.
TOKEN_HASH_LENGTH = 64
# As `users.email`.
EMAIL_LENGTH = 255


class PasswordLinkPurpose(str, enum.Enum):
    INVITE = "invite"
    RESET = "reset"


class PasswordLink(HasID, Base):
    __tablename__ = "password_links"
    __table_args__ = (
        CheckConstraint(
            in_values_predicate("purpose", PasswordLinkPurpose), name="ck_password_links_purpose"
        ),
        Index("ix_password_links_user_id_purpose", "user_id", "purpose"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    purpose: Mapped[PasswordLinkPurpose] = mapped_column(
        varchar_enum(PasswordLinkPurpose, length=PURPOSE_LENGTH), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(TOKEN_HASH_LENGTH), nullable=False, unique=True)
    # The address the link was sent to, so a later address change can be told from it.
    email: Mapped[str] = mapped_column(String(EMAIL_LENGTH), nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
