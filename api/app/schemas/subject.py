import uuid
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, Field

from app.services.text_rules import HiddenCharacters, clean_single_line, normalize_single_line

# The `subjects.name` column width.
MAX_NAME_LENGTH = 128
# The `subjects.name_es` column width.
MAX_NAME_ES_LENGTH = 128
NAME_ES_CHARACTERS_ERROR = (
    "must not contain control or invisible characters "
    "(line breaks, tabs, zero-width or text-direction characters)"
)
NAME_BLANK_ERROR = "must not be blank"


def _normalize_name(raw: object) -> object:
    """The Subject's English name, normalized so two names that look alike compare alike."""
    if not isinstance(raw, str):
        return raw

    normalized = normalize_single_line(raw)
    if not normalized:
        raise ValueError(NAME_BLANK_ERROR)

    return normalized


def _clean_spanish_name(raw: object) -> object:
    """The Display name's text rule, since the bot sends this name to Guardians; blank means
    "no Spanish name", so the bot falls back to `name`."""
    if not isinstance(raw, str):
        return raw

    try:
        cleaned = clean_single_line(raw)
    except HiddenCharacters as exc:
        raise ValueError(NAME_ES_CHARACTERS_ERROR) from exc

    return cleaned or None


# `None` passes through, so `SubjectUpdate` can keep the current name.
# Checked after normalization, so trimmed spaces and dropped hidden characters don't count.
SubjectName = Annotated[
    Annotated[str, Field(max_length=MAX_NAME_LENGTH)], BeforeValidator(_normalize_name)
]

SpanishName = Annotated[
    Annotated[str, Field(max_length=MAX_NAME_ES_LENGTH)] | None,
    BeforeValidator(_clean_spanish_name),
]


class SubjectRead(BaseModel):
    id: uuid.UUID
    name: str
    name_es: str | None
    description: str | None
    archived: bool
    tutor_count: int


class SubjectCreate(BaseModel):
    name: SubjectName
    name_es: SpanishName = None
    description: str | None = None


class SubjectUpdate(BaseModel):
    """Omitting `name` or sending `null` keeps it. Omitting `name_es` keeps it; `null` or a
    blank string clears it."""

    name: SubjectName | None = None
    name_es: SpanishName = None
    description: str | None = None
    is_active: bool | None = None
