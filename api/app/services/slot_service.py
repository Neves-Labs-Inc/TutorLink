"""The three-step availability query behind `GET /api/slots/available` (REQ-042, REQ-043).

This is the read path the bot drives, and it is the surface that has to agree with the write
path: every comparison it makes comes from `scheduling_service`, which `POST /api/bookings`
calls too. Nothing here re-derives a stride, an overlap test or a window gate — a second copy
of that arithmetic is exactly how the offer surface and the confirm surface drifted apart in
#19 and #44 item 1, where the bot offered a slot the booking endpoint then refused with a 409.

**Read-only. Nothing here writes, flushes or commits**, so the router calls no `db.commit()`.

**Four bounded queries, subtracted in Python.** The tutor set, their active ranges, the day's
approved exceptions and the day's live bookings are each fetched once for the whole set and
grouped by tutor here. Not one query per tutor, and not a SQL formulation of the subtraction:
the stride depends on two runtime-editable settings, the grid is generated in Python anyway,
and the row counts involved are one day of one small tutor roster.

`now` is a parameter of `find_available_slots`, not a `datetime.now()` read inside it. That is
what makes the lead-time and lookahead behaviour testable without freezing the clock; the
router passes the business wall-clock (`clock.business_now`, per `BUSINESS_TIMEZONE`), the zone
every scheduling column is stored in.

`DateOutOfWindow` is `scheduling_service`'s and is deliberately re-exported by propagation
rather than wrapped in a local class: the router maps the same exception from this endpoint and
from `POST /api/bookings`, and two names for one refusal would let the two drift.
"""

import datetime
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.enums import ExceptionStatus
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.services.scheduling_service import (
    LeadTimeNotMet,
    SchedulingSettings,
    assert_date_in_window,
    assert_lead_time_met,
    generate_grid,
    load_scheduling_settings,
    overlaps,
    overlaps_within_gap,
)

type TimeWindow = tuple[datetime.time, datetime.time]


@dataclass(frozen=True, slots=True)
class OpenSlot:
    tutor_id: uuid.UUID
    tutor_name: str
    availability_id: uuid.UUID
    date: datetime.date
    start_time: datetime.time
    end_time: datetime.time


@dataclass(frozen=True, slots=True)
class SlotSearchResult:
    """`items` capped at `page_size`; `total` is the pre-cap count (REQ-043.3, REQ-043.4).

    `page_size` is the one read of `max_slots_offered` this search makes, so the cap the router
    reports is the exact cap it applied to `items` rather than a second, possibly-stale read of
    the same setting.
    """

    items: list[OpenSlot]
    total: int
    page_size: int


def find_available_slots(
    db: Session,
    *,
    subject_id: uuid.UUID,
    grade_level: int | None,
    date: datetime.date,
    tutor_id: uuid.UUID | None,
    now: datetime.datetime,
) -> SlotSearchResult:
    """The cap is applied last, after every subtraction and after the sort, so `total` is the
    number that matched and `items` is the earliest few of them.
    """
    settings = load_scheduling_settings(db)
    assert_date_in_window(date, today=now.date(), lookahead_days=settings.booking_lookahead_days)

    names = _qualified_tutor_names(
        db, subject_id=subject_id, grade_level=grade_level, tutor_id=tutor_id
    )
    tutor_ids = list(names)
    # `date.weekday()` is 0 = Monday … 6 = Sunday, which is the encoding `tutor_availability`
    # stores (`models/availability.py:32`). Never `isoweekday()`, which makes Monday 1, and
    # never PostgreSQL's `EXTRACT(DOW)`, which makes Sunday 0.
    ranges = _active_ranges(db, tutor_ids=tutor_ids, day_of_week=date.weekday())
    whole_day_off, exception_windows = _approved_exceptions(db, tutor_ids=tutor_ids, date=date)
    booking_windows = _live_booking_windows(db, tutor_ids=tutor_ids, date=date)

    open_slots: list[OpenSlot] = []
    for row in ranges:
        if row.tutor_id in whole_day_off:
            continue

        grid = generate_grid(
            range_start=row.start_time,
            range_end=row.end_time,
            length_minutes=settings.session_length_minutes,
            gap_minutes=settings.session_gap_minutes,
        )
        open_slots.extend(
            OpenSlot(
                tutor_id=row.tutor_id,
                tutor_name=names[row.tutor_id],
                availability_id=row.id,
                date=date,
                start_time=start,
                end_time=end,
            )
            for start, end in grid
            if _is_offerable(
                start,
                end,
                date=date,
                now=now,
                settings=settings,
                exceptions=exception_windows.get(row.tutor_id, ()),
                bookings=booking_windows.get(row.tutor_id, ()),
            )
        )

    open_slots.sort(key=lambda slot: (slot.start_time, slot.tutor_id))

    return SlotSearchResult(
        items=open_slots[: settings.max_slots_offered],
        total=len(open_slots),
        page_size=settings.max_slots_offered,
    )


