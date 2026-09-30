"""`phone_service.normalize_phone_number` (#55, REQ-037), including REQ-037.8's server-fault
carve-out for a `default_phone_country_code` no region owns.
"""

from collections.abc import Callable

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models.system_setting import SystemSetting
from app.services.phone_service import (
    DEFAULT_COUNTRY_CODE_SETTING,
    InvalidPhoneNumber,
    PhoneRegionNotConfigured,
    normalize_phone_number,
)
from app.services.settings_service import SettingNotFound

CANONICAL = "+12025550123"
UNITED_KINGDOM = 44
UNOWNED_CALLING_CODE = 999


@pytest.mark.parametrize(
    "raw",
    [
        "+1 (202) 555-0123",
        "202-555-0123",
        "12025550123",
        CANONICAL,
    ],
)
def test_every_written_form_of_one_number_normalizes_to_the_same_e164(
    db: Session, raw: str
) -> None:
    assert normalize_phone_number(db, raw=raw) == CANONICAL


def test_an_explicit_country_code_is_parsed_by_that_code_not_by_the_setting(db: Session) -> None:
    assert normalize_phone_number(db, raw="+44 20 7183 8750") == "+442071838750"


@pytest.mark.parametrize("raw", ["not a phone", "", "   ", "12345"])
def test_unparseable_input_raises_rather_than_passing_through(db: Session, raw: str) -> None:
    with pytest.raises(InvalidPhoneNumber):
        normalize_phone_number(db, raw=raw)


def test_a_number_that_parses_but_is_not_a_real_number_is_refused(db: Session) -> None:
    # `+1 555 123 4567` is the right length and the right shape, and no NANP handset answers on
    # it. Storing it would be a row nobody can be reached at, under a UNIQUE column.
    with pytest.raises(InvalidPhoneNumber):
        normalize_phone_number(db, raw="+1 (555) 123-4567")


def test_rewriting_the_setting_changes_how_a_bare_national_number_parses(
    db: Session, set_int_setting: Callable[[str, int], None]
) -> None:
    with pytest.raises(InvalidPhoneNumber):
        normalize_phone_number(db, raw="020 7183 8750")

    set_int_setting(DEFAULT_COUNTRY_CODE_SETTING, UNITED_KINGDOM)

    assert normalize_phone_number(db, raw="020 7183 8750") == "+442071838750"


def test_a_missing_setting_row_propagates_the_settings_error(db: Session) -> None:
    db.execute(delete(SystemSetting).where(SystemSetting.key == DEFAULT_COUNTRY_CODE_SETTING))

    with pytest.raises(SettingNotFound):
        normalize_phone_number(db, raw=CANONICAL)


def test_a_bare_national_number_under_an_unowned_calling_code_raises_the_server_fault(
    db: Session, set_int_setting: Callable[[str, int], None]
) -> None:
    set_int_setting(DEFAULT_COUNTRY_CODE_SETTING, UNOWNED_CALLING_CODE)

    with pytest.raises(PhoneRegionNotConfigured) as exc_info:
        normalize_phone_number(db, raw="202-555-0123")

    assert not isinstance(exc_info.value, InvalidPhoneNumber)


def test_an_explicit_country_code_still_normalizes_under_an_unowned_calling_code(
    db: Session, set_int_setting: Callable[[str, int], None]
) -> None:
    set_int_setting(DEFAULT_COUNTRY_CODE_SETTING, UNOWNED_CALLING_CODE)

    assert normalize_phone_number(db, raw=CANONICAL) == CANONICAL
