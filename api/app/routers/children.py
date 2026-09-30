"""`/api/children` — admin only, the surface the bot uses at intake.

A thin HTTP shell over `child_service`, matching `users.py`: the service raises domain
exceptions, this maps them to status codes and owns the commit.

Children are reached through the client surface, which the RBAC table
(`docs/api-design.md:270-299`) gives to admins alone, so both routes take `AdminPrincipal`.
Nothing here queries a tutor-owned table and no route takes `TutorScope`. These are the two
write routes; the reads of `/api/children` live in `children_read.py`.

`PATCH` with `is_active: false` cancels the child's upcoming sessions in the same transaction as
the deactivation, which is why the one `db.commit()` below must stay the only one: a refusal or a
failure part-way through the cancellations leaves nothing written (P7C-O).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.models.child import Child
from app.schemas.child import ChildCreate, ChildRead, ChildUpdate
from app.services.child_service import (
    DATE_OF_BIRTH_EARLIEST,
    ChildNotFound,
    HomeRemovalHasUpcomingBookings,
    InvalidChildLinks,
    InvalidDateOfBirth,
    UpcomingSessionsChanged,
    create_child,
    update_child,
)

CHILD_NOT_FOUND_ERROR = "Child not found"
INVALID_LINKS_ERROR = (
    "guardian_ids and home_ids must each name at least one guardian or home, and every id "
    "given must already exist"
)
INVALID_DATE_OF_BIRTH_ERROR = (
    f"date_of_birth must be a real date between {DATE_OF_BIRTH_EARLIEST.isoformat()} and today"
)
UPCOMING_SESSIONS_CHANGED_ERROR = "Upcoming sessions changed; review them and confirm again"
HOME_REMOVAL_HAS_UPCOMING_BOOKINGS_ERROR = (
    "Child has upcoming bookings at a home being removed; cancel or move them first"
)

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/children", tags=["children"])


@router.post("", response_model=ChildRead, status_code=status.HTTP_201_CREATED)
def create(payload: ChildCreate, user: AdminPrincipal, db: DbSession) -> ChildRead:
    try:
        created = create_child(
            db,
            guardian_ids=payload.guardian_ids,
            home_ids=payload.home_ids,
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
    child_id: uuid.UUID, payload: ChildUpdate, user: AdminPrincipal, db: DbSession
) -> ChildRead:
    try:
        updated = update_child(
            db,
            child_id=child_id,
            guardian_ids=payload.guardian_ids,
            home_ids=payload.home_ids,
            name=payload.name,
            date_of_birth=payload.date_of_birth,
            grade_level=payload.grade_level,
            school_name=payload.school_name,
            notes=payload.notes,
            is_active=payload.is_active,
            expected_cancellations=payload.expected_cancellations,
        )
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except InvalidChildLinks as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_LINKS_ERROR) from exc
    except InvalidDateOfBirth as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_DATE_OF_BIRTH_ERROR) from exc
    except HomeRemovalHasUpcomingBookings as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, HOME_REMOVAL_HAS_UPCOMING_BOOKINGS_ERROR
        ) from exc
    except UpcomingSessionsChanged as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, UPCOMING_SESSIONS_CHANGED_ERROR) from exc

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
        is_active=child.is_active,
        guardian_ids=[link.guardian_id for link in child.guardian_links],
        home_ids=[link.home_id for link in child.home_links],
    )
