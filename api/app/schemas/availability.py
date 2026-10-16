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

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models.enums import AvailabilityMode


class AvailabilityRead(BaseModel):
    id: uuid.UUID
    tutor_id: uuid.UUID
    day_of_week: int
    start_time: datetime.time
    end_time: datetime.time
    is_active: bool
    mode: AvailabilityMode


class AvailabilityCreate(BaseModel):
    day_of_week: int = Field(ge=0, le=6)
    start_time: datetime.time
    end_time: datetime.time
    # The product default, not the column's `traveler` server default (that is for raw inserts).
    mode: AvailabilityMode = AvailabilityMode.ANYWHERE

    @model_validator(mode="after")
    def _range_is_coherent(self) -> Self:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")

        return self


# One slot per hour of every day: far above any real week, low enough that one request can't
# flood the table.
MAX_WEEK_SLOTS = 7 * 24


class AvailabilityWeekSlot(AvailabilityCreate):
    """`POST`'s body, held to naive whole-minute times. Sub-minute times would let near-identical
    slots slip past the (day, start) key, and a zone-marked time neither compares with a naive
    one nor matches a stored slot. `POST`/`PATCH` keep accepting both as they always have."""

    @field_validator("start_time", "end_time")
    @classmethod
    def _naive_whole_minute(cls, value: datetime.time) -> datetime.time:
        if value.tzinfo is not None:
            raise ValueError("must not carry a time zone")

        if value.second or value.microsecond:
            raise ValueError("must be a whole minute")

        return value


class AvailabilityWeek(BaseModel):
    """The whole active week `PUT` replaces."""

    slots: list[AvailabilityWeekSlot] = Field(max_length=MAX_WEEK_SLOTS)


class AvailabilityUpdate(BaseModel):
    start_time: datetime.time | None = None
    end_time: datetime.time | None = None
    is_active: bool | None = None
    mode: AvailabilityMode | None = None
