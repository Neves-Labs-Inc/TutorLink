"""One weekly reminder run that finished, by the week it covered. Kept forever, like the
reminders themselves.

The rows in `booking_reminders` cannot say this on their own: a run with nobody due writes
none, and "ran, reminded nobody" must read differently from "never ran". A week's first
finished run writes the row; the later ticks that day find it and leave it.
"""

import datetime

from sqlalchemy import Date, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class BookingReminderRun(Base):
    __tablename__ = "booking_reminder_runs"

    week_start: Mapped[datetime.date] = mapped_column(Date, primary_key=True)
    ran_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
