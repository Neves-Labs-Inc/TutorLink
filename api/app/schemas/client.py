"""Request and response shapes for `/api/clients`.

**`ClientRead.archived` is a proposed `docs/api-design.md` amendment, not a silent addition.**
The frozen example body at `docs/api-design.md:~628` omits it while the same document's
409-recovery path tells the bot to reactivate a deactivated client it has just fetched by id —
a decision it cannot make without the flag. Recorded as OQ-3/A-3 for the user to accept.

**`HomeRead.archived` is a second amendment of the same kind.** `docs/api-design.md:69` keeps
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

import datetime
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.child import Child
from app.models.enums import Language
from app.models.guardian import Guardian
from app.models.home import DIRECTIONS_MAX_LENGTH, Home
from app.schemas.archived import ArchivedFlag
from app.schemas.booking import NamedRef


class HomeRead(BaseModel):
    id: uuid.UUID
    label: str | None
    address: str
    directions: str | None
    archived: ArchivedFlag
    # Every Guardian linked to the Home, archived ones included, by name then id.
    guardians: list[NamedRef]
    # The upcoming live Bookings that block archiving the Home.
    upcoming_booking_count: int


def home_read(home: Home, guardians: list[Guardian], upcoming_booking_count: int) -> HomeRead:
    return HomeRead(
        id=home.id,
        label=home.label,
        address=home.address,
        directions=home.directions,
        archived=home.is_archived,
        guardians=[NamedRef(id=guardian.id, name=guardian.name) for guardian in guardians],
        upcoming_booking_count=upcoming_booking_count,
    )


class StaffRef(BaseModel):
    id: uuid.UUID
    name: str


class EvaluatedRead(BaseModel):
    at: datetime.datetime
    by: StaffRef


class ChildRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    date_of_birth: datetime.date | None
    grade_level: int | None
    school_name: str
    notes: str | None
    archived: ArchivedFlag
    # Null unless the Child is Evaluated (`at` and the evaluator both set).
    evaluated: EvaluatedRead | None


def child_read(child: Child) -> ChildRead:
    by = child.evaluated_by

    return ChildRead(
        id=child.id,
        name=child.name,
        date_of_birth=child.date_of_birth,
        grade_level=child.grade_level,
        school_name=child.school_name,
        notes=child.notes,
        archived=child.is_archived,
        evaluated=(
            None
            if child.evaluated_at is None or by is None
            else EvaluatedRead(at=child.evaluated_at, by=StaffRef(id=by.id, name=by.name))
        ),
    )


class ClientSummary(BaseModel):
    id: uuid.UUID
    name: str
    phone_number: str
    archived: bool
    home_count: int
    # Non-archived Children only, so it is the length of `children`.
    child_count: int
    # Never null on the list: an undetected language reads English, the language used.
    language: Language
    reminders: Literal["opt_in", "opt_out", "never"]
    reminders_blocked_by_whatsapp: bool
    # The non-archived Children, by name.
    children: list[NamedRef]


class ClientRead(BaseModel):
    id: uuid.UUID
    name: str
    phone_number: str
    archived: bool
    homes: list[HomeRead]
    children: list[ChildRead]
    # The Guardian language: that of the most recently active conversation, `null` when it is
    # not detected. Staff change it through `PATCH /api/conversations/{language_conversation_id}`;
    # with no conversation the id is `null` and English is used.
    language: Language | None
    language_conversation_id: uuid.UUID | None
    reminders: Literal["opt_in", "opt_out", "never"]
    reminders_blocked_by_whatsapp: bool


class HomeCreate(BaseModel):
    label: str | None = None
    address: str
    directions: str | None = Field(default=None, max_length=DIRECTIONS_MAX_LENGTH)


class ClientCreate(BaseModel):
    name: str
    phone_number: str
    home: HomeCreate | None = None


class ClientUpdate(BaseModel):
    # No `address` or `directions`: both belong to a home, which is edited through its own
    # resource. A client with two homes has no single one for a flat field to mean.
    name: str | None = None
    phone_number: str | None = None
