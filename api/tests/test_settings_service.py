"""The first reader `system_settings` has ever had — #3 (OQ-7).

Run against a live PostgreSQL via the `db` fixture rather than a mock, because the thing worth
proving is that a real row round-trips through TEXT `value` and comes back as the integer the
caller asked for.
"""

import pytest
from sqlalchemy.orm import Session

from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting
from app.services.settings_service import (
    SettingNotAnInteger,
    SettingNotFound,
    get_int_setting,
)

KEY = "a_test_only_setting"


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


def _make_setting(
    db: Session, *, value: str, value_type: str = SETTING_VALUE_TYPE_INTEGER
) -> SystemSetting:
    row = SystemSetting(key=KEY, value=value, value_type=value_type, is_developer_only=False)
    db.add(row)
    db.flush()

    return row
