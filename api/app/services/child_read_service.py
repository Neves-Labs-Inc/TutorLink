"""The read path over `children` — `GET /api/children` and `GET /api/children/{id}`.

Reads live here and writes in `child_service`, the `booking_service` / `booking_write_service`
split (P7C-D): the two change for different reasons and are owned by different tasks. Same
transaction contract as every other service: nothing commits, the caller owns the boundary.

**The list runs a constant number of statements, whatever the page size**: the count, the page,
then one batched load each for the page's guardians, active homes and next sessions (§5.3). A
per-row lazy load would turn a page of 100 into 300 round trips, and nothing on a list row is
read through an ORM relationship for that reason.

"Upcoming" — both `next_session` and `upcoming_session_count` — is `upcoming_live_bookings(now)`,
the predicate a deactivation cancels by (P7C-O, P7C-T), so the number an admin confirms and the
rows `PATCH` cancels cannot be defined differently. `now` is the naive business wall-clock
(`clock.business_now`, per `BUSINESS_TIMEZONE`), which is also where a test freezes it.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.booking import Booking, upcoming_live_bookings
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.models.subject import Subject
from app.services import clock

_LIKE_ESCAPE = "\\"
_LIKE_WILDCARDS = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


@dataclass(frozen=True, slots=True)
class ChildRow:
    child: Child
    guardians: list[Guardian]
    homes: list[Home]
    next_session: Booking | None


@dataclass(frozen=True, slots=True)
class ChildDetailRow:
    child: Child
    guardians: list[Guardian]
    homes: list[Home]
    upcoming_session_count: int
    levels: list[ChildSubjectLevel]


class ChildReadServiceError(Exception):
    """Base class for every failure this module reports."""


class ChildNotFound(ChildReadServiceError):
    """No child with that id."""


def list_children(
    db: Session,
    *,
    is_active: bool,
    q: str | None,
    limit: int,
    offset: int,
    awaiting_evaluation: bool = False,
) -> tuple[list[ChildRow], int]:
    """Rows for one page, plus the total matching before paging.

    `homes` on a row is the child's active homes only (A-66); `guardians` is every linked
    guardian, active or not.

    `awaiting_evaluation` narrows to active Children who aren't Evaluated, whatever
    `is_active` says, oldest first: the Child waiting longest leads the tab.
    """
    if awaiting_evaluation:
        matching = _matching(is_active=True, q=q).where(Child.evaluated_at.is_(None))
        order = (Child.created_at, Child.id)
    else:
        matching = _matching(is_active=is_active, q=q)
        order = (Child.name, Child.id)

    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0
    children = list(
        db.scalars(
            matching.order_by(*order)
            .limit(limit)
            .offset(offset)
            .options(selectinload(Child.evaluated_by))
        ).all()
    )
    child_ids = [child.id for child in children]
    guardians = _guardians_by_child(db, child_ids=child_ids)
    homes = _homes_by_child(db, child_ids=child_ids, only_active=True)
    next_sessions = _next_sessions_by_child(db, child_ids=child_ids)
    rows = [
        ChildRow(
            child=child,
            guardians=guardians[child.id],
            homes=homes[child.id],
            next_session=next_sessions.get(child.id),
        )
        for child in children
    ]

    return rows, total


def get_child(db: Session, *, child_id: uuid.UUID) -> ChildDetailRow:
    """The child whatever its `is_active` state, with **every** linked home, deactivated ones
    included — the by-id rule (§9) and §5.4."""
    child = db.get(Child, child_id)

    if child is None:
        raise ChildNotFound

    upcoming_session_count = (
        db.scalar(
            select(func.count())
            .select_from(Booking)
            .where(Booking.child_id == child.id, upcoming_live_bookings(clock.business_now()))
        )
        or 0
    )

    levels = list(
        db.scalars(
            select(ChildSubjectLevel)
            .join(Subject, Subject.id == ChildSubjectLevel.subject_id)
            .where(ChildSubjectLevel.child_id == child.id)
            .order_by(Subject.name, Subject.id)
            .options(joinedload(ChildSubjectLevel.subject), joinedload(ChildSubjectLevel.set_by))
        ).all()
    )

    return ChildDetailRow(
        child=child,
        guardians=_guardians_by_child(db, child_ids=[child.id])[child.id],
        homes=_homes_by_child(db, child_ids=[child.id], only_active=False)[child.id],
        upcoming_session_count=upcoming_session_count,
        levels=levels,
    )


def _matching(*, is_active: bool, q: str | None) -> Select[tuple[Child]]:
    """The guardian-name match is a correlated `EXISTS`, never a join: `total` counts this
    statement, and a child with two matching guardians would otherwise be counted twice (§8)."""
    statement = select(Child).where(Child.is_active.is_(is_active))
    pattern = _substring_pattern(q)

    if pattern is not None:
        guardian_named = (
            select(1)
            .select_from(ChildGuardian)
            .join(Guardian, Guardian.id == ChildGuardian.guardian_id)
            .where(
                ChildGuardian.child_id == Child.id,
                Guardian.name.ilike(pattern, escape=_LIKE_ESCAPE),
            )
        )
        statement = statement.where(
            or_(Child.name.ilike(pattern, escape=_LIKE_ESCAPE), guardian_named.exists())
        )

    return statement


def _substring_pattern(raw: str | None) -> str | None:
    trimmed = "" if raw is None else raw.strip()

    if not trimmed:
        pattern = None
    else:
        pattern = f"%{trimmed.translate(_LIKE_WILDCARDS)}%"

    return pattern


def _guardians_by_child(
    db: Session, *, child_ids: list[uuid.UUID]
) -> defaultdict[uuid.UUID, list[Guardian]]:
    rows = db.execute(
        select(ChildGuardian.child_id, Guardian)
        .join(Guardian, Guardian.id == ChildGuardian.guardian_id)
        .where(ChildGuardian.child_id.in_(child_ids))
        .order_by(Guardian.name, Guardian.id)
    ).all()
    grouped: defaultdict[uuid.UUID, list[Guardian]] = defaultdict(list)

    for child_id, guardian in rows:
        grouped[child_id].append(guardian)

    return grouped


def _homes_by_child(
    db: Session, *, child_ids: list[uuid.UUID], only_active: bool
) -> defaultdict[uuid.UUID, list[Home]]:
    statement = (
        select(ChildHome.child_id, Home)
        .join(Home, Home.id == ChildHome.home_id)
        .where(ChildHome.child_id.in_(child_ids))
        .order_by(Home.created_at, Home.id)
    )

    if only_active:
        statement = statement.where(Home.is_active.is_(True))

    rows = db.execute(statement).all()
    grouped: defaultdict[uuid.UUID, list[Home]] = defaultdict(list)

    for child_id, home in rows:
        grouped[child_id].append(home)

    return grouped


def _next_sessions_by_child(db: Session, *, child_ids: list[uuid.UUID]) -> dict[uuid.UUID, Booking]:
    """One statement for the whole page: `DISTINCT ON (child_id)` keeps the first row of each
    child under the `ORDER BY`, which is why `child_id` has to lead it."""
    bookings = db.scalars(
        select(Booking)
        .where(Booking.child_id.in_(child_ids), upcoming_live_bookings(clock.business_now()))
        .distinct(Booking.child_id)
        .order_by(Booking.child_id, Booking.scheduled_date, Booking.start_time, Booking.id)
        .options(joinedload(Booking.staff), joinedload(Booking.subject))
    ).all()

    return {booking.child_id: booking for booking in bookings}
