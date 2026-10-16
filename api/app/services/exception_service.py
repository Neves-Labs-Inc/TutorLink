"""The Time off lifecycle: who creates, decides and cancels a Staff member's Time off, and when.

An exception only blocks bookings once it is `APPROVED`. A Tutor's or Manager's own request
lands `PENDING` and changes nothing about their availability until an Admin role decides it;
an Admin's entry is approved on the spot (there is nobody above them to ask). Cancelling keeps
the row at `CANCELLED`, recording who and when, so the history survives.

Once a row's window has **ended** nothing changes it any more: no decide, no cancel. A pending
row that has ended reads `expired` on the wire (`read_status`). Nothing is stored for that and
no job runs; it is derived from the business clock on every read.

Approving Time off never refuses or cancels a Booking; it surfaces them (#204). A **clash** is a
live (pending or confirmed) Booking of the same person dated inside the row's dates and, for a
partial-day row, overlapping its window on that day: the bare-overlap test rule 4 of a Booking
write uses. Clashes are computed on every read (`clashes_by_exception`), never stored. A write
that would land a row approved over clashes is refused with `UnconfirmedBookingClash` unless
the caller confirmed `booking_clash`.

Who may touch whose Time off is decided here, not in the router, because the Developer
boundary needs the target's role and only this module loads it:

- the caller's own Time off, always;
- anyone's, for Admin roles, except that a Developer's is reserved for Developers;
- anyone's to read (never to write), for a Manager, with the same Developer reservation;
- nobody else's, otherwise.

This module knows nothing about FastAPI, status codes, or request bodies; it raises the
domain exceptions below and `app.routers.exceptions` maps them.

**Transaction contract — read this before calling.** Nothing here commits: the caller owns the
transaction boundary, as in `auth_service`. `decide_exception` and `cancel_exception` take a row
lock that is only released by that commit or rollback.
"""

import datetime
import logging
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.dependencies import ADMIN_ROLES, OFFICE_ROLES
from app.models.availability import TutorAvailabilityException
from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.child import Child
from app.models.enums import BookingStatus, ExceptionStatus, UserRole
from app.models.user import User
from app.schemas.exceptions import ExceptionReadStatus, TimeOffWarningCode
from app.services import clock, scheduling_service

EXPIRED_STATUS = "expired"
PENDING_STATUS = "pending"
SORT_BY_START = "start"
SORT_BY_REQUESTED = "requested"
BOOKING_CLASH_WARNING: TimeOffWarningCode = "booking_clash"

# The wire statuses whose rows still matter to a Booking; every other row lists no clashes.
_CLASHING_READ_STATUSES = frozenset({PENDING_STATUS, ExceptionStatus.APPROVED.value})

# The only decisions there are, keyed by the status they leave. Approving a rejected row is
# allowed (an Admin changing their mind before it starts); declining an approved one is not,
# because undoing an approval always goes through cancel.
_DECIDABLE_FROM = {
    ExceptionStatus.APPROVED: frozenset({ExceptionStatus.PENDING, ExceptionStatus.REJECTED}),
    ExceptionStatus.REJECTED: frozenset({ExceptionStatus.PENDING}),
}
_CANCELLABLE = frozenset({ExceptionStatus.PENDING, ExceptionStatus.APPROVED})

logger = logging.getLogger(__name__)


class ExceptionRequestError(Exception):
    """Base class for every failure this module reports."""


class UserNotFound(ExceptionRequestError):
    """No `users` row for the requested id. Only an Admin role gets this far."""


class UserArchived(ExceptionRequestError):
    """The target user is archived, so nobody may enter Time off for them."""


class ExceptionNotFound(ExceptionRequestError):
    """No `tutor_availability_exceptions` row for the requested id."""


class NotYourTimeOff(ExceptionRequestError):
    """Someone other than the owner or an Admin role reached for the row or the person."""


class DeveloperTimeOff(ExceptionRequestError):
    """A non-Developer reached for a Developer's Time off."""


class WindowEnded(ExceptionRequestError):
    """A Tutor or Manager asked for Time off whose window has already ended."""


class ExceptionAlreadyDecided(ExceptionRequestError):
    """The decision is not a move the row's status allows (approved is final, rejected once)."""


