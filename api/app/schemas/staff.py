"""The one item `GET /api/staff` returns: a person a Booking can be with.

`id` is the `users.id` that `POST /api/bookings.user_id` takes; `tutor_id` is the teaching
profile's id that `GET /api/tutors/{id}/availability` takes, `null` for a person with none (an
Admin, or a Manager migrated without a profile). Nothing more — email, phone and bio belong to
`/api/users` and `/api/tutors`, which carry their own access rules.
"""

import uuid

from pydantic import BaseModel

from app.models.enums import UserRole


class StaffRead(BaseModel):
    id: uuid.UUID
    name: str
    role: UserRole
    tutor_id: uuid.UUID | None
