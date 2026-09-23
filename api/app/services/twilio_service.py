"""Sending an outbound WhatsApp message through Twilio's REST API, and building the two TwiML
responses the webhook returns.

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

from xml.sax.saxutils import escape

from twilio.base.exceptions import TwilioException
from twilio.rest import Client

from app.config import get_settings


class TwilioServiceError(Exception):
    """Base class for every failure this module reports."""


class TwilioNotConfigured(TwilioServiceError):
    """`twilio_account_sid`, `twilio_auth_token` or `twilio_whatsapp_number` is unset.

    A deployment missing any of these is a configuration bug, not a runtime one, so it is
    refused here rather than left for the Twilio SDK to fail on obscurely.
    """


class TwilioSendFailed(TwilioServiceError):
    """Twilio rejected the send or could not be reached."""


def send_whatsapp_message(*, to: str, body: str) -> str:
    settings = get_settings()

    if not (
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_whatsapp_number
    ):
        raise TwilioNotConfigured(
            "twilio_account_sid, twilio_auth_token or twilio_whatsapp_number is unset"
        )

    client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    kwargs = {}
    if settings.twilio_status_callback_url:
        kwargs["status_callback"] = settings.twilio_status_callback_url

    try:
        message = client.messages.create(
            to=f"whatsapp:{to}",
            from_=f"whatsapp:{settings.twilio_whatsapp_number}",
            body=body,
            **kwargs,
        )
    except TwilioException as exc:
        raise TwilioSendFailed(f"failed to send WhatsApp message to {to!r}") from exc

    return message.sid


def twiml_reply(body: str) -> str:
    return f"<Response><Message>{escape(body, {'"': '&quot;', "'": '&apos;'})}</Message></Response>"


def twiml_empty() -> str:
    """`<Response></Response>` exactly.

    Twilio treats a non-200 or an unparseable body as a failed delivery and retries forever, so
    "say nothing" has to be a valid TwiML instruction, never an empty body (`api-design.md:497-502`).
    """
    return "<Response></Response>"
