import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict

from app.models.enums import UserRole


def _looks_like_an_email(value: str) -> str:
    """The same rule `app.cli` applies, deliberately.

    Both the CLI and this API create users. A stricter check here than there would mean an
    address the bootstrap command accepts and the dashboard rejects, which is worse than a
    loose rule applied consistently. Tightening it is a change to both, not to one.
    """
    if not value.strip() or "@" not in value:
        raise ValueError("invalid email")

    return value


Email = Annotated[str, AfterValidator(_looks_like_an_email)]


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    role: UserRole
    tutor_id: uuid.UUID | None
    is_active: bool


class UserCreate(BaseModel):
    email: Email
    password: str
    role: UserRole
    tutor_id: uuid.UUID | None = None


class UserUpdate(BaseModel):
    # Every field optional, and `tutor_id` is absent on purpose: unlinking a tutor account from
    # its profile is not something PATCH offers, because a tutor row with a NULL tutor_id is
    # the data error `TutorScope` refuses on.
    email: Email | None = None
    password: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
