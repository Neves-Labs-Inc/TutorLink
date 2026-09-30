"""Request and response shapes for a tutor's recurring weekly availability.

`tutor_availability` carries no `CHECK (end_time > start_time)`, unlike both sibling scheduling
tables (`tutor_availability_exceptions`, `bookings`) — see OQ-7, divergence D-4. The
`model_validator` below and `availability_service`'s own check on `PATCH` are the only
enforcement there is; nothing in the database catches an inverted range.

`AvailabilityUpdate` deliberately has no `day_of_week`: `docs/api-design.md` scopes a `PATCH`
to "a slot's time or active status", and moving a slot to a different day is a delete plus a
create rather than an edit.
"""

import datetime
import uuid
from typing import Self

from pydantic import BaseModel, Field, model_validator


class AvailabilityRead(BaseModel):
    id: uuid.UUID
    tutor_id: uuid.UUID
    day_of_week: int
    start_time: datetime.time
    end_time: datetime.time
    is_active: bool


class AvailabilityCreate(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    start_time: datetime.time
    end_time: datetime.time

    @model_validator(mode="after")
    def _range_is_coherent(self) -> Self:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")

        return self


class AvailabilityUpdate(BaseModel):
    start_time: datetime.time | None = None
    end_time: datetime.time | None = None
    is_active: bool | None = None
