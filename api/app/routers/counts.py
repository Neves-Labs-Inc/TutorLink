"""`GET /api/counts`: every badge in the Office shell, polled in one light read (#210).

`OfficePrincipal`: a Tutor has no Office shell and so no badges (403). The business clock is
read once here, through the module so `freeze_business_clock` reaches it, and every count sees
that one moment.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.schemas.counts import CountsRead
from app.services import clock
from app.services.counts_service import read_counts

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/counts", tags=["counts"])


@router.get("", response_model=CountsRead)
def read_counts_route(user: OfficePrincipal, db: DbSession) -> CountsRead:
    counts = read_counts(db, role=user.role, user_id=user.id, now=clock.business_now())

    return CountsRead(
        needs_attention=counts.needs_attention,
        time_off_pending=counts.time_off_pending,
        children_awaiting_evaluation=counts.children_awaiting_evaluation,
        bookings_to_sort_out=counts.bookings_to_sort_out,
        unread_chats=counts.unread_chats,
    )
