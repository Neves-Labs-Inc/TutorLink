"""Request and response shapes for `/api/children`.

`docs/api-design.md` documents no response body for either children route, so `ChildRead`
echoing `guardian_ids` and `home_ids` is a choice this task makes rather than a contract it
inherits. It is what makes `PATCH`'s replace semantics observable without a second request —
the frozen contract offers no `GET /api/children/{id}` to check the result against.

`grade_level` is an integer everywhere. The label ("Grade 7") is derived for display and is
never stored, so a string is refused rather than coerced.
"""

import uuid

from pydantic import BaseModel


class ChildRead(BaseModel):
    id: uuid.UUID
    name: str
    age: int
    grade_level: int
    school_name: str
    guardian_ids: list[uuid.UUID]
    home_ids: list[uuid.UUID]


class ChildCreate(BaseModel):
    guardian_ids: list[uuid.UUID]
    home_ids: list[uuid.UUID]
    name: str
    age: int
    grade_level: int
    school_name: str


class ChildUpdate(BaseModel):
    # An absent array leaves the link set alone; a present empty one is a 400. The two must stay
    # distinguishable all the way down to the service, which is why the default is None and not
    # an empty list.
    guardian_ids: list[uuid.UUID] | None = None
    home_ids: list[uuid.UUID] | None = None
    name: str | None = None
    age: int | None = None
    grade_level: int | None = None
    school_name: str | None = None
