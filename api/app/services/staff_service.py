"""The Office's Staff read: Tutors, Managers and Admins, archived or not (#212).

Separate from `user_service` because the rule is a different one. `/api/users` manages
accounts, Developers included; this is who the Office works with, and a Developer is never in
it. Only `users.is_archived` decides who is active — `tutors.is_active` is not consulted, the
same rule `POST /api/bookings` applies.

`build_staff_rows` is the one row assembly: any route that answers with Staff rows passes it
the users and gets rows back, in a fixed number of queries however long the page.
"""

import datetime
import uuid
from collections import defaultdict
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from sqlalchemy import ColumnElement, Select, exists, func, select
from sqlalchemy.orm import Session

from app.models.booking import Booking, upcoming_live_bookings
from app.models.enums import UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.schemas.staff import AssignedChildRead, StaffRead, StaffSubjectRead
from app.services import clock
from app.services.assigned_tutor_service import assigned_children_by_user
from app.services.password_link_service import live_invite_expiries
from app.services.sign_in_state import SignInState, sign_in_state_expression, sign_in_states

STAFF_ROLES = frozenset({UserRole.TUTOR, UserRole.MANAGER, UserRole.ADMIN})
# The roles whose profile's subject assignments count. An Admin who kept a profile after
# promotion no longer teaches, so their old assignments neither show nor match.
TEACHING_ROLES = frozenset({UserRole.TUTOR, UserRole.MANAGER})
SUNDAY = 6


class StaffNotFound(Exception):
    pass


@dataclass(frozen=True)
class StaffFilters:
    """AND across fields, OR within one. `None` or empty means "don't filter on it"."""

    is_archived: bool | None = None
    roles: Collection[UserRole] = ()
    sign_in_states: Collection[SignInState] = ()
    subject_id: uuid.UUID | None = None


def list_staff(
    db: Session, *, filters: StaffFilters, limit: int, offset: int
) -> tuple[list[StaffRead], int]:
    """Rows for one page ordered by name then id, plus the total matching before paging."""
    matching = _staff().where(*_conditions(filters))
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0
    users = list(
        db.scalars(matching.order_by(User.name, User.id).limit(limit).offset(offset)).all()
    )

    return build_staff_rows(db, users), total


def get_staff(db: Session, *, user_id: uuid.UUID) -> StaffRead:
    user = db.scalar(_staff().where(User.id == user_id))

    if user is None:
        raise StaffNotFound

    return build_staff_rows(db, [user])[0]


def build_staff_rows(
    db: Session, users: Sequence[User], *, now: datetime.datetime | None = None
) -> list[StaffRead]:
    """One row per user, in the order given: one query each for profiles, sign-in states,
    Invite expiries, subjects, session counts and assigned Children, never one per row. `now` is the moment
    Invite expiries are judged at; a caller that just issued an Invite passes the `now` it
    issued with."""
    ids = [user.id for user in users]
    profile_ids = _profile_ids(db, ids)
    states = sign_in_states(db, user_ids=ids)
    expiries = live_invite_expiries(
        db, user_ids=ids, now=now or datetime.datetime.now(datetime.UTC)
    )
    teacher_ids = [user.id for user in users if user.role in TEACHING_ROLES]
    subjects = _subjects(db, teacher_ids)
    sessions = _sessions_this_week(db, ids)
    assigned_children = assigned_children_by_user(db, user_ids=ids)

    return [
        StaffRead(
            id=user.id,
            name=user.name,
            role=user.role,
            tutor_id=profile_ids.get(user.id),
            email=user.email,
            sign_in_state=states[user.id],
            invite_expires_at=expiries.get(user.id),
            archived=user.is_archived,
            subjects=subjects.get(user.id, []),
            sessions_this_week=sessions.get(user.id, 0),
            assigned_children=[
                AssignedChildRead(id=child.id, name=child.name)
                for child in assigned_children[user.id]
            ],
        )
        for user in users
    ]


def _staff() -> Select[tuple[User]]:
    return select(User).where(User.role.in_(STAFF_ROLES))


def _conditions(filters: StaffFilters) -> list[ColumnElement[bool]]:
    conditions: list[ColumnElement[bool]] = []

    if filters.is_archived is not None:
        conditions.append(User.is_archived.is_(filters.is_archived))
    if filters.roles:
        conditions.append(User.role.in_(filters.roles))
    if filters.sign_in_states:
        wanted = [state.value for state in filters.sign_in_states]
        conditions.append(sign_in_state_expression().in_(wanted))
    if filters.subject_id is not None:
        teaches = exists().where(
            Tutor.user_id == User.id,
            TutorSubject.tutor_id == Tutor.id,
            TutorSubject.subject_id == filters.subject_id,
        )
        conditions.append(User.role.in_(TEACHING_ROLES) & teaches)

    return conditions


def _profile_ids(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
    # Queried rather than read off `user.profile`, so a caller that didn't load the
    # relationship doesn't cost one lazy load per row.
    if not user_ids:
        return {}

    rows = db.execute(select(Tutor.user_id, Tutor.id).where(Tutor.user_id.in_(user_ids))).all()

    return {user_id: tutor_id for user_id, tutor_id in rows}


def _subjects(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[StaffSubjectRead]]:
    """Archived subjects included, ordered by name; the grade ceiling is not on the row."""
    if not user_ids:
        return {}

    rows = db.execute(
        select(Tutor.user_id, Subject.id, Subject.name)
        .join(TutorSubject, TutorSubject.tutor_id == Tutor.id)
        .join(Subject, Subject.id == TutorSubject.subject_id)
        .where(Tutor.user_id.in_(user_ids))
        .order_by(Subject.name, Subject.id)
    ).all()
    by_user: defaultdict[uuid.UUID, list[StaffSubjectRead]] = defaultdict(list)
    for user_id, subject_id, name in rows:
        by_user[user_id].append(StaffSubjectRead(id=subject_id, name=name))

    return by_user


def _sessions_this_week(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Live Bookings starting after now, through the Sunday of this Monday-Sunday week."""
    if not user_ids:
        return {}

    now = clock.business_now()
    sunday = now.date() + datetime.timedelta(days=SUNDAY - now.date().weekday())
    rows = db.execute(
        select(Booking.user_id, func.count())
        .where(
            Booking.user_id.in_(user_ids),
            upcoming_live_bookings(now),
            Booking.scheduled_date <= sunday,
        )
        .group_by(Booking.user_id)
    ).all()

    return {user_id: count for user_id, count in rows}
