import datetime
import uuid
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.enums import UserRole
from app.models.system_setting import SystemSetting
from app.models.user import User
from app.security import create_access_token
from app.services import clock
from app.services.clock import to_business_wall_clock

NEW_YORK = ZoneInfo("America/New_York")
TOKYO = ZoneInfo("Asia/Tokyo")


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


# --- the settings-driven zone ----------------------------------------------------------------


def test_business_now_follows_a_timezone_write_without_a_restart(
    api: TestClient, db: Session
) -> None:
    admin = _make_admin(db)
    assert clock.business_zone() == NEW_YORK

    response = api.patch(
        "/api/settings",
        headers=_auth(admin),
        json={"updates": [{"key": "business_timezone", "value": "Asia/Tokyo"}]},
    )

    before = datetime.datetime.now(tz=TOKYO).replace(tzinfo=None)
    now = clock.business_now()
    after = datetime.datetime.now(tz=TOKYO).replace(tzinfo=None)
    assert response.status_code == 200
    assert clock.business_zone() == TOKYO
    assert before <= now <= after


def test_a_missing_timezone_row_falls_back_to_the_env_zone(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(business_timezone="Europe/Madrid")
    monkeypatch.setattr(clock, "get_settings", lambda: settings)
    db.execute(delete(SystemSetting).where(SystemSetting.key == "business_timezone"))

    clock.refresh_business_zone(db)

    assert clock.business_zone() == ZoneInfo("Europe/Madrid")


def test_the_cached_zone_is_reread_once_it_is_a_minute_old(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The write below is uncommitted, so only the refresh that is handed this session sees it;
    # the clock's own re-read sees the committed New York row.
    _set_business_timezone(db, "Asia/Tokyo")
    started = 1_000.0
    monkeypatch.setattr(clock, "monotonic", lambda: started)
    clock.refresh_business_zone(db)

    monkeypatch.setattr(clock, "monotonic", lambda: started + 59)
    within_a_minute = clock.business_zone()
    monkeypatch.setattr(clock, "monotonic", lambda: started + 60)
    after_a_minute = clock.business_zone()

    assert within_a_minute == TOKYO
    assert after_a_minute == NEW_YORK


@pytest.mark.parametrize(
    ("instant", "wall_clock"),
    [
        # 2026-11-01, fall back at 02:00 EDT: 01:30 happens twice, an hour apart in UTC.
        (
            datetime.datetime(2026, 11, 1, 5, 30, tzinfo=datetime.UTC),
            datetime.datetime(2026, 11, 1, 1, 30),
        ),
        (
            datetime.datetime(2026, 11, 1, 6, 30, tzinfo=datetime.UTC),
            datetime.datetime(2026, 11, 1, 1, 30),
        ),
        (
            datetime.datetime(2026, 11, 1, 23, 0, tzinfo=datetime.UTC),
            datetime.datetime(2026, 11, 1, 18, 0),
        ),
        # 2027-03-14, spring forward at 02:00 EST: 02:xx never shows.
        (
            datetime.datetime(2027, 3, 14, 6, 30, tzinfo=datetime.UTC),
            datetime.datetime(2027, 3, 14, 1, 30),
        ),
        (
            datetime.datetime(2027, 3, 14, 7, 30, tzinfo=datetime.UTC),
            datetime.datetime(2027, 3, 14, 3, 30),
        ),
        (
            datetime.datetime(2027, 3, 14, 22, 0, tzinfo=datetime.UTC),
            datetime.datetime(2027, 3, 14, 18, 0),
        ),
    ],
)
def test_dst_transition_days_read_correctly_through_the_settings_zone(
    db: Session, instant: datetime.datetime, wall_clock: datetime.datetime
) -> None:
    _set_business_timezone(db, "America/New_York")
    clock.refresh_business_zone(db)

    assert to_business_wall_clock(instant, clock.business_zone()) == wall_clock


def _set_business_timezone(db: Session, value: str) -> None:
    row = db.execute(
        select(SystemSetting).where(SystemSetting.key == "business_timezone")
    ).scalar_one()
    row.value = value
    db.flush()


def _make_admin(db: Session) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        name="Test Admin",
        hashed_password="not-a-real-hash",
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}
