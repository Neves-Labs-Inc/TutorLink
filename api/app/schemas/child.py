"""Request and response shapes for `/api/children`.

`ChildRead` echoing `guardian_ids` and `home_ids` is what makes `PATCH`'s replace semantics
observable without a second request — the frozen contract offers no `GET /api/children/{id}` to
check the result against. The shape itself is `docs/api-design.md`'s (amendment P7-10).

`grade_level` is an integer everywhere. The label ("Grade 7") is derived for display and is
never stored, so a string is refused rather than coerced.

`date_of_birth` is required on create and nullable on read: a child registered before migration
0015 has none, and nothing stored then could be turned into one (A-44). The plausibility bound
is the service's, not a validator's, so the bot and the API share one rule (A-46). `notes` is
admin-only (A-43) and must never be added to a shape a tutor can reach.
"""

import datetime
import uuid

from pydantic import BaseModel, Field

from app.models.child import NOTES_MAX_LENGTH


class ChildRead(BaseModel):
    id: uuid.UUID
    name: str
    date_of_birth: datetime.date | None
    grade_level: int
    school_name: str
    notes: str | None
    guardian_ids: list[uuid.UUID]
    home_ids: list[uuid.UUID]


class ChildCreate(BaseModel):
    guardian_ids: list[uuid.UUID]
    home_ids: list[uuid.UUID]
    name: str
    date_of_birth: datetime.date
    grade_level: int = Field(ge=1)
    school_name: str
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)


class ChildUpdate(BaseModel):
    # An absent array leaves the link set alone; a present empty one is a 400. The two must stay
    # distinguishable all the way down to the service, which is why the default is None and not
    # an empty list.
    guardian_ids: list[uuid.UUID] | None = None
    home_ids: list[uuid.UUID] | None = None
    name: str | None = None
    date_of_birth: datetime.date | None = None
    grade_level: int | None = Field(default=None, ge=1)
    school_name: str | None = None
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
