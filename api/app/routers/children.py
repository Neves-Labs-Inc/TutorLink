"""`/api/children` — admin only, the surface the bot uses at intake.

A thin HTTP shell over `child_service`, matching `users.py`: the service raises domain
exceptions, this maps them to status codes and owns the commit.

Children are reached through the client surface, which the RBAC table
(`docs/api-design.md:270-299`) gives to admins alone, so both routes take `OfficePrincipal`.
Nothing here queries a tutor-owned table and no route takes `TutorScope`. These are the two
write routes; the reads of `/api/children` live in `children_read.py`.

Archiving a child, which cancels its upcoming sessions, is `POST /api/archive`, not a route
here (see `archive_service`).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.child import Child
from app.schemas.child import ChildCreate, ChildRead, ChildUpdate
from app.services.child_service import (
    DATE_OF_BIRTH_EARLIEST,
    ChildNotFound,
    GuardianRemovalHasUpcomingBookings,
    InvalidChildLinks,
    InvalidDateOfBirth,
    create_child,
    update_child,
)

CHILD_NOT_FOUND_ERROR = "Child not found"
INVALID_LINKS_ERROR = (
    "guardian_ids must name at least one guardian, and every id given must already exist"
)
INVALID_DATE_OF_BIRTH_ERROR = (
    f"date_of_birth must be a real date between {DATE_OF_BIRTH_EARLIEST.isoformat()} and today"
)
GUARDIAN_REMOVAL_HAS_UPCOMING_BOOKINGS_ERROR = (
    "Child has upcoming bookings at a home that would no longer be theirs; "
    "cancel or move them first"
)

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/children", tags=["children"])


@router.post("", response_model=ChildRead, status_code=status.HTTP_201_CREATED)
def create(payload: ChildCreate, user: OfficePrincipal, db: DbSession) -> ChildRead:
    try:
        created = create_child(
            db,
            guardian_ids=payload.guardian_ids,
            name=payload.name,
            date_of_birth=payload.date_of_birth,
            grade_level=payload.grade_level,
            school_name=payload.school_name,
            notes=payload.notes,
        )
    except InvalidChildLinks as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_LINKS_ERROR) from exc
    except InvalidDateOfBirth as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_DATE_OF_BIRTH_ERROR) from exc

    db.commit()

    return _as_read(created)


@router.patch("/{child_id}", response_model=ChildRead)
def update(
    child_id: uuid.UUID, payload: ChildUpdate, user: OfficePrincipal, db: DbSession
) -> ChildRead | JSONResponse:
    try:
        updated = update_child(
            db,
            child_id=child_id,
            guardian_ids=payload.guardian_ids,
            name=payload.name,
            date_of_birth=payload.date_of_birth,
            grade_level=payload.grade_level,
            school_name=payload.school_name,
            notes=payload.notes,
        )
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except InvalidChildLinks as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_LINKS_ERROR) from exc
    except InvalidDateOfBirth as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_DATE_OF_BIRTH_ERROR) from exc
    except GuardianRemovalHasUpcomingBookings as exc:
        # A `JSONResponse`, like `archive.py`'s refusals: the body carries `booking_ids`.
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": GUARDIAN_REMOVAL_HAS_UPCOMING_BOOKINGS_ERROR,
                "booking_ids": [str(booking_id) for booking_id in exc.booking_ids],
            },
        )

    db.commit()

    return _as_read(updated)


def _as_read(child: Child) -> ChildRead:
    return ChildRead(
        id=child.id,
        name=child.name,
        date_of_birth=child.date_of_birth,
        grade_level=child.grade_level,
        school_name=child.school_name,
        notes=child.notes,
        archived=child.is_archived,
        guardian_ids=[link.guardian_id for link in child.guardian_links],
    )
