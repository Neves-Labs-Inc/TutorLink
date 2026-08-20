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

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_ROLES
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


def _initial_status(creator_role: UserRole) -> ExceptionStatus:
    """An admin's own entry is approved on the spot; a tutor's is pending.

    Not a uniform `PENDING`. Exceptions were admin-managed and immediately blocking before the
    status column existed, so making an admin's entry pending would both regress that
    behaviour and force the admin to approve their own request — a gate with nobody on the
    other side of it. The gate exists to put a second person between a tutor and their own
    availability, and there is no second person to add when the admin is already the one
    typing.
    """
    if creator_role in ADMIN_ROLES:
        status = ExceptionStatus.APPROVED
    else:
        status = ExceptionStatus.PENDING

    return status
