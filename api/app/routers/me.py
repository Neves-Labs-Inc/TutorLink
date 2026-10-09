"""`/api/me`: the signed-in user's own account, for every role, Tutors included.

`Principal` rather than `OfficePrincipal`: any signed-in user may read and rename their own row,
and only their own, because the id comes from the token and never from the request. The chat
uses it for "Take it over as {me}" and My profile pre-fills from it (#109).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import Principal
from app.models.user import User
from app.schemas.user import MeRead, MeUpdate
from app.services.name_rules import InvalidName
from app.services.user_service import get_user, rename_user

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=MeRead)
def read_me(user: Principal, db: DbSession) -> MeRead:
    # `get_current_user` has just read this row and refused a missing or inactive one.
    return _me(get_user(db, user_id=user.id))


@router.patch("", response_model=MeRead)
def update_me(payload: MeUpdate, user: Principal, db: DbSession) -> MeRead:
    try:
        account = rename_user(db, user_id=user.id, name=payload.name)
    except InvalidName as exc:
        # The service's message says which rule the name broke.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    db.commit()

    return _me(account)


def _me(account: User) -> MeRead:
    return MeRead(
        id=account.id,
        email=account.email,
        role=account.role,
        name=account.name,
    )
