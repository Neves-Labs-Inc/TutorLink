"""`fake_twilio`: the stand-in for Twilio's REST sends and the signer of its status callbacks.

No test may reach Twilio. As a backstop, the fixture also replaces `twilio_service.Client`, so a
send from a module missing from `SEND_CALLERS`, or one made through `twilio_service` itself,
fails the test instead of reaching the real REST client. The fake replaces `send_whatsapp_message` and `send_whatsapp_template`
on every module in `SEND_CALLERS`, at the name that module imported, because a `from` import
binds the function at import time and patching `twilio_service` itself would not be seen. A
ticket that adds a caller adds its dotted path to `SEND_CALLERS`.

Registered for every test by the import in `tests/conftest.py`.
"""

import importlib
import itertools
from collections.abc import Generator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from twilio.request_validator import RequestValidator

from app.config import get_settings
from app.services import twilio_service
from app.services.twilio_service import TwilioSendFailed

SEND_CALLERS = (
    "app.routers.conversation_stream",
    "app.services.notice_service",
    "app.services.webhook_service",
)
SEND_FUNCTION_NAMES = ("send_whatsapp_message", "send_whatsapp_template")

CODE_OUTSIDE_WINDOW = "63016"
CODE_UNDELIVERABLE = "63049"
OPT_OUT_CODES = ("63050", "63033")
SERVER_ERROR_CODE = "20500"

TEST_AUTH_TOKEN = "fake-twilio-auth-token"
TEST_ACCOUNT_SID = "AC00000000000000000000000000000000"
AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN"
STATUS_CALLBACK_PATH = "/webhook/whatsapp/status"
INBOUND_PATH = "/webhook/whatsapp"
# What `TestClient` puts in the request URL, and so what the route checks the signature against.
TEST_CLIENT_BASE_URL = "http://testserver"
SIGNATURE_HEADER = "X-Twilio-Signature"


@dataclass(frozen=True)
class SentMessage:
    """One accepted send: `body` for free-form, `content_sid` + `content_variables` for templates."""

    sid: str
    to: str
    body: str | None = None
    content_sid: str | None = None
    content_variables: dict[str, str] | None = None


class FakeTwilio:
    def __init__(self) -> None:
        self.sent: list[SentMessage] = []
        self._failures: list[TwilioSendFailed] = []
        self._sid_numbers = itertools.count(1)

    def send_whatsapp_message(self, *, to: str, body: str) -> str:
        return self._accept(to=to, body=body)

    def send_whatsapp_template(
        self, *, to: str, content_sid: str, content_variables: dict[str, str]
    ) -> str:
        return self._accept(
            to=to, content_sid=content_sid, content_variables=dict(content_variables)
        )

    def fail_next(self, *, code: str, times: int = 1) -> None:
        """Refuse the next `times` sends with Twilio error `code`, as a 4xx the caller can't retry."""
        self._arm(code=code, is_retryable=False, times=times)

    def fail_next_with_server_error(self, *, times: int = 1) -> None:
        """Fail the next `times` sends the way a Twilio 5xx does: retryable."""
        self._arm(code=SERVER_ERROR_CODE, is_retryable=True, times=times)

    def post_status(
        self, client: TestClient, *, sid: str, status: str, error_code: str | None = None
    ) -> Response:
        """Post a status callback to the real route, signed the way Twilio signs it."""
        form = {"MessageSid": sid, "MessageStatus": status, "AccountSid": TEST_ACCOUNT_SID}
        if error_code is not None:
            form["ErrorCode"] = error_code
        signature = RequestValidator(TEST_AUTH_TOKEN).compute_signature(
            TEST_CLIENT_BASE_URL + STATUS_CALLBACK_PATH, form
        )

        return client.post(STATUS_CALLBACK_PATH, data=form, headers={SIGNATURE_HEADER: signature})

    def post_inbound(
        self, client: TestClient, *, from_number: str, body: str, sid: str
    ) -> Response:
        """Post one inbound WhatsApp message to the real webhook route, signed like Twilio's."""
        form = {
            "From": f"whatsapp:{from_number}",
            "Body": body,
            "MessageSid": sid,
            "AccountSid": TEST_ACCOUNT_SID,
        }
        signature = RequestValidator(TEST_AUTH_TOKEN).compute_signature(
            TEST_CLIENT_BASE_URL + INBOUND_PATH, form
        )

        return client.post(INBOUND_PATH, data=form, headers={SIGNATURE_HEADER: signature})

    def _arm(self, *, code: str, is_retryable: bool, times: int) -> None:
        failure = TwilioSendFailed(
            f"fake Twilio refused the send with {code}", code=code, is_retryable=is_retryable
        )
        self._failures.extend([failure] * times)

    def _accept(self, *, to: str, **content: object) -> str:
        if self._failures:
            raise self._failures.pop(0)

        sid = f"SM{next(self._sid_numbers):032d}"
        self.sent.append(SentMessage(sid=sid, to=to, **content))

        return sid


def install(monkeypatch: pytest.MonkeyPatch, fake: FakeTwilio, callers: tuple[str, ...]) -> None:
    """Point each caller's imported send functions at `fake`."""
    for dotted_path in callers:
        module = importlib.import_module(dotted_path)
        names = [name for name in SEND_FUNCTION_NAMES if hasattr(module, name)]
        # A listed caller that imports neither send is a stale entry, and would hide a real send.
        assert names, f"{dotted_path} imports no Twilio send function"
        for name in names:
            monkeypatch.setattr(module, name, getattr(fake, name))


def _refuse_real_client(*args: object, **kwargs: object) -> object:
    raise AssertionError(
        "a test reached the real Twilio client; add the calling module to SEND_CALLERS"
    )


@pytest.fixture
def fake_twilio(monkeypatch: pytest.MonkeyPatch) -> Generator[FakeTwilio, None, None]:
    """A `FakeTwilio` installed on every caller, with the auth token its callbacks are signed by.

    The settings cache is cleared on both sides: it is process-wide, and a token left in it
    would reach tests that assert on an unconfigured deployment.
    """
    fake = FakeTwilio()
    install(monkeypatch, fake, SEND_CALLERS)
    monkeypatch.setattr(twilio_service, "Client", _refuse_real_client)
    monkeypatch.setenv(AUTH_TOKEN_ENV, TEST_AUTH_TOKEN)
    get_settings.cache_clear()
    try:
        yield fake
    finally:
        get_settings.cache_clear()
