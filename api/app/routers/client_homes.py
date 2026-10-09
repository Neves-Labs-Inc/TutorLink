"""`POST /api/clients/{client_id}/homes` — add a home to a client (`07B-CONTEXT.md` §4.3).

A thin HTTP shell over `home_service`: the service raises domain exceptions, this maps them to
status codes and owns the commit. Mounted on the clients prefix beside `clients.py`, the
`client_bookings.py` precedent. `OfficePrincipal` and never `TutorScope`: clients are admin-only
(`docs/api-design.md:285`), so there is no tutor filter to apply.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.schemas.client import HomeRead
from app.schemas.home import ClientHomeCreate
from app.services.home_service import BlankHomeDetails, ChildNotLinked, ClientNotFound, add_home

CLIENT_NOT_FOUND_ERROR = "Client not found"
BLANK_HOME_DETAILS_ERROR = "address and access_code must not be blank"
CHILD_NOT_LINKED_ERROR = "child_ids must name children linked to this client"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.post("/{client_id}/homes", response_model=HomeRead, status_code=status.HTTP_201_CREATED)
def create(
    client_id: uuid.UUID, payload: ClientHomeCreate, user: OfficePrincipal, db: DbSession
) -> HomeRead:
    try:
        home = add_home(
            db,
            client_id=client_id,
            label=payload.label,
            address=payload.address,
            access_code=payload.access_code,
            child_ids=payload.child_ids,
        )
    except ClientNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CLIENT_NOT_FOUND_ERROR) from exc
    except BlankHomeDetails as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, BLANK_HOME_DETAILS_ERROR) from exc
    except ChildNotLinked as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, CHILD_NOT_LINKED_ERROR) from exc

    db.commit()

    return HomeRead.model_validate(home)
