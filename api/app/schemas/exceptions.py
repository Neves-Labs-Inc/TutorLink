"""Request and response shapes for tutor availability exceptions.

`status` is deliberately absent from `ExceptionCreate`. Who may create an already-approved
exception is an authorisation decision, and a field on the request body would let a tutor
self-approve by adding one key to their JSON. The service derives it from the caller's role
instead — see `app.services.exception_service.create_exception`.
"""

import datetime
import uuid
from typing import Literal, Self

from pydantic import BaseModel, model_validator

from app.models.enums import ExceptionStatus

# Mirrors the reason column's documented values in docs/erd.md and the admin dashboard's
# reason dropdown. The column itself stays a plain String(32) with no DB-level constraint, so
# this is the only place an unrecognised reason is rejected.
type ExceptionReason = Literal["vacation", "personal", "sick", "other"]


class ExceptionCreate(BaseModel):
    start_date: datetime.date
    end_date: datetime.date
    start_time: datetime.time | None = None
    end_time: datetime.time | None = None
    reason: ExceptionReason
    notes: str | None = None

    @model_validator(mode="after")
    def _window_is_coherent(self) -> Self:
        # These mirror ck_tutor_availability_exceptions_time_pair and _time_order. Without
        # them a half-set time pair reaches PostgreSQL, fails the CHECK, and the caller gets a
        # 500 for what is an ordinary bad request — the constraints stay as the authority, and
        # this turns their violations into the project's 400 `{"detail": ...}` envelope.
        if self.end_date < self.start_date:
            raise ValueError("end_date must not be before start_date")

        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("start_time and end_time must both be set, or both omitted")

        if (
            self.start_time is not None
            and self.end_time is not None
            and (self.end_time <= self.start_time)
        ):
            raise ValueError("end_time must be after start_time")

        return self


class ExceptionDecision(BaseModel):
    # `pending` is not an accepted target. Approval and rejection are both terminal, and
    # allowing a decided row to be pushed back to pending would mean an approved exception
    # could stop blocking bookings without anyone rejecting it.
    status: Literal[ExceptionStatus.APPROVED, ExceptionStatus.REJECTED]


class ExceptionRead(BaseModel):
    id: uuid.UUID
    tutor_id: uuid.UUID
    start_date: datetime.date
    end_date: datetime.date
    start_time: datetime.time | None
    end_time: datetime.time | None
    reason: str
    notes: str | None
    status: ExceptionStatus
    created_at: datetime.datetime
