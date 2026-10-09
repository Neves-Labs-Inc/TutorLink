"""The emails TutorLink sends, rendered as subject, text and a minimal HTML alternative.

English only (#153). Pure functions: every value comes in as an argument and the result is
what `mail_service.send_email` takes. Names are stored values and are escaped into the HTML
part anyway, because a Display name is free text an Admin typed.

The text part carries no personal data beyond the names and the link: a forwarded or
mis-delivered email should reveal nothing else.
"""

import html
from dataclasses import dataclass

INVITE_SUBJECT = "You're invited to TutorLink"
INVITE_EXPIRY_WORDING = "This link expires in 7 days and can be used once."
RESET_SUBJECT = "Reset your TutorLink password"
RESET_EXPIRY_WORDING = (
    "This link expires in 48 hours and can be used once. "
    "If you didn't ask for this, you can ignore this email."
)


@dataclass(frozen=True, slots=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def invite_email(*, name: str, actor_name: str, link: str) -> RenderedEmail:
    """The Invite: `actor_name` (the sending Admin) invited `name` to choose a password."""
    text = (
        f"Hi {name},\n\n"
        f"{actor_name} invited you to TutorLink. Choose your password here:\n\n"
        f"{link}\n\n"
        f"{INVITE_EXPIRY_WORDING}\n"
    )
    body = (
        f"<p>Hi {html.escape(name)},</p>"
        f"<p>{html.escape(actor_name)} invited you to TutorLink. "
        f'<a href="{html.escape(link, quote=True)}">Choose your password</a>.</p>'
        f"<p>{INVITE_EXPIRY_WORDING}</p>"
        f'<p style="color:#666;font-size:12px">{html.escape(link)}</p>'
    )

    return RenderedEmail(subject=INVITE_SUBJECT, text=text, html=_document(body))


def reset_email(*, name: str, link: str) -> RenderedEmail:
    """The password reset: `name` asked for a link to choose a new password."""
    text = (
        f"Hi {name},\n\nReset your TutorLink password here:\n\n{link}\n\n{RESET_EXPIRY_WORDING}\n"
    )
    body = (
        f"<p>Hi {html.escape(name)},</p>"
        f'<p><a href="{html.escape(link, quote=True)}">Reset your TutorLink password</a>.</p>'
        f"<p>{RESET_EXPIRY_WORDING}</p>"
        f'<p style="color:#666;font-size:12px">{html.escape(link)}</p>'
    )

    return RenderedEmail(subject=RESET_SUBJECT, text=text, html=_document(body))


def _document(body: str) -> str:
    return f'<!doctype html><html><body style="font-family:sans-serif">{body}</body></html>'
