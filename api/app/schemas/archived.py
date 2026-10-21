"""Archive helpers shared by read and write shapes."""

from typing import Annotated

from pydantic import AliasChoices, Field


# Read shapes validated straight from an ORM row (`model_validate(row)`) pick up the row's
# `is_archived`; a dict or keyword construction says `archived`. Serialises as `archived`.
ArchivedFlag = Annotated[bool, Field(validation_alias=AliasChoices("archived", "is_archived"))]
