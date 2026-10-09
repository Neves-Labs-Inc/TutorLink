"""`GET /api/staff` — the bookable people, readable by every Office role.

`OfficePrincipal` rather than `AdminPrincipal`: a Manager books sessions too, and this is the
one list the booking form and the Bookings Staff filter read. It is read-only and carries
nothing `/api/users` guards (no email, no `is_active`), so widening it to the Office gives a
Manager nothing the Admin-only router keeps from them.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.user import User
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.staff import StaffRead
from app.services.staff_service import list_staff

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/staff", tags=["staff"])


@router.get("", response_model=Page[StaffRead])
def list_all(
    user: OfficePrincipal,
    db: DbSession,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[StaffRead]:
    staff, total = list_staff(db, limit=page_size, offset=(page - 1) * page_size)

    return Page[StaffRead](
        items=[_read(row) for row in staff],
        total=total,
        page=page,
        page_size=page_size,
    )


def _read(user: User) -> StaffRead:
    return StaffRead(id=user.id, name=user.name, role=user.role, tutor_id=user.profile_id)
