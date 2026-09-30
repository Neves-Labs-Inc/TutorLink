"""The one-field status transition on a booking (REQ-044.25, REQ-044.26).

This module knows nothing about FastAPI, status codes, or request bodies; it raises the
domain exceptions below and `app.routers.booking_status` maps them.

**Transaction contract.** Nothing here commits: the caller owns the transaction boundary.

`LEGAL_TRANSITIONS` is the single authority for what move is allowed — a lookup table, not a
chain of `if` branches. `cancelled` and `completed` are terminal: every move out of either,
including a restatement of the current status, is refused. This is why terminal matters
mechanically and not just semantically — a transition back into `pending` or `confirmed` would
re-enter the set `excl_bookings_live_overlap` covers (`LIVE_BOOKING_STATUSES` in
`app.models.booking`), and `PATCH` could then violate that constraint the way `POST
/api/bookings` does, needing the same savepoint-and-`IntegrityError` machinery. Under this table
it cannot, and this module deliberately carries none of that machinery. **If `LEGAL_TRANSITIONS`
ever grows a transition back into a live status, this module must grow that machinery with it.**
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.enums import BookingStatus

LEGAL_TRANSITIONS: dict[BookingStatus, frozenset[BookingStatus]] = {
    BookingStatus.PENDING: frozenset({BookingStatus.CONFIRMED, BookingStatus.CANCELLED}),
    BookingStatus.CONFIRMED: frozenset({BookingStatus.CANCELLED, BookingStatus.COMPLETED}),
    BookingStatus.CANCELLED: frozenset(),
    BookingStatus.COMPLETED: frozenset(),
}


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


def change_status(db: Session, *, booking_id: uuid.UUID, target: BookingStatus) -> Booking:
    """Move `booking_id` to `target`, if `LEGAL_TRANSITIONS` allows it from its current status."""
    # Locked for the rest of the transaction: two callers changing the same booking
    # concurrently would otherwise both read the same status and both write, so whichever
    # committed second would silently overwrite the other's transition. The second waiter
    # reads the decided row and gets the 409.
    row = db.execute(
        select(Booking).where(Booking.id == booking_id).with_for_update()
    ).scalar_one_or_none()

    if row is None:
        raise BookingNotFound(f"no booking {booking_id}")

    if target not in LEGAL_TRANSITIONS[row.status]:
        raise IllegalTransition(current=row.status, target=target)

    row.status = target
    db.flush()

    return row
