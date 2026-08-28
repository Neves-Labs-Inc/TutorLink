"""`scheduling_service`'s grid, overlap and window arithmetic (REQ-P4.2, REQ-P4.5).

Pure units apart from `load_scheduling_settings`, which reads the `system_settings` rows the
harness seeds in place of migrations 0004 and 0013.

The boundary cases below are the ones this arithmetic gets wrong *silently*. A `<=` where the
spec says `<` still produces a plausible-looking grid — just one missing every second slot — so
`test_overlaps_within_gap_strict_inequality_*` is the named pair that catches it, and the
abutting-booking case is #44 item 1: an off-grid 10:00-11:00 booking overlaps the 09:00-10:00
slot not at all, so bare overlap keeps offering a slot rule 3 then refuses with a 409.
"""

import datetime
from collections.abc import Callable

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models.system_setting import SystemSetting
from app.services.scheduling_service import (
    MAX_SLOTS_OFFERED_SETTING,
    SESSION_LENGTH_SETTING,
    DateOutOfWindow,
    LeadTimeNotMet,
    SchedulingSettings,
    assert_date_in_window,
    assert_lead_time_met,
    generate_grid,
    load_scheduling_settings,
    overlaps,
    overlaps_within_gap,
)
from app.services.settings_service import SettingNotFound

LOOKAHEAD_DAYS = 90
TODAY = datetime.date(2026, 3, 1)
NOW = datetime.datetime.combine(TODAY, datetime.time(9, 0))


def _time(value: str) -> datetime.time:
    return datetime.time.fromisoformat(value)


def _times(pairs: list[tuple[str, str]]) -> list[tuple[datetime.time, datetime.time]]:
    return [(_time(start), _time(end)) for start, end in pairs]


# --- the grid ---


@pytest.mark.parametrize(
    ("length_minutes", "gap_minutes", "expected"),
    [
        (60, 30, [("09:00", "10:00"), ("10:30", "11:30")]),
        (45, 30, [("09:00", "09:45"), ("10:15", "11:00")]),
    ],
)
def test_generate_grid_reproduces_the_worked_examples(
    length_minutes: int, gap_minutes: int, expected: list[tuple[str, str]]
) -> None:
    grid = generate_grid(
        range_start=_time("09:00"),
        range_end=_time("12:00"),
        length_minutes=length_minutes,
        gap_minutes=gap_minutes,
    )

    assert grid == _times(expected)


def test_generate_grid_emits_the_slot_that_ends_exactly_on_range_end() -> None:
    grid = generate_grid(
        range_start=_time("09:00"),
        range_end=_time("11:30"),
        length_minutes=60,
        gap_minutes=30,
    )

    assert grid == _times([("09:00", "10:00"), ("10:30", "11:30")])


@pytest.mark.parametrize(
    ("range_start", "range_end"),
    [("09:00", "09:45"), ("09:00", "09:00"), ("12:00", "09:00")],
)
def test_generate_grid_emits_nothing_when_no_whole_slot_fits(
    range_start: str, range_end: str
) -> None:
    grid = generate_grid(
        range_start=_time(range_start),
        range_end=_time(range_end),
        length_minutes=60,
        gap_minutes=30,
    )

    assert grid == []


@pytest.mark.parametrize(("length_minutes", "gap_minutes"), [(0, 30), (-60, 30), (60, -60)])
def test_generate_grid_emits_nothing_rather_than_looping_on_a_non_positive_stride(
    length_minutes: int, gap_minutes: int
) -> None:
    grid = generate_grid(
        range_start=_time("09:00"),
        range_end=_time("17:00"),
        length_minutes=length_minutes,
        gap_minutes=gap_minutes,
    )

    assert grid == []


def test_generate_grid_carries_minutes_across_the_hour_without_wrapping() -> None:
    grid = generate_grid(
        range_start=_time("22:50"),
        range_end=_time("23:59"),
        length_minutes=25,
        gap_minutes=10,
    )

    assert grid == _times([("22:50", "23:15"), ("23:25", "23:50")])


# --- bare overlap ---


@pytest.mark.parametrize(
    ("a_start", "a_end", "b_start", "b_end"),
    [
        ("09:00", "10:00", "10:00", "11:00"),
        ("10:00", "11:00", "09:00", "10:00"),
    ],
)
def test_overlaps_is_false_when_the_intervals_only_touch(
    a_start: str, a_end: str, b_start: str, b_end: str
) -> None:
    assert overlaps(_time(a_start), _time(a_end), _time(b_start), _time(b_end)) is False


