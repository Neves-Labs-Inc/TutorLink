"""The first reader `system_settings` has ever had — #3 (OQ-7) — and its first writer, #17.

Run against a live PostgreSQL via the `db` fixture rather than a mock, because the thing worth
proving is that a real row round-trips through TEXT `value` and comes back as the integer the
caller asked for.

Two properties here are easy to assert vacuously and are written to fail loudly instead:

- **The role filter.** Every row a migration seeds is `is_developer_only = FALSE`, so a filter
  that is silently a no-op looks exactly like a working one against real data. Every gate test
  below creates its own developer-only row and asserts an admin does *not* see it, so replacing
  `_may_see_developer_only` with `return True` fails the suite rather than passing it.
- **The fail-closed default.** `is_developer_only` is a `server_default` with no Python-side
  default (`app/models/system_setting.py:37-39`), so a freshly constructed `SystemSetting` reads
  `None` for it — and `None` is falsy, which would let a fail-closed test pass while proving the
  opposite. The test that covers it flushes, refreshes, and asserts the value is `True` before
  it asserts anything about filtering.

Row counts are never asserted: the test database is built by `metadata.create_all`, which
reproduces no migration data, so only the four rate-limit rows exist here. Tests create what
they assert on, under a `uuid4`-suffixed key, and compare key *sets* rather than sizes.
"""

from uuid import uuid4

import pytest
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.system_setting import (
    SETTING_VALUE_TYPE_INTEGER,
    SETTING_VALUE_TYPE_STRING,
    SystemSetting,
)
from app.services.retention_scheduler import RETENTION_PURGE_HOUR_SETTING
from app.services.settings_service import (
    SettingKeyDuplicated,
    SettingNotAnInteger,
    SettingNotAString,
    SettingNotEditable,
    SettingNotFound,
    SettingUpdate,
    SettingValueInvalid,
    SettingValueTypeUnsupported,
    apply_setting_updates,
    get_int_setting,
    get_str_setting,
    list_settings,
)

KEY = "a_test_only_setting"

# Seeded developer-only by 0021, so a developer always sees these beyond what an admin sees.
TEMPLATE_SID_KEYS = {
    "reminder_template_sid_en",
    "reminder_template_sid_es",
    "takeover_template_sid_en",
    "takeover_template_sid_es",
    "takeover_generic_template_sid_en",
    "takeover_generic_template_sid_es",
}


def test_an_integer_setting_comes_back_as_an_int(db: Session) -> None:
    _make_setting(db, value="42")

    assert get_int_setting(db, key=KEY) == 42


def test_a_missing_key_raises_rather_than_defaulting(db: Session) -> None:
    # A default would silently substitute a threshold nobody chose for one an admin edited.
    with pytest.raises(SettingNotFound):
        get_int_setting(db, key="no_such_setting")


def test_a_non_numeric_value_raises(db: Session) -> None:
    _make_setting(db, value="soon")

    with pytest.raises(SettingNotAnInteger):
        get_int_setting(db, key=KEY)


def test_a_row_of_another_value_type_raises(db: Session) -> None:
    _make_setting(db, value="60", value_type="duration")

    with pytest.raises(SettingNotAnInteger):
        get_int_setting(db, key=KEY)


def test_a_string_setting_comes_back_as_stored(db: Session) -> None:
    _make_setting(db, value="America/Chicago", value_type=SETTING_VALUE_TYPE_STRING)

    assert get_str_setting(db, key=KEY) == "America/Chicago"


def test_a_blank_string_setting_comes_back_blank(db: Session) -> None:
    _make_setting(db, value="", value_type=SETTING_VALUE_TYPE_STRING)

    assert get_str_setting(db, key=KEY) == ""


def test_an_integer_row_asked_for_as_a_string_raises(db: Session) -> None:
    _make_setting(db, value="42")

    with pytest.raises(SettingNotAString):
        get_str_setting(db, key=KEY)


def test_a_missing_string_key_raises_rather_than_defaulting(db: Session) -> None:
    with pytest.raises(SettingNotFound):
        get_str_setting(db, key="no_such_setting")


def test_list_settings_shows_a_developer_only_row_to_a_developer_and_not_to_an_admin(
    db: Session,
) -> None:
    key = _unique_key("developer_only")
    _make_setting(db, key=key, value="1", is_developer_only=True)

    developer_keys = _visible_keys(db, UserRole.DEVELOPER)
    admin_keys = _visible_keys(db, UserRole.ADMIN)

    assert key in developer_keys
    assert key not in admin_keys
    assert developer_keys - admin_keys == {key, *TEMPLATE_SID_KEYS}


