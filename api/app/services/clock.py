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

Known, accepted limitation: on the DST fall-back night the repeated hour makes the naive
wall-clock ambiguous, so lead-time and cutoff checks can be off by up to an hour.
"""

import datetime
from zoneinfo import ZoneInfo

from app.config import get_settings


def to_business_wall_clock(instant: datetime.datetime, zone: ZoneInfo) -> datetime.datetime:
    """An aware instant as the naive wall-clock time it shows in `zone`."""
    if instant.tzinfo is None:
        raise ValueError("to_business_wall_clock needs an aware instant, got a naive datetime")

    return instant.astimezone(zone).replace(tzinfo=None)


def business_now() -> datetime.datetime:
    """Naive wall-clock now in `BUSINESS_TIMEZONE`, the form every scheduling column stores."""
    return to_business_wall_clock(
        datetime.datetime.now(tz=datetime.UTC), get_settings().business_zone
    )


def business_today() -> datetime.date:
    return business_now().date()
