"""`/api/me`: the signed-in user's own account, for every role, Tutors included.

`Principal` rather than `AdminPrincipal`: any signed-in user may read their own row, and only
their own, because the id comes from the token and never from the request. The chat uses it
for "Take it over as {me}" and My profile pre-fills from it (#109).
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import Principal
from app.schemas.user import MeRead
from app.services.user_service import get_user

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=MeRead)
def read_me(user: Principal, db: DbSession) -> MeRead:
    # `get_current_user` has just read this row and refused a missing or inactive one.
    account = get_user(db, user_id=user.id)

    return MeRead(
        id=account.id,
        email=account.email,
        role=account.role,
        display_name=account.display_name,
    )