def test_list_settings_hides_a_row_whose_flag_was_left_to_the_server_default(db: Session) -> None:
    key = _unique_key("defaulted")
    row = _make_setting(db, key=key, value="1", is_developer_only=None)
    db.refresh(row)

    # Asserted, not assumed: unrefreshed the attribute is `None`, which is falsy, and a
    # fail-closed test built on it would pass while demonstrating the opposite.
    assert row.is_developer_only is True
    assert key not in _visible_keys(db, UserRole.ADMIN)
    assert key in _visible_keys(db, UserRole.DEVELOPER)


def test_list_settings_is_ordered_by_key_ascending(db: Session) -> None:
    _make_setting(db, key=_unique_key("zzz"), value="1")
    _make_setting(db, key=_unique_key("aaa"), value="1")

    keys = [row.key for row in list_settings(db, actor_role=UserRole.ADMIN)]

    assert keys == sorted(keys)


def test_apply_setting_updates_writes_the_new_value(db: Session) -> None:
    _make_setting(db, value="42")

    rows = apply_setting_updates(
        db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=KEY, value="90")]
    )

    assert get_int_setting(db, key=KEY) == 90
    assert {row.key: row.value for row in rows}[KEY] == "90"


def test_apply_setting_updates_refuses_a_key_named_twice(db: Session) -> None:
    _make_setting(db, value="42")
    updates = [SettingUpdate(key=KEY, value="90"), SettingUpdate(key=KEY, value="120")]

    with pytest.raises(SettingKeyDuplicated):
        apply_setting_updates(db, actor_role=UserRole.ADMIN, updates=updates)

    assert get_int_setting(db, key=KEY) == 42


@pytest.mark.parametrize("actor_role", [UserRole.ADMIN, UserRole.DEVELOPER])
def test_apply_setting_updates_raises_not_found_for_an_unknown_key(
    db: Session, actor_role: UserRole
) -> None:
    # Same exception for both roles: the failure must not become an oracle for what exists.
    with pytest.raises(SettingNotFound):
        apply_setting_updates(
            db,
            actor_role=actor_role,
            updates=[SettingUpdate(key="no_such_setting", value="1")],
        )


def test_apply_setting_updates_refuses_a_developer_only_row_for_an_admin(db: Session) -> None:
    key = _unique_key("developer_only")
    _make_setting(db, key=key, value="1", is_developer_only=True)

    with pytest.raises(SettingNotEditable):
        apply_setting_updates(
            db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=key, value="2")]
        )

    assert get_int_setting(db, key=key) == 1


def test_apply_setting_updates_writes_a_developer_only_row_for_a_developer(db: Session) -> None:
    key = _unique_key("developer_only")
    _make_setting(db, key=key, value="1", is_developer_only=True)

    apply_setting_updates(
        db, actor_role=UserRole.DEVELOPER, updates=[SettingUpdate(key=key, value="2")]
    )

    assert get_int_setting(db, key=key) == 2


def test_apply_setting_updates_checks_authorization_before_the_value(db: Session) -> None:
    # An admin naming a developer-only key with an unparseable value is refused for the key.
    # A 400 would answer a question about the row's type that they may not ask.
    key = _unique_key("developer_only")
    _make_setting(db, key=key, value="1", is_developer_only=True)

    with pytest.raises(SettingNotEditable):
        apply_setting_updates(
            db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=key, value="soon")]
        )


@pytest.mark.parametrize("value", ["0", "90", "-1"])
def test_apply_setting_updates_accepts_an_integer_value(db: Session, value: str) -> None:
    # "0" is load-bearing: it is the documented rate-limit kill switch (D-009). `KEY` is not a
    # scheduling key, and that is what this case now also pins: the per-key bounds below apply
    # to five named keys and leave the generic integer contract for every other row untouched.
    _make_setting(db, value="42")

    apply_setting_updates(
        db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=KEY, value=value)]
    )

    assert get_int_setting(db, key=KEY) == int(value)


@pytest.mark.parametrize("value", ["soon", "", "12.5", "1_0", " "])
def test_apply_setting_updates_refuses_a_non_integer_value(db: Session, value: str) -> None:
    _make_setting(db, value="42")

    with pytest.raises(SettingValueInvalid):
        apply_setting_updates(
            db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=KEY, value=value)]
        )

    assert get_int_setting(db, key=KEY) == 42


