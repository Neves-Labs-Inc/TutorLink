"""Response shapes for `/api/households` (HH).

A household is not a stored entity: it is a connected component of the bipartite graph
guardians and children form over `child_guardians`, computed fresh on every request. `key` is
the first guardian's id in the household's own sort order — a render key for the dashboard's
list, not an address or anything durable across requests.
"""

import uuid

from pydantic import BaseModel


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


class HouseholdRead(BaseModel):
    key: uuid.UUID
    guardians: list[HouseholdGuardian]
    children: list[HouseholdChild]
