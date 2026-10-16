"""Every Office badge in one read (#210): each number is the `total` of the list it badges.

Nothing here matches rows itself. Each count is the owning module's count over its list's own
matching query, so a badge and the list it opens can never disagree, and a later change to one
list's rule (say, what makes a Booking to sort out) reaches its badge with no edit here. Only
`COUNT` queries run; no rows are loaded.

`now` is the naive business wall-clock (`clock.business_now`), read once by the caller so every
time-dependent count sees the same moment.
"""

import datetime
import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.dependencies import ADMIN_ROLES
from app.models.enums import UserRole
from app.services.booking_service import BookingFilters, count_bookings
from app.services.child_read_service import count_children_needing_tutor, count_evaluable_children
from app.services.conversation_service import count_conversations
from app.services.exception_service import PENDING_STATUS, count_all_exceptions
from app.services.sort_out_service import sort_out_staff_limit


@dataclass(frozen=True, slots=True)
class Counts:
    needs_attention: int
    # None for a Manager: they can read Time off but never decide it, so To do doesn't show
    # them requests waiting for an Admin.
    time_off_pending: int | None
    children_awaiting_evaluation: int
    children_needing_tutor: int
    bookings_to_sort_out: int
    unread_chats: int


def read_counts(
    db: Session, *, role: UserRole, user_id: uuid.UUID, now: datetime.datetime
) -> Counts:
    """The badges an Office caller sees: what their own list reads would total right now."""
    to_sort_out = BookingFilters(
        to_sort_out=True, now=now, staff_user_id=sort_out_staff_limit(role, user_id)
    )
    time_off_pending = (
        count_all_exceptions(db, status=PENDING_STATUS, now=now) if role in ADMIN_ROLES else None
    )

    return Counts(
        needs_attention=count_conversations(db, flagged=True),
        time_off_pending=time_off_pending,
        children_awaiting_evaluation=count_evaluable_children(db),
        children_needing_tutor=count_children_needing_tutor(db),
        bookings_to_sort_out=count_bookings(db, tutor_id=None, filters=to_sort_out),
        unread_chats=count_conversations(db, unread=True),
    )
