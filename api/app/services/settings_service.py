"""Reading `system_settings` rows at the type the caller wants, and writing them back.

The table has existed since 0004 with no reader anywhere; this module was its first, so the
conventions it sets are deliberate:

**No caching.** Every read is a SELECT. A cached value is a stale value, and a setting whose
whole reason to exist is that an admin can change it without a deploy is exactly the wrong
thing to serve from a cache. Login is low-frequency and one indexed lookup on a unique key
costs less than the bcrypt round that follows it.

**A missing row raises.** Migrations remain the only thing that *creates, removes, or
reclassifies* a row — `apply_setting_updates` writes `value` on a row that already exists and
nothing else — so an absent key is a database that did not finish migrating, not a runtime
condition. Defaulting instead would silently substitute a number nobody chose, and for a rate
limit a default that disagrees with the row an admin edited is worse than a 500. Migrations
owning the row set is also what makes `is_developer_only` worth trusting: no request can
create a row, so no request can choose its own visibility.

**A write is validated against `value_type` before it lands** (D-007). `value_type` is a
rendering hint rather than a database constraint (`system_setting.py:9`), so nothing below
this module stops `"twenty"` from being stored. What makes that fatal is the no-caching rule
above: `load_login_policies` reads four of these rows through `get_int_setting` on every
`POST /auth/token`, so an admin's typo in `login_rate_limit_ip_max_attempts` 500s the very
next login attempt for everyone — including for the admin who typed it, once their
fifteen-minute access token expires. Validating on write is what stops a typo becoming an
authentication outage. The accepted form is deliberately narrower than what `int()` parses:
`int("1_0")` is ten, and a value that renders as one number and parses as another has no
business in a field an admin edits by hand.

The pattern also bounds the digit count at 18. Every row this table holds is a duration, a
count, or a threshold, so the useful range tops out many orders of magnitude below that.
Without a bound, a value the pattern accepts is not always one `get_int_setting` can read
back: CPython's `int()` refuses a literal past 4300 digits, so an admin pasting a 5000-digit
value would write successfully and then 500 every login after it — the exact failure this
validator exists to prevent, reached through the validator itself. 18 digits is comfortably
inside the 4300-digit interpreter limit rather than pinned to it, so this module stays correct
if that limit ever moves, and it is a 400 with a clear reason instead of the read path
discovering the problem later.

**Some keys carry per-key bounds on top of that pattern** (**P4-M**). The pattern accepts a
leading `-`, and each of the five scheduling keys is arithmetic some other module performs on every
scheduling request: a negative `session_gap_minutes` *shrinks* the overlap window `GET /api/slots/available`
and `POST /api/bookings` share, so the offer surface starts handing out slots the write path then
answers with a 409 — #44 item 1, reached through the settings surface rather than through a
divergent comparison. A `max_slots_offered` of `0` reports `items: []` beside a non-zero `total`,
which is the same outage told silently. A negative `booking_lookahead_days` refuses every date
including today. The minimums differ because the values do: `session_gap_minutes` of `0` means
back-to-back sessions and is a real configuration, while `session_length_minutes` of `0` is a grid
with no slots in it. The maximums exist because `datetime.timedelta` overflows long before the
18-digit pattern does — `timedelta(minutes=10**18)` raises, inside a request handler, on every
slot query after the write.

`chat_retention_days` is bounded for a harsher reason than any of those five, and its floor is the
only thing between an admin's typo and the whole chat archive. `purge_expired_messages` builds its
cutoff as `now - timedelta(days=retention_days)`, so a negative value puts the cutoff in the
*future* and `DELETE FROM messages WHERE created_at < cutoff` matches **every row in the table** —
and then every conversation those messages emptied. There is no confirmation step and no undo. `0`
stays inside the bounds because it is a documented setting rather than a mistake: `erd.md:378-380`
gives it to a client on a records-retention obligation, and `PurgeResult.ran=False` is what keeps
it distinguishable from a purge that ran and found nothing. The maximum is the same overflow
argument as above, reached through `timedelta(days=...)` in the CLI instead of a request handler.

**Only the keys below are bounded**: a bound is a fact about how a value is used, and every other
row here is used somewhere this module has no business guessing about — the four
`login_rate_limit_*` rows still accept a negative, which is #17/#18's and not this table's. The
keys are spelled out rather than imported from the modules that own them, because
`scheduling_service` and `retention_service` both import this one.

**Which rows a caller may see is decided here, from `actor_role`** (D-010), rather than by the
caller handing in a precomputed flag. One place answers "what may this role see", and it is
testable without an HTTP request.

This module knows nothing about FastAPI; it raises the domain exceptions below and the caller
decides what they mean. Nothing here commits — `apply_setting_updates` flushes and the router
owns the transaction boundary.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.enums import UserRole
from app.models.system_setting import (
    SETTING_VALUE_TYPE_INTEGER,
    SETTING_VALUE_TYPE_STRING,
    SystemSetting,
)
from app.services.mail_templates import EmailTemplateInvalid, TemplateKind, validate_template

BUSINESS_TIMEZONE_SETTING = "business_timezone"
REMINDER_TEMPLATE_SID_EN_SETTING = "reminder_template_sid_en"
REMINDER_TEMPLATE_SID_ES_SETTING = "reminder_template_sid_es"

_INTEGER_VALUE_PATTERN = re.compile(r"[+-]?[0-9]{1,18}")

# The rows migration 0034 seeds, by template kind: (subject key, body key).
EMAIL_TEMPLATE_SETTINGS = {
    TemplateKind.INVITE: ("email_invite_subject", "email_invite_body"),
    TemplateKind.PASSWORD_RESET: ("email_reset_subject", "email_reset_body"),
}


@dataclass(frozen=True)
class SettingUpdate:
    key: str
    value: str


@dataclass(frozen=True)
class SettingsFlags:
    """Derived, read-only facts the settings screen shows beside the rows.

    Computed for every role from rows the role may not see: an admin gets `reminders_paused`
    without being shown the developer-only template ids it is derived from.
    """

    business_timezone_locked: bool
    reminders_paused: bool


@dataclass(frozen=True, slots=True)
class EmailTemplate:
    subject: str
    body: str


@dataclass(frozen=True, slots=True)
class _Bounds:
    minimum: int
    maximum: int | None

    def permits(self, value: int) -> bool:
        return self.minimum <= value and (self.maximum is None or value <= self.maximum)

    def __str__(self) -> str:
        return (
            f"{self.minimum} to {self.maximum}"
            if self.maximum is not None
            else f"{self.minimum} or more"
        )


_VALUE_BOUNDS = {
    # A slot length of zero emits no grid at all; a day is the longest slot that can fit inside
    # one `tutor_availability` range, all of which live within a single day.
    "session_length_minutes": _Bounds(minimum=1, maximum=24 * 60),
    # Zero is back-to-back sessions and is meaningful. Negative inverts `overlaps_within_gap`
    # into a *narrower* comparison than bare overlap.
    "session_gap_minutes": _Bounds(minimum=0, maximum=24 * 60),
    # Zero offers today only, which is restrictive but coherent. Negative puts today itself past
    # the last offerable date, refusing every slot query and every booking.
    "booking_lookahead_days": _Bounds(minimum=0, maximum=365 * 10),
    # Zero is the seeded default and means "any start still in the future". Negative accepts a
    # session that already started, which the date window does not catch for today.
    "min_booking_lead_hours": _Bounds(minimum=0, maximum=24 * 365),
    # Zero returns an empty page beside a non-zero total, and negative makes `open_slots[:n]`
    # drop the last `n` slots instead of capping. No maximum: a cap larger than the day's grid
    # is simply not a cap, and nothing downstream does arithmetic with it.
    "max_slots_offered": _Bounds(minimum=1, maximum=None),
    # Zero means never purge and is a real configuration (`erd.md:378-380`). Negative is the one
    # value in this table that destroys data: it moves the purge's cutoff into the future, so the
    # age-based DELETE matches every message ever recorded. A century is far past any retention
    # obligation and far short of the `timedelta(days=...)` overflow the CLI would hit.
    "chat_retention_days": _Bounds(minimum=0, maximum=365 * 100),
    # An hour of the UTC day. Anything outside 0-23 never equals the tick's `now.hour`, so the
    # scheduler would log nothing and silently never purge again.
    "retention_purge_hour_utc": _Bounds(minimum=0, maximum=23),
    # ISO weekday (1 = Monday) and business-zone hour the weekly reminder pass fires on. A value
    # outside either range never matches the tick, so reminders would silently stop.
    "reminder_weekday": _Bounds(minimum=1, maximum=7),
    "reminder_hour": _Bounds(minimum=0, maximum=23),
}


class SettingsError(Exception):
    """Base class for every failure this module reports."""


class SettingNotFound(SettingsError):
    """No `system_settings` row carries the requested key."""


class SettingNotAnInteger(SettingsError):
    """The row exists but does not hold an integer.

    `PATCH /api/settings` validates `value` against `value_type` before it writes, so an admin
    can no longer produce one of these through the API — that route is closed. What stays
    reachable is a row edited by hand in SQL, and a row whose `value_type` is not `integer`
    being asked for as an int, which no amount of write validation prevents because the caller
    chose the type, not the row. Raised rather than swallowed so the bad row is reported
    instead of quietly becoming a default.
    """


class SettingNotAString(SettingsError):
    """The row exists but its `value_type` is not `string`."""


class SettingNotEditable(SettingsError):
    """The row exists but the actor's role may not write it."""


