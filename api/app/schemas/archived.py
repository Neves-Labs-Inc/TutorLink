"""Archive helpers shared by read and write shapes."""

from typing import Annotated

from pydantic import AliasChoices, Field


def to_archived(is_active: bool | None) -> bool | None:
    """A wire `is_active` as the stored `is_archived`; `None` (left unchanged) stays `None`.

    Only the PATCH bodies still say `is_active`; tickets 03-05 remove them."""
    return None if is_active is None else not is_active


# Read shapes validated straight from an ORM row (`model_validate(row)`) pick up the row's
# `is_archived`; a dict or keyword construction says `archived`. Serialises as `archived`.
ArchivedFlag = Annotated[bool, Field(validation_alias=AliasChoices("archived", "is_archived"))]
