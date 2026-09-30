"""`twilio_service` (REQ-P7.7): the REST send and the two TwiML builders.

`Client` is monkeypatched with a stub throughout — no test in this module makes a network call.
"""

from collections.abc import Generator

import pytest
from twilio.base.exceptions import TwilioRestException

from app.config import get_settings
from app.services import twilio_service
from app.services.twilio_service import (
    TwilioNotConfigured,
    TwilioSendFailed,
    send_whatsapp_message,
    twiml_empty,
    twiml_reply,
)

ACCOUNT_SID = "ACtest"
AUTH_TOKEN = "tokentest"
WHATSAPP_NUMBER = "+15550001111"
STATUS_CALLBACK_URL = "https://example.com/webhook/whatsapp/status"
TO = "+15550002222"
BODY = "Your session is confirmed."
MESSAGE_SID = "SMtest"


class FakeMessageInstance:
    def __init__(self, *, sid: str) -> None:
        self.sid = sid


class FakeMessages:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def create(self, **kwargs: object) -> FakeMessageInstance:
        self.calls.append(kwargs)
        return FakeMessageInstance(sid=MESSAGE_SID)


class FakeClient:
    last_instance: "FakeClient | None" = None

    def __init__(self, account_sid: str, auth_token: str) -> None:
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.messages = FakeMessages()
        FakeClient.last_instance = self


class FailingMessages:
    def create(self, **kwargs: object) -> FakeMessageInstance:
        raise TwilioRestException(status=400, uri="/Messages", msg="invalid number")


class FailingClient:
    def __init__(self, account_sid: str, auth_token: str) -> None:
        self.messages = FailingMessages()


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", ACCOUNT_SID)
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", AUTH_TOKEN)
    monkeypatch.setenv("TWILIO_WHATSAPP_NUMBER", WHATSAPP_NUMBER)
    monkeypatch.delenv("TWILIO_STATUS_CALLBACK_URL", raising=False)
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


def test_send_returns_the_message_sid(monkeypatch: pytest.MonkeyPatch, configured: None) -> None:
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    assert send_whatsapp_message(to=TO, body=BODY) == MESSAGE_SID


def test_send_addresses_to_and_from_on_the_whatsapp_channel(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    send_whatsapp_message(to=TO, body=BODY)

    call = FakeClient.last_instance.messages.calls[0]
    assert call["to"] == f"whatsapp:{TO}"
    assert call["from_"] == f"whatsapp:{WHATSAPP_NUMBER}"
    assert call["body"] == BODY


def test_send_passes_status_callback_when_the_setting_is_present(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    monkeypatch.setenv("TWILIO_STATUS_CALLBACK_URL", STATUS_CALLBACK_URL)
    get_settings.cache_clear()
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    send_whatsapp_message(to=TO, body=BODY)

    call = FakeClient.last_instance.messages.calls[0]
    assert call["status_callback"] == STATUS_CALLBACK_URL


def test_send_omits_status_callback_when_the_setting_is_absent(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    send_whatsapp_message(to=TO, body=BODY)

    call = FakeClient.last_instance.messages.calls[0]
    assert "status_callback" not in call


@pytest.mark.parametrize(
    "missing_env",
    ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_NUMBER"],
)
def test_send_refuses_with_a_distinct_error_when_a_credential_is_unset(
    monkeypatch: pytest.MonkeyPatch, configured: None, missing_env: str
) -> None:
    monkeypatch.delenv(missing_env, raising=False)
    get_settings.cache_clear()

    with pytest.raises(TwilioNotConfigured):
        send_whatsapp_message(to=TO, body=BODY)


def test_send_wraps_a_twilio_failure_as_a_domain_exception(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    monkeypatch.setattr(twilio_service, "Client", FailingClient)

    with pytest.raises(TwilioSendFailed):
        send_whatsapp_message(to=TO, body=BODY)


def test_twiml_empty_is_byte_for_byte() -> None:
    assert twiml_empty() == "<Response></Response>"


def test_twiml_reply_wraps_the_body() -> None:
    assert twiml_reply("hi") == "<Response><Message>hi</Message></Response>"


@pytest.mark.parametrize(
    ("raw", "escaped"),
    [
        ("A & B", "A &amp; B"),
        ("<script>", "&lt;script&gt;"),
        ('say "hi"', "say &quot;hi&quot;"),
        ("it's", "it&apos;s"),
    ],
)
def test_twiml_reply_escapes_special_characters(raw: str, escaped: str) -> None:
    assert twiml_reply(raw) == f"<Response><Message>{escaped}</Message></Response>"
