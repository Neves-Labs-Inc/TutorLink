"""The Staff view of one week's Booking reminders: before the run, who it would remind or
skip and why; after it, the rows it wrote.

**The preview is the run's own eligibility.** It is `reminder_service.due_guardians` evaluated
at the run's moment (the configured weekday and hour), so it cannot disagree with what
`run_week` then sends. Only the week the next or current run covers has one, and only until
that run has happened.

**Whether a week has run is read from the database, never the clock.** A week has run when a
run finished for it (`booking_reminder_runs`) or wrote any row (a run that died part-way). The
send hour passing proves nothing: the first tick comes seconds later, and an instance down all
evening never runs that week at all. Such a week still shows its preview until midnight, and
reads as not run afterwards.

Read-only: nothing here writes or sends.
"""

import datetime
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking_reminder import BookingReminder
from app.models.booking_reminder_run import BookingReminderRun
from app.models.child import Child
from app.models.enums import Language, ReminderSkipReason, ReminderStatus
from app.models.guardian import Guardian
from app.services.reminder_scheduler import REMINDER_HOUR_SETTING, REMINDER_WEEKDAY_SETTING
from app.services.reminder_service import (
    MAYBE_DELIVERED_CODES,
    ReminderCandidate,
    due_guardians,
    week_start_after,
)
from app.services.settings_service import get_int_setting

DAYS_PER_WEEK = 7


@dataclass(frozen=True, slots=True)
class ReminderRow:
    """One `booking_reminders` row with the names Staff read it by.

    `child_names` are the Children's current names, in the row's order; a Child deleted since
    is left out. `may_have_been_delivered`: `failed` with an unknown outcome (see
    `reminder_service.MAYBE_DELIVERED_CODES`), as opposed to "not sent".
    """

    guardian_id: uuid.UUID
    guardian_name: str
    child_names: tuple[str, ...]
    language: Language
    status: ReminderStatus
    skip_reason: ReminderSkipReason | None
    error_code: str | None
    may_have_been_delivered: bool
    sent_at: datetime.datetime | None


@dataclass(frozen=True, slots=True)
class ReminderWeek:
    """One week. `preview` is `None` after its run, and for every week but the run's own."""

    week_start: datetime.date
    has_run: bool
    preview: tuple[ReminderCandidate, ...] | None
    rows: tuple[ReminderRow, ...]


def reminder_week(
    db: Session,
    *,
    now: datetime.datetime,
    week_start: datetime.date | None = None,
    statuses: frozenset[ReminderStatus] | None = None,
) -> ReminderWeek:
    """The week starting `week_start` (default: the one the next or current run covers), as of
    business-local `now`. `statuses` narrows the rows only (the worklist); `None` keeps all.

    Only the run's own week has a preview, and only until it has run.
    """
    run_at = _next_or_current_run(db, now=now)
    run_week_start = week_start_after(run_at.date())
    week = week_start or run_week_start
    rows = _rows(db, week_start=week)
    has_run = bool(rows) or _was_run(db, week_start=week)

    preview = None
    if week == run_week_start and not has_run:
        preview = tuple(
            sorted(
                due_guardians(db, now=run_at),
                key=lambda candidate: (candidate.guardian_name, candidate.guardian_id),
            )
        )

    return ReminderWeek(
        week_start=week,
        has_run=has_run,
        preview=preview,
        rows=tuple(row for row in rows if statuses is None or row.status in statuses),
    )


def _next_or_current_run(db: Session, *, now: datetime.datetime) -> datetime.datetime:
    """The send time on the configured weekday, today included: on the day itself that is the
    current run whether or not its hour has passed."""
    weekday = get_int_setting(db, key=REMINDER_WEEKDAY_SETTING)
    hour = get_int_setting(db, key=REMINDER_HOUR_SETTING)
    run_day = now.date() + datetime.timedelta(days=(weekday - now.isoweekday()) % DAYS_PER_WEEK)

    return datetime.datetime.combine(run_day, datetime.time(hour))


def _was_run(db: Session, *, week_start: datetime.date) -> bool:
    return db.get(BookingReminderRun, week_start) is not None


def _rows(db: Session, *, week_start: datetime.date) -> list[ReminderRow]:
    found = db.execute(
        select(BookingReminder, Guardian.name)
        .join(Guardian, Guardian.id == BookingReminder.guardian_id)
        .where(BookingReminder.week_start == week_start)
        .order_by(Guardian.name, Guardian.id)
    ).all()
    names = _child_names(db, child_ids=(id_ for row, _ in found for id_ in row.child_ids))

    return [
        ReminderRow(
            guardian_id=reminder.guardian_id,
            guardian_name=guardian_name,
            child_names=tuple(names[id_] for id_ in reminder.child_ids if id_ in names),
            language=reminder.language,
            status=reminder.status,
            skip_reason=reminder.skip_reason,
            error_code=reminder.error_code,
            may_have_been_delivered=(
                reminder.status is ReminderStatus.FAILED
                and reminder.error_code in MAYBE_DELIVERED_CODES
            ),
            sent_at=reminder.sent_at,
        )
        for reminder, guardian_name in found
    ]


def _child_names(db: Session, *, child_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]:
    wanted = set(child_ids)
    rows = (
        db.execute(select(Child.id, Child.name).where(Child.id.in_(wanted))).all() if wanted else []
    )

    return {child_id: name for child_id, name in rows}
