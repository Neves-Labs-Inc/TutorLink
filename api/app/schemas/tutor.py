"""The one tutor shape every `/api/tutors` route returns, plus its embedded assignment item.

**No `availability` field, deliberately.** `docs/api-design.md:~765` says
`GET /api/tutors/{id}` returns "subjects and weekly availability"; the availability item schema
is owned by `GET /api/tutors/{id}/availability` in Phase 4, and inventing a shape here would
fix a contract the endpoint that owns it has to live with. Reported divergence, decided — not
an oversight.

`phone_number` is a plain `str`: the canonical form is produced by `phone_service`, which needs
a `Session` to read the parsing region and so cannot run in a validator (CONSTITUTION §7).
"""

import uuid

from pydantic import BaseModel

from app.schemas.user import Email


class TutorSubjectRead(BaseModel):
    subject_id: uuid.UUID
    name: str
    max_grade_level: int


class TutorRead(BaseModel):
    id: uuid.UUID
    # The account behind the profile: what `POST /api/bookings.user_id` takes.
    user_id: uuid.UUID
    name: str
    email: str
    phone_number: str
    bio: str | None
    is_active: bool
    subjects: list[TutorSubjectRead]


class TutorCreate(BaseModel):
    name: str
    email: Email
    phone_number: str
    bio: str | None = None


class TutorUpdate(BaseModel):
    name: str | None = None
    email: Email | None = None
    phone_number: str | None = None
    bio: str | None = None
    is_active: bool | None = None
