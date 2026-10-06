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


class MeRead(BaseModel):
    id: uuid.UUID
    email: str
    role: UserRole
    display_name: str


class TutorProfileCreate(BaseModel):
    # No `email`, deliberately: the profile takes the account's, so the address a tutor logs in
    # with and the one the office reaches them on cannot drift apart. `phone_number` is a plain
    # `str` for the reason `schemas/tutor.py` gives — the canonical form is `phone_service`'s to
    # produce, and it needs a `Session` a validator does not have (CONSTITUTION §7).
    name: str
    phone_number: str
    bio: str | None = None


class UserCreate(BaseModel):
    # Both fields are optional here and the pairing rule is the service's: a tutor account
    # carries exactly one of them, any other role neither. Enforced in `user_service` next to
    # the role/profile rule it completes, so one place decides what shape a tutor account has
    # and the refusal carries this router's own message.
    email: Email
    password: str
    role: UserRole
    tutor_id: uuid.UUID | None = None
    tutor: TutorProfileCreate | None = None


class UserUpdate(BaseModel):
    # Every field optional, and `tutor_id` is absent on purpose: unlinking a tutor account from
    # its profile is not something PATCH offers, because a tutor row with a NULL tutor_id is
    # the data error `TutorScope` refuses on.
    email: Email | None = None
    password: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
