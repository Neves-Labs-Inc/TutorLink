"""The one-field status transition on a booking (REQ-044.25, REQ-044.26, #151, #152).

This module knows nothing about FastAPI, status codes, or request bodies; it raises the
domain exceptions below and `app.routers.booking_status` maps them.

**Transaction contract.** Nothing here commits: the caller owns the transaction boundary.

`LEGAL_TRANSITIONS` is the single authority for what move is allowed — a lookup table, not a
chain of `if` branches. `cancelled` is terminal: every move out of it, including a restatement
of the current status, is refused. `completed` is not: the Office may revert it to `confirmed`
(#152), which re-enters the set `excl_bookings_live_overlap` and
`uq_bookings_one_live_evaluation_per_child` cover (`LIVE_BOOKING_STATUSES` in
`app.models.booking`). That is why the write runs inside a savepoint and translates the two
`IntegrityError`s the way `POST /api/bookings` does: the constraints are the guarantee, and the
pre-checks here are only the readable refusals.

**Who may move what.** An internal caller (the bot, `child_service`) passes no `actor` and gets
the whole table. The Office gets the whole table too. A Tutor gets one cell — their own
`confirmed` booking to `completed`, once its start has passed on the business clock
(`clock.business_now`) — and is refused everything else as *not theirs* / *Office only* (the
router's 403s) or *illegal* / *too early* (its 409s).

**Stale check.** `expected_updated_at` is the bot's race guard (spec 03): when it is given
(timezone-aware, like the column) and differs from the row's `updated_at` as read under the
lock, nothing is written and `BookingChanged` is raised.
"""

import datetime
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.booking import LIVE_BOOKING_STATUSES, Booking
from app.models.child import Child
from app.models.enums import BookingKind, BookingStatus
from app.services import clock

logger = logging.getLogger(__name__)

LEGAL_TRANSITIONS: dict[BookingStatus, frozenset[BookingStatus]] = {
    BookingStatus.PENDING: frozenset({BookingStatus.CONFIRMED, BookingStatus.CANCELLED}),
    BookingStatus.CONFIRMED: frozenset({BookingStatus.CANCELLED, BookingStatus.COMPLETED}),
    BookingStatus.CANCELLED: frozenset(),
    BookingStatus.COMPLETED: frozenset({BookingStatus.CONFIRMED}),
}

# The one move a Tutor may make on their own booking (#152).
TUTOR_TRANSITION = (BookingStatus.CONFIRMED, BookingStatus.COMPLETED)

# PostgreSQL SQLSTATEs the savepoint translates; anything else is not ours and propagates.
EXCLUSION_VIOLATION_SQLSTATE = "23P01"
UNIQUE_VIOLATION_SQLSTATE = "23505"


@dataclass(frozen=True)
class Actor:
    """Who is asking. `is_office` callers get the whole table; everyone else is a Tutor."""

    user_id: uuid.UUID
    is_office: bool


class BookingStatusError(Exception):
    """Base class for every failure this module reports."""


class BookingNotFound(BookingStatusError):
    """No `bookings` row for the requested id."""


class IllegalTransition(BookingStatusError):
    """The requested status is not a legal move from the row's current status."""

    def __init__(self, *, current: BookingStatus, target: BookingStatus) -> None:
        self.current = current
        self.target = target
        super().__init__(f"cannot move booking from {current.value} to {target.value}")


class NotBookingOwner(BookingStatusError):
    """A Tutor asked to move a booking whose Staff member is someone else."""


class OfficeOnlyTransition(BookingStatusError):
    """A Tutor asked for a move only the Office may make."""


class TooEarlyToComplete(BookingStatusError):
    """A Tutor asked to complete a booking whose start has not passed yet."""


class BookingChanged(BookingStatusError):
    """The row's `updated_at` is not the one the caller picked (`expected_updated_at`)."""


class RevertOverlaps(BookingStatusError):
    """Reverting to `confirmed` would overlap another live booking of the Staff member."""


class ChildAlreadyEvaluated(BookingStatusError):
    """Reverting an Evaluation for a Child who has been marked Evaluated since."""


class LiveEvaluationExists(BookingStatusError):
    """Reverting an Evaluation would give the Child a second live one."""


