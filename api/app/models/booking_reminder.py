"""One weekly reminder to one Guardian, sent or skipped. Kept forever: the retention purge
does not touch it.

UNIQUE(guardian_id, week_start) is the de-dup: a second run in the same week conflicts here
rather than reminding the Guardian twice.
"""

import datetime
import uuid

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import (
    LANGUAGE_CODE_LENGTH,
    Language,
    ReminderSkipReason,
    ReminderStatus,
    in_values_predicate,
    varchar_enum,
)
from app.models.mixins import HasID

STATUS_LENGTH = 16
SKIP_REASON_LENGTH = 32


class BookingReminder(HasID, Base):
    __tablename__ = "booking_reminders"
    __table_args__ = (
        UniqueConstraint("guardian_id", "week_start", name="uq_booking_reminders_guardian_week"),
        CheckConstraint(
            in_values_predicate("language", Language), name="ck_booking_reminders_language"
        ),
        CheckConstraint(
            in_values_predicate("status", ReminderStatus), name="ck_booking_reminders_status"
        ),
        CheckConstraint(
            in_values_predicate("skip_reason", ReminderSkipReason),
            name="ck_booking_reminders_skip_reason",
        ),
        # A skip always says why, and only a skip has a reason.
        CheckConstraint(
            "(status = 'skipped') = (skip_reason IS NOT NULL)",
            name="ck_booking_reminders_skip_pair",
        ),
    )

    guardian_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardians.id"), nullable=False
    )
    week_start: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    language: Mapped[Language] = mapped_column(
        varchar_enum(Language, length=LANGUAGE_CODE_LENGTH), nullable=False
    )
    # The Children named in the message, as they were at send time. No FK: an array cannot
    # carry one, and the record should survive a Child's later deletion.
    child_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    template_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    twilio_sid: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    status: Mapped[ReminderStatus] = mapped_column(
        varchar_enum(ReminderStatus, length=STATUS_LENGTH), nullable=False
    )
    skip_reason: Mapped[ReminderSkipReason | None] = mapped_column(
        varchar_enum(ReminderSkipReason, length=SKIP_REASON_LENGTH), nullable=True
    )
    error_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    sent_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
