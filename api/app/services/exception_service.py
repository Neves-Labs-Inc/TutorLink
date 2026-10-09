"""Creating tutor time-off requests, and the admin decision that makes one binding.

An exception only blocks bookings once it is `APPROVED`. That is the whole point of the
status: before this module existed, every row in `tutor_availability_exceptions` was written
by an admin and blocked immediately, so a tutor could not ask for time off without someone
editing the table for them. A tutor's own request now lands as `PENDING` and changes nothing
about their availability until an admin decides it.

This module knows nothing about FastAPI, status codes, or request bodies; it raises the
domain exceptions below and `app.routers.exceptions` maps them.

**Transaction contract — read this before calling.** Nothing here commits: the caller owns the
transaction boundary, as in `auth_service`. `decide_exception` takes a row lock that is only
released by that commit or rollback, so a caller that holds the transaction open across
further work holds the lock with it.
"""

import datetime
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import OFFICE_ROLES
from app.models.availability import TutorAvailabilityException
from app.models.enums import ExceptionStatus, UserRole
from app.models.tutor import Tutor


class ExceptionRequestError(Exception):
    """Base class for every failure this module reports."""


class TutorNotFound(ExceptionRequestError):
    """No `tutors` row for the requested id.

    Only reachable by an admin or developer: a tutor's own `tutor_id` comes from their
    `users` row and is a foreign key, and `TutorScope` refuses any other id with a 403 before
    the route runs.
    """


class ExceptionNotFound(ExceptionRequestError):
    """No `tutor_availability_exceptions` row for the requested id."""


class ExceptionAlreadyDecided(ExceptionRequestError):
    """The row has already been approved or rejected, so there is nothing left to decide."""


class ExceptionNotDeletable(ExceptionRequestError):
    """A tutor tried to withdraw a request an admin has already decided."""


def create_exception(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    creator_role: UserRole,
    start_date: datetime.date,
    end_date: datetime.date,
    start_time: datetime.time | None,
    end_time: datetime.time | None,
    reason: str,
    notes: str | None,
) -> TutorAvailabilityException:
    """Record a time-off request for `tutor_id`, at the status the creator's role earns."""
    if db.get(Tutor, tutor_id) is None:
        raise TutorNotFound(f"no tutor {tutor_id}")

    row = TutorAvailabilityException(
        tutor_id=tutor_id,
        start_date=start_date,
        end_date=end_date,
        start_time=start_time,
        end_time=end_time,
        reason=reason,
        notes=notes,
        status=_initial_status(creator_role),
    )
    db.add(row)
    db.flush()

    return row


def decide_exception(
    db: Session, *, exception_id: uuid.UUID, decision: ExceptionStatus
) -> TutorAvailabilityException:
    """Move a pending exception to `decision`. Raises unless the row exists and is pending."""
    # Locked for the rest of the transaction: two admins deciding the same request
    # concurrently would otherwise both read `pending` and both write, so whichever committed
    # second would silently overwrite the other's decision — an approval quietly becoming a
    # rejection, or the reverse. The second waiter reads the decided row and gets the 409.
    row = db.execute(
        select(TutorAvailabilityException)
        .where(TutorAvailabilityException.id == exception_id)
        .with_for_update()
    ).scalar_one_or_none()

    if row is None:
        raise ExceptionNotFound(f"no exception {exception_id}")

    if row.status is not ExceptionStatus.PENDING:
        # Both decisions are terminal. Re-deciding an approved exception would let a second
        # admin unblock a tutor's time off without the first admin's approval ever appearing
        # to have been reversed, so the transition is refused rather than applied.
        raise ExceptionAlreadyDecided(f"exception {exception_id} is already {row.status.value}")

    row.status = decision
    db.flush()

    return row


