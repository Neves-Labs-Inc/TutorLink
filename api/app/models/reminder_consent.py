"""Append-only history of a Guardian's weekly-reminder consent.

The current state is the latest row; no rows means never asked, which is not opted in. Rows
are never updated, so the history answers "who turned this off, and when".
"""

import datetime
import uuid

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    in_values_predicate,
    varchar_enum,
)
from app.models.mixins import HasID

CONSENT_VALUE_LENGTH = 16
# As `guardians.phone_number`.
PHONE_NUMBER_LENGTH = 32


class ReminderConsent(HasID, Base):
    __tablename__ = "reminder_consents"
    __table_args__ = (
        CheckConstraint(
            in_values_predicate("action", ConsentAction), name="ck_reminder_consents_action"
        ),
        CheckConstraint(
            in_values_predicate("source", ConsentSource), name="ck_reminder_consents_source"
        ),
        # A Staff row speaks for no number; every other row's evidence came from one.
        CheckConstraint(
            "(source = 'staff') = (phone_number IS NULL)",
            name="ck_reminder_consents_staff_phone_pair",
        ),
        Index("ix_reminder_consents_guardian_id_created_at", "guardian_id", "created_at"),
    )

    guardian_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardians.id"), nullable=False
    )
    action: Mapped[ConsentAction] = mapped_column(
        varchar_enum(ConsentAction, length=CONSENT_VALUE_LENGTH), nullable=False
    )
    source: Mapped[ConsentSource] = mapped_column(
        varchar_enum(ConsentSource, length=CONSENT_VALUE_LENGTH), nullable=False
    )
    # SET NULL because the retention purge deletes old messages, and the consent they carried
    # must outlive them.
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    # The WhatsApp number the evidence came from, normalised: a WhatsApp block holds only for
    # the Guardian while they hold this number (see `reminder_consent_service`).
    phone_number: Mapped[str | None] = mapped_column(String(PHONE_NUMBER_LENGTH), nullable=True)
    set_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
