"""`twilio_service` (REQ-P7.7): the REST send and the two TwiML builders.

`Client` is monkeypatched with a stub throughout — no test in this module makes a network call.
"""

import json
import socket
from collections.abc import Generator

import pytest
import requests
from twilio.base.exceptions import TwilioRestException, TwilioServiceException
from twilio.http import HttpClient

from app.config import get_settings
from app.services import twilio_service
from app.services.twilio_service import (
    TwilioNotConfigured,
    TwilioSendFailed,
    send_whatsapp_message,
    send_whatsapp_template,
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
CONTENT_SID = "HXtest"
CONTENT_VARIABLES = {"1": "Ana", "2": "Lunes 3 de noviembre"}


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

    def __init__(
        self, account_sid: str, auth_token: str, http_client: HttpClient | None = None
    ) -> None:
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.http_client = http_client
        self.messages = FakeMessages()
        FakeClient.last_instance = self


class FailingMessages:
    def create(self, **kwargs: object) -> FakeMessageInstance:
        raise TwilioRestException(status=400, uri="/Messages", msg="invalid number")


class FailingClient:
    def __init__(self, account_sid: str, auth_token: str, **kwargs: object) -> None:
        self.messages = FailingMessages()


def _client_raising(error: Exception) -> type:
    """A `Client` stand-in whose every send raises `error`."""

    class RaisingMessages:
        def create(self, **kwargs: object) -> FakeMessageInstance:
            raise error

    class RaisingClient:
        def __init__(self, account_sid: str, auth_token: str, **kwargs: object) -> None:
            self.messages = RaisingMessages()

    return RaisingClient


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


@pytest.mark.parametrize("send", ["free-form", "template"])
def test_every_send_is_made_with_a_finite_timeout(
    monkeypatch: pytest.MonkeyPatch, configured: None, send: str
) -> None:
    # Without one the SDK waits forever, holding whatever the caller holds (a row lock, a
    # pooled connection, the scheduler's lock) for as long as Twilio does not answer.
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    if send == "free-form":
        send_whatsapp_message(to=TO, body=BODY)
    else:
        send_whatsapp_template(to=TO, content_sid=CONTENT_SID, content_variables=CONTENT_VARIABLES)

    http_client = FakeClient.last_instance.http_client
    assert http_client is not None
    assert http_client.timeout is not None and 0 < http_client.timeout <= 30


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


def test_template_send_returns_the_message_sid(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    sid = send_whatsapp_template(
        to=TO, content_sid=CONTENT_SID, content_variables=CONTENT_VARIABLES
    )

    assert sid == MESSAGE_SID


def test_template_send_passes_the_content_sid_and_json_variables_without_a_body(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    send_whatsapp_template(to=TO, content_sid=CONTENT_SID, content_variables=CONTENT_VARIABLES)

    call = FakeClient.last_instance.messages.calls[0]
    assert call["to"] == f"whatsapp:{TO}"
    assert call["from_"] == f"whatsapp:{WHATSAPP_NUMBER}"
    assert call["content_sid"] == CONTENT_SID
    assert json.loads(call["content_variables"]) == CONTENT_VARIABLES
    assert "body" not in call


def test_template_send_passes_the_same_status_callback_as_the_free_form_send(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    monkeypatch.setenv("TWILIO_STATUS_CALLBACK_URL", STATUS_CALLBACK_URL)
    get_settings.cache_clear()
    monkeypatch.setattr(twilio_service, "Client", FakeClient)

    send_whatsapp_template(to=TO, content_sid=CONTENT_SID, content_variables=CONTENT_VARIABLES)

    call = FakeClient.last_instance.messages.calls[0]
    assert call["status_callback"] == STATUS_CALLBACK_URL


@pytest.mark.parametrize(
    "missing_env",
    ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_NUMBER"],
)
def test_template_send_refuses_when_a_credential_is_unset(
    monkeypatch: pytest.MonkeyPatch, configured: None, missing_env: str
) -> None:
    monkeypatch.delenv(missing_env, raising=False)
    get_settings.cache_clear()

    with pytest.raises(TwilioNotConfigured):
        send_whatsapp_template(to=TO, content_sid=CONTENT_SID, content_variables=CONTENT_VARIABLES)


def _caused_by(error: Exception, cause: BaseException) -> Exception:
    """`error` chained to `cause` the way `requests` chains urllib3's failure to the socket's."""
    error.__cause__ = cause

    return error


def _rfc9457(*, status: int, code: int) -> TwilioServiceException:
    return TwilioServiceException(
        type_uri="https://www.twilio.com/docs/errors", title="Error", status=status, code=code
    )


@pytest.mark.parametrize(
    ("error", "code", "is_retryable"),
    [
        (TwilioRestException(status=400, uri="/Messages", msg="", code=63016), "63016", False),
        (TwilioRestException(status=400, uri="/Messages", msg="", code=63049), "63049", False),
        (TwilioRestException(status=503, uri="/Messages", msg="", code=20503), "20503", True),
        (TwilioRestException(status=500, uri="/Messages", msg=""), None, True),
        # What the SDK builds from a body it cannot parse: the HTTP status in the code field.
        (TwilioRestException(status=502, uri="/Messages", msg="", code=502), None, True),
        (_rfc9457(status=400, code=63016), "63016", False),
        (_rfc9457(status=503, code=20503), "20503", True),
        (
            _caused_by(requests.ConnectionError("max retries"), ConnectionRefusedError(61, "")),
            None,
            True,
        ),
        (
            _caused_by(requests.ConnectionError("max retries"), socket.gaierror(8, "")),
            None,
            True,
        ),
        # Either can happen after Twilio accepted the message, so a retry could send it twice.
        (requests.ConnectionError("connection reset"), None, False),
        (requests.Timeout("read timed out"), None, False),
        (ValueError("an SDK bug"), None, False),
    ],
    ids=[
        "63016",
        "63049",
        "http-503",
        "http-500-no-code",
        "unparsed-502-body",
        "rfc9457-63016",
        "rfc9457-503",
        "connection-refused",
        "name-not-resolved",
        "connection-reset",
        "read-timeout",
        "unexpected-error",
    ],
)
def test_template_send_failure_carries_the_twilio_code_and_whether_to_retry(
    monkeypatch: pytest.MonkeyPatch,
    configured: None,
    error: Exception,
    code: str | None,
    is_retryable: bool,
) -> None:
    monkeypatch.setattr(twilio_service, "Client", _client_raising(error))

    with pytest.raises(TwilioSendFailed) as raised:
        send_whatsapp_template(to=TO, content_sid=CONTENT_SID, content_variables=CONTENT_VARIABLES)

    assert (raised.value.code, raised.value.is_retryable) == (code, is_retryable)


@pytest.mark.parametrize(
    ("error", "may_have_been_delivered"),
    [
        (TwilioRestException(status=400, uri="/Messages", msg="", code=63016), False),
        (TwilioRestException(status=503, uri="/Messages", msg="", code=20503), False),
        (
            _caused_by(requests.ConnectionError("max retries"), ConnectionRefusedError(61, "")),
            False,
        ),
        (requests.ConnectionError("connection reset"), True),
        (requests.Timeout("read timed out"), True),
        (ValueError("an SDK bug"), True),
    ],
    ids=[
        "63016",
        "http-503",
        "connection-refused",
        "connection-reset",
        "read-timeout",
        "unexpected-error",
    ],
)
def test_a_send_failure_says_whether_twilio_may_have_accepted_the_message(
    monkeypatch: pytest.MonkeyPatch,
    configured: None,
    error: Exception,
    may_have_been_delivered: bool,
) -> None:
    monkeypatch.setattr(twilio_service, "Client", _client_raising(error))

    with pytest.raises(TwilioSendFailed) as raised:
        send_whatsapp_template(to=TO, content_sid=CONTENT_SID, content_variables=CONTENT_VARIABLES)

    assert raised.value.may_have_been_delivered is may_have_been_delivered


def test_free_form_send_failure_carries_the_twilio_code(
    monkeypatch: pytest.MonkeyPatch, configured: None
) -> None:
    error = TwilioRestException(status=400, uri="/Messages", msg="", code=63016)
    monkeypatch.setattr(twilio_service, "Client", _client_raising(error))

    with pytest.raises(TwilioSendFailed) as raised:
        send_whatsapp_message(to=TO, body=BODY)

    assert (raised.value.code, raised.value.is_retryable) == ("63016", False)


@pytest.mark.parametrize(
    "error",
    [
        TwilioRestException(status=400, uri="/Messages", msg=f"bad number whatsapp:{TO}", code=1),
        requests.ConnectionError("connection reset"),
        ValueError("an SDK bug"),
    ],
    ids=["refused", "network", "unexpected"],
)
def test_a_send_failure_never_names_the_recipient(
    monkeypatch: pytest.MonkeyPatch, configured: None, error: Exception
) -> None:
    monkeypatch.setattr(twilio_service, "Client", _client_raising(error))

    with pytest.raises(TwilioSendFailed) as raised:
        send_whatsapp_message(to=TO, body=BODY)

    assert TO not in str(raised.value)


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