def test_apply_setting_updates_accepts_a_value_at_the_digit_bound(db: Session) -> None:
    value = "9" * 18
    _make_setting(db, value="42")

    apply_setting_updates(
        db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=KEY, value=value)]
    )

    assert get_int_setting(db, key=KEY) == int(value)


def test_apply_setting_updates_refuses_a_value_past_the_digit_bound(db: Session) -> None:
    _make_setting(db, value="42")

    with pytest.raises(SettingValueInvalid):
        apply_setting_updates(
            db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=KEY, value="9" * 19)]
        )

    assert get_int_setting(db, key=KEY) == 42


@pytest.mark.parametrize("value", ["0", "90", "-1", "9" * 18])
def test_apply_setting_updates_accepted_value_always_reads_back(db: Session, value: str) -> None:
    # The invariant write validation exists to protect: whatever `apply_setting_updates` writes,
    # `get_int_setting` must be able to read back without raising. A pattern widened without
    # this test in mind could accept a value CPython's `int()` refuses at read time.
    _make_setting(db, value="42")

    apply_setting_updates(
        db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=KEY, value=value)]
    )

    get_int_setting(db, key=KEY)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("session_length_minutes", "0"),
        ("session_length_minutes", "-60"),
        ("session_length_minutes", "1441"),
        ("session_gap_minutes", "-30"),
        ("session_gap_minutes", "1441"),
        ("booking_lookahead_days", "-1"),
        ("booking_lookahead_days", "3651"),
        ("min_booking_lead_hours", "-4"),
        ("min_booking_lead_hours", "8761"),
        ("max_slots_offered", "0"),
        ("max_slots_offered", "-3"),
    ],
)
def test_apply_setting_updates_refuses_an_out_of_range_scheduling_value(
    db: Session, key: str, value: str
) -> None:
    # Each of these is a live scheduling outage an admin could type into `PATCH /api/settings`:
    # a negative gap narrows the shared overlap window until the bot offers slots the booking
    # endpoint refuses with a 409, `max_slots_offered = 0` reports no availability for a full
    # roster, and a negative lookahead puts today past the last offerable date. The row itself
    # is the one `conftest.py` seeds — a migration owns these five keys, so a test creating its
    # own would be asserting against a row the application never reads.
    seeded = get_int_setting(db, key=key)

    with pytest.raises(SettingValueInvalid):
        apply_setting_updates(
            db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=key, value=value)]
        )

    assert get_int_setting(db, key=key) == seeded


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("session_length_minutes", "1"),
        ("session_length_minutes", "60"),
        ("session_length_minutes", "1440"),
        ("session_gap_minutes", "0"),
        ("session_gap_minutes", "30"),
        ("session_gap_minutes", "1440"),
        ("booking_lookahead_days", "0"),
        ("booking_lookahead_days", "90"),
        ("booking_lookahead_days", "3650"),
        ("min_booking_lead_hours", "0"),
        ("min_booking_lead_hours", "24"),
        ("min_booking_lead_hours", "8760"),
        ("max_slots_offered", "1"),
        ("max_slots_offered", "5"),
        ("max_slots_offered", "9" * 18),
    ],
)
def test_apply_setting_updates_accepts_a_scheduling_value_in_range(
    db: Session, key: str, value: str
) -> None:
    # The zeroes are the point: `session_gap_minutes = 0` is back-to-back sessions,
    # `booking_lookahead_days = 0` is today only and `min_booking_lead_hours = 0` is the seeded
    # default, so a bound written as "positive everywhere" would break all three. The largest
    # `max_slots_offered` case pins that this key is deliberately unbounded above.
    apply_setting_updates(
        db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=key, value=value)]
    )

    assert get_int_setting(db, key=key) == int(value)


def test_apply_setting_updates_bounds_a_scheduling_value_for_a_developer_too(db: Session) -> None:
    # Bounds are a fact about how the value is used, not a role gate: a developer is held to the
    # same range an admin is.
    seeded = get_int_setting(db, key="session_gap_minutes")

    with pytest.raises(SettingValueInvalid):
        apply_setting_updates(
            db,
            actor_role=UserRole.DEVELOPER,
            updates=[SettingUpdate(key="session_gap_minutes", value="-30")],
        )

    assert get_int_setting(db, key="session_gap_minutes") == seeded


