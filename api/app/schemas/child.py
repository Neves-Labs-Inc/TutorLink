"""Request and response shapes for `/api/children`.

`ChildRead` echoing `guardian_ids` and `home_ids` is what makes `PATCH`'s replace semantics
observable without a second request — the frozen contract offers no `GET /api/children/{id}` to
check the result against. The shape itself is `docs/api-design.md`'s (amendment P7-10).

`grade_level` is the Overall grade, an integer 0..12 everywhere (0 = Kindergarten). The label
("Grade 7") is derived for display and is never stored, so a string is refused rather than
coerced. It is optional on create and nullable
on read from migration 0019 on: the admin sets it by hand after the child's first session.
`ChildUpdate` cannot clear it, because there None already means "leave alone".

`date_of_birth` is required on create and nullable on read: a child registered before migration
0015 has none, and nothing stored then could be turned into one (A-44). The plausibility bound
is the service's, not a validator's, so the bot and the API share one rule (A-46). `notes`
reaches a tutor in exactly one place — `child.notes` on `GET /api/bookings/{id}` for the tutor
assigned to that booking (OQ-52 answered (b), 2026-09-23; A-43 reversed). `date_of_birth` is
admin-only and must never be added to a shape a tutor can reach.

`is_active` exists from migration 0016 on (P7C-1), reversing `docs/api-design.md:71`'s "children
carries no flag": a child can be deactivated without being deleted. `ChildSummary` and
`ChildDetail` serve `GET /api/children` and `GET /api/children/{id}` (CR). The
`GuardianLinkCreate` exactly-one-of `guardian_id`/`guardian` rule belongs to the service, not a
validator, because resolving it may mean creating a guardian row (07B P7B-A).

`levels` and `evaluated` carry the Subject levels and the Evaluated mark, each with the Staff
member behind it as a `StaffRef` (Display name). `created_at` on `ChildSummary` is the
"Since" of the Awaiting evaluation tab.
"""

import datetime
import uuid

from pydantic import BaseModel, Field

from app.models.child import HIGHEST_GRADE, LOWEST_GRADE, NOTES_MAX_LENGTH
from app.schemas.booking import NamedRef


class ChildRead(BaseModel):
    id: uuid.UUID
    name: str
    date_of_birth: datetime.date | None
    grade_level: int | None
    school_name: str
    notes: str | None
    is_active: bool
    guardian_ids: list[uuid.UUID]
    home_ids: list[uuid.UUID]


class ChildCreate(BaseModel):
    guardian_ids: list[uuid.UUID]
    home_ids: list[uuid.UUID]
    name: str
    date_of_birth: datetime.date
    grade_level: int | None = Field(default=None, ge=LOWEST_GRADE, le=HIGHEST_GRADE)
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
    grade_level: int | None = Field(default=None, ge=LOWEST_GRADE, le=HIGHEST_GRADE)
    school_name: str | None = None
    notes: str | None = Field(default=None, max_length=NOTES_MAX_LENGTH)
    is_active: bool | None = None
    expected_cancellations: int | None = Field(default=None, ge=0)


class StaffRef(BaseModel):
    id: uuid.UUID
    name: str


class EvaluatedRead(BaseModel):
    at: datetime.datetime
    by: StaffRef


class LevelSet(BaseModel):
    level: int = Field(ge=LOWEST_GRADE, le=HIGHEST_GRADE)


class ChildLevelRead(BaseModel):
    subject_id: uuid.UUID
    name: str
    # The subject's flag: a level outlives its subject's deactivation and is shown muted.
    is_active: bool
    level: int
    set_by: StaffRef
    updated_at: datetime.datetime


class ChildHomeRef(BaseModel):
    id: uuid.UUID
    label: str | None
    address: str
    is_active: bool


class ChildHomeRead(ChildHomeRef):
    access_code: str


class NextSession(BaseModel):
    id: uuid.UUID
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    tutor: NamedRef
    subject: NamedRef


class ChildSummary(BaseModel):
    id: uuid.UUID
    name: str
    grade_level: int | None
    school_name: str
    is_active: bool
    guardians: list[NamedRef]
    homes: list[ChildHomeRef]
    next_session: NextSession | None
    evaluated: EvaluatedRead | None
    created_at: datetime.datetime


class ChildGuardianRead(BaseModel):
    id: uuid.UUID
    name: str
    phone_number: str
    is_active: bool


class ChildDetail(BaseModel):
    id: uuid.UUID
    name: str
    date_of_birth: datetime.date | None
    grade_level: int | None
    school_name: str
    notes: str | None
    is_active: bool
    upcoming_session_count: int
    guardians: list[ChildGuardianRead]
    homes: list[ChildHomeRead]
    levels: list[ChildLevelRead]
    evaluated: EvaluatedRead | None


class NewGuardian(BaseModel):
    name: str
    phone_number: str


class GuardianLinkCreate(BaseModel):
    guardian_id: uuid.UUID | None = None
    guardian: NewGuardian | None = None
    home_ids: list[uuid.UUID] = []
