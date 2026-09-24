"""`PATCH /api/homes/{home_id}` — edit, deactivate or reactivate a home (`07B-CONTEXT.md` §4.4).

A thin HTTP shell over `home_service`: the service raises domain exceptions, this maps them to
status codes and owns the commit. There is no `DELETE`: bookings point at a home, so it is
deactivated, never erased. `AdminPrincipal` and never `TutorScope` — the deactivation guard
reads `bookings`, a tutor-owned table, and an unread scope would turn that read into a 500.

`BLANK_HOME_DETAILS_ERROR` is the same literal `client_homes.py` declares; a test asserts it.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.schemas.client import HomeRead
from app.schemas.home import HomeUpdate
from app.services.home_service import (
    BlankHomeDetails,
    HomeHasUpcomingBookings,
    HomeNotFound,
    update_home,
)

HOME_NOT_FOUND_ERROR = "Home not found"
BLANK_HOME_DETAILS_ERROR = "address and access_code must not be blank"
HOME_HAS_UPCOMING_BOOKINGS_ERROR = "Home has upcoming bookings; cancel or move them first"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/homes", tags=["homes"])


@router.patch("/{home_id}", response_model=HomeRead)
def update(
    home_id: uuid.UUID, payload: HomeUpdate, user: AdminPrincipal, db: DbSession
) -> HomeRead:
    try:
        home = update_home(
            db,
            home_id=home_id,
            label=payload.label,
            address=payload.address,
            access_code=payload.access_code,
            is_active=payload.is_active,
        )
    except HomeNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, HOME_NOT_FOUND_ERROR) from exc
    except BlankHomeDetails as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BLANK_HOME_DETAILS_ERROR) from exc
    except HomeHasUpcomingBookings as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, HOME_HAS_UPCOMING_BOOKINGS_ERROR) from exc

    db.commit()

    return HomeRead.model_validate(home)
