"""A Guardian's language and weekly-reminder state, read for many Guardians at once.

The Guardians list and Child details' guardian cards show these per row, and the list filters
on the first two, so each rule is a SQL expression correlated on `Guardian.id`: the same
expression selects the value and narrows a `WHERE`, and a page reads them in one statement.

- **Language**: that of the Guardian's latest conversation (`LATEST_CONVERSATION_FIRST`),
  English when it is not detected or there is no conversation. `ClientRead.language` and
  `reminder_service._languages` follow the same rule; this one is never null.
- **Reminders**: the action of the latest `reminder_consents` row, `never` with none; the same
  state `GET /api/clients/{id}/reminders` reports as `consent.state`.
- **Blocked by WhatsApp**: `reminder_consent_service.blocked_guardian_ids`, whose rule this
  reuses rather than restates.
"""

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from typing import Literal, cast

from sqlalchemy import ColumnElement, String, func, select, type_coerce
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import Language
from app.models.guardian import Guardian
from app.models.reminder_consent import ReminderConsent
from app.services.conversation_service import LATEST_CONVERSATION_FIRST
from app.services.reminder_consent_service import blocked_guardian_ids

ReminderState = Literal["opt_in", "opt_out", "never"]

NEVER_ASKED: ReminderState = "never"


@dataclass(frozen=True, slots=True)
class GuardianState:
    language: Language
    reminders: ReminderState
    is_blocked_by_whatsapp: bool


def effective_language() -> ColumnElement[Language]:
    """The Guardian's language, correlated on `Guardian.id`; English when undetected."""
    latest = (
        select(Conversation.language)
        .where(Conversation.guardian_id == Guardian.id)
        .order_by(*LATEST_CONVERSATION_FIRST)
        .limit(1)
        .correlate(Guardian)
        .scalar_subquery()
    )

    return func.coalesce(latest, Language.EN)


def reminders_state() -> ColumnElement[str]:
    """The Guardian's current consent action, correlated on `Guardian.id`; `never` with none."""
    latest = (
        select(ReminderConsent.action)
        .where(ReminderConsent.guardian_id == Guardian.id)
        # Same order as `reminder_status`, so this agrees with the Guardian screen.
        .order_by(ReminderConsent.created_at.desc(), ReminderConsent.id.desc())
        .limit(1)
        .correlate(Guardian)
        .scalar_subquery()
    )

    # Read as the stored text so `never` can stand in for no row; actions store their value.
    return func.coalesce(type_coerce(latest, String), NEVER_ASKED)


def guardian_states(
    db: Session, guardian_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, GuardianState]:
    """Each listed Guardian's state, in two statements whatever the number of ids."""
    if not guardian_ids:
        return {}

    rows = db.execute(
        select(Guardian.id, effective_language(), reminders_state()).where(
            Guardian.id.in_(guardian_ids)
        )
    ).all()
    blocked = blocked_guardian_ids(db, guardian_ids=guardian_ids)

    return {
        guardian_id: GuardianState(
            language=language,
            reminders=cast(ReminderState, reminders),
            is_blocked_by_whatsapp=guardian_id in blocked,
        )
        for guardian_id, language, reminders in rows
    }
