"""The grid, overlap and window arithmetic every scheduling surface shares (REQ-P4.2).

`GET /api/slots/available` and `POST /api/bookings` have to agree exactly on what a slot is and
on what "too close to an existing booking" means, or the offer surface hands out a time the
write path then refuses with a 409 — which is #19 and #44 item 1. Both call the functions below
rather than each re-deriving the comparison, so the agreement is structural instead of a thing
two modules have to remember to keep true.

**Every minute of arithmetic runs on `datetime.datetime`, never on `datetime.time`** (REQ-P4.5).
`time` supports no arithmetic at all, so adding a gap to one has to be hand-rolled through
minute counts, and every hand-rolled version wraps wrong at the day boundary —
`models/booking.py:53-56` already records what a wrapped range does to the exclusion constraint.
Each function here combines its `time` inputs with a fixed reference date, does the `timedelta`
maths, and takes `.time()` back off at the end. This is the single most likely thing a later
author undoes.

**Both inequalities in the overlap tests are strict, and that is load-bearing.** The grid strides
by `length + gap`, so slot *n+1* starts exactly one gap after slot *n* ends: a booking filling
slot *n* clears slot *n+1* by exactly `gap_minutes`, and a `<=` in either comparison would drop
it. One `<=` here silently deletes every second slot on the grid, which is why
`test_scheduling_service.py` pins the exactly-one-gap case by name.

**`generate_grid` refuses to stride when the stride is not positive.** `session_length_minutes`
and `session_gap_minutes` are admin-editable integers and nothing below `apply_setting_updates`
bounds them, so a `0` or a negative typed into either would otherwise be an unterminating loop
in a request handler — a settings edit that hangs a worker per slot query. An empty grid is a
visible, harmless answer to a misconfiguration; a hung thread pool is not.

**Nothing here caches a setting.** `load_scheduling_settings` reads all five rows through
`get_int_setting` on every call; `settings_service`'s docstring states the rule and the reason
and both apply unchanged (OB-11), so an admin's `PATCH /api/settings` re-cuts the grid on the
very next request. A missing row raises `SettingNotFound` and is deliberately not caught here:
it means the database did not finish migrating, not that the caller did anything wrong.

This module knows nothing about FastAPI, and nothing about `Booking`, `TutorAvailability` or any
other model. It takes and returns `date`, `time`, `int` and its own frozen dataclass; only
`load_scheduling_settings` takes a `Session`. Nothing here writes or commits.
"""

import datetime
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.services.settings_service import get_int_setting

SESSION_LENGTH_SETTING = "session_length_minutes"
SESSION_GAP_SETTING = "session_gap_minutes"
BOOKING_LOOKAHEAD_SETTING = "booking_lookahead_days"
MIN_BOOKING_LEAD_SETTING = "min_booking_lead_hours"
MAX_SLOTS_OFFERED_SETTING = "max_slots_offered"

_REFERENCE_DATE = datetime.date(2000, 1, 1)


@dataclass(frozen=True, slots=True)
class SchedulingSettings:
    session_length_minutes: int
    session_gap_minutes: int
    booking_lookahead_days: int
    min_booking_lead_hours: int
    max_slots_offered: int


class SchedulingError(Exception):
    """Base class for every failure this module reports."""


class DateOutOfWindow(SchedulingError):
    """The requested date is in the past or beyond `booking_lookahead_days`."""


class LeadTimeNotMet(SchedulingError):
    """The requested start is not `min_booking_lead_hours` clear of now."""


def load_scheduling_settings(db: Session) -> SchedulingSettings:
    return SchedulingSettings(
        session_length_minutes=get_int_setting(db, key=SESSION_LENGTH_SETTING),
        session_gap_minutes=get_int_setting(db, key=SESSION_GAP_SETTING),
        booking_lookahead_days=get_int_setting(db, key=BOOKING_LOOKAHEAD_SETTING),
        min_booking_lead_hours=get_int_setting(db, key=MIN_BOOKING_LEAD_SETTING),
        max_slots_offered=get_int_setting(db, key=MAX_SLOTS_OFFERED_SETTING),
    )


def generate_grid(
    *,
    range_start: datetime.time,
    range_end: datetime.time,
    length_minutes: int,
    gap_minutes: int,
) -> list[tuple[datetime.time, datetime.time]]:
    """Slot *n* is `[range_start + n·(length + gap), + length)`, emitted while its end fits.

    The emission test is on the slot's **end**, not its start, so a stride that starts inside
    the range but runs past `range_end` is dropped rather than truncated or emitted whole.
    """
    length = datetime.timedelta(minutes=length_minutes)
    stride = datetime.timedelta(minutes=length_minutes + gap_minutes)
    range_ends_at = _combine(range_end)
    slot_starts_at = _combine(range_start)
    grid: list[tuple[datetime.time, datetime.time]] = []

    if length_minutes > 0 and length_minutes + gap_minutes > 0:
        while slot_starts_at + length <= range_ends_at:
            grid.append((slot_starts_at.time(), (slot_starts_at + length).time()))
            slot_starts_at += stride

    return grid


def overlaps(
    a_start: datetime.time,
    a_end: datetime.time,
    b_start: datetime.time,
    b_end: datetime.time,
) -> bool:
    """`a_start < b_end and a_end > b_start` — half-open, so touching is not overlapping.

    Expressed as the zero-gap case of `overlaps_within_gap` so the two can never disagree about
    strictness. Step 2 of the slot query subtracts exceptions by this bare comparison while step
    3 subtracts bookings by the gap-expanded one; that asymmetry is deliberate — rule 4 of `POST
    /api/bookings` also blocks on bare overlap with an exception — and is not to be reconciled.
    """
    return overlaps_within_gap(a_start, a_end, b_start, b_end, gap_minutes=0)


def overlaps_within_gap(
    a_start: datetime.time,
    a_end: datetime.time,
    b_start: datetime.time,
    b_end: datetime.time,
    *,
    gap_minutes: int,
) -> bool:
    """`a_start < b_end + gap and a_end + gap > b_start`, widening only the second interval.

    Clearance of exactly `gap_minutes` returns `False`, which is what rule 3's "at least
    `session_gap_minutes` clear" means and what keeps consecutive grid slots from erasing each
    other.
    """
    gap = datetime.timedelta(minutes=gap_minutes)

    return _combine(a_start) < _combine(b_end) + gap and _combine(a_end) + gap > _combine(b_start)


def assert_date_in_window(
    date: datetime.date, *, today: datetime.date, lookahead_days: int
) -> None:
    """`today` is a parameter so the window is testable without freezing the clock."""
    if date < today:
        raise DateOutOfWindow(f"{date.isoformat()} is in the past")

    last_offerable = today + datetime.timedelta(days=lookahead_days)

    if date > last_offerable:
        raise DateOutOfWindow(f"{date.isoformat()} is beyond {last_offerable.isoformat()}")


def assert_lead_time_met(
    date: datetime.date,
    start_time: datetime.time,
    *,
    now: datetime.datetime,
    min_lead_hours: int,
) -> None:
    """`now` is a parameter for the same reason `today` is.

    With the default `min_booking_lead_hours` of `0` this only ever bites on a start that has
    already passed today.
    """
    starts_at = datetime.datetime.combine(date, start_time)
    earliest = now + datetime.timedelta(hours=min_lead_hours)

    if starts_at <= earliest:
        raise LeadTimeNotMet(f"{starts_at.isoformat()} is not clear of {earliest.isoformat()}")


def _combine(value: datetime.time) -> datetime.datetime:
    return datetime.datetime.combine(_REFERENCE_DATE, value)
