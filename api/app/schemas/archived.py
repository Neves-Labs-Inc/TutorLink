"""The wire still says `is_active` while storage says `is_archived`; the next step renames the
wire to match. Until then routers and read shapes translate at the edge with these."""

from pydantic import BaseModel, ConfigDict, model_validator

ARCHIVED_ATTRIBUTE = "is_archived"
WIRE_FIELD = "is_active"


def to_archived(is_active: bool | None) -> bool | None:
    """A wire `is_active` as the stored `is_archived`; `None` (left unchanged) stays `None`."""
    return None if is_active is None else not is_active


class ReadFromArchivedRow(BaseModel):
    """A read shape validated straight from an ORM row (`model_validate(row)`), whose
    `is_active` field is the row's `is_archived` inverted. A dict passes through untouched."""

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _active_from_archived(cls, data: object) -> object:
        if isinstance(data, dict) or not hasattr(data, ARCHIVED_ATTRIBUTE):
            return data

        fields = {name: getattr(data, name) for name in cls.model_fields if name != WIRE_FIELD}
        return {**fields, WIRE_FIELD: not getattr(data, ARCHIVED_ATTRIBUTE)}