class ExceptionCancelled(ExceptionRequestError):
    """A decision on a cancelled row."""


class ExceptionEnded(ExceptionRequestError):
    """A decision or a cancel on a row whose window has ended (Expired included)."""


class ExceptionNotCancellable(ExceptionRequestError):
    """A cancel on a row that is neither pending nor approved."""


@dataclass(frozen=True)
class Clash:
    """A live Booking inside a Time off row's window."""

    booking_id: uuid.UUID
    date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    child_name: str
    status: BookingStatus


class UnconfirmedBookingClash(ExceptionRequestError):
    """The write would land a row approved over live Bookings and `booking_clash` was not
    confirmed. Nothing was written. `clashes` are those Bookings, ordered as a read lists them."""

    def __init__(self, clashes: list[Clash]) -> None:
        super().__init__(f"{len(clashes)} clashing booking(s)")
        self.clashes = clashes


@dataclass(frozen=True)
class _Window:
    user_id: uuid.UUID
    start_date: datetime.date
    end_date: datetime.date
    start_time: datetime.time | None
    end_time: datetime.time | None


def create_exception(
    db: Session,
    *,
    actor_id: uuid.UUID,
    actor_role: UserRole,
    user_id: uuid.UUID,
    start_date: datetime.date,
    end_date: datetime.date,
    start_time: datetime.time | None,
    end_time: datetime.time | None,
    reason: str | None,
    confirm_warnings: frozenset[TimeOffWarningCode] = frozenset(),
) -> TutorAvailabilityException:
    """Record Time off for `user_id`, at the status the creator's role earns.

    Checked in this order: the caller may reach the person at all (before the lookup, so a
    requester probing another id gets 403 whether or not it exists), the person exists, the
    Developer boundary, the person is not archived, and a requester's window has not ended.
    An Admin role may log an ended window; it lands approved and is frozen from then on.
    An Admin role's entry over clashing Bookings needs `booking_clash` confirmed; a
    requester's pending entry never does.
    """
    _assert_may_reach(actor_id=actor_id, actor_role=actor_role, owner_id=user_id)

    staff = db.get(User, user_id)
    if staff is None:
        logger.warning("exception_service.create: actor %s, no user %s", actor_id, user_id)
        raise UserNotFound(f"no user {user_id}")

    _assert_developer_boundary(actor_id=actor_id, actor_role=actor_role, owner=staff)

    if staff.is_archived:
        logger.warning("exception_service.create: actor %s, user %s archived", actor_id, user_id)
        raise UserArchived(f"user {user_id} is archived")

    is_admin = actor_role in ADMIN_ROLES
    if not is_admin and has_ended(end_date=end_date, end_time=end_time, now=clock.business_now()):
        logger.warning("exception_service.create: actor %s filed an ended window", actor_id)
        raise WindowEnded(f"window ending {end_date} {end_time} has ended")

    if is_admin:
        window = _Window(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            start_time=start_time,
            end_time=end_time,
        )
        _assert_clashes_confirmed(
            db, window, confirm_warnings=confirm_warnings, actor_id=actor_id, operation="create"
        )

    row = TutorAvailabilityException(
        staff=staff,
        start_date=start_date,
        end_date=end_date,
        start_time=start_time,
        end_time=end_time,
        reason=reason,
        status=ExceptionStatus.PENDING,
        creator=db.get_one(User, actor_id),
    )
    if is_admin:
        _record_decision(db, row, decision=ExceptionStatus.APPROVED, actor_id=actor_id)
    db.add(row)
    db.flush()

    return row


