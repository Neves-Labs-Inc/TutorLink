"""Request and response shapes for `POST /api/bookings`.

**`home_id` is required when `location` is `home`, and `booked_by_guardian_id` is accepted**,
even though neither appears in the documented example body at `docs/api-design.md:1189-1201`.
The prose rules above that example are the contract — rule 6 validates `home_id` against
`child_homes` and rule 7 validates `booked_by_guardian_id` against `child_guardians`. The
example is the half that is stale. Per `CONSTITUTION.md` §1 that divergence is reported and not
patched; it is recorded as amendment P4-1.

`BookingWarning` is one entry of the 409's `warnings[]` (#151): the code the client resubmits in
`confirm_warnings`, and the message it shows. The body is `{"detail": ..., "warnings": [...]}`,
`detail` kept as the string every other refusal carries, so a client that reads only `detail`
still gets a sentence.

`BookingCreated` restates the five fields of the documented response rather than importing a
shape from `schemas/booking.py`. The duplication is deliberate: it is what lets the read path
and the write path be built at the same time, and the name is `BookingCreated` rather than
`BookingRead` so that a later reader consolidating it against `BookingSummary` has to notice
they are different shapes first.
"""

import datetime
import uuid
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.booking import NOTES_MAX_LENGTH
from app.models.enums import BookingKind, BookingLocation, BookingStatus
from app.services.booking_write_service import WarningCode


class BookingWarning(BaseModel):
    code: WarningCode
    message: str


class _BookingWrite(BaseModel):
    """What a create and an edit both name: the Staff member, the Location, the shape-dependent
    references and the time range, under the warning contract."""

    # The Staff member, as a user (#130).
    user_id: uuid.UUID
    location: BookingLocation
    # Required by shape, not by schema: a home Location names `home_id`, a Regular booking
    # `subject_id`, and a Tutor/Manager Regular booking `availability_id`. The service refuses
    # the mismatches (spec 01, ticket 05); the database CHECKs hold whatever it misses.
    subject_id: uuid.UUID | None = None
    availability_id: uuid.UUID | None = None
    home_id: uuid.UUID | None = None
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    # The warning contract (#151): the codes from a previous 409's `warnings[]` the Office has
    # confirmed. The write lands only if every warning raised on this submission is here.
    confirm_warnings: list[WarningCode] = []

    @model_validator(mode="after")
    def _times_are_ordered(self) -> Self:
        # Mirrors `ck_bookings_time_order`. Without it an inverted range reaches PostgreSQL,
        # where `tsrange(start, end)` with `end < start` fails range construction itself with
        # SQLSTATE 22000 — a `DataError`, not the `IntegrityError` the conflict path catches —
        # and an ordinary bad request comes back as a 500.
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")

        return self


class BookingCreate(_BookingWrite):
    child_id: uuid.UUID
    kind: BookingKind
    booked_by_guardian_id: uuid.UUID | None = None
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)


class BookingReplace(_BookingWrite):
    """The body of `PUT /api/bookings/{id}`: a full replacement of the editable fields. The
    Child and the booking guardian are not editable here and are not accepted; `kind` may be
    omitted or equal to the row's, never different. The response is `BookingDetail`
    (`schemas/booking.py`), the shape the dashboard already reads, with `updated_at` bumped.

    `notes` is the one field with three readings: omitted keeps the row's notes, `null` clears
    them, a string replaces them. The router tells the first two apart by `model_fields_set`.

    `extra="forbid"`: a body carrying `child_id` or `booked_by_guardian_id` is refused rather
    than silently ignored, so a client that believes it changed one of them learns it did not."""

    model_config = ConfigDict(extra="forbid")

    kind: BookingKind | None = None
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)

    @property
    def notes_given(self) -> bool:
        return "notes" in self.model_fields_set


class BookingCreated(BaseModel):
    id: uuid.UUID
    status: BookingStatus
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
