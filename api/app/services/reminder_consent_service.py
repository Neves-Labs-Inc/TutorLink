"""Reading and appending a Guardian's weekly-reminder consent history.

Rows are append-only (see `app.models.reminder_consent`), so recording is always an insert and
the current state is the latest row. Nothing here commits: callers own the transaction.

**A WhatsApp block belongs to one Guardian on one number** (#119). WhatsApp's `system` opt-out
blocks the Guardian while they hold the number it came from, and only that Guardian's own row
from that number (a START or button by message, or the Intake yes) lifts it. Rows from any
other number neither lift it nor count toward it, so a Staff member cannot lift it by swapping
in a number they control and sending START, and a number given to another Guardian does not
carry the block to them. `blocked_guardian_ids` is the one rule; the Guardian screen, the Staff
opt-in refusal and the weekly run all read it.
"""

import logging
import uuid
from dataclasses import dataclass

from collections.abc import Collection

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking_reminder import BookingReminder
from app.models.enums import ConsentAction, ConsentSource
from app.models.guardian import Guardian
from app.models.reminder_consent import ReminderConsent
from app.models.user import User
from app.services.phone_service import InvalidPhoneNumber, normalize_phone_number

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

    `is_blocked_by_whatsapp`: WhatsApp reported the Guardian's current number blocked us and the
    Guardian has said nothing from it since, so Staff may not opt them in (see
    `blocked_guardian_ids`)."""

    history: list[ConsentEntry]
    last_reminder: BookingReminder | None
    is_blocked_by_whatsapp: bool


class GuardianNotFound(Exception):
    """No Guardian with that id."""


class BlockedBySystem(Exception):
    """Staff tried to opt in a Guardian blocked by WhatsApp on their current number."""


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
    phone_number: str | None,
    set_by_user_id: uuid.UUID | None = None,
) -> ReminderConsent:
    """Append one row. `phone_number` is the WhatsApp number the evidence came from, as it
    arrived (it is normalised here), and `None` exactly for a `staff` row."""
    consent = ReminderConsent(
        guardian_id=guardian_id,
        action=action,
        source=source,
        message_id=message_id,
        phone_number=None if phone_number is None else _canonical(db, phone_number=phone_number),
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

    An opt-in is refused while the Guardian is blocked by WhatsApp on their current number
    (Franklin): WhatsApp reported that number blocked us (63050/63033), so only the Guardian's
    own START from it may undo it, and Staff rows recorded since do not. An opt-out is always
    allowed. A Staff row carries no number.
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
        phone_number=None,
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
    blocked = blocked_guardian_ids(db, guardian_ids=[guardian_id])

    return GuardianReminders(
        history=history,
        last_reminder=last_reminder,
        is_blocked_by_whatsapp=guardian_id in blocked,
    )


def blocked_guardian_ids(db: Session, *, guardian_ids: Collection[uuid.UUID]) -> set[uuid.UUID]:
    """The Guardians among `guardian_ids` blocked by WhatsApp on their current number, in one
    query.

    Blocked: among the Guardian's own rows from their current `guardians.phone_number`, the
    newest is WhatsApp's `system` opt-out. Staff rows never count: a Staff opt-out on top of the
    `system` row must not open the way to a Staff opt-in.
    Rows of other Guardians are never read. Ordered like the current consent, newest first.
    """
    latest_from_current_number = (
        select(ReminderConsent.guardian_id, ReminderConsent.source)
        .join(Guardian, Guardian.id == ReminderConsent.guardian_id)
        .where(
            ReminderConsent.guardian_id.in_(guardian_ids),
            ReminderConsent.source != ConsentSource.STAFF,
            ReminderConsent.phone_number == Guardian.phone_number,
        )
        .distinct(ReminderConsent.guardian_id)
        .order_by(
            ReminderConsent.guardian_id,
            ReminderConsent.created_at.desc(),
            ReminderConsent.id.desc(),
        )
        .subquery()
    )
    blocked = db.scalars(
        select(latest_from_current_number.c.guardian_id).where(
            latest_from_current_number.c.source == ConsentSource.SYSTEM
        )
    ).all()

    return set(blocked)


def _canonical(db: Session, *, phone_number: str) -> str:
    """`phone_service`'s form of a number, or the number as given when it cannot be parsed:
    `bot_service._recognise`'s rule, so a stored number compares like with like against
    `guardians.phone_number` without ever refusing an inbound one."""
    try:
        canonical = normalize_phone_number(db, raw=phone_number)
    except InvalidPhoneNumber:
        canonical = phone_number

    return canonical


def _assert_guardian_exists(db: Session, *, guardian_id: uuid.UUID) -> None:
    if db.get(Guardian, guardian_id) is None:
        raise GuardianNotFound
