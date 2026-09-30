import uuid

from pydantic import BaseModel


class SubjectRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    is_active: bool
    tutor_count: int


class SubjectCreate(BaseModel):
    name: str
    description: str | None = None


class SubjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None
