import datetime
from zoneinfo import ZoneInfo

import pytest

from app.config import Settings
from app.services import clock
from app.services.clock import to_business_wall_clock

NEW_YORK = ZoneInfo("America/New_York")


def test_an_evening_in_new_york_is_still_the_previous_utc_date() -> None:
    instant = datetime.datetime(2026, 10, 2, 2, 0, tzinfo=datetime.UTC)

    assert to_business_wall_clock(instant, NEW_YORK) == datetime.datetime(2026, 10, 1, 22, 0)


def test_a_january_instant_in_new_york_is_five_hours_behind_utc() -> None:
    instant = datetime.datetime(2026, 1, 15, 12, 0, tzinfo=datetime.UTC)

    assert to_business_wall_clock(instant, NEW_YORK) == datetime.datetime(2026, 1, 15, 7, 0)


def test_the_utc_zone_only_drops_the_offset() -> None:
    instant = datetime.datetime(2026, 10, 2, 2, 0, 30, 123, tzinfo=datetime.UTC)

    assert to_business_wall_clock(instant, ZoneInfo("UTC")) == datetime.datetime(
        2026, 10, 2, 2, 0, 30, 123
    )


def test_the_result_is_naive() -> None:
    instant = datetime.datetime(2026, 10, 2, 2, 0, tzinfo=datetime.UTC)

    assert to_business_wall_clock(instant, NEW_YORK).tzinfo is None


def test_a_naive_instant_is_refused() -> None:
    with pytest.raises(ValueError):
        to_business_wall_clock(datetime.datetime(2026, 10, 2, 2, 0), NEW_YORK)


def test_business_now_reads_the_configured_zone(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(business_timezone="America/New_York")
    monkeypatch.setattr(clock, "get_settings", lambda: settings)

    before = datetime.datetime.now(tz=NEW_YORK).replace(tzinfo=None)
    now = clock.business_now()
    after = datetime.datetime.now(tz=NEW_YORK).replace(tzinfo=None)

    assert now.tzinfo is None
    assert before <= now <= after


def test_business_today_follows_a_frozen_business_now(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(clock, "business_now", lambda: datetime.datetime(2026, 10, 1, 22, 0))

    assert clock.business_today() == datetime.date(2026, 10, 1)
