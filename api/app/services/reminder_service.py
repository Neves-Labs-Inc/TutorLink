"""The weekly Booking reminder: who is due for a week, the run that reminds them, and what a
delivery callback does to the reminder row.

**One eligibility function.** `due_guardians` is what the run sends from and what the Staff
preview shows, so the two can never disagree about who is due or why a Guardian is skipped.

**Record, commit, send, record, commit**, per Guardian, the order `notice_service` uses. The
reminder row and its chat copy are committed before the send, so a database that fails after
Twilio accepted the message cannot make the next tick remind the Guardian a second time: the
row is already there, and a row for the week is the de-dup. Until the send's outcome is written
the row reads `failed` with code `interrupted` (`booking_reminders.status` has no "sending"
value). A process that dies in that gap leaves exactly that: "we don't know it went", told
apart from every Twilio or configuration failure. Its chat copy, left `queued` with no SID, is
marked `failed` / `interrupted` by the next run, which holds the scheduler lock, so no send can
still be in flight then.

**The row is locked from the send to the outcome's commit.** Twilio can call back before that
commit stores the SID. A callback whose SID matches nothing waits on the locks of in-flight
reminders to its `To` number, then looks again, so a failure (and a 63050/63033 opt-out) is
never lost to that race. The price is a transaction held open across the Twilio round trip,
which `twilio_service`'s send timeout bounds.

**One retry, only when it cannot duplicate.** `twilio_service` marks a send retryable only for
an HTTP 5xx or a connection that was never made. A read timeout or a reset is not retried: Twilio
may already have accepted that message.

Nothing here knows about the scheduler; `reminder_scheduler` decides when `run_week` runs.
"""

import datetime
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import ColumnElement, and_, exists, func, select
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.booking_reminder import BookingReminder
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    BookingStatus,
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    Language,
    MessageAuthor,
    MessageStatus,
    ReminderSkipReason,
    ReminderStatus,
    SystemMessageKind,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.services import (
    bot_messages,
    clock,
    conversation_service,
    message_service,
    reminder_consent_service,
)
from app.services.settings_service import (
    REMINDER_TEMPLATE_SID_EN_SETTING,
    REMINDER_TEMPLATE_SID_ES_SETTING,
    get_str_setting,
)
from app.services.twilio_service import (
    TwilioSendFailed,
    TwilioServiceError,
    send_whatsapp_template,
)

TEMPLATE_MESSAGE_ID = "TEMPLATE_booking_reminder"
TEMPLATE_NAME_PREFIX = "booking_reminder_"
CODE_UNDELIVERABLE = "63049"
# The error code of a reminder whose send's outcome was never written; see the module docstring.
INTERRUPTED_CODE = "interrupted"
WHATSAPP_PREFIX = "whatsapp:"
# Far longer than a send can take (two attempts, each capped by `twilio_service`'s timeout).
IN_FLIGHT_WINDOW = datetime.timedelta(minutes=10)
# Meta's "the user stopped marketing/utility messages" and "the user blocked this business":
# either is the Guardian opting out, so the reminders stop.
OPT_OUT_CODES = frozenset({"63050", "63033"})
DAYS_PER_WEEK = 7
LIVE_BOOKING_STATUSES = (BookingStatus.PENDING, BookingStatus.CONFIRMED)

_TEMPLATE_SID_SETTINGS = {
    Language.EN: REMINDER_TEMPLATE_SID_EN_SETTING,
    Language.ES: REMINDER_TEMPLATE_SID_ES_SETTING,
}
# Twilio's delivery states that move a reminder forward, in the only order they may be applied.
_PROGRESS = {
    "sent": ReminderStatus.SENT,
    "delivered": ReminderStatus.DELIVERED,
    "read": ReminderStatus.READ,
}
_PROGRESS_RANK = {ReminderStatus.SENT: 1, ReminderStatus.DELIVERED: 2, ReminderStatus.READ: 3}
_FAILURE_STATUSES = frozenset({"failed", "undelivered"})

