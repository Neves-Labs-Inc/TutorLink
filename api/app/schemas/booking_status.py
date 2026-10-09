"""Request and response shapes for `PATCH /api/bookings/{id}`.

`BookingStatusChanged` duplicates B2's `BookingCreated` field for field (`id`, `status`,
`scheduled_date`, `start_time`, `end_time`). Deliberate, for the same reason B2's duplicates
B1's — and named differently so a later reader consolidating them does so on purpose.
"""

import datetime
import uuid

from pydantic import AwareDatetime, BaseModel

from app.models.enums import BookingStatus


class BookingStatusUpdate(BaseModel):
    status: BookingStatus
    # The `updated_at` the caller last read; when sent, a changed row is refused (#151).
    # Aware, as the column is: a naive value could never equal it and would always read stale.
    expected_updated_at: AwareDatetime | None = None


class BookingStatusChanged(BaseModel):
    id: uuid.UUID
    status: BookingStatus
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    updated_at: datetime.datetime
