import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel

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


class MeRead(BaseModel):
    id: uuid.UUID
    email: str
    role: UserRole
    name: str
    # The caller's own profile id, or null for a user with none.
    tutor_id: uuid.UUID | None
    # The office's E.164 number, or null while an Admin has not set one. Same for every role.
    office_phone: str | None


class MeUpdate(BaseModel):
    # Nothing else: the row is the token's user, so there is no id to send.
    name: str


class TutorProfileCreate(BaseModel):
    # No `name` and no `email`: both are the account's, so the person has one of each and the
    # address they log in with and the one the office reaches them on cannot drift apart.
    # `phone_number` is a plain `str` for the reason `schemas/tutor.py` gives — the canonical
    # form is `phone_service`'s to produce, and it needs a `Session` a validator does not have
    # (CONSTITUTION §7).
    phone_number: str
    bio: str | None = None


class UserCreate(BaseModel):
    # The pairing rule is the service's: a Tutor or Manager carries `tutor`, any other role
    # does not. `tutor_id` is still parsed so the service can refuse it with its own 409 —
    # every profile already has its user, and an Admin edits that user instead.
    email: Email
    # Required for every role, tutors included. Blank or too long is the service's 422.
    name: str
    role: UserRole
    tutor_id: uuid.UUID | None = None
    tutor: TutorProfileCreate | None = None
    # Sends the Invite in this same request, by the same path as `POST /{id}/invite`.
    send_invite: bool = False


class UserUpdate(BaseModel):
    # Every field optional, and no profile field at all: a `PATCH` never creates, moves or
    # drops a profile. A role change to Admin keeps it; a change to Tutor or Manager needs it.
    email: Email | None = None
    name: str | None = None
    role: UserRole | None = None
