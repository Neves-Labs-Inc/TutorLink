"""Reading and appending a Guardian's weekly-reminder consent history.

Rows are append-only (see `app.models.reminder_consent`), so recording is always an insert and
the current state is the latest row. Nothing here commits: callers own the transaction.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import ConsentAction, ConsentSource
from app.models.reminder_consent import ReminderConsent


def has_consent(db: Session, *, guardian_id: uuid.UUID) -> bool:
    """Whether the Guardian has ever opted in or out, by any route. No rows means never asked."""
    # Selects the id only, so the read never names the messages table the row points at.
    first_id = db.scalars(
        select(ReminderConsent.id).where(ReminderConsent.guardian_id == guardian_id).limit(1)
    ).first()

    return first_id is not None


def record_consent(
    db: Session,
    *,
    guardian_id: uuid.UUID,
    action: ConsentAction,
    source: ConsentSource,
    message_id: uuid.UUID | None,
) -> ReminderConsent:
    consent = ReminderConsent(
        guardian_id=guardian_id, action=action, source=source, message_id=message_id
    )
    db.add(consent)
    db.flush()

    return consent
