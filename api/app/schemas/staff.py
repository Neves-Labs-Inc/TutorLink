"""The one Staff row `GET /api/staff` and `GET /api/staff/{id}` return (#212).

`id` is the `users.id` that `POST /api/bookings.user_id` takes; `tutor_id` is the teaching
profile's id that `GET /api/tutors/{id}/availability` takes, `null` for a person with none (an
Admin, or a Manager migrated without a profile). The rest is what the Office's Staff screen
shows: account state, the subjects they teach and the sessions still ahead of them this week.
Phone and bio stay on `/api/tutors`.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.enums import UserRole
from app.services.sign_in_state import SignInState


class StaffSubjectRead(BaseModel):
    id: uuid.UUID
    name: str


class StaffRead(BaseModel):
    id: uuid.UUID
    name: str
    role: UserRole
    tutor_id: uuid.UUID | None
    email: str
    sign_in_state: SignInState
    invite_expires_at: datetime | None
    archived: bool
    subjects: list[StaffSubjectRead]
    sessions_this_week: int
