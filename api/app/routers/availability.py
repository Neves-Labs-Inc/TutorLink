"""Tutor availability: recurring weekly slots and their overrides.

Stub mounted by T0 (REQ-P4.1). Bare `/api` prefix: this router serves both
`/api/tutors/{tutor_id}/availability` and `/api/availability/{availability_id}`, mirroring
`routers/exceptions.py:41`.

The dependency split is asymmetric, and it is not the shape the `{tutor_id}` path segment
suggests:

- `GET` takes `TutorScope`, whose `tutor_id` binds from the path segment — the two-shape rule's
  "list" side, same as `routers/exceptions.py`'s `list_tutor_exceptions`.
- `POST` looks like it should take `TutorScope` too, because its path also carries
  `{tutor_id}`, and it must not: the route is admin-only per the RBAC table
  (`docs/api-design.md:271-278`), so there is nobody for the scope to narrow, and
  `CONSTITUTION.md` §15 forbids an `AdminPrincipal` route also taking `TutorScope`. It takes a
  plain `tutor_id: uuid.UUID` path parameter instead.
- `PATCH`/`DELETE` load one row by id and are admin-only too, so both take `AdminPrincipal` and
  neither takes `TutorScope`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal, TutorScope
from app.models.availability import TutorAvailability
from app.schemas.availability import AvailabilityCreate, AvailabilityRead, AvailabilityUpdate
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.services.availability_service import (
    AvailabilityNotFound,
    AvailabilitySlotTaken,
    InvalidTimeRange,
    TutorNotFound,
    create_availability,
    deactivate_availability,
    list_availability,
    update_availability,
)

TUTOR_NOT_FOUND_ERROR = "No such tutor"
AVAILABILITY_NOT_FOUND_ERROR = "No such availability slot"
SLOT_TAKEN_ERROR = "This tutor already has a slot starting at that time on that day"
INVALID_TIME_RANGE_ERROR = "end_time must be after start_time"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api", tags=["availability"])


@router.get("/tutors/{tutor_id}/availability", response_model=Page[AvailabilityRead])
def list_tutor_availability(
    scope: TutorScope,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[AvailabilityRead]:
    # Reading `scope.tutor_id` is both where the id comes from and what disarms the
    # unapplied-scope guard — `TutorAvailability` is a tutor-owned mapper.
    tutor_id = scope.tutor_id

    rows, total = list_availability(
        db, tutor_id=tutor_id, limit=page_size, offset=(page - 1) * page_size
    )

    return Page[AvailabilityRead](
        items=[_read(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/tutors/{tutor_id}/availability",
    response_model=AvailabilityRead,
    status_code=status.HTTP_201_CREATED,
)
def create_tutor_availability(
    tutor_id: uuid.UUID,
    payload: AvailabilityCreate,
    user: AdminPrincipal,
    db: DbSession,
) -> AvailabilityRead:
    try:
        row = create_availability(
            db,
            tutor_id=tutor_id,
            day_of_week=payload.day_of_week,
            start_time=payload.start_time,
            end_time=payload.end_time,
        )
    except TutorNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=TUTOR_NOT_FOUND_ERROR
        ) from exc
    except InvalidTimeRange as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_TIME_RANGE_ERROR
        ) from exc
    except AvailabilitySlotTaken as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=SLOT_TAKEN_ERROR) from exc

    db.commit()

    return _read(row)


@router.patch("/availability/{availability_id}", response_model=AvailabilityRead)
def update_tutor_availability(
    availability_id: uuid.UUID,
    payload: AvailabilityUpdate,
    user: AdminPrincipal,
    db: DbSession,
) -> AvailabilityRead:
    try:
        row = update_availability(
            db,
            availability_id=availability_id,
            start_time=payload.start_time,
            end_time=payload.end_time,
            is_active=payload.is_active,
        )
    except AvailabilityNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=AVAILABILITY_NOT_FOUND_ERROR
        ) from exc
    except InvalidTimeRange as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_TIME_RANGE_ERROR
        ) from exc
    except AvailabilitySlotTaken as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=SLOT_TAKEN_ERROR) from exc

    db.commit()

    return _read(row)


@router.delete("/availability/{availability_id}", response_model=AvailabilityRead)
def delete_tutor_availability(
    availability_id: uuid.UUID, user: AdminPrincipal, db: DbSession
) -> AvailabilityRead:
    try:
        row = deactivate_availability(db, availability_id=availability_id)
    except AvailabilityNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=AVAILABILITY_NOT_FOUND_ERROR
        ) from exc

    db.commit()

    return _read(row)


def _read(row: TutorAvailability) -> AvailabilityRead:
    return AvailabilityRead(
        id=row.id,
        tutor_id=row.tutor_id,
        day_of_week=row.day_of_week,
        start_time=row.start_time,
        end_time=row.end_time,
        is_active=row.is_active,
    )
