"""Reading and appending a Guardian's weekly-reminder consent history.

Rows are append-only (see `app.models.reminder_consent`), so recording is always an insert and
the current state is the latest row. Nothing here commits: callers own the transaction.
"""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking_reminder import BookingReminder
from app.models.enums import ConsentAction, ConsentSource
from app.models.guardian import Guardian
from app.models.reminder_consent import ReminderConsent
from app.models.user import User

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ConsentEntry:
    """One history row, with the Staff member who recorded it (`None` unless `source` is
    `staff`)."""

    consent: ReminderConsent
    set_by: User | None


@dataclass(frozen=True, slots=True)
class GuardianReminders:
    """A Guardian's reminder status: the consent history newest first, whose head is the
    current consent (no rows means never asked), and the latest week's reminder row.

    `is_blocked_by_whatsapp`: WhatsApp's `system` opt-out is newer than every row the Guardian
    wrote, so Staff may not opt them in (see `_is_blocked_by_whatsapp`)."""

    history: list[ConsentEntry]
    last_reminder: BookingReminder | None
    is_blocked_by_whatsapp: bool


class GuardianNotFound(Exception):
    """No Guardian with that id."""


class BlockedBySystem(Exception):
    """Staff tried to opt in a Guardian while WhatsApp's `system` opt-out still stands."""


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
    set_by_user_id: uuid.UUID | None = None,
) -> ReminderConsent:
    consent = ReminderConsent(
        guardian_id=guardian_id,
        action=action,
        source=source,
        message_id=message_id,
        set_by_user_id=set_by_user_id,
    )
    db.add(consent)
    db.flush()

    return consent


def record_staff_consent(
    db: Session, *, guardian_id: uuid.UUID, action: ConsentAction, user_id: uuid.UUID
) -> GuardianReminders:
    """Staff record an opt-in or opt-out on the Guardian's behalf, and get the updated status.

    Only the row is written: the Guardian is sent nothing, because the Guardian told Staff
    directly and a confirmation would answer a message they never sent on WhatsApp.

    An opt-in is refused while the Guardian is blocked by WhatsApp (Franklin): WhatsApp
    reported that the Guardian blocked our number (63050/63033), so only the Guardian's own
    START may undo it, and Staff rows recorded since do not. An opt-out is always allowed.
    """
    current = reminder_status(db, guardian_id=guardian_id)

    if action is ConsentAction.OPT_IN and current.is_blocked_by_whatsapp:
        logger.warning(
            "refused staff opt-in over a system opt-out: guardian_id=%s user_id=%s",
            guardian_id,
            user_id,
        )
        raise BlockedBySystem

    record_consent(
        db,
        guardian_id=guardian_id,
        action=action,
        source=ConsentSource.STAFF,
        message_id=None,
        set_by_user_id=user_id,
    )

    return reminder_status(db, guardian_id=guardian_id)


def reminder_status(db: Session, *, guardian_id: uuid.UUID) -> GuardianReminders:
    """What the Guardian screen's Weekly reminders card shows."""
    _assert_guardian_exists(db, guardian_id=guardian_id)
    # Same order as `reminder_service`'s latest-consent read, so the head here is the consent
    # the weekly run acts on.
    rows = db.execute(
        select(ReminderConsent, User)
        .outerjoin(User, User.id == ReminderConsent.set_by_user_id)
        .where(ReminderConsent.guardian_id == guardian_id)
        .order_by(ReminderConsent.created_at.desc(), ReminderConsent.id.desc())
    ).all()
    last_reminder = db.scalars(
        select(BookingReminder)
        .where(BookingReminder.guardian_id == guardian_id)
        .order_by(BookingReminder.week_start.desc())
        .limit(1)
    ).first()

    history = [ConsentEntry(consent=consent, set_by=user) for consent, user in rows]

    return GuardianReminders(
        history=history,
        last_reminder=last_reminder,
        is_blocked_by_whatsapp=_is_blocked_by_whatsapp(history),
    )


def _is_blocked_by_whatsapp(history: list[ConsentEntry]) -> bool:
    """Whether WhatsApp's opt-out is newer than anything the Guardian said themselves.

    Staff rows are skipped: a Staff opt-out on top of the `system` row must not open the way to
    a Staff opt-in. Only a later Guardian row (a START or button by message, or the Intake yes)
    lifts the block. `history` is newest first, the current-consent order.
    """
    latest_non_staff = next(
        (entry.consent for entry in history if entry.consent.source is not ConsentSource.STAFF),
        None,
    )

    return latest_non_staff is not None and latest_non_staff.source is ConsentSource.SYSTEM


def _assert_guardian_exists(db: Session, *, guardian_id: uuid.UUID) -> None:
    if db.get(Guardian, guardian_id) is None:
        raise GuardianNotFound
