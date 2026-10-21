"""Bodies for `POST /api/archive` and `POST /api/restore`: one shape per archivable type, picked
by `type`. A type that needs more than an id (a Child's expected cancellations, Staff's
confirmed warnings) adds its fields to its own shape."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class ChildTarget(BaseModel):
    type: Literal["child"]
    id: uuid.UUID
    # The number of upcoming sessions the admin was shown; only an archive reads it.
    expected_cancellations: int | None = Field(default=None, ge=0)


class GuardianTarget(BaseModel):
    type: Literal["guardian"]
    id: uuid.UUID
    # The upcoming sessions, across every Child the archive would cascade to, the admin was shown.
    expected_cancellations: int | None = Field(default=None, ge=0)


class HomeTarget(BaseModel):
    type: Literal["home"]
    id: uuid.UUID


class SubjectTarget(BaseModel):
    type: Literal["subject"]
    id: uuid.UUID


StaffWarningCode = Literal["archived_staff_bookings"]


class StaffTarget(BaseModel):
    """A Staff member is a `users` row, so `id` is the user's id, not a profile's."""

    type: Literal["staff"]
    id: uuid.UUID
    confirm_warnings: list[StaffWarningCode] = []


ArchiveTarget = Annotated[
    ChildTarget | GuardianTarget | HomeTarget | SubjectTarget | StaffTarget,
    Field(discriminator="type"),
]


class ArchiveRead(BaseModel):
    """The same shape for every type. `archived` is the state after the call."""

    type: str
    id: uuid.UUID
    archived: bool
    cancelled_booking_ids: list[uuid.UUID]
    # Children a Guardian's archive took with it; empty for every other type.
    archived_child_ids: list[uuid.UUID]
