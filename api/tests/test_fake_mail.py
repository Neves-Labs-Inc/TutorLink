"""The `fake_mail` test double: what later tickets rely on when they send email.

`fake_mail` is autouse, so no test here requests it by name except to hold the instance. The
send tests call `mail_service.send_email` through the module attribute, the reference a caller
that imports the module reaches, so a fixture that patched the wrong place would fail here first.
"""

import smtplib

import pytest

from app.config import get_settings
from app.services import mail_service
from app.services.mail_service import MailSendFailed
from tests.fake_mail import FakeMail, SentEmail, token_from

TO = "ana@example.com"
SUBJECT = "You're invited"
TEXT = "Hola"
HTML = "<p>Hola</p>"


def test_sends_are_recorded_in_order(fake_mail: FakeMail) -> None:
    mail_service.send_email(to=TO, subject=SUBJECT, text=TEXT, html=HTML)
    mail_service.send_email(to=TO, subject="Reminder", text="Adiós")

    assert fake_mail.sent == [
        SentEmail(to=TO, subject=SUBJECT, text=TEXT, html=HTML),
        SentEmail(to=TO, subject="Reminder", text="Adiós", html=None),
    ]


def test_an_armed_fake_raises_for_the_next_sends_only_and_records_none_of_them(
    fake_mail: FakeMail,
) -> None:
    fake_mail.fail_next(times=2)

    for _ in range(2):
        with pytest.raises(MailSendFailed):
            mail_service.send_email(to=TO, subject=SUBJECT, text=TEXT)

    mail_service.send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert [email.subject for email in fake_mail.sent] == [SUBJECT]


def test_a_direct_smtp_construction_fails_the_test(
    monkeypatch: pytest.MonkeyPatch, fake_mail: FakeMail
) -> None:
    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("MAIL_FROM", "office@example.com")
    get_settings.cache_clear()
    try:
        with pytest.raises(AssertionError, match="real SMTP"):
            smtplib.SMTP("smtp.example.com", 587, timeout=1)
    finally:
        get_settings.cache_clear()

    assert fake_mail.sent == []


def test_token_from_reads_the_first_set_password_link() -> None:
    email = SentEmail(
        to=TO,
        subject=SUBJECT,
        text=(
            "Choose a password at http://testserver/set-password?token=abc-123&lang=es\n"
            "Not this one: http://testserver/set-password?token=other"
        ),
        html=None,
    )

    assert token_from(email) == "abc-123"


@pytest.mark.parametrize("trailing", [".", ",", ")", ")."])
def test_token_from_leaves_the_sentence_punctuation_behind(trailing: str) -> None:
    email = SentEmail(
        to=TO,
        subject=SUBJECT,
        text=f"Open http://testserver/set-password?token=abc-123{trailing} Hurry.",
        html=None,
    )

    assert token_from(email) == "abc-123"


def test_token_from_fails_when_the_email_carries_no_link() -> None:
    email = SentEmail(to=TO, subject=SUBJECT, text="no link here", html=None)

    with pytest.raises(AssertionError, match="set-password"):
        token_from(email)
