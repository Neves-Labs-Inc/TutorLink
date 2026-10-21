"""Response shapes for `/api/households` (HH).

A household is not a stored entity: it is a connected component of the bipartite graph
guardians and children form over `child_guardians`, computed fresh on every request. `key` is
the first guardian's id in the household's own sort order — a render key for the dashboard's
list, not an address or anything durable across requests. `GET /api/households/{member_id}`
is the durable address: any Guardian's or Child's id finds the same family.
"""

import datetime
import uuid

from pydantic import BaseModel

from app.models.enums import BookingKind, BookingLocation
from app.schemas.booking import NamedRef


class HouseholdGuardian(BaseModel):
    id: uuid.UUID
    name: str
    phone_number: str
    archived: bool


class HouseholdChild(BaseModel):
    id: uuid.UUID
    name: str
    grade_level: int | None
    archived: bool


class HouseholdHome(BaseModel):
    id: uuid.UUID
    label: str | None
    address: str
    directions: str | None
    archived: bool
    # The family's Guardians on this Home, archived ones included, in the family's order.
    guardian_ids: list[uuid.UUID]


class HouseholdNextBooking(BaseModel):
    id: uuid.UUID
    kind: BookingKind
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    location: BookingLocation
    child: NamedRef
    staff: NamedRef


class HouseholdRead(BaseModel):
    key: uuid.UUID
    guardians: list[HouseholdGuardian]
    children: list[HouseholdChild]
    # Derived from the Guardians' surnames on every read; never stored.
    name: str
    # True when every Guardian is archived.
    archived: bool
    homes: list[HouseholdHome]
    next_booking: HouseholdNextBooking | None
