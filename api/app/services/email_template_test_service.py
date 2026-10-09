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
    DEFAULT_BRAND_COLOR,
    LINK_PLACEHOLDER,
    NAME_PLACEHOLDER,
    TemplateKind,
    render_email,
    validate_template,
)

TEST_SUBJECT_PREFIX = "[Test] "
# Not a real token: the link only has to look right, and must never log anyone in.
DUMMY_LINK_PATH = "set-password?token=example"


def send_test_email(
    db: Session, *, user_id: uuid.UUID, kind: TemplateKind, subject: str, body: str
) -> None:
    """Email the draft to user `user_id`, with their own name for every name placeholder.

    Raises `EmailTemplateInvalid` for a draft breaking a rule (nothing is sent) and lets any
    `MailServiceError` propagate.
    """
    validate_template(kind, subject=subject, body=body)

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
        brand_color=DEFAULT_BRAND_COLOR,
    )

    send_email(
        to=user.email,
        subject=f"{TEST_SUBJECT_PREFIX}{rendered.subject}",
        text=rendered.text,
        html=rendered.html,
    )
