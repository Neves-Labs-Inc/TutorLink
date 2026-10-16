"""`POST /api/archive` and `POST /api/restore` — one contract for every archivable type.

A thin HTTP shell over `archive_service`: the service answers an `ArchiveResult`, this maps it
to a response and owns the single commit. A refusal is a `JSONResponse` rather than an
`HTTPException` because some carry fields beside `detail` (a Home's blocking `booking_ids`).
"""

from typing import Annotated

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import CurrentUser, OfficePrincipal
from app.schemas.archive import ArchiveRead, ArchiveTarget
from app.services.archive_service import Actor, ArchiveResult, ArchiveService

DbSession = Annotated[Session, Depends(get_db)]
TargetBody = Annotated[ArchiveTarget, Body()]

router = APIRouter(prefix="/api", tags=["archive"])


@router.post("/archive", response_model=ArchiveRead)
def archive(target: TargetBody, user: OfficePrincipal, db: DbSession) -> ArchiveRead | JSONResponse:
    return _respond(db, target, ArchiveService(db).archive(_actor(user), target))


@router.post("/restore", response_model=ArchiveRead)
def restore(target: TargetBody, user: OfficePrincipal, db: DbSession) -> ArchiveRead | JSONResponse:
    return _respond(db, target, ArchiveService(db).restore(_actor(user), target))


def _actor(user: CurrentUser) -> Actor:
    return Actor(id=user.id, role=user.role)


def _respond(
    db: Session, target: ArchiveTarget, result: ArchiveResult
) -> ArchiveRead | JSONResponse:
    if result.value is None:
        return JSONResponse(
            status_code=result.status, content={"detail": result.error, **result.extra}
        )

    db.commit()

    return ArchiveRead(
        type=target.type,
        id=target.id,
        archived=result.value.archived,
        cancelled_booking_ids=result.value.cancelled_booking_ids,
        archived_child_ids=result.value.archived_child_ids,
    )
