"""The dashboard aggregate, computed entirely from the list endpoints' own predicates.

**Every count here is an obligation, not an estimate** (`docs/api-design.md:1304-1313`). Each
one must equal the `total` of the corresponding list endpoint for an admin-or-above caller,
and it holds for a reason rather than by coincidence only because this module writes no filter
of its own: `apply_booking_filters`, `matching_tutors` and `visible_clients` are the same
functions `list_bookings`, `list_tutors` and `list_clients` build their pages from
(CONSTITUTION §11). A hand-written `where` on `Booking.status`, `Tutor.is_active` or
`Guardian.is_active` added here is a second aggregation path that can disagree with the lists,
which is the single failure this endpoint exists to prevent.

`LIVE_SESSION_STATUSES` is derived from `LIVE_BOOKING_STATUSES` for the same reason: `pending`
or `confirmed` is the one definition of a booking that counts anywhere in TutorLink, and it is
already spelled out beside the exclusion constraint scoped by it.

`weekday()` is 0 = Monday … 6 = Sunday, matching `tutor_availability.day_of_week`. Both windows
are **inclusive** date ranges over `scheduled_date`, and they are disjoint by construction: the
upcoming window starts the day after `on`. On a Sunday that range is inverted, so it selects
nothing and the count is 0 with no branch on the day of the week.

Same transaction contract as every other service here: nothing commits, the caller owns the
boundary. Nothing in this module reads a clock — `on` is named by the caller
(`docs/api-design.md:1241-1245`).
"""

import datetime
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, joinedload

from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.enums import BookingStatus
from app.services.booking_service import BookingFilters, apply_booking_filters
from app.services.client_service import visible_clients
from app.services.tutor_service import matching_tutors

LIVE_SESSION_STATUSES = tuple(BookingStatus(value) for value in LIVE_BOOKING_STATUSES)
RECENT_BOOKING_LIMIT = 5


@dataclass(frozen=True, slots=True)
class StatsOverviewData:
    date: datetime.date
    week_end: datetime.date
    today_session_count: int
    upcoming_week_session_count: int
    active_tutor_count: int
    active_client_count: int
    recent_bookings: list[Booking]


def overview(db: Session, *, on: datetime.date) -> StatsOverviewData:
    week_end = on + datetime.timedelta(days=6 - on.weekday())

    return StatsOverviewData(
        date=on,
        week_end=week_end,
        today_session_count=_count(db, _live_sessions(date_from=on, date_to=on)),
        upcoming_week_session_count=_count(
            db,
            _live_sessions(date_from=on + datetime.timedelta(days=1), date_to=week_end),
        ),
        active_tutor_count=_count(
            db,
            matching_tutors(is_active=True, tutor_id=None, subject_id=None, grade_level=None),
        ),
        active_client_count=_count(db, visible_clients(is_active=True, phone_number=None)),
        recent_bookings=_recent_bookings(db),
    )


def _live_sessions(*, date_from: datetime.date, date_to: datetime.date) -> Select[tuple[Booking]]:
    return apply_booking_filters(
        select(Booking),
        BookingFilters(statuses=LIVE_SESSION_STATUSES, date_from=date_from, date_to=date_to),
    )


def _recent_bookings(db: Session) -> list[Booking]:
    """The `id` tie-break is required, not cosmetic: ids are `gen_random_uuid()` and carry no
    insertion order, so two bookings written in one transaction share a `created_at` and have
    no defined order without it (`docs/api-design.md:1319`)."""
    return list(
        db.scalars(
            select(Booking)
            .options(
                joinedload(Booking.child),
                joinedload(Booking.tutor),
                joinedload(Booking.subject),
            )
            .order_by(Booking.created_at.desc(), Booking.id.desc())
            .limit(RECENT_BOOKING_LIMIT)
        ).all()
    )


def _count(db: Session, statement: Select[Any]) -> int:
    return db.scalar(select(func.count()).select_from(statement.subquery())) or 0