class SettingLocked(SettingNotEditable):
    """The row is one the role may normally write, but a state lock now forbids it.

    Today only `business_timezone`: every booking's naive wall-clock columns were typed in the
    zone that was current at the time, and changing the zone afterwards does not move them, so
    once a booking exists only a developer (who can also fix the data) may change it. A
    subclass of `SettingNotEditable` so it is still a refusal of the write, not of the value.
    """


class SettingValueInvalid(SettingsError):
    """The submitted value does not parse as the row's `value_type`, or is outside its bounds.

    One class for both because the router maps both the same way — a 400 naming the value, not
    the reason (`routers/settings.py:63`). A caller who submits `-30` for `session_gap_minutes`
    and a caller who submits `soon` have each sent a value this row cannot hold.
    """


class BusinessTimezoneUnknown(SettingValueInvalid):
    """`business_timezone` was given a name `ZoneInfo` cannot resolve.

    A subclass so callers that only care "the value was refused" still catch it, while the
    router can tell the admin what a valid value looks like instead of the generic type error.
    """


class EmailTemplateSettingInvalid(SettingValueInvalid):
    """An email template row was given a subject or body `validate_template` refuses.

    Carries the rule's message, which the router returns as-is: unlike a type error, the Admin
    needs to know which rule they broke to fix the template.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class SettingKeyDuplicated(SettingsError):
    """One key was named more than once in a single batch of updates."""


class SettingValueTypeUnsupported(SettingsError):
    """The row's `value_type` is one this module has no validator for.

    A deploy error rather than a client error: a migration introduced a `value_type` without
    teaching this module to check it, so every write to that row would otherwise be waved
    through unvalidated. Deliberately not mapped to a 4xx by the router (REQ-176) — it is not
    something the caller did, and a 500 is what gets it noticed.
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