def test_apply_setting_updates_writes_nothing_when_a_later_update_is_out_of_range(
    db: Session,
) -> None:
    seeded_length = get_int_setting(db, key="session_length_minutes")
    seeded_gap = get_int_setting(db, key="session_gap_minutes")
    updates = [
        SettingUpdate(key="session_length_minutes", value="45"),
        SettingUpdate(key="session_gap_minutes", value="-30"),
    ]

    with pytest.raises(SettingValueInvalid):
        apply_setting_updates(db, actor_role=UserRole.ADMIN, updates=updates)

    assert get_int_setting(db, key="session_length_minutes") == seeded_length
    assert get_int_setting(db, key="session_gap_minutes") == seeded_gap


@pytest.mark.parametrize("value", ["24", "-1"])
def test_apply_setting_updates_refuses_a_purge_hour_outside_the_day(
    db: Session, value: str
) -> None:
    # The scheduler compares this with the tick's `now.hour`, which is 0-23: anything else is
    # accepted silently and then never matches, so the purge just stops happening.
    _ensure_purge_hour_row(db)
    seeded = get_int_setting(db, key=RETENTION_PURGE_HOUR_SETTING)

    with pytest.raises(SettingValueInvalid):
        apply_setting_updates(
            db,
            actor_role=UserRole.ADMIN,
            updates=[SettingUpdate(key=RETENTION_PURGE_HOUR_SETTING, value=value)],
        )

    assert get_int_setting(db, key=RETENTION_PURGE_HOUR_SETTING) == seeded


@pytest.mark.parametrize("value", ["0", "23"])
def test_apply_setting_updates_accepts_a_purge_hour_at_either_end_of_the_day(
    db: Session, value: str
) -> None:
    _ensure_purge_hour_row(db)

    apply_setting_updates(
        db,
        actor_role=UserRole.ADMIN,
        updates=[SettingUpdate(key=RETENTION_PURGE_HOUR_SETTING, value=value)],
    )

    assert get_int_setting(db, key=RETENTION_PURGE_HOUR_SETTING) == int(value)


def test_apply_setting_updates_raises_on_a_value_type_it_cannot_validate(db: Session) -> None:
    # A migration that adds a `value_type` without teaching this module to check it is a deploy
    # error. Waving the write through unvalidated is the one outcome that must not happen.
    _make_setting(db, value="60", value_type="duration")

    with pytest.raises(SettingValueTypeUnsupported):
        apply_setting_updates(
            db, actor_role=UserRole.ADMIN, updates=[SettingUpdate(key=KEY, value="90")]
        )


def test_apply_setting_updates_writes_nothing_when_one_update_in_the_batch_is_refused(
    db: Session,
) -> None:
    refused_key = _unique_key("developer_only")
    _make_setting(db, value="42")
    _make_setting(db, key=refused_key, value="1", is_developer_only=True)
    updates = [SettingUpdate(key=KEY, value="90"), SettingUpdate(key=refused_key, value="2")]

    with pytest.raises(SettingNotEditable):
        apply_setting_updates(db, actor_role=UserRole.ADMIN, updates=updates)

    assert get_int_setting(db, key=KEY) == 42


def _make_setting(
    db: Session,
    *,
    value: str,
    key: str = KEY,
    value_type: str = SETTING_VALUE_TYPE_INTEGER,
    is_developer_only: bool | None = False,
) -> SystemSetting:
    """Insert one row through the rolled-back session; `is_developer_only=None` omits the
    column so the `server_default` decides, which is the fail-closed case."""
    columns = {"key": key, "value": value, "value_type": value_type}

    if is_developer_only is not None:
        columns["is_developer_only"] = is_developer_only

    row = SystemSetting(**columns)
    db.add(row)
    db.flush()

    return row


def _ensure_purge_hour_row(db: Session) -> None:
    """Migration 0018 seeds this row and the harness does not yet; `DO NOTHING` keeps this
    correct on either side of the harness learning to."""
    db.execute(
        insert(SystemSetting)
        .values(
            key=RETENTION_PURGE_HOUR_SETTING,
            value="3",
            value_type=SETTING_VALUE_TYPE_INTEGER,
            is_developer_only=False,
        )
        .on_conflict_do_nothing(index_elements=[SystemSetting.key])
    )
    db.flush()


def _unique_key(label: str) -> str:
    return f"{label}_{uuid4().hex}"


def _visible_keys(db: Session, actor_role: UserRole) -> set[str]:
    return {row.key for row in list_settings(db, actor_role=actor_role)}
