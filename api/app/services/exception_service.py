"""The Time off lifecycle: who creates, decides and cancels a Staff member's Time off, and when.

An exception only blocks bookings once it is `APPROVED`. A Tutor's or Manager's own request
lands `PENDING` and changes nothing about their availability until an Admin role decides it;
an Admin's entry is approved on the spot (there is nobody above them to ask). Cancelling keeps
the row at `CANCELLED`, recording who and when, so the history survives.

Once a row's window has **ended** nothing changes it any more: no decide, no cancel. A pending
row that has ended reads `expired` on the wire (`read_status`). Nothing is stored for that and
no job runs; it is derived from the business clock on every read.

Who may touch whose Time off is decided here, not in the router, because the Developer
boundary needs the target's role and only this module loads it:

- the caller's own Time off, always;
- anyone's, for Admin roles, except that a Developer's is reserved for Developers;
- nobody else's, otherwise (a Manager reads and writes only their own).

This module knows nothing about FastAPI, status codes, or request bodies; it raises the
domain exceptions below and `app.routers.exceptions` maps them.

**Transaction contract — read this before calling.** Nothing here commits: the caller owns the
transaction boundary, as in `auth_service`. `decide_exception` and `cancel_exception` take a row
lock that is only released by that commit or rollback.
"""

import datetime
import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.dependencies import ADMIN_ROLES
from app.models.availability import TutorAvailabilityException
from app.models.enums import ExceptionStatus, UserRole
from app.models.user import User
from app.services import clock

EXPIRED_STATUS = "expired"

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
) -> TutorAvailabilityException:
    """Record Time off for `user_id`, at the status the creator's role earns.

    Checked in this order: the caller may reach the person at all (before the lookup, so a
    requester probing another id gets 403 whether or not it exists), the person exists, the
    Developer boundary, the person is not archived, and a requester's window has not ended.
    An Admin role may log an ended window; it lands approved and is frozen from then on.
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

    row = TutorAvailabilityException(
        staff=staff,
        start_date=start_date,
        end_date=end_date,
        start_time=start_time,
        end_time=end_time,
        reason=reason,
        status=ExceptionStatus.PENDING,
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
) -> TutorAvailabilityException:
    """Approve or reject a live row. The caller has already established an Admin role.

    The Developer boundary is checked before the status, so a non-Developer learns nothing
    about a Developer's row. Then: cancelled, ended, and finally whether the move is allowed.
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

    Only the person themselves or an Admin role may read it (a Developer's only a Developer).
    `pending`, `rejected` and `cancelled` rows come back beside the `approved` ones even though
    none of them blocks a booking: the list is how a requester sees a request is still waiting
    and how an Admin finds the ones left to decide.

    Each row comes back with `staff`, `decider` and `canceller` loaded in a fixed number of
    queries for the page, never one per row.

    `date_from`/`date_to`, when given, narrow the result to rows that **overlap** the window
    rather than rows contained by it: `end_date >= date_from` and `start_date <= date_to`. A
    containment test (`start_date >= date_from`) would drop Time off that began before the
    window and runs through it — exactly the row a weekly grid exists to show.
    """
    _assert_may_reach(actor_id=actor_id, actor_role=actor_role, owner_id=user_id)

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
            )
            .order_by(TutorAvailabilityException.start_date, TutorAvailabilityException.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return rows, total


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