def decide_exception(
    db: Session,
    *,
    actor_id: uuid.UUID,
    actor_role: UserRole,
    exception_id: uuid.UUID,
    decision: ExceptionStatus,
    confirm_warnings: frozenset[TimeOffWarningCode] = frozenset(),
) -> TutorAvailabilityException:
    """Approve or reject a live row. The caller has already established an Admin role.

    The Developer boundary is checked before the status, so a non-Developer learns nothing
    about a Developer's row. Then: cancelled, ended, whether the move is allowed, and last,
    for an approval, whether its clashing Bookings were confirmed. Rejecting never warns.
    """
    row = _lock(db, exception_id=exception_id, actor_id=actor_id)

    _assert_developer_boundary(actor_id=actor_id, actor_role=actor_role, owner=row.staff)

    if row.status is ExceptionStatus.CANCELLED:
        logger.warning("exception_service.decide: actor %s, %s is cancelled", actor_id, row.id)
        raise ExceptionCancelled(f"exception {exception_id} is cancelled")

    if _row_has_ended(row):
        logger.warning("exception_service.decide: actor %s, %s has ended", actor_id, row.id)
        raise ExceptionEnded(f"exception {exception_id} has ended")

    if row.status not in _DECIDABLE_FROM[decision]:
        logger.warning(
            "exception_service.decide: actor %s, %s %s -> %s refused",
            actor_id,
            row.id,
            row.status.value,
            decision.value,
        )
        raise ExceptionAlreadyDecided(f"exception {exception_id} is already {row.status.value}")

    if decision is ExceptionStatus.APPROVED:
        _assert_clashes_confirmed(
            db,
            _window_of(row),
            confirm_warnings=confirm_warnings,
            actor_id=actor_id,
            operation="decide",
        )

    _record_decision(db, row, decision=decision, actor_id=actor_id)
    db.flush()

    return row


def cancel_exception(
    db: Session, *, actor_id: uuid.UUID, actor_role: UserRole, exception_id: uuid.UUID
) -> TutorAvailabilityException:
    """Cancel a live (pending or approved, not ended) row, keeping it.

    Ownership first, status second, and the order is load-bearing: answering "not cancellable"
    to someone holding another person's id would tell them which of that person's requests have
    been ruled on. An id matching no row is 404 for everyone; another person's row is 403. That
    pair does reveal whether an id exists, and it is the constitution's deliberate choice
    (cross-user access is 403, never 404, never an empty 200).
    """
    row = _lock(db, exception_id=exception_id, actor_id=actor_id)

    _assert_may_reach(actor_id=actor_id, actor_role=actor_role, owner_id=row.user_id)
    _assert_developer_boundary(actor_id=actor_id, actor_role=actor_role, owner=row.staff)

    if row.status not in _CANCELLABLE:
        logger.warning(
            "exception_service.cancel: actor %s, %s is %s", actor_id, row.id, row.status.value
        )
        raise ExceptionNotCancellable(f"exception {exception_id} is {row.status.value}")

    if _row_has_ended(row):
        logger.warning("exception_service.cancel: actor %s, %s has ended", actor_id, row.id)
        raise ExceptionEnded(f"exception {exception_id} has ended")

    row.status = ExceptionStatus.CANCELLED
    row.canceller = db.get_one(User, actor_id)
    row.cancelled_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()

    return row