# Each Guardian's current consent: their latest row.
_LATEST_CONSENTS = (
    select(ReminderConsent.guardian_id, ReminderConsent.action)
    .distinct(ReminderConsent.guardian_id)
    .order_by(
        ReminderConsent.guardian_id, ReminderConsent.created_at.desc(), ReminderConsent.id.desc()
    )
    .subquery("latest_consents")
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ReminderCandidate:
    """One Guardian due a reminder for a week, and why it would be skipped (`None`: it sends).

    `child_ids` and `child_names` are the Guardian's eligible Children, in the same order.
    """

    guardian_id: uuid.UUID
    guardian_name: str
    phone_number: str
    language: Language
    child_ids: tuple[uuid.UUID, ...]
    child_names: tuple[str, ...]
    skip_reason: ReminderSkipReason | None


@dataclass(frozen=True, slots=True)
class RunResult:
    """What one weekly run wrote, by outcome. Guardians who already had a row are not counted."""

    week_start: datetime.date
    sent: int
    failed: int
    undeliverable: int
    skipped: int


def week_start_after(day: datetime.date) -> datetime.date:
    """The first Monday strictly after `day`: a Sunday gives tomorrow, a Monday a week on."""
    return day + datetime.timedelta(days=DAYS_PER_WEEK - day.weekday())


def due_guardians(db: Session, *, now: datetime.datetime) -> list[ReminderCandidate]:
    """Every Guardian due a reminder for the week after `now` (naive, business-local).

    Due: active, latest consent `opt_in`, and linked to at least one eligible Child (active,
    Evaluated, nothing pending or confirmed that Monday to Sunday). A Guardian who already has a
    row for the week is still listed; `run_week` is what skips them.
    """
    week_start = week_start_after(now.date())
    rows = db.execute(
        select(Guardian, Child)
        .join(ChildGuardian, ChildGuardian.guardian_id == Guardian.id)
        .join(Child, Child.id == ChildGuardian.child_id)
        .join(_LATEST_CONSENTS, _LATEST_CONSENTS.c.guardian_id == Guardian.id)
        .where(
            Guardian.is_active.is_(True),
            _LATEST_CONSENTS.c.action == ConsentAction.OPT_IN,
            _child_is_eligible(week_start),
        )
        .order_by(Guardian.id, Child.name, Child.id)
    ).all()

    children_by_guardian: dict[uuid.UUID, list[Child]] = {}
    guardians: dict[uuid.UUID, Guardian] = {}
    for guardian, child in rows:
        guardians[guardian.id] = guardian
        children_by_guardian.setdefault(guardian.id, []).append(child)

    languages = _languages(db, guardian_ids=list(guardians))
    taken_over = _taken_over_phone_numbers(
        db, phone_numbers=[guardian.phone_number for guardian in guardians.values()], day=now.date()
    )
    template_sids = _template_sids(db)

    return [
        ReminderCandidate(
            guardian_id=guardian.id,
            guardian_name=guardian.name,
            phone_number=guardian.phone_number,
            language=languages.get(guardian.id, Language.EN),
            child_ids=tuple(child.id for child in children_by_guardian[guardian.id]),
            child_names=tuple(child.name for child in children_by_guardian[guardian.id]),
            skip_reason=_skip_reason(
                is_taken_over=guardian.phone_number in taken_over,
                template_sid=template_sids[languages.get(guardian.id, Language.EN)],
            ),
        )
        for guardian in guardians.values()
    ]


def run_week(db: Session, *, now: datetime.datetime) -> RunResult:
    """Write a row for, and remind or skip, every due Guardian with no row for the week yet.

    Commits once per Guardian (see the module docstring), so a failure part-way keeps every
    reminder already sent, and the next run carries on from the first Guardian without a row.
    Run it only under the scheduler's lock: it settles chat copies an earlier run left queued.
    """
    week_start = week_start_after(now.date())
    already_reminded = set(
        db.scalars(
            select(BookingReminder.guardian_id).where(BookingReminder.week_start == week_start)
        )
    )
    template_sids = _template_sids(db)
    counts = {status: 0 for status in ReminderStatus}
    _settle_interrupted_copies(db)

    for candidate in due_guardians(db, now=now):
        if candidate.guardian_id in already_reminded:
            continue
        if candidate.skip_reason is not None:
            status = _record_skip(db, candidate=candidate, week_start=week_start)
        else:
            status = _remind(
                db,
                candidate=candidate,
                week_start=week_start,
                content_sid=template_sids[candidate.language],
            )
        counts[status] += 1

    return RunResult(
        week_start=week_start,
        sent=counts[ReminderStatus.SENT],
        failed=counts[ReminderStatus.FAILED],
        undeliverable=counts[ReminderStatus.UNDELIVERABLE],
        skipped=counts[ReminderStatus.SKIPPED],
    )


def apply_delivery_status(
    db: Session,
    *,
    twilio_sid: str,
    twilio_status: str,
    error_code: str | None,
    twilio_to: str | None,
) -> BookingReminder | None:
    """Move the reminder Twilio reported on, forward only. `None`: no reminder has that SID.

    sent → delivered → read, never back. A failure applies only to a reminder still `sent`:
    63049 makes it `undeliverable`, any other code `failed`, and 63050 or 63033 also opts the
    Guardian out, once, since a replay finds the reminder no longer `sent`. The row is locked so
    two callbacks racing on one SID apply in turn.

    A SID that matches nothing may belong to a send whose outcome is still being written: wait
    for any in-flight reminder to `twilio_to` (the callback's `To`) and look again.
    """
    reminder = _reminder_by_sid(db, twilio_sid=twilio_sid)
    if reminder is None and twilio_to:
        _wait_for_sends_in_flight(db, phone_number=twilio_to.removeprefix(WHATSAPP_PREFIX))
        reminder = _reminder_by_sid(db, twilio_sid=twilio_sid)

    if reminder is None:
        return None

    progress = _PROGRESS.get(twilio_status)
    current_rank = _PROGRESS_RANK.get(reminder.status)
    if progress is not None and current_rank is not None:
        if _PROGRESS_RANK[progress] > current_rank:
            reminder.status = progress
    elif twilio_status in _FAILURE_STATUSES and reminder.status is ReminderStatus.SENT:
        reminder.status = _failure_status(error_code)
        reminder.error_code = error_code
        _opt_out_on_code(db, guardian_id=reminder.guardian_id, error_code=error_code)
    db.flush()

    return reminder


def _reminder_by_sid(db: Session, *, twilio_sid: str) -> BookingReminder | None:
    return db.scalars(
        select(BookingReminder)
        .where(BookingReminder.twilio_sid == twilio_sid)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).first()


def _wait_for_sends_in_flight(db: Session, *, phone_number: str) -> None:
    """Block until no reminder to `phone_number` is between its send and its outcome's commit.

    In flight means no SID yet, still `interrupted`, and written within `IN_FLIGHT_WINDOW`.

    Such a row is locked by `_remind` for exactly that span. Once the lock is released the row
    no longer matches (it carries a SID), so this returns nothing; it is only ever a wait.
    """
    db.execute(
        select(BookingReminder.id)
        .join(Guardian, Guardian.id == BookingReminder.guardian_id)
        .where(
            Guardian.phone_number == phone_number,
            BookingReminder.twilio_sid.is_(None),
            BookingReminder.error_code == INTERRUPTED_CODE,
            # Only a send that can still be running: an interrupted row from an earlier run is
            # settled history, and a callback has no business locking it.
            BookingReminder.created_at > func.now() - IN_FLIGHT_WINDOW,
        )
        .with_for_update(of=BookingReminder)
    ).all()


def _opt_out_on_code(db: Session, *, guardian_id: uuid.UUID, error_code: str | None) -> None:
    """63050/63033: WhatsApp says the Guardian stopped or blocked us, so the reminders stop."""
    if error_code in OPT_OUT_CODES:
        reminder_consent_service.record_consent(
            db,
            guardian_id=guardian_id,
            action=ConsentAction.OPT_OUT,
            source=ConsentSource.SYSTEM,
            message_id=None,
        )


def _settle_interrupted_copies(db: Session) -> None:
    """Fail the chat copies an interrupted run left `queued`, with the reason their rows carry.

    Under the scheduler's lock no send is in flight, so a reminder copy still `queued` with no
    SID can only be one whose outcome was never written.
    """
    interrupted = db.scalars(
        select(Message).where(
            Message.system_kind == SystemMessageKind.BOOKING_REMINDER,
            Message.status == MessageStatus.QUEUED,
            Message.twilio_sid.is_(None),
        )
    ).all()
    for copy in interrupted:
        message_service.mark_failed(db, message=copy, error_code=INTERRUPTED_CODE)
    db.commit()


def _remind(
    db: Session,
    *,
    candidate: ReminderCandidate,
    week_start: datetime.date,
    content_sid: str,
) -> ReminderStatus:
    language = candidate.language.value
    names = bot_messages.format_names(list(candidate.child_names), language)
    week = bot_messages.format_week(week_start, language)
    # A placeholder until the outcome is known; see the module docstring.
    reminder = BookingReminder(
        guardian_id=candidate.guardian_id,
        week_start=week_start,
        language=candidate.language,
        child_ids=list(candidate.child_ids),
        template_name=f"{TEMPLATE_NAME_PREFIX}{language}",
        status=ReminderStatus.FAILED,
        error_code=INTERRUPTED_CODE,
    )
    db.add(reminder)
    conversation = _conversation_for(db, candidate=candidate)
    copy = message_service.record_system_notice(
        db,
        conversation=conversation,
        body=bot_messages.render(TEMPLATE_MESSAGE_ID, language, names=names, week=week),
        system_kind=SystemMessageKind.BOOKING_REMINDER,
        author_user_id=None,
    )
    db.commit()
    # Held to the outcome's commit, so an early callback waits for the SID instead of missing.
    db.execute(
        select(BookingReminder.id).where(BookingReminder.id == reminder.id).with_for_update()
    )

    try:
        twilio_sid = _send_with_one_retry(
            to=candidate.phone_number,
            content_sid=content_sid,
            content_variables={"1": names, "2": week},
        )
    except TwilioServiceError as exc:
        # A missing configuration carries no Twilio code; a refusal does, and Staff need it.
        error_code = exc.code if isinstance(exc, TwilioSendFailed) else None
        logger.warning(
            "booking reminder for guardian %s (week %s) was not sent: %s (code %s)",
            candidate.guardian_id,
            week_start,
            exc,
            error_code,
        )
        reminder.status = _failure_status(error_code)
        reminder.error_code = error_code
        message_service.mark_failed(db, message=copy, error_code=error_code)
        _opt_out_on_code(db, guardian_id=candidate.guardian_id, error_code=error_code)
    else:
        reminder.status = ReminderStatus.SENT
        reminder.error_code = None
        reminder.twilio_sid = twilio_sid
        reminder.sent_at = datetime.datetime.now(tz=datetime.UTC)
        message_service.attach_twilio_sid(db, message=copy, twilio_sid=twilio_sid)
    db.commit()

    return reminder.status


def _send_with_one_retry(*, to: str, content_sid: str, content_variables: dict[str, str]) -> str:
    try:
        twilio_sid = send_whatsapp_template(
            to=to, content_sid=content_sid, content_variables=content_variables
        )
    except TwilioSendFailed as exc:
        if not exc.is_retryable:
            raise
        logger.info("booking reminder send failed (code %s); retrying once", exc.code)
        twilio_sid = send_whatsapp_template(
            to=to, content_sid=content_sid, content_variables=content_variables
        )

    return twilio_sid


def _record_skip(
    db: Session, *, candidate: ReminderCandidate, week_start: datetime.date
) -> ReminderStatus:
    db.add(
        BookingReminder(
            guardian_id=candidate.guardian_id,
            week_start=week_start,
            language=candidate.language,
            child_ids=list(candidate.child_ids),
            status=ReminderStatus.SKIPPED,
            skip_reason=candidate.skip_reason,
        )
    )
    db.commit()

    return ReminderStatus.SKIPPED


def _failure_status(error_code: str | None) -> ReminderStatus:
    if error_code == CODE_UNDELIVERABLE:
        status = ReminderStatus.UNDELIVERABLE
    else:
        status = ReminderStatus.FAILED

    return status


def _skip_reason(*, is_taken_over: bool, template_sid: str) -> ReminderSkipReason | None:
    if is_taken_over:
        reason: ReminderSkipReason | None = ReminderSkipReason.TAKEOVER
    elif not template_sid:
        reason = ReminderSkipReason.TEMPLATE_NOT_APPROVED
    else:
        reason = None

    return reason


def _conversation_for(db: Session, *, candidate: ReminderCandidate) -> Conversation:
    """The thread at the Guardian's number, opened if there is none, and linked to them."""
    conversation = conversation_service.resolve_or_create(db, phone_number=candidate.phone_number)
    if conversation.guardian_id is None:
        conversation_service.link_guardian(
            db, conversation=conversation, guardian_id=candidate.guardian_id
        )

    return conversation


def _template_sids(db: Session) -> dict[Language, str]:
    """The approved ContentSid per language; blank means not approved yet."""
    return {
        language: get_str_setting(db, key=key).strip()
        for language, key in _TEMPLATE_SID_SETTINGS.items()
    }


def _languages(db: Session, *, guardian_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, Language]:
    """Each Guardian's language, from their most recently active conversation that has one set.

    Only the latest conversation counts: a NULL there means English even if an older thread was
    Spanish. Guardians with no conversation are absent, which also means English.
    """
    latest = db.execute(
        select(Conversation.guardian_id, Conversation.language)
        .where(Conversation.guardian_id.in_(guardian_ids))
        .distinct(Conversation.guardian_id)
        .order_by(Conversation.guardian_id, Conversation.last_message_at.desc())
    ).all()

    return {guardian_id: language for guardian_id, language in latest if language is not None}


def _taken_over_phone_numbers(
    db: Session, *, phone_numbers: Sequence[str], day: datetime.date
) -> set[str]:
    """The numbers whose thread Staff hold and were the last to write in on business day `day`.

    The thread is the one at the Guardian's number, where the reminder would land. System
    lines (notices, earlier reminders) are not anyone writing, so they never count.
    """
    zone = clock.business_zone()
    day_start = datetime.datetime.combine(day, datetime.time.min, tzinfo=zone)
    day_end = datetime.datetime.combine(
        day + datetime.timedelta(days=1), datetime.time.min, tzinfo=zone
    )
    last_today = (
        select(Message.conversation_id, Message.author_kind)
        .where(
            Message.created_at >= day_start,
            Message.created_at < day_end,
            Message.author_kind != MessageAuthor.SYSTEM,
        )
        .distinct(Message.conversation_id)
        .order_by(Message.conversation_id, Message.created_at.desc(), Message.id.desc())
        .subquery()
    )
    rows = db.scalars(
        select(Conversation.phone_number)
        .join(last_today, last_today.c.conversation_id == Conversation.id)
        .where(
            Conversation.phone_number.in_(phone_numbers),
            Conversation.status == ConversationStatus.HUMAN,
            last_today.c.author_kind == MessageAuthor.ADMIN,
        )
    ).all()

    return set(rows)


def _child_is_eligible(week_start: datetime.date) -> ColumnElement[bool]:
    week_end = week_start + datetime.timedelta(days=DAYS_PER_WEEK - 1)
    booked_that_week = exists().where(
        and_(
            Booking.child_id == Child.id,
            Booking.status.in_(LIVE_BOOKING_STATUSES),
            Booking.scheduled_date.between(week_start, week_end),
        )
    )

    return and_(Child.is_active.is_(True), Child.evaluated_at.is_not(None), ~booked_that_week)
