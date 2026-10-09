"""`mail_service`: the one SMTP send and the public-link builder.

`smtplib.SMTP` is monkeypatched with a stub throughout: no test in this module opens a socket.
`send_email` is bound here at import time, before the autouse `fake_mail` fixture replaces the
module attribute, so these tests drive the real function.
"""

import smtplib
from collections.abc import Generator
from email.message import EmailMessage

import pytest

from app.config import get_settings
from app.services.mail_service import (
    MailInsecureTransport,
    MailNotConfigured,
    MailSendFailed,
    SEND_TIMEOUT_SECONDS,
    public_url,
    send_email,
)

SMTP_HOST = "smtp.example.com"
SMTP_PORT = "2525"
SMTP_USERNAME = "office@example.com"
SMTP_PASSWORD = "app-password"
MAIL_FROM = "TutorLink <office@example.com>"
TO = "ana@example.com"
SUBJECT = "Set your TutorLink password"
TEXT = "Open https://tutorlink.example.com/set-password?token=abc to choose a password."
HTML = "<p>Open <a href='https://tutorlink.example.com/set-password?token=abc'>this</a>.</p>"
PUBLIC_BASE_URL = "https://tutorlink.example.com"


class StubSMTP:
    """Records the session `send_email` drives; offers STARTTLS unless told otherwise."""

    last_instance: "StubSMTP | None" = None
    offers_starttls = True
    failure: Exception | None = None
    quit_failure: Exception | None = None

    def __init__(self, host: str, port: int = 0, timeout: float | None = None) -> None:
        self.host = host
        self.port = port
        self.timeout = timeout
        self.calls: list[str] = []
        self.login_args: tuple[str, str] | None = None
        self.starttls_context: object = None
        self.message: EmailMessage | None = None
        type(self).last_instance = self

    def ehlo(self) -> None:
        self.calls.append("ehlo")

    def has_extn(self, name: str) -> bool:
        return name == "starttls" and self.offers_starttls

    def starttls(self, *, context: object = None) -> None:
        self.calls.append("starttls")
        self.starttls_context = context

    def login(self, user: str, password: str) -> None:
        self.calls.append("login")
        self.login_args = (user, password)

    def send_message(self, message: EmailMessage) -> None:
        self.calls.append("send_message")
        if self.failure is not None:
            raise self.failure
        self.message = message

    def quit(self) -> None:
        self.calls.append("quit")
        if self.quit_failure is not None:
            raise self.quit_failure


@pytest.fixture
def smtp(monkeypatch: pytest.MonkeyPatch) -> type[StubSMTP]:
    """A fresh `StubSMTP` class installed in place of `smtplib.SMTP`."""

    class FreshStub(StubSMTP):
        last_instance = None
        offers_starttls = True
        failure = None
        quit_failure = None

    monkeypatch.setattr(smtplib, "SMTP", FreshStub)

    return FreshStub


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    """Full SMTP configuration in the environment, with the settings cache cleared both ways."""
    monkeypatch.setenv("SMTP_HOST", SMTP_HOST)
    monkeypatch.setenv("SMTP_PORT", SMTP_PORT)
    monkeypatch.setenv("SMTP_USERNAME", SMTP_USERNAME)
    monkeypatch.setenv("SMTP_PASSWORD", SMTP_PASSWORD)
    monkeypatch.setenv("MAIL_FROM", MAIL_FROM)
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


