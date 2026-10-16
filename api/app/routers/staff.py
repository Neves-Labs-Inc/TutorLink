"""`/api/staff` — the Office's one Staff read (#212), for every Office role.

`OfficePrincipal` rather than `AdminPrincipal`: the Staff screen is the whole Office's, and a
Manager books sessions too, so the booking form's Staff picker (`?archived=false`) reads this
as well. It is read-only; every Staff write stays on the Admin-only `/api/users`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.enums import UserRole
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.staff import StaffRead
from app.services.sign_in_state import SignInState
from app.services.staff_service import StaffFilters, StaffNotFound, get_staff, list_staff

STAFF_NOT_FOUND_ERROR = "Staff member not found"
INVALID_ROLE_ERROR = "role must be one of: " + ", ".join(role.value for role in UserRole)
INVALID_SIGN_IN_STATE_ERROR = "sign_in_state must be one of: " + ", ".join(
    state.value for state in SignInState
)

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/staff", tags=["staff"])


@router.get("", response_model=Page[StaffRead])
def list_all(
    user: OfficePrincipal,
    db: DbSession,
    archived: bool | None = None,
    role: Annotated[list[str] | None, Query()] = None,
    sign_in_state: Annotated[list[str] | None, Query()] = None,
    subject_id: uuid.UUID | None = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[StaffRead]:
    # 422, not the app-wide 400 for a malformed query: the values are well-formed but unknown.
    try:
        roles = [UserRole(value) for value in role or []]
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, INVALID_ROLE_ERROR) from exc
    try:
        states = [SignInState(value) for value in sign_in_state or []]
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, INVALID_SIGN_IN_STATE_ERROR
        ) from exc

    rows, total = list_staff(
        db,
        filters=StaffFilters(
            is_archived=archived, roles=roles, sign_in_states=states, subject_id=subject_id, q=q
        ),
        limit=page_size,
        offset=(page - 1) * page_size,
    )

    return Page[StaffRead](items=rows, total=total, page=page, page_size=page_size)


@router.get("/{staff_id}", response_model=StaffRead)
def read_one(staff_id: uuid.UUID, user: OfficePrincipal, db: DbSession) -> StaffRead:
    try:
        row = get_staff(db, user_id=staff_id)
    except StaffNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, STAFF_NOT_FOUND_ERROR) from exc

    return row
