"""Available booking slots — the endpoint the bot drives to answer "when can we come?".

Admin-only, and it deliberately does **not** take `TutorScope`. The query behind it touches
`Tutor`, `TutorSubject`, `TutorAvailability`, `TutorAvailabilityException` and `Booking` — five
tutor-owned mappers — so declaring a scope this route has nothing to narrow would arm
`_guard_unapplied_scope` (`dependencies.py:237-255`) and turn every populated response into a
500. `?tutor_id=` is therefore an ordinary optional filter declared on the signature, the same
shape and for the same reason as `routers/client_bookings.py:29`.

`page` and `page_size` are absent on purpose (REQ-043.3): the answer is capped at
`max_slots_offered` and there is no continuation. The `Page` envelope stays regardless —
`CONSTITUTION.md` §8 has no exceptions and `schemas/common.py` names this endpoint — and its
`total` is the count before the cap, which is what lets the bot say "showing 5 of 8".

The clock is read here and handed to the service as a **naive** datetime, matching
`routers/booking_writes.py:117-118` exactly. That is not a stylistic echo: OB-13 requires the
offer surface and the write path to read the same rows by the same rules, and two endpoints
disagreeing about what "now" is would put the lead-time gate and rule 1's window on different
clocks. Naive because `scheduled_date`, `start_time` and `end_time` are naive columns and
comparing an aware `now` against `combine(date, start_time)` raises `TypeError`; UTC with the
offset stripped rather than `datetime.now()`, which is the same instant under the container's
UTC clock and does not change meaning with a stray `TZ`.

A read: nothing here commits.
"""

import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import AdminPrincipal
from app.schemas.common import DEFAULT_PAGE, Page
from app.schemas.slot import SlotRead
from app.services.scheduling_service import DateOutOfWindow
from app.services.slot_service import OpenSlot, find_available_slots

DATE_OUT_OF_WINDOW_ERROR = "date must not be in the past or beyond booking_lookahead_days"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/slots", tags=["slots"])


@router.get("/available", response_model=Page[SlotRead])
def list_available_slots(
    user: AdminPrincipal,
    db: DbSession,
    subject_id: uuid.UUID,
    date: datetime.date,
    # `ge=1` because grade 0 is nobody's grade: Phase 3's review found `?grade_level=0` matched
    # every assignment's ceiling and returned the whole roster, and this is the same hole.
    grade_level: Annotated[int, Query(ge=1)],
    tutor_id: uuid.UUID | None = None,
) -> Page[SlotRead]:
    try:
        result = find_available_slots(
            db,
            subject_id=subject_id,
            grade_level=grade_level,
            date=date,
            tutor_id=tutor_id,
            now=_now(),
        )
    except DateOutOfWindow as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, DATE_OUT_OF_WINDOW_ERROR) from exc

    return Page[SlotRead](
        items=[_read(slot) for slot in result.items],
        total=result.total,
        page=DEFAULT_PAGE,
        page_size=result.page_size,
    )


def _now() -> datetime.datetime:
    return datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)


def _read(slot: OpenSlot) -> SlotRead:
    return SlotRead(
        tutor_id=slot.tutor_id,
        tutor_name=slot.tutor_name,
        availability_id=slot.availability_id,
        date=slot.date,
        start_time=slot.start_time,
        end_time=slot.end_time,
    )