def _qualified_tutor_names(
    db: Session, *, subject_id: uuid.UUID, grade_level: int | None, tutor_id: uuid.UUID | None
) -> dict[uuid.UUID, str]:
    """Active tutors whose ceiling for `subject_id` is at or above `grade_level`.

    A `None` grade is a child nobody has graded yet: every active tutor who teaches the subject
    qualifies, whatever their ceiling. The inner join still drops a tutor with no
    `tutor_subjects` row, so "no grade" never widens the set past the subject's own tutors.

    `max_grade_level` is a ceiling, so the comparison is `>=` and never a membership test
    (#36). The join to `TutorSubject` is inner on purpose: a tutor with no `tutor_subjects`
    row for the subject has no ceiling to compare against and does not teach it, so dropping
    the row here is the refusal REQ-042.3 asks for rather than the silent pass the same shape
    produces on the booking write path.

    The join to `Subject` and its `is_active` filter close #44 item 1 in its original
    direction: a retired subject must yield no qualified tutors here the same way a retired
    tutor already yields none, so a retired `subject_id` answers with the empty `Page`
    `test_a_tutor_with_no_assignment_for_the_subject_is_never_offered` already established for
    an unassigned one, rather than a new refusal shape this endpoint has never used for an
    unsatisfiable filter.
    """
    statement = (
        select(Tutor.id, Tutor.name)
        .join(TutorSubject, TutorSubject.tutor_id == Tutor.id)
        .join(Subject, Subject.id == TutorSubject.subject_id)
        .where(
            Tutor.is_active.is_(True),
            Subject.id == subject_id,
            Subject.is_active.is_(True),
        )
    )
    if grade_level is not None:
        statement = statement.where(TutorSubject.max_grade_level >= grade_level)
    if tutor_id is not None:
        statement = statement.where(Tutor.id == tutor_id)

    return {row.id: row.name for row in db.execute(statement)}


def _active_ranges(
    db: Session, *, tutor_ids: list[uuid.UUID], day_of_week: int
) -> list[TutorAvailability]:
    """Step 1's raw material. `is_active = false` is a withdrawn slot and is never offered.

    Without that filter the endpoint keeps offering a soft-deleted range that rule 1 of
    `POST /api/bookings` then refuses with a 400 — #44 item 3.
    """
    return list(
        db.scalars(
            select(TutorAvailability).where(
                TutorAvailability.tutor_id.in_(tutor_ids),
                TutorAvailability.is_active.is_(True),
                TutorAvailability.day_of_week == day_of_week,
            )
        ).all()
    )


