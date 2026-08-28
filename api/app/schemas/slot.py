"""The response shape for `GET /api/slots/available`.

Read-only: an open slot is computed, never stored, so there is no `SlotCreate` and no
`SlotUpdate` to pair with this. `POST /api/bookings` is what turns one of these into a row, and
it takes a booking body rather than a slot.

`start_time` and `end_time` render as `"09:00:00"` — the `HH:MM:SS` form every other time in
this API already serialises (`docs/api-design.md:1105`). The examples at `:1044-1052` show
`"09:00"`; that is the illustration being stale, not a second format, and it is not to be
worked around with a custom serialiser.
"""

import datetime
import uuid

from pydantic import BaseModel


class SlotRead(BaseModel):
    tutor_id: uuid.UUID
    tutor_name: str
    availability_id: uuid.UUID
    date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
