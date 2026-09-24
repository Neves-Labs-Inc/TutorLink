"""Request shapes for `POST /api/clients/{client_id}/homes` and `PATCH /api/homes/{home_id}`.

Both routes answer with `HomeRead` from `schemas/client.py`, the nested home shape
`GET /api/clients/{id}` already returns; it is imported, not duplicated, so the two cannot drift.

Trimming, and the blank-label-is-`null` and blank-address-is-400 rules, belong to
`home_service` rather than to a validator (CONSTITUTION §7). The length bounds are here because
they mirror the `String(64)` columns and need no database read.
"""

import uuid

from pydantic import BaseModel, Field

HOME_FIELD_MAX_LENGTH = 64


class ClientHomeCreate(BaseModel):
    label: str | None = Field(default=None, max_length=HOME_FIELD_MAX_LENGTH)
    address: str
    access_code: str = Field(max_length=HOME_FIELD_MAX_LENGTH)
    child_ids: list[uuid.UUID] = []


class HomeUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=HOME_FIELD_MAX_LENGTH)
    address: str | None = None
    access_code: str | None = Field(default=None, max_length=HOME_FIELD_MAX_LENGTH)
    is_active: bool | None = None
