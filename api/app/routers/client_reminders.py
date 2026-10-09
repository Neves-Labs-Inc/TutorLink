"""`/api/clients/{id}/reminders`: a Guardian's weekly-reminder status, and Staff recording an
opt-in or opt-out for them.

`OfficePrincipal`, so a tutor is 403, and no `TutorScope`: the route reads no tutor-owned table.
Recording sends the Guardian nothing; it only appends a `staff` consent row naming the caller.
An opt-in while the Guardian is blocked by WhatsApp on their current number (WhatsApp's
`system` opt-out on it, and no Guardian row from it since; Staff rows don't count) is a 409:
only the Guardian's own START from that number undoes it. The screen reads that case from
`consent.blocked_by_whatsapp`, not from `consent.source`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.enums import ConsentSource
from app.schemas.reminder import (
    ConsentHistoryRead,
    ConsentRead,
    ConsentRecord,
    GuardianRemindersRead,
    LastReminderRead,
)
from app.services.reminder_consent_service import (
    BlockedBySystem,
    ConsentEntry,
    GuardianNotFound,
    GuardianReminders,
    record_staff_consent,
    reminder_status,
)

CLIENT_NOT_FOUND_ERROR = "Client not found"
BLOCKED_BY_SYSTEM_ERROR = (
    "WhatsApp reported this Guardian blocked our number; only the Guardian can turn reminders "
    "back on by messaging START from this number."
)
NEVER_ASKED = "never"
# Who a non-staff consent row is attributed to. A `staff` row names its Staff member instead.
GUARDIAN_AUTHOR = "Guardian"
WHATSAPP_AUTHOR = "WhatsApp"
# Only reachable for a `staff` row written without a user, which the API never does.
UNKNOWN_STAFF_AUTHOR = "Staff"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/clients", tags=["reminders"])


@router.get("/{client_id}/reminders", response_model=GuardianRemindersRead)
def read_reminders(
    client_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> GuardianRemindersRead:
    try:
        reminders = reminder_status(db, guardian_id=client_id)
    except GuardianNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CLIENT_NOT_FOUND_ERROR) from exc

    return _read(reminders)


@router.post(
    "/{client_id}/reminders/consent",
    response_model=GuardianRemindersRead,
    status_code=status.HTTP_201_CREATED,
)
def record_consent(
    client_id: uuid.UUID, payload: ConsentRecord, user: OfficePrincipal, db: DbSession
) -> GuardianRemindersRead:
    try:
        reminders = record_staff_consent(
            db, guardian_id=client_id, action=payload.action, user_id=user.id
        )
    except GuardianNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CLIENT_NOT_FOUND_ERROR) from exc
    except BlockedBySystem as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, BLOCKED_BY_SYSTEM_ERROR) from exc

    db.commit()

    return _read(reminders)


def _read(reminders: GuardianReminders) -> GuardianRemindersRead:
    current = reminders.history[0].consent if reminders.history else None
    reminder = reminders.last_reminder

    return GuardianRemindersRead(
        consent=ConsentRead(
            state=NEVER_ASKED if current is None else current.action.value,
            source=None if current is None else current.source,
            set_at=None if current is None else current.created_at,
            blocked_by_whatsapp=reminders.is_blocked_by_whatsapp,
        ),
        last_reminder=None
        if reminder is None
        else LastReminderRead(
            week_start=reminder.week_start,
            status=reminder.status,
            error_code=reminder.error_code,
            skip_reason=reminder.skip_reason,
        ),
        history=[_history_row(entry) for entry in reminders.history],
    )


def _history_row(entry: ConsentEntry) -> ConsentHistoryRead:
    return ConsentHistoryRead(
        id=entry.consent.id,
        action=entry.consent.action,
        source=entry.consent.source,
        created_at=entry.consent.created_at,
        who=_who(entry),
    )


def _who(entry: ConsentEntry) -> str:
    if entry.consent.source is ConsentSource.SYSTEM:
        author = WHATSAPP_AUTHOR
    elif entry.consent.source is not ConsentSource.STAFF:
        author = GUARDIAN_AUTHOR
    elif entry.set_by is None:
        author = UNKNOWN_STAFF_AUTHOR
    else:
        author = entry.set_by.name

    return author