def get_str_setting(db: Session, *, key: str) -> str:
    row = db.execute(select(SystemSetting).where(SystemSetting.key == key)).scalar_one_or_none()

    if row is None:
        raise SettingNotFound(f"no system setting {key!r}")

    if row.value_type != SETTING_VALUE_TYPE_STRING:
        raise SettingNotAString(f"system setting {key!r} is {row.value_type!r}, not a string")

    return row.value


def read_settings_flags(db: Session) -> SettingsFlags:
    # Both reminder ids blank is the documented "paused" state: no template is approved yet, so
    # the weekly run would skip every Guardian.
    reminder_sids = [
        get_str_setting(db, key=REMINDER_TEMPLATE_SID_EN_SETTING),
        get_str_setting(db, key=REMINDER_TEMPLATE_SID_ES_SETTING),
    ]

    return SettingsFlags(
        business_timezone_locked=has_any_booking(db),
        reminders_paused=all(sid.strip() == "" for sid in reminder_sids),
    )


def list_settings(db: Session, *, actor_role: UserRole) -> list[SystemSetting]:
    """Every row the role may see, ordered by `key` ascending.

    Filtered in SQL rather than in Python: a developer-only row a non-developer may not see
    should not be in the result set to begin with, and a filter applied after the fact is one
    `return` away from leaking.
    """
    statement = select(SystemSetting).order_by(SystemSetting.key)

    if not _may_see_developer_only(actor_role):
        statement = statement.where(SystemSetting.is_developer_only.is_(False))

    return list(db.scalars(statement).all())


