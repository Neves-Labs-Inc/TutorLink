"""Reading `system_settings` rows at the type the caller wants.

The table has existed since 0004 with no reader anywhere; this is its first one, so the
conventions it sets are deliberate:

**No caching.** Every read is a SELECT. A cached value is a stale value, and a setting whose
whole reason to exist is that an admin can change it without a deploy is exactly the wrong
thing to serve from a cache. Login is low-frequency and one indexed lookup on a unique key
costs less than the bcrypt round that follows it.

**A missing row raises.** Migrations are the only thing that writes these rows, so an absent
key is a database that did not finish migrating, not a runtime condition. Defaulting instead
would silently substitute a number nobody chose — and for a rate limit, a default that
silently disagrees with the row an admin edited is worse than a 500.

This module knows nothing about FastAPI; it raises the domain exceptions below and the caller
decides what they mean.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting


class SettingsError(Exception):
    """Base class for every failure this module reports."""


class SettingNotFound(SettingsError):
    """No `system_settings` row carries the requested key."""


class SettingNotAnInteger(SettingsError):
    """The row exists but does not hold an integer.

    Reachable once `PATCH /api/settings` lands and an admin can put arbitrary text in `value`:
    `value_type` is a rendering hint, not a database constraint, so nothing below this module
    stops a non-numeric value from being stored. Raised rather than swallowed so the bad row
    is reported instead of quietly becoming a default.
    """


def get_int_setting(db: Session, *, key: str) -> int:
    row = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()

    if row is None:
        raise SettingNotFound(f"no system setting {key!r}")

    if row.value_type != SETTING_VALUE_TYPE_INTEGER:
        raise SettingNotAnInteger(f"system setting {key!r} is {row.value_type!r}, not an integer")

    try:
        value = int(row.value)
    except ValueError as exc:
        raise SettingNotAnInteger(f"system setting {key!r} holds {row.value!r}") from exc

    return value
