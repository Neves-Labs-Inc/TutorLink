"""`/api/homes` — create a shared Home, share and unshare it, and edit it (`07B-CONTEXT.md`
§4.4). Archive and Restore are `POST /api/archive` and `/api/restore` (`routers/archive.py`).

A thin HTTP shell over `home_service` and `home_sharing_service`: the services report failures
(a domain exception or a `HomeResult`), this maps them to responses and owns the commit. A
sharing refusal is a `JSONResponse` because an unshare's carries `booking_ids` beside `detail`.
There is no `DELETE` of a Home: bookings point at it, so it is archived, never erased.

`BLANK_HOME_DETAILS_ERROR` is the same literal `client_homes.py` declares; a test asserts it.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.home import Home
from app.schemas.client import HomeRead, home_read
from app.schemas.home import HomeShare, HomeUpdate, SharedHomeCreate
from app.services.home_service import (
    HOME_NOT_FOUND_ERROR,
    BlankAddress,
    HomeNotFound,
    update_home,
)
from app.services.home_set import guardians_by_home, upcoming_booking_counts
from app.services.home_sharing_service import HomeResult, HomeSharingService

BLANK_HOME_DETAILS_ERROR = "address must not be blank"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/homes", tags=["homes"])


@router.post("", response_model=HomeRead, status_code=status.HTTP_201_CREATED)
def create(
    payload: SharedHomeCreate, user: OfficePrincipal, db: DbSession
) -> HomeRead | JSONResponse:
    result = HomeSharingService(db).create(
        guardian_ids=payload.guardian_ids,
        label=payload.label,
        address=payload.address,
        directions=payload.directions,
    )

    return _respond(db, result)


@router.post("/{home_id}/guardians", response_model=HomeRead)
def share(
    home_id: uuid.UUID, payload: HomeShare, user: OfficePrincipal, db: DbSession
) -> HomeRead | JSONResponse:
    result = HomeSharingService(db).share(home_id=home_id, guardian_id=payload.guardian_id)

    return _respond(db, result)


@router.delete("/{home_id}/guardians/{guardian_id}", response_model=HomeRead)
def unshare(
    home_id: uuid.UUID, guardian_id: uuid.UUID, user: OfficePrincipal, db: DbSession
) -> HomeRead | JSONResponse:
    result = HomeSharingService(db).unshare(home_id=home_id, guardian_id=guardian_id)

    return _respond(db, result)


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

    return _as_read(db, home)


def _respond(db: Session, result: HomeResult) -> HomeRead | JSONResponse:
    if result.value is None:
        return JSONResponse(
            status_code=result.status, content={"detail": result.error, **result.extra}
        )

    db.commit()

    return _as_read(db, result.value)


def _as_read(db: Session, home: Home) -> HomeRead:
    return home_read(
        home,
        guardians_by_home(db, home_ids=[home.id])[home.id],
        upcoming_booking_counts(db, home_ids=[home.id])[home.id],
    )
