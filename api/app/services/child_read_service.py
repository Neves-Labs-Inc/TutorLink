"""The read path over `children` — `GET /api/children` and `GET /api/children/{id}`.

Reads live here and writes in `child_service`, the `booking_service` / `booking_write_service`
split (P7C-D): the two change for different reasons and are owned by different tasks. Same
transaction contract as every other service: nothing commits, the caller owns the boundary.

**The list runs a constant number of statements, whatever the page size**: the count, the page,
then one batched load each for the page's guardians, bookable homes and next sessions (§5.3). A
per-row lazy load would turn a page of 100 into 300 round trips, and nothing on a list row is
read through an ORM relationship for that reason.

"Upcoming" — both `next_session` and `upcoming_session_count` — is `upcoming_live_bookings(now)`,
the predicate a deactivation cancels by (P7C-O, P7C-T), so the number an admin confirms and the
rows `PATCH` cancels cannot be defined differently. `now` is the naive business wall-clock
(`clock.business_now`, per `BUSINESS_TIMEZONE`), which is also where a test freezes it.
"""

import uuid
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.booking import LIVE_BOOKING_STATUSES, Booking, upcoming_live_bookings
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.enums import BookingKind
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.services import clock
from app.services.guardian_state import GuardianState, guardian_states
from app.services.home_set import homes_by_child

_LIKE_ESCAPE = "\\"
_LIKE_WILDCARDS = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


@dataclass(frozen=True, slots=True)
class ChildRow:
    child: Child
    guardians: list[Guardian]
    homes: list[Home]
    next_session: Booking | None
    # Levels in non-archived Subjects, by Subject name then id.
    levels: list[ChildSubjectLevel]


@dataclass(frozen=True, slots=True)
class ChildDetailRow:
    child: Child
    guardians: list[Guardian]
    homes: list[Home]
    upcoming_session_count: int
    next_session: Booking | None
    levels: list[ChildSubjectLevel]
    guardian_states: dict[uuid.UUID, GuardianState]


class ChildReadServiceError(Exception):
    """Base class for every failure this module reports."""


class ChildNotFound(ChildReadServiceError):
    """No child with that id."""


def list_children(
    db: Session,
    *,
    is_archived: bool,
    q: str | None,
    limit: int,
    offset: int,
    awaiting_evaluation: bool = False,
    evaluable: bool = False,
    subject_ids: Collection[uuid.UUID] = (),
    is_evaluated: bool | None = None,
) -> tuple[list[ChildRow], int]:
    """Rows for one page, plus the total matching before paging.

    `homes` on a row is the child's bookable homes only (A-66): its guardians' homes, archived
    ones left out (`home_set`). `guardians` is every linked guardian, active or not.

    `awaiting_evaluation` narrows to active Children who aren't Evaluated, whatever
    `is_archived` says, oldest first: the Child waiting longest leads the tab.

    `evaluable` is `awaiting_evaluation` minus Children with a live Evaluation: the ones the
    booking form may offer for an Evaluation. Same order, so the two tabs read alike.

    `subject_ids` keeps Children with a level in any of those Subjects, archived or not, and
    `is_evaluated` splits on `evaluated_at`; `None` is no filter. Both AND with the rest.
    """
    matching = _matching_list(
        is_archived=is_archived,
        q=q,
        awaiting_evaluation=awaiting_evaluation,
        evaluable=evaluable,
        subject_ids=subject_ids,
        is_evaluated=is_evaluated,
    )
    if awaiting_evaluation or evaluable:
        order = (Child.created_at, Child.id)
    else:
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
    homes = homes_by_child(db, child_ids=child_ids, include_archived=False)
    next_sessions = _next_sessions_by_child(db, child_ids=child_ids)
    levels = _active_levels_by_child(db, child_ids=child_ids)
    rows = [
        ChildRow(
            child=child,
            guardians=guardians[child.id],
            homes=homes[child.id],
            next_session=next_sessions.get(child.id),
            levels=levels[child.id],
        )
        for child in children
    ]

    return rows, total


def count_evaluable_children(db: Session) -> int:
    """What `list_children(evaluable=True)` totals with no other filter, without its rows."""
    matching = _matching_list(
        is_archived=False,
        q=None,
        awaiting_evaluation=False,
        evaluable=True,
        subject_ids=(),
        is_evaluated=None,
    )

    return db.scalar(select(func.count()).select_from(matching.subquery())) or 0


def get_child(db: Session, *, child_id: uuid.UUID) -> ChildDetailRow:
    """The child whatever its `is_archived` state, with its **whole** home set, archived homes
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

    guardians = _guardians_by_child(db, child_ids=[child.id])[child.id]
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
        guardians=guardians,
        homes=homes_by_child(db, child_ids=[child.id], include_archived=True)[child.id],
        upcoming_session_count=upcoming_session_count,
        next_session=_next_sessions_by_child(db, child_ids=[child.id]).get(child.id),
        levels=levels,
        guardian_states=guardian_states(db, [guardian.id for guardian in guardians]),
    )


def _matching_list(
    *,
    is_archived: bool,
    q: str | None,
    awaiting_evaluation: bool,
    evaluable: bool,
    subject_ids: Collection[uuid.UUID],
    is_evaluated: bool | None,
) -> Select[tuple[Child]]:
    """Every `list_children` filter applied; see there for what each means."""
    if awaiting_evaluation or evaluable:
        matching = _matching(is_archived=False, q=q).where(Child.evaluated_at.is_(None))
        if evaluable:
            matching = matching.where(~_has_live_evaluation().exists())
    else:
        matching = _matching(is_archived=is_archived, q=q)

    if subject_ids:
        matching = matching.where(_has_level_in(subject_ids).exists())
    if is_evaluated is not None:
        matching = matching.where(Child.evaluated_at.is_not(None) == is_evaluated)

    return matching


def _matching(*, is_archived: bool, q: str | None) -> Select[tuple[Child]]:
    """The guardian-name match is a correlated `EXISTS`, never a join: `total` counts this
    statement, and a child with two matching guardians would otherwise be counted twice (§8)."""
    statement = select(Child).where(Child.is_archived.is_(is_archived))
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


def _has_level_in(subject_ids: Collection[uuid.UUID]) -> Select[tuple[int]]:
    return (
        select(1)
        .select_from(ChildSubjectLevel)
        .where(
            ChildSubjectLevel.child_id == Child.id,
            ChildSubjectLevel.subject_id.in_(subject_ids),
        )
    )


def _has_live_evaluation() -> Select[tuple[int]]:
    return (
        select(1)
        .select_from(Booking)
        .where(
            Booking.child_id == Child.id,
            Booking.kind == BookingKind.EVALUATION,
            Booking.status.in_(LIVE_BOOKING_STATUSES),
        )
    )


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


def _active_levels_by_child(
    db: Session, *, child_ids: list[uuid.UUID]
) -> defaultdict[uuid.UUID, list[ChildSubjectLevel]]:
    """One statement for the page; levels in archived Subjects are left out of the list row."""
    levels = db.scalars(
        select(ChildSubjectLevel)
        .join(Subject, Subject.id == ChildSubjectLevel.subject_id)
        .where(ChildSubjectLevel.child_id.in_(child_ids), Subject.is_archived.is_(False))
        .order_by(Subject.name, Subject.id)
        .options(joinedload(ChildSubjectLevel.subject))
    ).all()
    grouped: defaultdict[uuid.UUID, list[ChildSubjectLevel]] = defaultdict(list)

    for level in levels:
        grouped[level.child_id].append(level)

    return grouped
