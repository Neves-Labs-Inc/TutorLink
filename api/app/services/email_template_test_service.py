"""Emailing an unsaved template draft to the person editing it, so they can see it in a real
inbox before saving.

Writes nothing: the link is a dummy, so no password link is issued, and the draft is never
stored. The draft goes through the same validation and renderer as a real email.
"""

import uuid

from sqlalchemy.orm import Session

from app.models.user import User
from app.services.mail_service import public_url, send_email
from app.services.mail_templates import (
    ACTOR_NAME_PLACEHOLDER,
    LINK_PLACEHOLDER,
    NAME_PLACEHOLDER,
    TemplateKind,
    render_email,
    validate_brand_color,
    validate_template,
)
from app.services.settings_service import read_email_brand_color

TEST_SUBJECT_PREFIX = "[Test] "
# Not a real token: the link only has to look right, and must never log anyone in.
DUMMY_LINK_PATH = "set-password?token=example"


def send_test_email(
    db: Session,
    *,
    user_id: uuid.UUID,
    kind: TemplateKind,
    subject: str,
    body: str,
    brand_color: str | None,
) -> None:
    """Email the draft to user `user_id`, with their own name for every name placeholder.

    `brand_color` is the draft colour, or None for the saved one. Raises `EmailTemplateInvalid`
    for a draft breaking a rule, the template's rules before the colour's (nothing is sent),
    and lets any `MailServiceError` propagate.
    """
    validate_template(kind, subject=subject, body=body)
    color = read_email_brand_color(db) if brand_color is None else validate_brand_color(brand_color)

    user = db.get_one(User, user_id)
    rendered = render_email(
        kind,
        subject=subject,
        body=body,
        values={
            NAME_PLACEHOLDER: user.name,
            ACTOR_NAME_PLACEHOLDER: user.name,
            LINK_PLACEHOLDER: public_url(DUMMY_LINK_PATH),
        },
        brand_color=color,
    )

    send_email(
        to=user.email,
        subject=f"{TEST_SUBJECT_PREFIX}{rendered.subject}",
        text=rendered.text,
        html=rendered.html,
    )
