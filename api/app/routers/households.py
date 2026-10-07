"""`GET /api/households` — admin-only, a read over guardians and children grouped by their links.

A thin HTTP shell over `household_service`, which does the grouping, the search and the paging;
nothing here can fail past validation, so there is no exception to map and nothing to commit.

`StaffPrincipal` and never `TutorScope` (P7C-G): tutors have no access to the guardian and
child rows a household is built from, so there is no tutor filter to apply. Not a soft-delete
list — there is no `is_active` parameter, and inactive members arrive carrying their flag.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import StaffPrincipal
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.household import HouseholdChild, HouseholdGuardian, HouseholdRead
from app.services.household_service import Household, list_households

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/households", tags=["households"])


@router.get("", response_model=Page[HouseholdRead])
def list_all(
    user: StaffPrincipal,
    db: DbSession,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[HouseholdRead]:
    households, total = list_households(db, q=q, limit=page_size, offset=(page - 1) * page_size)

    return Page[HouseholdRead](
        items=[_to_read(household) for household in households],
        total=total,
        page=page,
        page_size=page_size,
    )


def _to_read(household: Household) -> HouseholdRead:
    return HouseholdRead(
        key=household.guardians[0].id,
        guardians=[
            HouseholdGuardian(
                id=guardian.id,
                name=guardian.name,
                phone_number=guardian.phone_number,
                is_active=guardian.is_active,
            )
            for guardian in household.guardians
        ],
        children=[
            HouseholdChild(
                id=child.id,
                name=child.name,
                grade_level=child.grade_level,
                is_active=child.is_active,
            )
            for child in household.children
        ],
    )
