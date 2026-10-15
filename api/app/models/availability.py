import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import (
    AvailabilityMode,
    ExceptionStatus,
    exception_status_enum,
    in_values_predicate,
    varchar_enum,
)
from app.models.mixins import HasActiveFlag, HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.tutor import Tutor
    from app.models.user import User

AVAILABILITY_MODE_LENGTH = 16
REASON_MAX_LENGTH = 500


class TutorAvailability(HasID, HasTimestamps, HasActiveFlag, Base):
    """One recurring weekly slot. `day_of_week` is 0 = Monday … 6 = Sunday."""

    __tablename__ = "tutor_availability"
    __table_args__ = (
        UniqueConstraint(
            "tutor_id", "day_of_week", "start_time", name="uq_tutor_availability_slot"
        ),
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="ck_tutor_availability_day_of_week"),
        CheckConstraint(
            in_values_predicate("mode", AvailabilityMode), name="ck_tutor_availability_mode"
        ),
        Index("ix_tutor_availability_tutor_id_day_of_week", "tutor_id", "day_of_week"),
    )

    tutor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutors.id"), nullable=False
    )
    day_of_week: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    start_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    end_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    # Where this range's sessions may happen (#132). `traveler` is what every range meant
    # before the column existed: home visits only.
    mode: Mapped[AvailabilityMode] = mapped_column(
        varchar_enum(AvailabilityMode, length=AVAILABILITY_MODE_LENGTH),
        nullable=False,
        server_default=text(f"'{AvailabilityMode.TRAVELER.value}'"),
        default=AvailabilityMode.TRAVELER,
    )

    tutor: Mapped["Tutor"] = relationship(back_populates="availability")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="availability")


class TutorAvailabilityException(HasID, Base):
    """A Staff member's Time off: overrides the recurring schedule for a date or an inclusive
    date range. A NULL `start_time`/`end_time` pair blocks the whole day; a set pair blocks
    only that window.

    Keyed on the person (`user_id`), not a teaching profile, so any Staff member — an Admin
    with no profile included — can hold it. `reason` is optional free text.

    Only a row whose `status` is `APPROVED` overrides anything. A Tutor's own time-off request
    lands as `PENDING` and is inert until an admin decides it, so a consumer that subtracts
    Time off from availability must filter on `status` — the row existing is not enough.
    `decided_*` and `cancelled_*` are recorded by the lifecycle, and are null until then.
    """

    __tablename__ = "tutor_availability_exceptions"
    __table_args__ = (
        Index(
            "ix_tutor_availability_exceptions_user_id_dates",
            "user_id",
            "start_date",
            "end_date",
        ),
        CheckConstraint(
            "(start_time IS NULL) = (end_time IS NULL)",
            name="ck_tutor_availability_exceptions_time_pair",
        ),
        CheckConstraint(
            "start_time IS NULL OR end_time > start_time",
            name="ck_tutor_availability_exceptions_time_order",
        ),
        CheckConstraint(
            "end_date >= start_date",
            name="ck_tutor_availability_exceptions_date_order",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    start_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    end_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    start_time: Mapped[datetime.time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[datetime.time | None] = mapped_column(Time, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(REASON_MAX_LENGTH), nullable=True)
    # The server default is `approved`, not `pending`: every row that predates the approval
    # workflow was written by an admin and already blocks bookings, so `approved` is the one
    # backfill that leaves existing rows meaning what they meant. See migration 0008.
    status: Mapped[ExceptionStatus] = mapped_column(
        exception_status_enum, nullable=False, server_default=text("'approved'")
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    decided_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    cancelled_at: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Three foreign keys reach `users`, so the join is named.
    staff: Mapped["User"] = relationship(foreign_keys=[user_id])
