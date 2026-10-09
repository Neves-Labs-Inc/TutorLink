"""`/api/stats/overview` — the admin dashboard's five widgets in one round trip.

**`OfficePrincipal`, and `TutorScope` nowhere.** These are whole-system metrics and the RBAC
table gives a tutor no correct value for any of them, so a tutor is 403 — never an empty
payload and never a scoped variant (CONSTITUTION §15, `docs/api-design.md:1239`). Taking
`TutorScope` here would also be a 500 rather than a subtler bug: this route queries `Booking`
and `Tutor`, both tutor-owned mappers, and it has no filter to apply, so the unapplied-scope
guard would fire on every call (`dependencies.py:229-255`).

`date` is required and unbounded. A missing or malformed one is a `RequestValidationError`,
which `main.py:78-87` already renders as **400** with a string `detail`; 422 stays reserved for
deliberate semantic refusal (CONSTITUTION §10), so this module adds no handler and validates
nothing by hand. Unlike `GET /api/slots/available` there is no past or future bound, because
this endpoint decides nothing (`docs/api-design.md:1249`).

`recent_bookings` is a bare array of at most five, not a `Page`: this response is an object
with a list field rather than a list response, so the envelope rule does not reach it
(`docs/api-design.md:1315-1317`).
"""

import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.booking import Booking
from app.schemas.booking import BookingSummary, NamedRef
from app.schemas.stats import StatsOverview
from app.services.stats_service import overview

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/overview", response_model=StatsOverview)
def read_overview(user: OfficePrincipal, db: DbSession, date: datetime.date) -> StatsOverview:
    data = overview(db, on=date)

    return StatsOverview(
        date=data.date,
        week_end=data.week_end,
        today_session_count=data.today_session_count,
        upcoming_week_session_count=data.upcoming_week_session_count,
        active_tutor_count=data.active_tutor_count,
        active_client_count=data.active_client_count,
        recent_bookings=[_summary(row) for row in data.recent_bookings],
    )


def _summary(row: Booking) -> BookingSummary:
    return BookingSummary(
        id=row.id,
        child=NamedRef(id=row.child.id, name=row.child.name),
        tutor=NamedRef(id=row.tutor.id, name=row.tutor.name),
        subject=NamedRef(id=row.subject.id, name=row.subject.name),
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
        status=row.status,
        notes=row.notes,
    )