@pytest.fixture
def unconfigured(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    for name in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "MAIL_FROM", "PUBLIC_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


@pytest.mark.usefixtures("unconfigured")
def test_an_unconfigured_deployment_is_refused_before_any_socket_is_opened(
    smtp: type[StubSMTP],
) -> None:
    with pytest.raises(MailNotConfigured):
        send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert smtp.last_instance is None


@pytest.mark.usefixtures("configured")
@pytest.mark.parametrize("missing", ["SMTP_HOST", "MAIL_FROM"])
def test_either_host_or_from_address_missing_is_refused(
    monkeypatch: pytest.MonkeyPatch, smtp: type[StubSMTP], missing: str
) -> None:
    monkeypatch.delenv(missing)
    get_settings.cache_clear()

    with pytest.raises(MailNotConfigured):
        send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert smtp.last_instance is None


@pytest.mark.usefixtures("configured")
def test_a_configured_send_drives_a_tls_login_session_and_quits(smtp: type[StubSMTP]) -> None:
    send_email(to=TO, subject=SUBJECT, text=TEXT, html=HTML)

    session = smtp.last_instance
    assert session is not None
    assert (session.host, session.port, session.timeout) == (
        SMTP_HOST,
        int(SMTP_PORT),
        SEND_TIMEOUT_SECONDS,
    )
    assert session.calls == ["ehlo", "starttls", "ehlo", "login", "send_message", "quit"]
    assert session.login_args == (SMTP_USERNAME, SMTP_PASSWORD)
    assert session.starttls_context is not None


@pytest.mark.usefixtures("configured")
def test_the_message_carries_from_to_subject_and_both_parts(smtp: type[StubSMTP]) -> None:
    send_email(to=TO, subject=SUBJECT, text=TEXT, html=HTML)

    message = smtp.last_instance.message
    assert message is not None
    assert (message["From"], message["To"], message["Subject"]) == (MAIL_FROM, TO, SUBJECT)
    assert message.get_content_type() == "multipart/alternative"
    parts = {part.get_content_type(): part.get_content() for part in message.iter_parts()}
    assert parts == {"text/plain": TEXT + "\n", "text/html": HTML + "\n"}


@pytest.mark.usefixtures("configured")
def test_a_text_only_send_is_a_single_plain_part(smtp: type[StubSMTP]) -> None:
    send_email(to=TO, subject=SUBJECT, text=TEXT)

    message = smtp.last_instance.message
    assert message is not None
    assert message.get_content_type() == "text/plain"
    assert message.get_content() == TEXT + "\n"


@pytest.mark.usefixtures("configured")
def test_a_username_without_a_password_is_refused_as_misconfigured(
    monkeypatch: pytest.MonkeyPatch, smtp: type[StubSMTP]
) -> None:
    monkeypatch.delenv("SMTP_PASSWORD")
    get_settings.cache_clear()

    with pytest.raises(MailNotConfigured):
        send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert smtp.last_instance is None


@pytest.mark.usefixtures("configured")
def test_credentials_are_never_sent_when_the_server_offers_no_starttls(
    smtp: type[StubSMTP],
) -> None:
    smtp.offers_starttls = False

    with pytest.raises(MailInsecureTransport):
        send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert smtp.last_instance.calls == ["ehlo", "quit"]


@pytest.mark.usefixtures("configured")
def test_a_credential_less_relay_without_starttls_is_used_in_the_clear(
    monkeypatch: pytest.MonkeyPatch, smtp: type[StubSMTP]
) -> None:
    monkeypatch.delenv("SMTP_USERNAME")
    monkeypatch.delenv("SMTP_PASSWORD")
    get_settings.cache_clear()
    smtp.offers_starttls = False

    send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert smtp.last_instance.calls == ["ehlo", "send_message", "quit"]


@pytest.mark.usefixtures("configured")
def test_no_username_means_no_login(monkeypatch: pytest.MonkeyPatch, smtp: type[StubSMTP]) -> None:
    monkeypatch.delenv("SMTP_USERNAME")
    monkeypatch.delenv("SMTP_PASSWORD")
    get_settings.cache_clear()

    send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert "login" not in smtp.last_instance.calls


@pytest.mark.usefixtures("configured")
@pytest.mark.parametrize(
    "subject",
    [pytest.param("Hola\nBcc: eve@example.com", id="linefeed"), pytest.param("Hola\r", id="cr")],
)
def test_a_header_with_a_line_break_is_a_failed_send_not_a_crash(
    smtp: type[StubSMTP], subject: str
) -> None:
    with pytest.raises(MailSendFailed):
        send_email(to=TO, subject=subject, text=TEXT)

    assert smtp.last_instance is None or "send_message" not in smtp.last_instance.calls


@pytest.mark.usefixtures("configured")
@pytest.mark.parametrize(
    "to",
    [
        pytest.param("ana@example.com, eve@example.com", id="comma"),
        pytest.param("ana@example.com eve@example.com", id="space"),
        pytest.param("", id="empty"),
    ],
)
def test_more_or_fewer_than_one_recipient_is_a_caller_bug(smtp: type[StubSMTP], to: str) -> None:
    with pytest.raises(ValueError, match="one recipient"):
        send_email(to=to, subject=SUBJECT, text=TEXT)

    assert smtp.last_instance is None


@pytest.mark.usefixtures("configured")
def test_a_failed_quit_after_a_delivered_send_is_not_a_failure(smtp: type[StubSMTP]) -> None:
    smtp.quit_failure = smtplib.SMTPResponseException(421, b"closing")

    send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert smtp.last_instance.message is not None


@pytest.mark.usefixtures("configured")
@pytest.mark.parametrize(
    "failure",
    [
        pytest.param(
            smtplib.SMTPRecipientsRefused({TO: (550, b"5.1.1 user unknown")}),
            id="recipient-refused",
        ),
        pytest.param(smtplib.SMTPServerDisconnected("connection lost"), id="disconnected"),
        pytest.param(ConnectionRefusedError(111, "refused"), id="unreachable"),
        pytest.param(TimeoutError("timed out"), id="timeout"),
    ],
)
def test_an_smtp_or_socket_error_becomes_mail_send_failed_without_the_recipient(
    smtp: type[StubSMTP], failure: Exception
) -> None:
    smtp.failure = failure

    with pytest.raises(MailSendFailed) as raised:
        send_email(to=TO, subject=SUBJECT, text=TEXT)

    assert TO not in str(raised.value)
    assert raised.value.__cause__ is failure


def test_public_url_joins_the_base_and_a_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PUBLIC_BASE_URL", PUBLIC_BASE_URL + "/")
    get_settings.cache_clear()
    try:
        assert public_url("/set-password?token=abc") == f"{PUBLIC_BASE_URL}/set-password?token=abc"
        assert public_url("set-password?token=abc") == f"{PUBLIC_BASE_URL}/set-password?token=abc"
    finally:
        get_settings.cache_clear()


@pytest.mark.usefixtures("unconfigured")
def test_public_url_refuses_when_the_base_url_is_unset() -> None:
    with pytest.raises(MailNotConfigured):
        public_url("/set-password?token=abc")
