"""Sending an outbound WhatsApp message (free-form or approved template) through Twilio's REST
API, and building the two TwiML responses the webhook returns.

Two mechanisms, two status lifecycles (amendment P7-3, `docs/erd.md:349-356`,
`docs/api-design.md:527-534`). `send_whatsapp_message` is the REST path: it starts a message
`queued`, and `POST /webhook/whatsapp/status` advances it to `sent`/`delivered`/`failed` once
Twilio calls back with the `MessageSid` this function returns. A bot reply never calls this
function — it goes out as `twiml_reply`'s TwiML in the webhook's own response, and Twilio does
not mint a `MessageSid` for it until after reading that response, so a bot reply is recorded
`status = 'sent'` with `twilio_sid` NULL and never reaches the status callback. Mixing the two up
leaves every bot reply stuck `queued` forever.

No FastAPI import, no `Session` parameter: this module raises the domain exceptions below and
knows nothing about routers, sockets or the database.
"""

import json
import logging
import socket
from xml.sax.saxutils import escape

from twilio.base.exceptions import TwilioRestException, TwilioServiceException
from twilio.http.http_client import TwilioHttpClient
from twilio.rest import Client

from app.config import get_settings

HTTP_SERVER_ERROR = 500
# The SDK's default is no timeout at all. A hung send would hold whatever its caller holds (a
# reminder's row lock, a pooled connection, the scheduler's lock) until the process restarts. A
# timeout surfaces as a read timeout, which is never retried, so it cannot cause a duplicate.
SEND_TIMEOUT_SECONDS = 15.0

# The socket-level causes that prove the request never left this host: nothing reached Twilio,
# so sending again cannot deliver the message twice.
_NEVER_SENT_CAUSES = (ConnectionRefusedError, socket.gaierror)

logger = logging.getLogger(__name__)


class TwilioServiceError(Exception):
    """Base class for every failure this module reports."""


class TwilioNotConfigured(TwilioServiceError):
    """`twilio_account_sid`, `twilio_auth_token` or `twilio_whatsapp_number` is unset.

    A deployment missing any of these is a configuration bug, not a runtime one, so it is
    refused here rather than left for the Twilio SDK to fail on obscurely.
    """


class TwilioSendFailed(TwilioServiceError):
    """Twilio rejected the send or could not be reached.

    `code` is Twilio's own error code (`"63016"`: outside the 24-hour window), stored on the
    failed message so the dashboard can say why; `None` when Twilio sent no code or was never
    reached. `is_retryable` is true only for an HTTP 5xx or a connection that was never made
    (refused, or the host name did not resolve): the failures a later attempt can fix without
    risking a second copy. A 4xx is Twilio's final answer about this send. A read timeout or a
    connection reset is not retryable, because either can happen after Twilio accepted the
    message, and a retry would then send the Guardian a duplicate.

    `may_have_been_delivered` is true when the outcome is unknown rather than a refusal: a read
    timeout, a reset, or an unexpected client error, any of which can follow Twilio accepting
    the message. Callers record it apart from a definite failure, so Staff do not resend blindly.

    The message never names the recipient: callers log it, and a phone number does not belong
    in the logs.
    """

    def __init__(
        self,
        message: str,
        *,
        code: str | None,
        is_retryable: bool,
        may_have_been_delivered: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.is_retryable = is_retryable
        self.may_have_been_delivered = may_have_been_delivered


def send_whatsapp_message(*, to: str, body: str) -> str:
    return _create_message(to=to, body=body)


def send_whatsapp_template(*, to: str, content_sid: str, content_variables: dict[str, str]) -> str:
    """Send an approved WhatsApp template, the only kind allowed outside the 24-hour window.

    Twilio takes the variables as one JSON string keyed by placeholder (`{"1": "Ana"}`).
    """
    return _create_message(
        to=to, content_sid=content_sid, content_variables=json.dumps(content_variables)
    )


def _create_message(*, to: str, **content: str) -> str:
    """The one REST send both public functions share: credentials, addressing, callback, errors."""
    settings = get_settings()

    if not (
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_whatsapp_number
    ):
        raise TwilioNotConfigured(
            "twilio_account_sid, twilio_auth_token or twilio_whatsapp_number is unset"
        )

    client = Client(
        settings.twilio_account_sid,
        settings.twilio_auth_token,
        http_client=TwilioHttpClient(timeout=SEND_TIMEOUT_SECONDS),
    )
    kwargs = {}
    if settings.twilio_status_callback_url:
        kwargs["status_callback"] = settings.twilio_status_callback_url

    # The exception's own text is never copied into ours: Twilio's refusal quotes the `To`
    # number. Callers therefore log our message without the traceback.
    try:
        message = client.messages.create(
            to=f"whatsapp:{to}",
            from_=f"whatsapp:{settings.twilio_whatsapp_number}",
            **content,
            **kwargs,
        )
    except (TwilioRestException, TwilioServiceException) as exc:
        raise TwilioSendFailed(
            f"Twilio refused the WhatsApp message (HTTP {exc.status})",
            code=_twilio_code(exc.code, status=exc.status),
            is_retryable=exc.status >= HTTP_SERVER_ERROR,
        ) from exc
    except OSError as exc:
        # The SDK lets `requests`' connection errors and timeouts through unwrapped; every one
        # of them is an `OSError`.
        was_never_sent = _was_never_sent(exc)
        raise TwilioSendFailed(
            "could not reach Twilio to send the WhatsApp message",
            code=None,
            is_retryable=was_never_sent,
            may_have_been_delivered=not was_never_sent,
        ) from exc
    except Exception as exc:
        # Anything else is a bug in the SDK or here. It still has to end as a failed send, or the
        # caller's queued row would wait for a callback that can never come.
        logger.error("unexpected %s from the Twilio client", type(exc).__name__)
        raise TwilioSendFailed(
            "unexpected error sending the WhatsApp message",
            code=None,
            is_retryable=False,
            may_have_been_delivered=True,
        ) from exc

    return message.sid


def _twilio_code(code: int | None, *, status: int) -> str | None:
    """Twilio's error code, or `None` when the SDK filled the field from the HTTP status because
    it could not parse the body (a gateway's HTML 502): that is not a Twilio code."""
    if code is None or code == status:
        result = None
    else:
        result = str(code)

    return result


def _was_never_sent(error: BaseException) -> bool:
    """Whether the socket-level cause in `error`'s chain shows the request never left."""
    seen: list[BaseException] = []
    current: BaseException | None = error
    while current is not None and current not in seen:
        seen.append(current)
        current = current.__cause__ or current.__context__

    return any(isinstance(link, _NEVER_SENT_CAUSES) for link in seen)


def twiml_reply(body: str) -> str:
    return f"<Response><Message>{escape(body, {'"': '&quot;', "'": '&apos;'})}</Message></Response>"


def twiml_empty() -> str:
    """`<Response></Response>` exactly.

    Twilio treats a non-200 or an unparseable body as a failed delivery and retries forever, so
    "say nothing" has to be a valid TwiML instruction, never an empty body (`api-design.md:497-502`).
    """
    return "<Response></Response>"
