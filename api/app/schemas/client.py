"""Request and response shapes for `/api/clients`.

**`ClientRead.is_active` is a proposed `docs/api-design.md` amendment, not a silent addition.**
The frozen example body at `docs/api-design.md:~628` omits it while the same document's
409-recovery path tells the bot to reactivate a deactivated client it has just fetched by id —
a decision it cannot make without the flag. Recorded as OQ-3/A-3 for the user to accept.

**`HomeRead.is_active` is a second amendment of the same kind.** `docs/api-design.md:69` keeps
nested homes outside the collection `is_active` rule, so the by-id response returns every linked
home while `home_count` on the list counts only the active ones; `docs/api-design.md:64` names the
remedy — a caller that must distinguish a deactivated row "needs it added to that endpoint's
schema first". Without the field the two numbers read as a contradiction rather than as two
questions.

`ChildRead` here is a deliberate duplicate of the read shape `schemas/child.py` owns. The two
files must not import each other: the duplication is what lets the clients and children tracks
land independently.

`phone_number` is a plain `str` in every shape. It is normalised in `client_service`, not by a
validator, because the canonical form depends on a `system_settings` row and a validator has no
`Session` (CONSTITUTION §7, decision D-C).
"""

import uuid

from pydantic import BaseModel, ConfigDict


class HomeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str | None
    address: str
    access_code: str
    is_active: bool


class ChildRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    age: int
    grade_level: int
    school_name: str


class ClientSummary(BaseModel):
    id: uuid.UUID
    name: str
    phone_number: str
    is_active: bool
    home_count: int
    child_count: int


class ClientRead(BaseModel):
    id: uuid.UUID
    name: str
    phone_number: str
    is_active: bool
    homes: list[HomeRead]
    children: list[ChildRead]


class HomeCreate(BaseModel):
    label: str | None = None
    address: str
    access_code: str


class ClientCreate(BaseModel):
    name: str
    phone_number: str
    home: HomeCreate | None = None


class ClientUpdate(BaseModel):
    # No `address` or `access_code`: both belong to a home, which is edited through its own
    # resource. A client with two homes has no single one for a flat field to mean.
    name: str | None = None
    phone_number: str | None = None
    is_active: bool | None = None
