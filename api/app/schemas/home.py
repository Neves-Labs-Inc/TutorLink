"""Request shapes for `POST /api/clients/{client_id}/homes`, `POST /api/homes`,
`POST /api/homes/{home_id}/guardians` and `PATCH /api/homes/{home_id}`.

Every route answers with `HomeRead` from `schemas/client.py`, the nested home shape
`GET /api/clients/{id}` already returns; it is imported, not duplicated, so the two cannot drift.

Trimming, and the blank-label-and-directions-are-`null` and blank-address-is-400 rules, belong
to `home_service` rather than to a validator (CONSTITUTION §7). The length bounds are here
because they mirror the `String` columns and need no database read.
"""

import uuid

from pydantic import BaseModel, Field

from app.models.home import DIRECTIONS_MAX_LENGTH

HOME_FIELD_MAX_LENGTH = 64


class ClientHomeCreate(BaseModel):
    label: str | None = Field(default=None, max_length=HOME_FIELD_MAX_LENGTH)
    address: str
    directions: str | None = Field(default=None, max_length=DIRECTIONS_MAX_LENGTH)


class HomeUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=HOME_FIELD_MAX_LENGTH)
    address: str | None = None
    directions: str | None = Field(default=None, max_length=DIRECTIONS_MAX_LENGTH)


class SharedHomeCreate(BaseModel):
    # Duplicates are ignored, not refused: the Home links to each Guardian once.
    guardian_ids: list[uuid.UUID] = Field(min_length=1)
    label: str | None = Field(default=None, max_length=HOME_FIELD_MAX_LENGTH)
    address: str
    directions: str | None = Field(default=None, max_length=DIRECTIONS_MAX_LENGTH)


class HomeShare(BaseModel):
    guardian_id: uuid.UUID
