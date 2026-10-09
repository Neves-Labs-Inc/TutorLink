"""`/api/reminders/week`: the Staff view of one week's Booking reminders. Read-only.

`OfficePrincipal`, so a tutor is 403. No `TutorScope`:
the reminders are whole-system and the route reads no tutor-owned table.

`status` is a comma-separated worklist filter (`undeliverable,failed,skipped`). An unknown
value, or a `week_start` that is not a Monday, is a 400: a filter that silently matched
nothing would read as "nothing needs attention".
"""

import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.enums import ReminderStatus
from app.schemas.reminder import ReminderPreviewItem, ReminderRowRead, ReminderWeekRead
from app.services import clock
from app.services.reminder_service import ReminderCandidate
from app.services.reminder_week_service import ReminderRow, reminder_week

NOT_A_MONDAY_ERROR = "week_start must be a Monday"
UNKNOWN_STATUS_ERROR = "Unknown reminder status: {value}"
MONDAY = 0

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/reminders", tags=["reminders"])


def parse_statuses(
    raw: Annotated[str | None, Query(alias="status")] = None,
) -> frozenset[ReminderStatus] | None:
    """`?status=undeliverable,failed` as a set; absent or blank means every status."""
    values = [] if raw is None else [value.strip() for value in raw.split(",")]
    wanted = [value for value in values if value]
    known = {member.value for member in ReminderStatus}
    unknown = [value for value in wanted if value not in known]

    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, UNKNOWN_STATUS_ERROR.format(value=", ".join(unknown))
        )

    return frozenset(ReminderStatus(value) for value in wanted) if wanted else None


StatusFilter = Annotated[frozenset[ReminderStatus] | None, Depends(parse_statuses)]


@router.get("/week", response_model=ReminderWeekRead)
def read_week(
    user: OfficePrincipal,
    db: DbSession,
    statuses: StatusFilter,
    week_start: datetime.date | None = None,
) -> ReminderWeekRead:
    if week_start is not None and week_start.weekday() != MONDAY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NOT_A_MONDAY_ERROR)

    week = reminder_week(db, now=clock.business_now(), week_start=week_start, statuses=statuses)

    return ReminderWeekRead(
        week_start=week.week_start,
        has_run=week.has_run,
        preview=None if week.preview is None else [_preview_item(item) for item in week.preview],
        rows=[_row(row) for row in week.rows],
    )


def _preview_item(candidate: ReminderCandidate) -> ReminderPreviewItem:
    return ReminderPreviewItem(
        guardian_id=candidate.guardian_id,
        guardian_name=candidate.guardian_name,
        child_names=list(candidate.child_names),
        language=candidate.language,
        skip_reason=candidate.skip_reason,
    )


def _row(row: ReminderRow) -> ReminderRowRead:
    return ReminderRowRead(
        guardian_id=row.guardian_id,
        guardian_name=row.guardian_name,
        child_names=list(row.child_names),
        language=row.language,
        status=row.status,
        skip_reason=row.skip_reason,
        error_code=row.error_code,
        may_have_been_delivered=row.may_have_been_delivered,
        sent_at=row.sent_at,
    )
