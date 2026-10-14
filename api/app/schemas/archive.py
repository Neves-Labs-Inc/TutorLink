"""Bodies for `POST /api/archive` and `POST /api/restore`: one shape per archivable type, picked
by `type`. A type that needs more than an id (a Child's expected cancellations, Staff's
confirmed warnings) adds its fields to its own shape."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class GuardianTarget(BaseModel):
    type: Literal["guardian"]
    id: uuid.UUID


class HomeTarget(BaseModel):
    type: Literal["home"]
    id: uuid.UUID


class SubjectTarget(BaseModel):
    type: Literal["subject"]
    id: uuid.UUID


ArchiveTarget = Annotated[GuardianTarget | HomeTarget | SubjectTarget, Field(discriminator="type")]


class ArchiveRead(BaseModel):
    """The same shape for every type. `archived` is the state after the call."""

    type: str
    id: uuid.UUID
    archived: bool
    cancelled_booking_ids: list[uuid.UUID]
