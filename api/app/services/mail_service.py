"""Sending one email over plain SMTP, and building the public links those emails carry.

Provider-agnostic on purpose (spec 04, answers #1): production points `SMTP_*` at a mailbox's
SMTP today and at SES over SMTP later, with no code change. Synchronous and blocking by design:
the invite route sends inside its request and the forgot-password route from a background task,
and neither wants a queue for a handful of emails a week.

No FastAPI import, no `Session` parameter: this module raises the domain exceptions below and
knows nothing about routers or the database. The `fake_mail` fixture replaces `send_email`
wholesale in every test, so nothing here is ever reached from the suite.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import getaddresses

from app.config import get_settings

# A hung SMTP conversation would otherwise hold the invite request open for as long as the
# server cared to stall. The socket timeout surfaces as `TimeoutError`, an `OSError`.
SEND_TIMEOUT_SECONDS = 15.0
STARTTLS_EXTENSION = "starttls"

# What the SMTP conversation can raise. `ValueError` covers the stdlib's own refusals: a header
# with a line break (`email.policy.default`) and a non-ASCII password (`UnicodeEncodeError`).
_SEND_ERRORS = (smtplib.SMTPException, OSError, ValueError)

logger = logging.getLogger(__name__)


class MailServiceError(Exception):
    """Base class for every failure this module reports."""


class MailNotConfigured(MailServiceError):
    """`smtp_host`, `mail_from`, a password for a set username, or (for links) `public_base_url`
    is unset.

    A deployment missing any of these is a configuration bug, not a runtime one, so it is
    refused here rather than left for `smtplib` to fail on obscurely.
    """


class MailInsecureTransport(MailServiceError):
    """Credentials are configured but the server offered no STARTTLS: refused, never sent.

    An on-path attacker can strip `250-STARTTLS` from the EHLO reply, and a login that followed
    would hand them the mailbox password base64-encoded in the clear. Only a credential-less
    relay may run without TLS.
    """


class MailSendFailed(MailServiceError):
    """The SMTP server refused the message or could not be reached.

    The message never names the recipient: callers log it, and an email address does not belong
    in the logs. `smtplib`'s own text does (`SMTPRecipientsRefused` quotes every address), which
    is why none of it is copied into ours; it stays on `__cause__` for a debugger.
    """


def send_email(*, to: str, subject: str, text: str, html: str | None = None) -> None:
    """Send one message to one address: a text part and, when `html` is given, an HTML
    alternative.

    `to` is exactly one address, from a stored and validated column, never a request-supplied
    string: `smtplib` delivers to every address it can parse out of the header, so a list here
    would fan out. More or fewer than one is a caller bug and raises `ValueError`.
    """
    settings = get_settings()

    if not (settings.smtp_host and settings.mail_from):
        raise MailNotConfigured("smtp_host or mail_from is unset")
    if settings.smtp_username and not settings.smtp_password:
        raise MailNotConfigured("smtp_username is set but smtp_password is unset")
    if _address_count(to) != 1:
        raise ValueError("send_email takes exactly one recipient address")

    try:
        message = _build_message(
            mail_from=settings.mail_from, to=to, subject=subject, text=text, html=html
        )
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=SEND_TIMEOUT_SECONDS)
    except _SEND_ERRORS as exc:
        raise MailSendFailed(_failure_text(exc)) from exc

    try:
        smtp.ehlo()
        if smtp.has_extn(STARTTLS_EXTENSION):
            # A default context verifies the certificate and host name, so a spoofed relay
            # cannot read the credentials.
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        elif settings.smtp_username:
            raise MailInsecureTransport(
                "the SMTP server offers no STARTTLS; refusing to send credentials in the clear"
            )
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)
    except _SEND_ERRORS as exc:
        raise MailSendFailed(_failure_text(exc)) from exc
    finally:
        # The message is delivered once `send_message` returns; a server that then answers
        # QUIT with anything but 221, or drops the socket, must not turn that into a failed
        # send, or the caller would resend and rotate a token the first email already carries.
        _quit_quietly(smtp)


def public_url(path: str) -> str:
    """`settings.public_base_url` joined with `path`, for the links an email carries."""
    settings = get_settings()

    if not settings.public_base_url:
        raise MailNotConfigured("public_base_url is unset")

    return f"{settings.public_base_url}/{path.lstrip('/')}"


def _build_message(
    *, mail_from: str, to: str, subject: str, text: str, html: str | None
) -> EmailMessage:
    headers = {"From": mail_from, "To": to, "Subject": subject}
    # `email.policy.default` refuses a line break only when text follows it; a trailing one
    # would still reach the wire and end the header block early. No header may carry either.
    for name, value in headers.items():
        if "\r" in value or "\n" in value:
            raise ValueError(f"the {name} header contains a line break")

    message = EmailMessage()
    for name, value in headers.items():
        message[name] = value
    message.set_content(text)
    if html is not None:
        message.add_alternative(html, subtype="html")

    return message


def _address_count(to: str) -> int:
    """How many addresses `smtplib` would deliver to from a `To` header of `to`."""
    addresses = [address for _, address in getaddresses([to]) if address]
    # `getaddresses` splits on commas only; two bare addresses separated by whitespace come back
    # as one entry, which is the other way a caller could pass more than one recipient.
    return sum(len(address.split()) for address in addresses)


def _failure_text(exc: BaseException) -> str:
    return f"could not send the email through SMTP ({type(exc).__name__})"


def _quit_quietly(smtp: smtplib.SMTP) -> None:
    try:
        smtp.quit()
    except (smtplib.SMTPException, OSError) as exc:
        logger.warning("SMTP QUIT failed after the conversation (%s)", type(exc).__name__)
