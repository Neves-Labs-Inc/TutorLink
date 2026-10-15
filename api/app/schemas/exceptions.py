"""Request and response shapes for a Staff member's Time off (availability exceptions).

`status` is deliberately absent from `ExceptionCreate`. Who may create an already-approved
exception is an authorisation decision, and a field on the request body would let a tutor
self-approve by adding one key to their JSON. The service derives it from the caller's role
instead — see `app.services.exception_service.create_exception`.
"""

import datetime
import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, BeforeValidator, Field, model_validator

from app.models.availability import REASON_MAX_LENGTH
from app.models.enums import BookingStatus, ExceptionStatus
from app.schemas.booking import NamedRef, StaffRef

# The stored statuses plus `expired`: a stored `pending` row whose window has ended. Derived at
# read time, never stored, so it is a wire type rather than a member of `ExceptionStatus`.
ExceptionReadStatus = Literal["pending", "approved", "rejected", "cancelled", "expired"]

# The one warning a Time off write can raise (#204): the row would land approved over live
# Bookings. Confirmed by naming it in `confirm_warnings`, as the #151 booking warnings are.
TimeOffWarningCode = Literal["booking_clash"]


def _strip_reason(raw: object) -> object:
    """Trimmed, and blank means no reason at all."""
    if not isinstance(raw, str):
        return raw

    return raw.strip() or None


# Checked after trimming, so surrounding spaces don't count toward the limit.
Reason = Annotated[
    Annotated[str, Field(max_length=REASON_MAX_LENGTH)] | None, BeforeValidator(_strip_reason)
]


class ExceptionCreate(BaseModel):
    start_date: datetime.date
    end_date: datetime.date
    start_time: datetime.time | None = None
    end_time: datetime.time | None = None
    reason: Reason = None
    confirm_warnings: list[TimeOffWarningCode] = []

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
    # Neither `pending` nor `cancelled` is an accepted target. Nothing goes back to pending, and
    # cancelling has its own route with its own rules (the owner may cancel; only Admin roles
    # decide).
    status: Literal[ExceptionStatus.APPROVED, ExceptionStatus.REJECTED]
    confirm_warnings: list[TimeOffWarningCode] = []


class TimeOffWarning(BaseModel):
    code: TimeOffWarningCode
    message: str


class ClashingBooking(BaseModel):
    """A live Booking of the same person inside the Time off's window. Computed, never stored."""

    booking_id: uuid.UUID
    date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    child_name: str
    status: BookingStatus


class ExceptionRead(BaseModel):
    id: uuid.UUID
    # The person holding the Time off: their user id, name and role.
    staff: StaffRef
    start_date: datetime.date
    end_date: datetime.date
    start_time: datetime.time | None
    end_time: datetime.time | None
    reason: str | None
    status: ExceptionReadStatus
    created_at: datetime.datetime
    decided_by: NamedRef | None
    decided_at: datetime.datetime | None
    cancelled_by: NamedRef | None
    cancelled_at: datetime.datetime | None
    # Empty unless the wire status is `pending` (not Expired) or `approved`.
    clashing_bookings: list[ClashingBooking]
    clashing_bookings_count: int
