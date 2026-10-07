"""`python -m app.cli send-test-reminder`: one real reminder template to a developer's phone.

Driven through `main`, on the rolled-back `db` (prior art: `test_cli_seed.py`), with
`fake_twilio` standing in for the send and the business clock frozen on Wednesday 2026-10-14,
so the sample week is Monday 2026-10-19.
"""

import datetime
from collections.abc import Callable

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import app.cli as cli_module
from app.cli import main
from app.models.booking_reminder import BookingReminder
from app.models.enums import Language
from app.models.message import Message
from tests.fake_twilio import FakeTwilio, SentMessage
from tests.test_reminder_service import EN_SID, ES_SID, set_template_sid

TO = "+12025550188"


@pytest.fixture(autouse=True)
def cli_db(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
    freeze_business_clock: Callable[[datetime.datetime], None],
) -> None:
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)
    freeze_business_clock(datetime.datetime(2026, 10, 14, 9, 0))


def _count(db: Session, model: type[BookingReminder] | type[Message]) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


@pytest.mark.parametrize(
    ("language", "sid", "variables"),
    [
        ("en", EN_SID, {"1": "Ana and Luis", "2": "October 19"}),
        ("es", ES_SID, {"1": "Ana y Luis", "2": "19 de octubre"}),
    ],
)
def test_sends_the_real_template_with_sample_variables_and_prints_the_sid(
    db: Session,
    fake_twilio: FakeTwilio,
    capsys: pytest.CaptureFixture[str],
    language: str,
    sid: str,
    variables: dict[str, str],
) -> None:
    set_template_sid(db, Language(language), sid)
    reminders, messages = _count(db, BookingReminder), _count(db, Message)

    exit_code = main(["send-test-reminder", "--to", TO, "--language", language])

    assert exit_code == 0
    assert fake_twilio.sent == [
        SentMessage(
            sid=fake_twilio.sent[0].sid, to=TO, content_sid=sid, content_variables=variables
        )
    ]
    assert fake_twilio.sent[0].sid in capsys.readouterr().out
    assert (_count(db, BookingReminder), _count(db, Message)) == (reminders, messages)


def test_a_blank_template_sid_exits_non_zero_and_sends_nothing(
    db: Session, fake_twilio: FakeTwilio, capsys: pytest.CaptureFixture[str]
) -> None:
    set_template_sid(db, Language.EN, EN_SID)
    set_template_sid(db, Language.ES, "  ")

    exit_code = main(["send-test-reminder", "--to", TO, "--language", "es"])

    assert exit_code != 0
    assert fake_twilio.sent == []
    assert "reminder_template_sid_es" in capsys.readouterr().err


def test_a_failed_send_exits_non_zero_with_the_code(
    db: Session, fake_twilio: FakeTwilio, capsys: pytest.CaptureFixture[str]
) -> None:
    set_template_sid(db, Language.EN, EN_SID)
    fake_twilio.fail_next(code="63016")

    exit_code = main(["send-test-reminder", "--to", TO, "--language", "en"])

    assert exit_code != 0
    assert "63016" in capsys.readouterr().err


def test_an_invalid_phone_number_exits_non_zero(
    db: Session, fake_twilio: FakeTwilio, capsys: pytest.CaptureFixture[str]
) -> None:
    set_template_sid(db, Language.EN, EN_SID)

    exit_code = main(["send-test-reminder", "--to", "not a phone", "--language", "en"])

    assert exit_code != 0
    assert fake_twilio.sent == []
    assert capsys.readouterr().err


def test_a_default_country_code_with_no_region_exits_non_zero_without_a_traceback(
    db: Session,
    fake_twilio: FakeTwilio,
    capsys: pytest.CaptureFixture[str],
    set_int_setting: Callable[[str, int], None],
) -> None:
    set_template_sid(db, Language.EN, EN_SID)
    # No region owns calling code 999, so a number without a leading + cannot be read.
    set_int_setting("default_phone_country_code", 999)

    exit_code = main(["send-test-reminder", "--to", "2025550188", "--language", "en"])

    err = capsys.readouterr().err
    assert exit_code == 1
    assert fake_twilio.sent == []
    assert "default_phone_country_code" in err
    assert "Traceback" not in err
