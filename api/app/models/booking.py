import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    ColumnElement,
    Date,
    ForeignKey,
    Index,
    Text,
    Time,
    and_,
    literal_column,
    or_,
    text,
)
from sqlalchemy.dialects.postgresql import UUID, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import BookingStatus, booking_status_enum
from app.models.mixins import HasID, HasTimestamps

if TYPE_CHECKING:
    from app.models.availability import TutorAvailability
    from app.models.child import Child
    from app.models.guardian import Guardian
    from app.models.home import Home
    from app.models.subject import Subject
    from app.models.tutor import Tutor

LIVE_BOOKING_STATUSES = (BookingStatus.PENDING.value, BookingStatus.CONFIRMED.value)
LIVE_BOOKING_STATUS_PREDICATE = "status IN ({})".format(
    ", ".join(f"'{status}'" for status in LIVE_BOOKING_STATUSES)
)
BOOKING_RANGE_EXPRESSION = "tsrange(scheduled_date + start_time, scheduled_date + end_time)"
BOOKING_TIME_ORDER_PREDICATE = "end_time > start_time"


def upcoming_live_bookings(now: datetime.datetime) -> ColumnElement[bool]:
    """Live, and starting after `now` (naive UTC). The one definition of "upcoming" (P7C-T)."""
    return and_(
        Booking.status.in_(LIVE_BOOKING_STATUSES),
        or_(
            Booking.scheduled_date > now.date(),
            and_(Booking.scheduled_date == now.date(), Booking.start_time > now.time()),
        ),
    )


class Booking(HasID, HasTimestamps, Base):
    __tablename__ = "bookings"
    __table_args__ = (
        Index("ix_bookings_tutor_date_status", "tutor_id", "scheduled_date", "status"),
        Index("ix_bookings_child_date", "child_id", "scheduled_date"),
        Index("ix_bookings_home_id", "home_id"),
        Index("ix_bookings_date_status", "scheduled_date", "status"),
        # What makes the exclusion constraint below sound, not a separate nicety. A row with
        # `end_time == start_time` builds an *empty* `tsrange`, which overlaps nothing and so
        # is invisible to an EXCLUDE — two identical zero-length bookings would both land.
        # `end_time < start_time` is worse: PostgreSQL rejects the range construction itself
        # with SQLSTATE 22000, a `DataError` rather than the `IntegrityError` a caller
        # translating conflicts into a 409 is watching for.
        #
        # The cost is that a session ending at midnight (23:00-00:00) cannot be stored. That
        # is deliberate: the range expression already produces garbage for a wrap-around, so
        # refusing it is strictly better than storing a booking that no constraint can see.
        # Loosening this check without giving the range a real end date reopens both holes.
        CheckConstraint(BOOKING_TIME_ORDER_PREDICATE, name="ck_bookings_time_order"),
        # REQ-008: a tutor's live (pending or confirmed) bookings never overlap in time.
        # `tsrange` is half-open `[)`, so a 10:00-11:00 and an 11:00-12:00 booking are
        # adjacent rather than conflicting. Requires the `btree_gist` extension, which the
        # equality operator on a plain UUID column has no GiST support without.
        ExcludeConstraint(
            ("tutor_id", "="),
            (literal_column(BOOKING_RANGE_EXPRESSION), "&&"),
            name="excl_bookings_live_overlap",
            using="gist",
            where=text(LIVE_BOOKING_STATUS_PREDICATE),
        ),
    )

    child_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("children.id"), nullable=False
    )
    tutor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutors.id"), nullable=False
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subjects.id"), nullable=False
    )
    availability_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tutor_availability.id"), nullable=False
    )
    # Required, and not derivable: once a child has two homes the location is genuinely
    # ambiguous, and a tutor with no address cannot work.
    home_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("homes.id"), nullable=False
    )
    # NULL when an admin created the booking from the dashboard. Populated, it answers "who
    # scheduled this" — a question separated guardians sharing a child will ask.
    booked_by_guardian_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("guardians.id"), nullable=True
    )
    scheduled_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    start_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    end_time: Mapped[datetime.time] = mapped_column(Time, nullable=False)
    status: Mapped[BookingStatus] = mapped_column(booking_status_enum, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    child: Mapped["Child"] = relationship(back_populates="bookings")
    tutor: Mapped["Tutor"] = relationship(back_populates="bookings")
    subject: Mapped["Subject"] = relationship(back_populates="bookings")
    availability: Mapped["TutorAvailability"] = relationship(back_populates="bookings")
    home: Mapped["Home"] = relationship(back_populates="bookings")
    booked_by_guardian: Mapped["Guardian | None"] = relationship()