def list_exceptions(
    db: Session,
    *,
    actor_id: uuid.UUID,
    actor_role: UserRole,
    user_id: uuid.UUID,
    date_from: datetime.date | None = None,
    date_to: datetime.date | None = None,
    limit: int,
    offset: int,
) -> tuple[list[TutorAvailabilityException], int]:
    """One Staff member's Time off at every status, and the count before paging.

    Only the person themselves or an Office role may read it (a Developer's only a Developer).
    `pending`, `rejected` and `cancelled` rows come back beside the `approved` ones even though
    none of them blocks a booking: the list is how a requester sees a request is still waiting
    and how an Admin finds the ones left to decide.

    Each row comes back with `staff`, `decider`, `canceller` and `creator` loaded in a fixed number of
    queries for the page, never one per row.

    `date_from`/`date_to`, when given, narrow the result to rows that **overlap** the window
    rather than rows contained by it: `end_date >= date_from` and `start_date <= date_to`. A
    containment test (`start_date >= date_from`) would drop Time off that began before the
    window and runs through it — exactly the row a weekly grid exists to show.
    """
    _assert_may_read(actor_id=actor_id, actor_role=actor_role, owner_id=user_id)

    # An unknown id has no role and so no boundary to cross; it simply lists nothing.
    staff = db.get(User, user_id)
    if staff is not None:
        _assert_developer_boundary(actor_id=actor_id, actor_role=actor_role, owner=staff)

    matching = select(TutorAvailabilityException).where(
        TutorAvailabilityException.user_id == user_id
    )
    if date_from is not None:
        matching = matching.where(TutorAvailabilityException.end_date >= date_from)
    if date_to is not None:
        matching = matching.where(TutorAvailabilityException.start_date <= date_to)

    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0

    # `id` is the tiebreaker, not decoration: several rows on one `start_date` is the ordinary
    # case, and LIMIT/OFFSET over a sort key that does not distinguish them may order two
    # executions differently — so page two can repeat or skip a row page one already showed.
    rows = list(
        db.scalars(
            matching.options(
                joinedload(TutorAvailabilityException.staff),
                selectinload(TutorAvailabilityException.decider),
                selectinload(TutorAvailabilityException.canceller),
                selectinload(TutorAvailabilityException.creator),
            )
            .order_by(TutorAvailabilityException.start_date, TutorAvailabilityException.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return rows, total


def list_all_exceptions(
    db: Session,
    *,
    statuses: Collection[ExceptionReadStatus] = (),
    user_id: uuid.UUID | None = None,
    date_from: datetime.date | None = None,
    date_to: datetime.date | None = None,
    sort: str = SORT_BY_START,
    limit: int,
    offset: int,
    now: datetime.datetime,
) -> tuple[list[TutorAvailabilityException], int]:
    """Every Staff member's Time off, filtered, and the count before paging.

    The caller has already established an Office role. Developers' rows are always left out,
    even when `user_id` names one: the Developer stays hidden from this list for every caller.

    `statuses` are wire statuses, and a row at any of them matches; empty means no filter.
    `pending` is stored pending that has not ended and `expired` is stored pending that has,
    so the two never overlap. `date_from`/`date_to` overlap the
    window as in `list_exceptions`. `sort` is `start` (the default) or `requested`; `id` breaks
    ties in both so paging is stable. `now` is the caller's clock reading, so the status filter
    and the statuses the caller renders agree on a row ending between two reads.
    """
    matching = _matching_all_exceptions(
        statuses=statuses, user_id=user_id, date_from=date_from, date_to=date_to, now=now
    )
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0

    if sort == SORT_BY_REQUESTED:
        ordering = (TutorAvailabilityException.created_at, TutorAvailabilityException.id)
    else:
        ordering = (
            TutorAvailabilityException.start_date,
            TutorAvailabilityException.start_time.nulls_first(),
            TutorAvailabilityException.id,
        )

    rows = list(
        db.scalars(
            matching.options(
                joinedload(TutorAvailabilityException.staff),
                selectinload(TutorAvailabilityException.decider),
                selectinload(TutorAvailabilityException.canceller),
                selectinload(TutorAvailabilityException.creator),
            )
            .order_by(*ordering)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return rows, total


def count_all_exceptions(
    db: Session, *, status: ExceptionReadStatus | None, now: datetime.datetime
) -> int:
    """What `list_all_exceptions` totals for `status` with no other filter, without its rows."""
    matching = _matching_all_exceptions(
        statuses=() if status is None else (status,),
        user_id=None,
        date_from=None,
        date_to=None,
        now=now,
    )

    return db.scalar(select(func.count()).select_from(matching.subquery())) or 0


def has_ended(
    *, end_date: datetime.date, end_time: datetime.time | None, now: datetime.datetime
) -> bool:
    """Whether a window ending at `end_date`/`end_time` is over at `now`.

    A partial-day window ends at `end_date` + `end_time`; a whole-day one at the start of the
    day after `end_date`. Both are naive business wall-clock, the form `clock.business_now`
    returns. The end itself counts as ended: a window ending at 11:00 is over at 11:00.
    """
    if end_time is None:
        end = datetime.datetime.combine(end_date + datetime.timedelta(days=1), datetime.time.min)
    else:
        end = datetime.datetime.combine(end_date, end_time)

    return end <= now


def read_status(row: TutorAvailabilityException, *, now: datetime.datetime) -> str:
    """The wire status: the stored one, or `expired` for a pending row that has ended."""
    is_expired = row.status is ExceptionStatus.PENDING and has_ended(
        end_date=row.end_date, end_time=row.end_time, now=now
    )

    return EXPIRED_STATUS if is_expired else row.status.value


def clashes_by_exception(
    db: Session, rows: Sequence[TutorAvailabilityException], *, now: datetime.datetime
) -> dict[uuid.UUID, list[Clash]]:
    """Each row's clashing Bookings, ordered by date, start time and id, in one query.

    Only rows whose wire status at `now` is `pending` or `approved` are keyed; a caller reads a
    missing key as no clashes.
    """
    live_rows = [row for row in rows if read_status(row, now=now) in _CLASHING_READ_STATUSES]
    clashes = _find_clashes(db, [_window_of(row) for row in live_rows])

    return {row.id: row_clashes for row, row_clashes in zip(live_rows, clashes, strict=True)}


def _find_clashes(db: Session, windows: Sequence[_Window]) -> list[list[Clash]]:
    """Every window's clashes, in the windows' order, from one query over all of them."""
    if not windows:
        return []

    candidates = db.execute(
        select(Booking, Child.name)
        .join(Child, Booking.child_id == Child.id)
        .where(
            Booking.status.in_(LIVE_BOOKING_STATUSES),
            or_(
                *(
                    and_(
                        Booking.user_id == window.user_id,
                        Booking.scheduled_date.between(window.start_date, window.end_date),
                    )
                    for window in windows
                )
            ),
        )
        .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
    ).all()

    return [
        [
            Clash(
                booking_id=booking.id,
                date=booking.scheduled_date,
                start_time=booking.start_time,
                end_time=booking.end_time,
                child_name=child_name,
                status=booking.status,
            )
            for booking, child_name in candidates
            if _clashes_with(window, booking)
        ]
        for window in windows
    ]


def _clashes_with(window: _Window, booking: Booking) -> bool:
    # The same bare overlap, no gap padding, as rule 4's `_exception_blocks`, and the same rule
    # as `sort_out_service.time_off_clash_predicate` in SQL: keep the two in step. Unlike that
    # one, a Booking's clash acknowledgement doesn't count here: this is the Time off's view.
    if booking.user_id != window.user_id:
        return False
    if not window.start_date <= booking.scheduled_date <= window.end_date:
        return False
    if window.start_time is None or window.end_time is None:
        return True

    return scheduling_service.overlaps(
        booking.start_time, booking.end_time, window.start_time, window.end_time
    )


def _assert_clashes_confirmed(
    db: Session,
    window: _Window,
    *,
    confirm_warnings: frozenset[TimeOffWarningCode],
    actor_id: uuid.UUID,
    operation: str,
) -> None:
    """Refuse a write landing `window` approved over Bookings unless `booking_clash` is
    confirmed. Confirmed, the query is skipped: nothing would come of it."""
    if BOOKING_CLASH_WARNING in confirm_warnings:
        return

    [clashes] = _find_clashes(db, [window])
    if clashes:
        logger.warning(
            "exception_service.%s: actor %s, user %s, %d unconfirmed clash(es)",
            operation,
            actor_id,
            window.user_id,
            len(clashes),
        )
        raise UnconfirmedBookingClash(clashes)


def _window_of(row: TutorAvailabilityException) -> _Window:
    return _Window(
        user_id=row.user_id,
        start_date=row.start_date,
        end_date=row.end_date,
        start_time=row.start_time,
        end_time=row.end_time,
    )


def _matching_all_exceptions(
    *,
    statuses: Collection[ExceptionReadStatus],
    user_id: uuid.UUID | None,
    date_from: datetime.date | None,
    date_to: datetime.date | None,
    now: datetime.datetime,
) -> Select[tuple[TutorAvailabilityException]]:
    # An inner join to `users` on a non-null FK: one row per exception, so `total` stays a count.
    matching = (
        select(TutorAvailabilityException)
        .join(User, TutorAvailabilityException.user_id == User.id)
        .where(User.role != UserRole.DEVELOPER)
    )
    if user_id is not None:
        matching = matching.where(TutorAvailabilityException.user_id == user_id)
    if date_from is not None:
        matching = matching.where(TutorAvailabilityException.end_date >= date_from)
    if date_to is not None:
        matching = matching.where(TutorAvailabilityException.start_date <= date_to)
    if statuses:
        matching = matching.where(
            or_(*(_matches_wire_status(status, now=now) for status in statuses))
        )

    return matching


def user_ids_with_pending_time_off(
    db: Session, user_ids: Sequence[uuid.UUID], *, now: datetime.datetime
) -> set[uuid.UUID]:
    """Which of `user_ids` have Time off whose wire status is `pending` (Expired excluded)."""
    if not user_ids:
        return set()

    return set(
        db.scalars(
            select(TutorAvailabilityException.user_id)
            .where(
                TutorAvailabilityException.user_id.in_(user_ids),
                _matches_wire_status(PENDING_STATUS, now=now),
            )
            .distinct()
        )
    )


def _matches_wire_status(
    status: ExceptionReadStatus, *, now: datetime.datetime
) -> ColumnElement[bool]:
    """SQL form of `read_status`: the same end rule as `has_ended`, evaluated by the database."""
    if status not in (PENDING_STATUS, EXPIRED_STATUS):
        return TutorAvailabilityException.status == ExceptionStatus(status)

    # A whole-day window ends at the start of the day after `end_date`; a partial-day one at
    # `end_time`, and the end itself counts as ended.
    has_ended_sql = or_(
        TutorAvailabilityException.end_date < now.date(),
        and_(
            TutorAvailabilityException.end_date == now.date(),
            TutorAvailabilityException.end_time.is_not(None),
            TutorAvailabilityException.end_time <= now.time(),
        ),
    )
    is_pending = TutorAvailabilityException.status == ExceptionStatus.PENDING
    if status == EXPIRED_STATUS:
        return and_(is_pending, has_ended_sql)

    return and_(is_pending, ~has_ended_sql)


def _lock(
    db: Session, *, exception_id: uuid.UUID, actor_id: uuid.UUID
) -> TutorAvailabilityException:
    """Load and lock the row for the rest of the transaction. Raises unless it exists.

    Locked because two writers would otherwise both read the same status and both write: two
    Admins deciding at once, or an owner cancelling while an Admin decides, would let whichever
    committed second silently overwrite the other. The waiter re-reads the changed row and is
    refused by the status checks.
    """
    row = db.execute(
        select(TutorAvailabilityException)
        .where(TutorAvailabilityException.id == exception_id)
        .with_for_update()
    ).scalar_one_or_none()

    if row is None:
        logger.warning("exception_service: actor %s, no exception %s", actor_id, exception_id)
        raise ExceptionNotFound(f"no exception {exception_id}")

    return row


def _assert_may_reach(*, actor_id: uuid.UUID, actor_role: UserRole, owner_id: uuid.UUID) -> None:
    """The owner, or an Admin role. Needs no lookup, so it runs before any."""
    if actor_id != owner_id and actor_role not in ADMIN_ROLES:
        logger.warning("exception_service: actor %s refused user %s's time off", actor_id, owner_id)
        raise NotYourTimeOff(f"user {owner_id} is not {actor_id}")


def _assert_may_read(*, actor_id: uuid.UUID, actor_role: UserRole, owner_id: uuid.UUID) -> None:
    """The owner, or an Office role: a Manager reads anyone's Time off but writes only their own."""
    if actor_id != owner_id and actor_role not in OFFICE_ROLES:
        logger.warning("exception_service: actor %s refused user %s's time off", actor_id, owner_id)
        raise NotYourTimeOff(f"user {owner_id} is not {actor_id}")


def _assert_developer_boundary(*, actor_id: uuid.UUID, actor_role: UserRole, owner: User) -> None:
    """A Developer's Time off is reserved for Developers, as their account is (#173)."""
    if owner.role is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        logger.warning(
            "exception_service: actor %s refused developer %s's time off", actor_id, owner.id
        )
        raise DeveloperTimeOff(f"user {owner.id} is a developer")


def _record_decision(
    db: Session,
    row: TutorAvailabilityException,
    *,
    decision: ExceptionStatus,
    actor_id: uuid.UUID,
) -> None:
    # Overwrites an earlier decision: only the latest is kept, there is no history table. Set
    # through the relationship, not the column, so a `decider` already loaded on this session
    # cannot go on naming the earlier Admin. The actor is in the identity map from auth.
    row.status = decision
    row.decider = db.get_one(User, actor_id)
    row.decided_at = datetime.datetime.now(tz=datetime.UTC)


def _row_has_ended(row: TutorAvailabilityException) -> bool:
    return has_ended(end_date=row.end_date, end_time=row.end_time, now=clock.business_now())
