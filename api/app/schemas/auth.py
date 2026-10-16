from typing import Literal

from pydantic import BaseModel, Field

from app.models.password_link import PasswordLinkPurpose

# Real link tokens are 43 characters; the cap stops an anonymous caller making each request
# hash a multi-megabyte body.
MAX_TOKEN_LENGTH = 128


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class SetPasswordRequest(BaseModel):
    token: str = Field(max_length=MAX_TOKEN_LENGTH)
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ForgotPasswordResponse(BaseModel):
    detail: str


class LinkLookupRequest(BaseModel):
    token: str = Field(max_length=MAX_TOKEN_LENGTH)


class LinkLookupResponse(BaseModel):
    kind: PasswordLinkPurpose | None
    state: Literal["valid", "expired", "used", "invalid"]
    name: str | None
    email: str | None
