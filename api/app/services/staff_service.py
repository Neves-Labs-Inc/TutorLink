"""Who a Booking can be with: the active Tutors, Managers and Admins.

Separate from `user_service` because the rule is a different one. `/api/users` lists accounts
for an Admin to manage, Developers and deactivated people included behind a filter; this lists
the people the Office books sessions with, and no filter widens it. A Developer is never
bookable, and only `users.is_active` decides who is active — `tutors.is_active` is not
consulted, the same rule `POST /api/bookings` applies.
"""

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.models.enums import UserRole
from app.models.user import User

BOOKABLE_ROLES = frozenset({UserRole.TUTOR, UserRole.MANAGER, UserRole.ADMIN})


def _bookable() -> Select[tuple[User]]:
    return select(User).where(User.is_active.is_(True), User.role.in_(BOOKABLE_ROLES))


def list_staff(db: Session, *, limit: int, offset: int) -> tuple[list[User], int]:
    """Rows for one page ordered by name then id, plus the total before paging."""
    total = db.scalar(select(func.count()).select_from(_bookable().subquery())) or 0
    users = list(
        db.scalars(
            _bookable()
            .options(selectinload(User.profile))
            .order_by(User.name, User.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return users, total
