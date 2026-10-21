"""`GET /api/households` and `GET /api/households/{member_id}` — admin-only reads over guardians
and children grouped by their links.

A thin HTTP shell over `household_service`, which does the grouping, the search and the paging;
the only failure to map is the single read's unknown member, and there is nothing to commit.

`OfficePrincipal` and never `TutorScope` (P7C-G): tutors have no access to the guardian and
child rows a household is built from, so there is no tutor filter to apply. Not a soft-delete
list — there is no `is_active` parameter, and inactive members arrive carrying their flag. A
family whose every Guardian is archived is hidden unless `include_archived=true`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.schemas.booking import NamedRef
from app.schemas.household import (
    HouseholdChild,
    HouseholdGuardian,
    HouseholdHome,
    HouseholdNextBooking,
    HouseholdRead,
)
from app.services.household_service import (
    FamilyNotFound,
    Household,
    get_household,
    list_households,
)

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/households", tags=["households"])

FAMILY_NOT_FOUND_ERROR = "Family not found"


@router.get("", response_model=Page[HouseholdRead])
def list_all(
    user: OfficePrincipal,
    db: DbSession,
    q: str | None = None,
    include_archived: bool = False,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[HouseholdRead]:
    households, total = list_households(
        db,
        q=q,
        include_archived=include_archived,
        limit=page_size,
        offset=(page - 1) * page_size,
    )

    return Page[HouseholdRead](
        items=[_to_read(household) for household in households],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{member_id}", response_model=HouseholdRead)
def read_one(member_id: uuid.UUID, user: OfficePrincipal, db: DbSession) -> HouseholdRead:
    try:
        household = get_household(db, member_id=member_id)
    except FamilyNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, FAMILY_NOT_FOUND_ERROR) from exc

    return _to_read(household)


def _to_read(household: Household) -> HouseholdRead:
    next_booking = household.next_booking

    return HouseholdRead(
        key=household.guardians[0].id,
        guardians=[
            HouseholdGuardian(
                id=guardian.id,
                name=guardian.name,
                phone_number=guardian.phone_number,
                archived=guardian.is_archived,
            )
            for guardian in household.guardians
        ],
        children=[
            HouseholdChild(
                id=child.id,
                name=child.name,
                grade_level=child.grade_level,
                archived=child.is_archived,
            )
            for child in household.children
        ],
        name=household.name,
        archived=household.archived,
        homes=[
            HouseholdHome(
                id=family_home.home.id,
                label=family_home.home.label,
                address=family_home.home.address,
                directions=family_home.home.directions,
                archived=family_home.home.is_archived,
                guardian_ids=family_home.guardian_ids,
            )
            for family_home in household.homes
        ],
        next_booking=None
        if next_booking is None
        else HouseholdNextBooking(
            id=next_booking.id,
            kind=next_booking.kind,
            scheduled_date=next_booking.scheduled_date,
            start_time=next_booking.start_time,
            end_time=next_booking.end_time,
            location=next_booking.location,
            child=NamedRef(id=next_booking.child.id, name=next_booking.child.name),
            staff=NamedRef(id=next_booking.staff.id, name=next_booking.staff.name),
        ),
    )