def _approved_exceptions(
    db: Session, *, tutor_ids: list[uuid.UUID], date: datetime.date
) -> tuple[set[uuid.UUID], dict[uuid.UUID, list[TimeWindow]]]:
    """Step 2's rows, split into whole-day blocks and time windows.

    `status = 'approved'` is in the SQL and is not a filter applied afterwards: a `pending`
    request is a tutor asking for time off and blocks nothing until an admin rules on it, and
    `rejected` blocks nothing ever (#24). The date comparison is inclusive at both ends, so a
    range covers its middle days as well as its edges, and a set time window applies to every
    day in the range rather than as one continuous absence across it.
    """
    rows = db.execute(
        select(
            TutorAvailabilityException.tutor_id,
            TutorAvailabilityException.start_time,
            TutorAvailabilityException.end_time,
        ).where(
            TutorAvailabilityException.tutor_id.in_(tutor_ids),
            TutorAvailabilityException.status == ExceptionStatus.APPROVED,
            TutorAvailabilityException.start_date <= date,
            TutorAvailabilityException.end_date >= date,
        )
    ).all()

    whole_day_off: set[uuid.UUID] = set()
    windows: dict[uuid.UUID, list[TimeWindow]] = {}
    for tutor, start_time, end_time in rows:
        # `ck_tutor_availability_exceptions_time_pair` makes the pair all-or-nothing, so a NULL
        # start means the whole day is blocked and a set start always has a set end.
        if start_time is None:
            whole_day_off.add(tutor)
        else:
            windows.setdefault(tutor, []).append((start_time, end_time))

    return whole_day_off, windows


def _live_booking_windows(
    db: Session, *, tutor_ids: list[uuid.UUID], date: datetime.date
) -> dict[uuid.UUID, list[TimeWindow]]:
    """Step 3's rows. `LIVE_BOOKING_STATUSES` is the one definition of a booking that counts."""
    rows = db.execute(
        select(Booking.tutor_id, Booking.start_time, Booking.end_time).where(
            Booking.tutor_id.in_(tutor_ids),
            Booking.scheduled_date == date,
            Booking.status.in_(LIVE_BOOKING_STATUSES),
        )
    ).all()

    windows: dict[uuid.UUID, list[TimeWindow]] = {}
    for tutor, start_time, end_time in rows:
        windows.setdefault(tutor, []).append((start_time, end_time))

    return windows


def _is_offerable(
    start: datetime.time,
    end: datetime.time,
    *,
    date: datetime.date,
    now: datetime.datetime,
    settings: SchedulingSettings,
    exceptions: Iterable[TimeWindow],
    bookings: Iterable[TimeWindow],
) -> bool:
    # Step 2 subtracts exceptions by BARE overlap and step 3 subtracts bookings by
    # GAP-EXPANDED overlap. The two comparisons differ on purpose and are not to be reconciled:
    # rule 4 of `POST /api/bookings` blocks on bare overlap with an approved exception while
    # rule 3 refuses anything less than `session_gap_minutes` clear of a live booking, and this
    # endpoint has to read the same rows the same way the write path does or it offers slots
    # the write path rejects (#44 item 1). Both inequalities inside those helpers are strict,
    # so a slot with exactly one gap of clearance is still offered.
    blocked = any(
        overlaps(start, end, window_start, window_end) for window_start, window_end in exceptions
    ) or any(
        overlaps_within_gap(
            start, end, window_start, window_end, gap_minutes=settings.session_gap_minutes
        )
        for window_start, window_end in bookings
    )

    return not blocked and _lead_time_met(
        date, start, now=now, min_lead_hours=settings.min_booking_lead_hours
    )


def _lead_time_met(
    date: datetime.date,
    start_time: datetime.time,
    *,
    now: datetime.datetime,
    min_lead_hours: int,
) -> bool:
    """`assert_lead_time_met` in predicate form — this step filters a slot out, it does not
    refuse the request."""
    try:
        assert_lead_time_met(date, start_time, now=now, min_lead_hours=min_lead_hours)
    except LeadTimeNotMet:
        met = False
    else:
        met = True

    return met