def change_status(
    db: Session,
    *,
    booking_id: uuid.UUID,
    target: BookingStatus,
    actor: Actor | None = None,
    expected_updated_at: datetime.datetime | None = None,
) -> Booking:
    """Move `booking_id` to `target`, if `LEGAL_TRANSITIONS` (and `actor`'s role) allows it."""
    # Locked for the rest of the transaction: two callers changing the same booking
    # concurrently would otherwise both read the same status and both write, so whichever
    # committed second would silently overwrite the other's transition. The second waiter
    # reads the decided row and gets the 409.
    #
    # `populate_existing`: the bot has already loaded this booking into the same session, and
    # a plain select hands back that cached object untouched. The lock would then be real but
    # the `updated_at` compared below would be the pre-lock one, and the stale check could
    # never fire.
    row = db.execute(
        select(Booking)
        .where(Booking.id == booking_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()

    if row is None:
        raise BookingNotFound(f"no booking {booking_id}")

    if actor is not None and not actor.is_office:
        _assert_tutor_may_move(row, actor=actor, target=target)

    if target not in LEGAL_TRANSITIONS[row.status]:
        raise IllegalTransition(current=row.status, target=target)

    if actor is not None and not actor.is_office:
        _assert_start_has_passed(row)

    if expected_updated_at is not None and expected_updated_at.tzinfo is None:
        raise ValueError("expected_updated_at must be timezone-aware")

    if expected_updated_at is not None and expected_updated_at != row.updated_at:
        logger.warning(
            "booking_status: booking %s changed since it was picked (%s != %s)",
            booking_id,
            expected_updated_at,
            row.updated_at,
        )
        raise BookingChanged(f"booking {booking_id} changed since it was picked")

    # Only the revert re-enters the live set; confirming a pending Evaluation changes nothing
    # about the Child's one-live-Evaluation guarantee and is left exactly as it was.
    if row.status is BookingStatus.COMPLETED and row.kind is BookingKind.EVALUATION:
        _assert_evaluation_may_go_live(db, row)

    _write_status(db, row, target=target)

    return row


def _assert_tutor_may_move(row: Booking, *, actor: Actor, target: BookingStatus) -> None:
    """A Tutor's cell of the table: their own booking, and only `TUTOR_TRANSITION`'s target."""
    if row.user_id != actor.user_id:
        logger.warning(
            "booking_status: user %s is not the Staff member on booking %s", actor.user_id, row.id
        )
        raise NotBookingOwner(f"booking {row.id} is not user {actor.user_id}'s")

    if target is not TUTOR_TRANSITION[1]:
        logger.warning(
            "booking_status: user %s asked for Office-only move to %s on booking %s",
            actor.user_id,
            target.value,
            row.id,
        )
        raise OfficeOnlyTransition(f"only the Office may move a booking to {target.value}")


def _assert_start_has_passed(row: Booking) -> None:
    start = datetime.datetime.combine(row.scheduled_date, row.start_time)

    if clock.business_now() < start:
        logger.warning("booking_status: booking %s has not started yet (%s)", row.id, start)
        raise TooEarlyToComplete(f"booking {row.id} starts at {start}")


def _assert_evaluation_may_go_live(db: Session, row: Booking) -> None:
    """The readable half of the Evaluation preconditions (#133); the partial unique index is
    the guarantee, translated from the savepoint below."""
    child = db.get_one(Child, row.child_id)

    if child.evaluated_at is not None:
        logger.warning(
            "booking_status: Child %s is already Evaluated, cannot revert %s", child.id, row.id
        )
        raise ChildAlreadyEvaluated(f"Child {child.id} is already Evaluated")

    another_live = db.scalar(
        select(
            exists().where(
                Booking.child_id == row.child_id,
                Booking.id != row.id,
                Booking.kind == BookingKind.EVALUATION,
                Booking.status.in_(LIVE_BOOKING_STATUSES),
            )
        )
    )
    if another_live:
        logger.warning(
            "booking_status: Child %s already has a live Evaluation, cannot revert %s",
            child.id,
            row.id,
        )
        raise LiveEvaluationExists(f"Child {child.id} already has a live Evaluation")


def _write_status(db: Session, row: Booking, *, target: BookingStatus) -> None:
    """Assign and flush inside a savepoint, so a constraint refusal leaves the `Session` usable.

    Same shape as `booking_write_service`: the savepoint wraps the assignment and the flush and
    nothing else, so no unrelated failure is mislabelled, and the constraint is matched by its
    SQLSTATE rather than its rendered name (a migrated database and a `create_all` one do not
    agree on names).
    """
    try:
        with db.begin_nested():
            row.status = target
            db.flush()
    except IntegrityError as exc:
        sqlstate = getattr(exc.orig, "sqlstate", None)
        if sqlstate == EXCLUSION_VIOLATION_SQLSTATE:
            logger.warning("booking_status: reverting %s overlaps a live booking", row.id)
            raise RevertOverlaps(f"booking {row.id} would overlap") from exc
        if sqlstate == UNIQUE_VIOLATION_SQLSTATE:
            logger.warning("booking_status: reverting %s makes a second live Evaluation", row.id)
            raise LiveEvaluationExists(
                f"booking {row.id} would be a second live Evaluation"
            ) from exc
        raise
