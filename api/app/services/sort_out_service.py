"""Bookings to sort out (#209): the one place their rules live, all computed on read.

A Booking is to sort out for one or more reasons, each a SQL predicate correlated on `Booking`
(other tables reached through `EXISTS`, never a join, so a count over a filtered statement stays
a count of Bookings). The list filter, every Booking read and `GET /api/counts` all build on
these, so the three can never disagree.

`now` is the naive business wall-clock (`clock.business_now`).
"""

import datetime
import uuid
from collections.abc import Sequence
from typing import Literal

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailabilityException
from app.models.booking import LIVE_BOOKING_STATUSES, Booking, upcoming_live_bookings
from app.models.enums import ExceptionStatus, UserRole
from app.models.user import User

SortOutReason = Literal["not_completed", "time_off_clash", "archived_staff"]
# Wire order: every `sort_out_reasons` list comes in this order.
SORT_OUT_REASONS: tuple[SortOutReason, ...] = ("not_completed", "time_off_clash", "archived_staff")


def sort_out_predicate(
    now: datetime.datetime, reason: SortOutReason | None = None
) -> ColumnElement[bool]:
    """Bookings to sort out for `reason`; with no reason, for any of them."""
    predicates = _reason_predicates(now)

    return or_(*predicates.values()) if reason is None else predicates[reason]


def time_off_clash_predicate() -> ColumnElement[bool]:
    """Live, and inside some approved Time off of its Staff member, past Bookings included.

    The same bare overlap as `exception_service._clashes_with` (keep the two in step): a
    whole-day Time off blocks every day of its range, a partial-day one only its window on each
    day, and touching times don't clash.
    """
    time_off = TutorAvailabilityException
    clashing_time_off = select(1).where(
        time_off.status == ExceptionStatus.APPROVED,
        time_off.user_id == Booking.user_id,
        time_off.start_date <= Booking.scheduled_date,
        time_off.end_date >= Booking.scheduled_date,
        or_(
            time_off.start_time.is_(None),
            and_(time_off.start_time < Booking.end_time, time_off.end_time > Booking.start_time),
        ),
    )

    return and_(_is_live(), clashing_time_off.exists())


def sort_out_reasons(
    db: Session, booking_ids: Sequence[uuid.UUID], now: datetime.datetime
) -> dict[uuid.UUID, list[SortOutReason]]:
    """Every id's reasons, in `SORT_OUT_REASONS` order (`[]` for none), from one query."""
    if not booking_ids:
        return {}

    predicates = _reason_predicates(now)
    rows = db.execute(
        select(
            Booking.id, *(predicate.label(reason) for reason, predicate in predicates.items())
        ).where(Booking.id.in_(booking_ids))
    ).all()
    found = {
        row.id: [reason for reason in SORT_OUT_REASONS if row._mapping[reason]] for row in rows
    }

    return {booking_id: found.get(booking_id, []) for booking_id in booking_ids}


def sort_out_staff_limit(role: UserRole, user_id: uuid.UUID) -> uuid.UUID | None:
    """Whose Bookings alone a caller sorts out: a Manager's own; anyone else's, all (None).

    A Tutor is already limited to their own Bookings by `TutorScope`.
    """
    return user_id if role == UserRole.MANAGER else None


def _reason_predicates(now: datetime.datetime) -> dict[SortOutReason, ColumnElement[bool]]:
    archived_staff = select(1).where(User.id == Booking.user_id, User.is_archived.is_(True))

    return {
        # From 00:00 business time the day after its date; no lower bound.
        "not_completed": and_(_is_live(), Booking.scheduled_date < now.date()),
        "time_off_clash": time_off_clash_predicate(),
        "archived_staff": and_(upcoming_live_bookings(now), archived_staff.exists()),
    }


def _is_live() -> ColumnElement[bool]:
    return Booking.status.in_(LIVE_BOOKING_STATUSES)
