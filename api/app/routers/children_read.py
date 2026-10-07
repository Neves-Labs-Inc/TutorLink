"""`GET /api/children` and `GET /api/children/{id}` — admin only, read-only.

A thin HTTP shell over `child_read_service`. The writes on this same prefix live in
`children.py`, which is mounted first; the two never collide because Starlette matches on method
as well as path, so `GET` reaches these routes and `POST`/`PATCH` reach those (P7C-D).

Both routes take `StaffPrincipal` and neither takes the tutor scope (P7C-G, CONSTITUTION §15):
tutors cannot call either route, and an unread scope would arm the guard that 500s the
`bookings` read behind `next_session`.

`?awaiting_evaluation=true` is the Awaiting evaluation tab: active Children not yet Evaluated,
oldest `created_at` first.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import StaffPrincipal
from app.models.booking import Booking
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.schemas.booking import NamedRef
from app.schemas.child import (
    ChildDetail,
    ChildGuardianRead,
    ChildHomeRead,
    ChildHomeRef,
    ChildLevelRead,
    ChildSummary,
    EvaluatedRead,
    NextSession,
    StaffRef,
)
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.services.child_read_service import (
    ChildDetailRow,
    ChildNotFound,
    ChildRow,
    get_child,
    list_children,
)

CHILD_NOT_FOUND_ERROR = "Child not found"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/children", tags=["children"])


@router.get("", response_model=Page[ChildSummary])
def list_all(
    user: StaffPrincipal,
    db: DbSession,
    is_active: bool = True,
    q: str | None = None,
    awaiting_evaluation: bool = False,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[ChildSummary]:
    rows, total = list_children(
        db,
        is_active=is_active,
        q=q,
        limit=page_size,
        offset=(page - 1) * page_size,
        awaiting_evaluation=awaiting_evaluation,
    )

    return Page[ChildSummary](
        items=[_summary(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{child_id}", response_model=ChildDetail)
def read_one(child_id: uuid.UUID, user: StaffPrincipal, db: DbSession) -> ChildDetail:
    try:
        found = get_child(db, child_id=child_id)
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc

    return _detail(found)


def _summary(row: ChildRow) -> ChildSummary:
    return ChildSummary(
        id=row.child.id,
        name=row.child.name,
        grade_level=row.child.grade_level,
        school_name=row.child.school_name,
        is_active=row.child.is_active,
        guardians=[NamedRef(id=guardian.id, name=guardian.name) for guardian in row.guardians],
        homes=[
            ChildHomeRef(
                id=home.id, label=home.label, address=home.address, is_active=home.is_active
            )
            for home in row.homes
        ],
        next_session=_next_session(row.next_session),
        evaluated=_evaluated(row.child),
        created_at=row.child.created_at,
    )


def _next_session(booking: Booking | None) -> NextSession | None:
    return (
        None
        if booking is None
        else NextSession(
            id=booking.id,
            scheduled_date=booking.scheduled_date,
            start_time=booking.start_time,
            end_time=booking.end_time,
            tutor=NamedRef(id=booking.tutor.id, name=booking.tutor.name),
            subject=NamedRef(id=booking.subject.id, name=booking.subject.name),
        )
    )


def _detail(row: ChildDetailRow) -> ChildDetail:
    return ChildDetail(
        id=row.child.id,
        name=row.child.name,
        date_of_birth=row.child.date_of_birth,
        grade_level=row.child.grade_level,
        school_name=row.child.school_name,
        notes=row.child.notes,
        is_active=row.child.is_active,
        upcoming_session_count=row.upcoming_session_count,
        guardians=[
            ChildGuardianRead(
                id=guardian.id,
                name=guardian.name,
                phone_number=guardian.phone_number,
                is_active=guardian.is_active,
            )
            for guardian in row.guardians
        ],
        homes=[
            ChildHomeRead(
                id=home.id,
                label=home.label,
                address=home.address,
                access_code=home.access_code,
                is_active=home.is_active,
            )
            for home in row.homes
        ],
        levels=[_level(level) for level in row.levels],
        evaluated=_evaluated(row.child),
    )


def _level(row: ChildSubjectLevel) -> ChildLevelRead:
    return ChildLevelRead(
        subject_id=row.subject_id,
        name=row.subject.name,
        is_active=row.subject.is_active,
        level=row.level,
        set_by=StaffRef(id=row.set_by.id, display_name=row.set_by.display_name),
        updated_at=row.updated_at,
    )


def _evaluated(child: Child) -> EvaluatedRead | None:
    by = child.evaluated_by

    return (
        None
        if child.evaluated_at is None or by is None
        else EvaluatedRead(
            at=child.evaluated_at, by=StaffRef(id=by.id, display_name=by.display_name)
        )
    )