def apply_setting_updates(
    db: Session, *, actor_role: UserRole, updates: Sequence[SettingUpdate]
) -> list[SystemSetting]:
    """Validate every update, then apply every update, then return `list_settings`.

    All-or-nothing is structural here, not a property of the router remembering not to commit:
    nothing is assigned until every update has passed, so there is no partially-applied state
    for a caller to observe or for an exception to leave behind. It matters semantically as
    well as transactionally — the four rate-limit rows are read together by
    `load_login_policies`, so applying one and refusing its partner would produce a live
    configuration nobody chose (D-004).

    Authorization is checked before the value is (D-006): an admin naming a developer-only key
    with a malformed value is refused for the key, not told its value was wrong. The 400 would
    answer a question they may not ask.
    """
    keys = [update.key for update in updates]
    duplicated = sorted({key for key in keys if keys.count(key) > 1})

    if duplicated:
        raise SettingKeyDuplicated(f"named more than once: {', '.join(duplicated)}")

    rows = {
        row.key: row
        for row in db.scalars(select(SystemSetting).where(SystemSetting.key.in_(keys))).all()
    }
    pending: list[tuple[SystemSetting, str]] = []

    for update in updates:
        row = rows.get(update.key)

        if row is None:
            raise SettingNotFound(f"no system setting {update.key!r}")

        if row.is_developer_only and not _may_see_developer_only(actor_role):
            raise SettingNotEditable(f"system setting {update.key!r} is developer-only")

        if (
            update.key == BUSINESS_TIMEZONE_SETTING
            and not _may_see_developer_only(actor_role)
            and has_any_booking(db)
        ):
            raise SettingLocked(f"system setting {update.key!r} is locked once a booking exists")

        if row.value_type == SETTING_VALUE_TYPE_INTEGER:
            _check_integer_value(update)
            value = update.value
        elif row.value_type == SETTING_VALUE_TYPE_STRING:
            value = _checked_string_value(update)
        else:
            raise SettingValueTypeUnsupported(
                f"system setting {update.key!r} is {row.value_type!r}, which has no validator"
            )

        pending.append((row, value))

    _check_email_templates(updates)

    for row, value in pending:
        row.value = value

    db.flush()

    return list_settings(db, actor_role=actor_role)


def read_email_template(db: Session, *, kind: TemplateKind) -> EmailTemplate:
    """The saved subject and body of the `kind` email."""
    subject_key, body_key = EMAIL_TEMPLATE_SETTINGS[kind]

    return EmailTemplate(
        subject=get_str_setting(db, key=subject_key), body=get_str_setting(db, key=body_key)
    )


def has_any_booking(db: Session) -> bool:
    """Whether any booking row exists, in any status; what locks `business_timezone`."""
    return db.scalar(select(Booking.id).limit(1)) is not None


def _check_integer_value(update: SettingUpdate) -> None:
    if _INTEGER_VALUE_PATTERN.fullmatch(update.value.strip()) is None:
        raise SettingValueInvalid(f"system setting {update.key!r} rejects {update.value!r}")

    bounds = _VALUE_BOUNDS.get(update.key)

    if bounds is not None and not bounds.permits(int(update.value)):
        raise SettingValueInvalid(
            f"system setting {update.key!r} rejects {update.value!r}: accepts {bounds}"
        )


def _check_email_templates(updates: Sequence[SettingUpdate]) -> None:
    """Validate each email template the batch touches, checking only the parts it changes.

    Per template rather than per row so that a batch saving both parts gets the rules in their
    documented order (subject before body), as the test-send route does.
    """
    values = {update.key: update.value for update in updates}

    for kind, (subject_key, body_key) in EMAIL_TEMPLATE_SETTINGS.items():
        if subject_key not in values and body_key not in values:
            continue

        try:
            validate_template(kind, subject=values.get(subject_key), body=values.get(body_key))
        except EmailTemplateInvalid as exc:
            raise EmailTemplateSettingInvalid(exc.message) from exc


def _checked_string_value(update: SettingUpdate) -> str:
    """The value to store for a string row, stripped, or raise if this key refuses it.

    Stripped because every string row is pasted in by hand (a zone name, a Twilio template id),
    and a trailing space would make a template id that looks set fail at send time.
    Only `business_timezone` has a validator here; the template-id rows accept anything, and
    blank is their documented "not approved" value. Email template rows are stored as written:
    their whitespace is the email's layout, and `_check_email_templates` validates them.
    """
    if _is_email_template_key(update.key):
        return update.value

    value = update.value.strip()

    if update.key == BUSINESS_TIMEZONE_SETTING and not _is_known_zone(value):
        raise BusinessTimezoneUnknown(f"system setting {update.key!r} rejects {update.value!r}")

    return value


def _is_email_template_key(key: str) -> bool:
    return any(key in keys for keys in EMAIL_TEMPLATE_SETTINGS.values())


def _is_known_zone(name: str) -> bool:
    # `ZoneInfo` signals a bad name three ways: not found, a malformed key ("", "../x"), and an
    # OS error when the name is a directory of the tz database ("America").
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        is_known = False
    else:
        is_known = True

    return is_known


def _may_see_developer_only(role: UserRole) -> bool:
    # Deliberately narrower than `ADMIN_ROLES`, and this is the one place that is correct.
    # `dependencies.py:80-84` establishes that every *route gate* asks "admin or above", so a
    # reader who knows that rule will otherwise read this line as the bug the rule warns
    # about. This is not a route gate — both roles reach both settings endpoints — it is the
    # field-level distinction the `developer` role was created for (CONSTITUTION.md §5).
    return role is UserRole.DEVELOPER
