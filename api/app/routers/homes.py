"""`PATCH /api/homes/{home_id}` — edit a home (`07B-CONTEXT.md` §4.4). Archive and Restore are
`POST /api/archive` and `/api/restore` (`routers/archive.py`).

A thin HTTP shell over `home_service`: the service raises domain exceptions, this maps them to
status codes and owns the commit. There is no `DELETE`: bookings point at a home, so it is
archived, never erased.

`BLANK_HOME_DETAILS_ERROR` is the same literal `client_homes.py` declares; a test asserts it.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.schemas.client import HomeRead, home_read
from app.schemas.home import HomeUpdate
from app.services.home_service import (
    HOME_NOT_FOUND_ERROR,
    BlankAddress,
    HomeNotFound,
    update_home,
)
from app.services.home_set import guardians_by_home, upcoming_booking_counts

BLANK_HOME_DETAILS_ERROR = "address must not be blank"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/homes", tags=["homes"])


@router.patch("/{home_id}", response_model=HomeRead)
def update(
    home_id: uuid.UUID, payload: HomeUpdate, user: OfficePrincipal, db: DbSession
) -> HomeRead:
    try:
        home = update_home(
            db,
            home_id=home_id,
            label=payload.label,
            address=payload.address,
            directions=payload.directions,
        )
    except HomeNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, HOME_NOT_FOUND_ERROR) from exc
    except BlankAddress as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BLANK_HOME_DETAILS_ERROR) from exc

    db.commit()

    return home_read(
        home,
        guardians_by_home(db, home_ids=[home.id])[home.id],
        upcoming_booking_counts(db, home_ids=[home.id])[home.id],
    )