def list_exceptions(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    date_from: datetime.date | None = None,
    date_to: datetime.date | None = None,
    limit: int,
    offset: int,
) -> tuple[list[TutorAvailabilityException], int]:
    """One tutor's exceptions at every status, and the count before paging.

    `pending` and `rejected` rows come back beside the `approved` ones even though neither
    blocks a booking. The list is how a tutor sees that a request is still waiting and how an
    admin finds the ones left to decide, so narrowing it to the rows that block availability
    would hide exactly the rows the page exists to show.

    `tutor_id` is never `None`. The only caller binds it from a `{tutor_id}` path segment
    through `TutorScope`, which has already refused a cross-tutor reach with a 403, and there
    is no route that wants every tutor's exceptions at once.

    `date_from`/`date_to`, when given, narrow the result to rows that **overlap** the window
    rather than rows contained by it: `end_date >= date_from` and `start_date <= date_to`. A
    containment test (`start_date >= date_from`) would drop an exception that began before the
    window and runs through it — exactly the row a weekly grid exists to show, since the tutor
    is unavailable for every day the row and the window share, not only the days the row starts
    on.
    """
    matching = select(TutorAvailabilityException).where(
        TutorAvailabilityException.tutor_id == tutor_id
    )
    if date_from is not None:
        matching = matching.where(TutorAvailabilityException.end_date >= date_from)
    if date_to is not None:
        matching = matching.where(TutorAvailabilityException.start_date <= date_to)

    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0

    # `id` is the tiebreaker, not decoration: a tutor booking a week off in pieces has several
    # rows on one `start_date`, and LIMIT/OFFSET over a sort key that does not distinguish them
    # may order two executions differently — so page two can repeat or skip a row page one
    # already showed.
    rows = list(
        db.scalars(
            matching.order_by(TutorAvailabilityException.start_date, TutorAvailabilityException.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return rows, total


def load_exception_for_delete(
    db: Session, *, exception_id: uuid.UUID
) -> TutorAvailabilityException:
    """Load and lock the row a caller is about to delete. Raises unless it exists.

    Split from `delete_exception` because the ownership check belongs to the router, which
    needs `row.tutor_id` to run it — and it has to run *before* the status gate, so a tutor
    holding another tutor's id cannot tell "not yours" from "already decided".

    Locked for the same reason `decide_exception` locks, in the other direction: without it a
    tutor could read their own request as `pending`, an admin could approve and commit, and the
    delete would still go through — erasing the decision the status gate exists to protect. The
    waiter re-reads the decided row and is refused.
    """
    row = db.execute(
        select(TutorAvailabilityException)
        .where(TutorAvailabilityException.id == exception_id)
        .with_for_update()
    ).scalar_one_or_none()

    if row is None:
        raise ExceptionNotFound(f"no exception {exception_id}")

    return row


def delete_exception(
    db: Session, *, exception: TutorAvailabilityException, actor_role: UserRole
) -> None:
    """Delete a loaded exception, if the actor's role permits it at that row's status.

    Staff (admin, manager, developer) delete any row whatever its status. That is deliberate and
    it is the only way back from a mistaken approval: `decide_exception` refuses to re-decide, so
    nothing else reverses one. A tutor deletes only a still-`pending` row — withdrawing a request
    nobody has acted on — because undoing a decision unilaterally, in either direction, is
    precisely what the staff gate exists to prevent.

    The row is really gone afterwards. `tutor_availability_exceptions` carries no `is_active`
    and nothing references it by foreign key, so there is no orphan and nothing to soft-delete.
    """
    if actor_role not in OFFICE_ROLES and exception.status is not ExceptionStatus.PENDING:
        raise ExceptionNotDeletable(f"exception {exception.id} is already {exception.status.value}")

    db.delete(exception)
    db.flush()


def _initial_status(creator_role: UserRole) -> ExceptionStatus:
    """An admin's own entry is approved on the spot; a tutor's is pending.

    Not a uniform `PENDING`. Exceptions were admin-managed and immediately blocking before the
    status column existed, so making an admin's entry pending would both regress that
    behaviour and force the admin to approve their own request — a gate with nobody on the
    other side of it. The gate exists to put a second person between a tutor and their own
    availability, and there is no second person to add when the admin is already the one
    typing.
    """
    if creator_role in OFFICE_ROLES:
        status = ExceptionStatus.APPROVED
    else:
        status = ExceptionStatus.PENDING

    return status