@pytest.mark.parametrize(
    ("a_start", "a_end", "b_start", "b_end"),
    [
        ("09:00", "10:00", "09:30", "10:30"),
        ("09:00", "10:00", "09:15", "09:45"),
        ("09:00", "10:00", "08:00", "11:00"),
    ],
)
def test_overlaps_is_true_when_the_intervals_share_a_minute(
    a_start: str, a_end: str, b_start: str, b_end: str
) -> None:
    assert overlaps(_time(a_start), _time(a_end), _time(b_start), _time(b_end)) is True


# --- gap-expanded overlap ---


def test_overlaps_within_gap_strict_inequality_keeps_a_slot_exactly_one_gap_clear() -> None:
    kept = overlaps_within_gap(
        _time("10:30"), _time("11:30"), _time("09:00"), _time("10:00"), gap_minutes=30
    )

    assert kept is False


def test_overlaps_within_gap_strict_inequality_drops_a_slot_one_minute_inside_the_gap() -> None:
    dropped = overlaps_within_gap(
        _time("10:29"), _time("11:29"), _time("09:00"), _time("10:00"), gap_minutes=30
    )

    assert dropped is True


def test_overlaps_within_gap_drops_the_slot_an_off_grid_booking_merely_abuts() -> None:
    slot_start, slot_end = _time("09:00"), _time("10:00")
    booking_start, booking_end = _time("10:00"), _time("11:00")

    assert overlaps(slot_start, slot_end, booking_start, booking_end) is False
    assert (
        overlaps_within_gap(slot_start, slot_end, booking_start, booking_end, gap_minutes=30)
        is True
    )


def test_overlaps_within_gap_with_no_gap_is_the_bare_comparison() -> None:
    assert (
        overlaps_within_gap(
            _time("09:00"), _time("10:00"), _time("10:00"), _time("11:00"), gap_minutes=0
        )
        is False
    )


# --- the date window ---


@pytest.mark.parametrize("offset_days", [0, 1, LOOKAHEAD_DAYS])
def test_assert_date_in_window_accepts_today_through_the_last_day_of_the_window(
    offset_days: int,
) -> None:
    assert_date_in_window(
        TODAY + datetime.timedelta(days=offset_days),
        today=TODAY,
        lookahead_days=LOOKAHEAD_DAYS,
    )


@pytest.mark.parametrize("offset_days", [-1, LOOKAHEAD_DAYS + 1])
def test_assert_date_in_window_refuses_a_date_outside_the_window(offset_days: int) -> None:
    with pytest.raises(DateOutOfWindow):
        assert_date_in_window(
            TODAY + datetime.timedelta(days=offset_days),
            today=TODAY,
            lookahead_days=LOOKAHEAD_DAYS,
        )


# --- the lead time ---


def test_assert_lead_time_met_refuses_a_start_exactly_at_the_lead_boundary() -> None:
    with pytest.raises(LeadTimeNotMet):
        assert_lead_time_met(NOW.date(), _time("11:00"), now=NOW, min_lead_hours=2)


def test_assert_lead_time_met_accepts_a_start_one_minute_past_the_lead_boundary() -> None:
    assert_lead_time_met(NOW.date(), _time("11:01"), now=NOW, min_lead_hours=2)


def test_assert_lead_time_met_refuses_a_start_already_passed_when_no_lead_is_configured() -> None:
    with pytest.raises(LeadTimeNotMet):
        assert_lead_time_met(NOW.date(), _time("08:00"), now=NOW, min_lead_hours=0)


def test_assert_lead_time_met_accepts_tomorrow_when_no_lead_is_configured() -> None:
    assert_lead_time_met(
        NOW.date() + datetime.timedelta(days=1), _time("08:00"), now=NOW, min_lead_hours=0
    )


# --- the settings read ---


def test_load_scheduling_settings_returns_the_seeded_defaults(db: Session) -> None:
    assert load_scheduling_settings(db) == SchedulingSettings(
        session_length_minutes=60,
        session_gap_minutes=30,
        booking_lookahead_days=90,
        min_booking_lead_hours=0,
        max_slots_offered=5,
    )


def test_load_scheduling_settings_re_reads_the_rows_rather_than_caching_them(
    db: Session, set_int_setting: Callable[[str, int], None]
) -> None:
    assert load_scheduling_settings(db).session_length_minutes == 60

    set_int_setting(SESSION_LENGTH_SETTING, 45)

    assert load_scheduling_settings(db).session_length_minutes == 45


def test_load_scheduling_settings_propagates_a_missing_row(db: Session) -> None:
    db.execute(delete(SystemSetting).where(SystemSetting.key == MAX_SLOTS_OFFERED_SETTING))

    with pytest.raises(SettingNotFound):
        load_scheduling_settings(db)
