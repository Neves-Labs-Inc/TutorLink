"""Tutor availability: recurring weekly slots and their overrides.

Stub mounted by T0 (REQ-P4.1). Bare `/api` prefix: this router serves both
`/api/tutors/{tutor_id}/availability` and `/api/availability/{availability_id}`, mirroring
`routers/exceptions.py:41`.

The dependency split is asymmetric, and it is not the shape the `{tutor_id}` path segment
suggests:

- `GET` takes `TutorScope`, whose `tutor_id` binds from the path segment — the two-shape rule's
  "list" side, same as `routers/exceptions.py`'s `list_tutor_exceptions`.
- `POST`, `PUT`, `PATCH` and `DELETE` take `Principal` (any signed-in role, Tutors included) and
  **not** `TutorScope`: the rule is self or Admin (#208), not "a tutor sees only their own",
  and `availability_service` checks it against the caller it is handed. A Tutor or Manager
  writes their own slots; an Admin role writes anyone's within the account boundary (not a
  Developer's unless a Developer, not a peer Admin's). `POST` refuses a non-Admin naming
  someone else's profile before any lookup, an unknown id included, and so does `PUT`;
  `PATCH`/`DELETE` load the slot first, so an unknown slot is 404 for every role.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import Principal, TutorScope
from app.models.availability import TutorAvailability
from app.schemas.availability import (
    AvailabilityCreate,
    AvailabilityRead,
    AvailabilityUpdate,
    AvailabilityWeek,
)
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.services.availability_service import (
    AvailabilityNotFound,
    AvailabilitySlotTaken,
    InvalidTimeRange,
    NotYourAvailability,
    TutorNotFound,
    WeekSlot,
    create_availability,
    deactivate_availability,
    list_availability,
    replace_week,
    update_availability,
)
from app.services.tutor_service import (
    TutorAccountForbidden,
    TutorDeveloperForbidden,
    TutorPeerAdminForbidden,
)

TUTOR_NOT_FOUND_ERROR = "No such tutor"
AVAILABILITY_NOT_FOUND_ERROR = "No such availability slot"
SLOT_TAKEN_ERROR = "This tutor already has a slot starting at that time on that day"
INVALID_TIME_RANGE_ERROR = "end_time must be after start_time"
NOT_YOUR_AVAILABILITY_ERROR = "Only an Admin may change someone else's Availability"
# The same words `/api/users` answers with for the same rules (#173).
PEER_ADMIN_FORBIDDEN_ERROR = "Only a developer may modify another admin's account"
DEVELOPER_FORBIDDEN_ERROR = "Only a developer may create or modify a developer account"
# Every refusal a write can raise, by its exact type; `assert_may_write_person` raises only the
# two `TutorAccountForbidden` subclasses.
FORBIDDEN_DETAILS: dict[type[Exception], str] = {
    NotYourAvailability: NOT_YOUR_AVAILABILITY_ERROR,
    TutorPeerAdminForbidden: PEER_ADMIN_FORBIDDEN_ERROR,
    TutorDeveloperForbidden: DEVELOPER_FORBIDDEN_ERROR,
}

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
    user: Principal,
    db: DbSession,
) -> AvailabilityRead:
    try:
        row = create_availability(
            db,
            actor=user,
            tutor_id=tutor_id,
            day_of_week=payload.day_of_week,
            start_time=payload.start_time,
            end_time=payload.end_time,
            mode=payload.mode,
        )
    except TutorNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=TUTOR_NOT_FOUND_ERROR
        ) from exc
    except (NotYourAvailability, TutorAccountForbidden) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAILS[type(exc)]
        ) from exc
    except InvalidTimeRange as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_TIME_RANGE_ERROR
        ) from exc
    except AvailabilitySlotTaken as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=SLOT_TAKEN_ERROR) from exc

    db.commit()

    return _read(row)


@router.put("/tutors/{tutor_id}/availability", response_model=Page[AvailabilityRead])
def replace_tutor_availability_week(
    tutor_id: uuid.UUID,
    payload: AvailabilityWeek,
    user: Principal,
    db: DbSession,
) -> Page[AvailabilityRead]:
    slots = [
        WeekSlot(
            day_of_week=slot.day_of_week,
            start_time=slot.start_time,
            end_time=slot.end_time,
            mode=slot.mode,
        )
        for slot in payload.slots
    ]

    try:
        rows = replace_week(db, actor=user, tutor_id=tutor_id, slots=slots)
    except TutorNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=TUTOR_NOT_FOUND_ERROR
        ) from exc
    except (NotYourAvailability, TutorAccountForbidden) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAILS[type(exc)]
        ) from exc
    except InvalidTimeRange as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_TIME_RANGE_ERROR
        ) from exc
    except AvailabilitySlotTaken as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=SLOT_TAKEN_ERROR) from exc

    db.commit()

    # The whole active week, unpaged: one page that holds every row.
    return Page[AvailabilityRead](
        items=[_read(row) for row in rows], total=len(rows), page=DEFAULT_PAGE, page_size=len(rows)
    )


@router.patch("/availability/{availability_id}", response_model=AvailabilityRead)
def update_tutor_availability(
    availability_id: uuid.UUID,
    payload: AvailabilityUpdate,
    user: Principal,
    db: DbSession,
) -> AvailabilityRead:
    try:
        row = update_availability(
            db,
            actor=user,
            availability_id=availability_id,
            start_time=payload.start_time,
            end_time=payload.end_time,
            is_active=payload.is_active,
            mode=payload.mode,
        )
    except AvailabilityNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=AVAILABILITY_NOT_FOUND_ERROR
        ) from exc
    except (NotYourAvailability, TutorAccountForbidden) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAILS[type(exc)]
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
    availability_id: uuid.UUID, user: Principal, db: DbSession
) -> AvailabilityRead:
    try:
        row = deactivate_availability(db, actor=user, availability_id=availability_id)
    except AvailabilityNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=AVAILABILITY_NOT_FOUND_ERROR
        ) from exc
    except (NotYourAvailability, TutorAccountForbidden) as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAILS[type(exc)]
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
        mode=row.mode,
    )
