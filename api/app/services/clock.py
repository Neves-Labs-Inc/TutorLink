"""The business clock: "now" and "today" as staff in `BUSINESS_TIMEZONE` read them.

Every scheduling column (`bookings.scheduled_date/start_time/end_time`, availability and time
off) is a **naive** wall-clock value typed in by staff in the business's own zone. Comparing
those against a UTC "now" is wrong by the zone's offset, so every scheduling-side clock read
goes through `business_now` and nowhere else.

`business_now` is the single freezing point for tests: `business_today` reads through it, so
patching `clock.business_now` freezes both. Callers reach it as `clock.business_now()` (module
attribute, not a `from` import) so the patch is seen everywhere.

Timezone-aware UTC instants (conversation, message, auth, rate-limit, retention and bot-state
timestamps) are not scheduling data and keep reading `datetime.now(UTC)` directly.

**Which zone.** The `business_timezone` settings row, so an admin can change it without a
deploy. It is read through a process-level cache rather than per call: `business_now` is called
from pure code paths that hold no session, and a SELECT per clock read would be one more query on
every slot listing. The cache is refreshed by `refresh_business_zone` when the settings route
writes the row, and re-read on its own once it is `ZONE_CACHE_TTL_SECONDS` old, so another
process (or a hand edit) is seen within a minute. `BUSINESS_TIMEZONE` from the environment is the
fallback only when the row is missing.

Known, accepted limitation: on the DST fall-back night the repeated hour makes the naive
wall-clock ambiguous, so lead-time and cutoff checks can be off by up to an hour.
"""

import datetime
import logging
from dataclasses import dataclass
from time import monotonic
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.services.settings_service import (
    BUSINESS_TIMEZONE_SETTING,
    SettingNotFound,
    get_str_setting,
)

ZONE_CACHE_TTL_SECONDS = 60.0

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _CachedZone:
    zone: ZoneInfo
    loaded_at: float


_cached_zone: _CachedZone | None = None


def to_business_wall_clock(instant: datetime.datetime, zone: ZoneInfo) -> datetime.datetime:
    """An aware instant as the naive wall-clock time it shows in `zone`."""
    if instant.tzinfo is None:
        raise ValueError("to_business_wall_clock needs an aware instant, got a naive datetime")

    return instant.astimezone(zone).replace(tzinfo=None)


def business_now() -> datetime.datetime:
    """Naive wall-clock now in the business zone, the form every scheduling column stores."""
    return to_business_wall_clock(datetime.datetime.now(tz=datetime.UTC), business_zone())


def business_zone() -> ZoneInfo:
    """The business zone, from the cache while it is fresh, else re-read from the settings row."""
    cached = _cached_zone

    if cached is None or monotonic() - cached.loaded_at >= ZONE_CACHE_TTL_SECONDS:
        with SessionLocal() as session:
            zone = refresh_business_zone(session)
    else:
        zone = cached.zone

    return zone


def refresh_business_zone(db: Session) -> ZoneInfo:
    """Re-read the zone through `db` and cache it; call after writing `business_timezone`.

    Taking the caller's session is what lets a write be seen before the cache would expire: the
    settings route hands in the session that just committed the new value.
    """
    global _cached_zone

    try:
        zone = ZoneInfo(get_str_setting(db, key=BUSINESS_TIMEZONE_SETTING))
    except SettingNotFound:
        zone = get_settings().business_zone
        logger.warning(
            "clock: no %r row, falling back to BUSINESS_TIMEZONE=%s",
            BUSINESS_TIMEZONE_SETTING,
            zone.key,
        )

    _cached_zone = _CachedZone(zone=zone, loaded_at=monotonic())

    return zone


def business_today() -> datetime.date:
    return business_now().date()
