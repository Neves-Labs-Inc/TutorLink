"""`POST /api/children/{child_id}/guardians` — link another guardian to an existing child.

A thin HTTP shell over `guardian_link_service`, matching `children.py`: the service raises
domain exceptions, this maps them to status codes and owns the commit. Mounted on the same
`/api/children` prefix as `children.py` and `children_read.py`; no path here overlaps theirs.

`StaffPrincipal` and never `TutorScope` (`docs/api-design.md` RBAC table): a tutor has no access
to any client or child write, and nothing here queries a tutor-owned table.

The two phone literals are `clients.py`'s and `CHILD_NOT_FOUND_ERROR` is `children.py`'s, repeated
rather than imported so this module depends on no other router; a test asserts they are equal.
`_as_read` mirrors `children.py:_as_read` for the same reason.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import StaffPrincipal
from app.models.child import Child
from app.schemas.child import ChildRead, GuardianLinkCreate
from app.services.child_service import ChildNotFound
from app.services.client_service import PhoneNumberTaken
from app.services.guardian_link_service import (
    AlreadyLinked,
    GuardianChoiceInvalid,
    GuardianInput,
    GuardianNotFound,
    HomesNotOfChild,
    link_guardian,
)
from app.services.phone_service import InvalidPhoneNumber

CHILD_NOT_FOUND_ERROR = "Child not found"
GUARDIAN_CHOICE_ERROR = "Send exactly one of guardian_id or guardian"
GUARDIAN_NOT_FOUND_ERROR = "guardian_id does not name an existing client"
ALREADY_LINKED_ERROR = "That guardian is already linked to this child"
HOMES_NOT_OF_CHILD_ERROR = "home_ids must name active homes of this child"
PHONE_NUMBER_TAKEN_ERROR = "A client with that phone number already exists"
INVALID_PHONE_NUMBER_ERROR = "phone_number is not a phone number that can be dialled"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/children", tags=["children"])


@router.post("/{child_id}/guardians", response_model=ChildRead, status_code=status.HTTP_201_CREATED)
def create(
    child_id: uuid.UUID, payload: GuardianLinkCreate, user: StaffPrincipal, db: DbSession
) -> ChildRead:
    new_guardian = (
        None
        if payload.guardian is None
        else GuardianInput(name=payload.guardian.name, phone_number=payload.guardian.phone_number)
    )

    try:
        linked = link_guardian(
            db,
            child_id=child_id,
            guardian_id=payload.guardian_id,
            new_guardian=new_guardian,
            home_ids=payload.home_ids,
        )
    except ChildNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CHILD_NOT_FOUND_ERROR) from exc
    except GuardianChoiceInvalid as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, GUARDIAN_CHOICE_ERROR) from exc
    except HomesNotOfChild as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, HOMES_NOT_OF_CHILD_ERROR) from exc
    except GuardianNotFound as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, GUARDIAN_NOT_FOUND_ERROR) from exc
    except AlreadyLinked as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_LINKED_ERROR) from exc
    except PhoneNumberTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, PHONE_NUMBER_TAKEN_ERROR) from exc
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc

    db.commit()

    return _as_read(linked)


def _as_read(child: Child) -> ChildRead:
    return ChildRead(
        id=child.id,
        name=child.name,
        date_of_birth=child.date_of_birth,
        grade_level=child.grade_level,
        school_name=child.school_name,
        notes=child.notes,
        is_active=child.is_active,
        guardian_ids=[link.guardian_id for link in child.guardian_links],
        home_ids=[link.home_id for link in child.home_links],
    )
