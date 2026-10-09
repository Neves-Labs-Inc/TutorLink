"""Wire shapes for `/api/settings` — one object per setting, in both directions.

`value` is `str` everywhere, mirroring the TEXT column. A client must not be able to send `90`
for one setting and `"90"` for another and have both work, so the number form is rejected by
the schema rather than coerced (D-003). What `value` *means* is decided by `value_type`, and
`settings_service` is the only thing that checks the two agree.

`SettingsUpdate` carries a list rather than a `{key: value}` map because a JSON object with a
duplicate key is undefined — the last one silently wins — and a duplicate this project can see
is a duplicate it can refuse (D-003). `min_length=1` for the same reason: an empty batch is a
write that asks for nothing, and answering it with the full settings list would look like a
successful change nobody made.

`SettingRead` deliberately has no `ConfigDict(from_attributes=True)`. The router builds it
field by field so that exposing a new `system_settings` column is a decision rather than an
accident (constitution §8).

`is_developer_only` is present for both roles (D-002). For an admin it is `false` on every row
they can possibly receive — the service never sends them another kind — so it discloses
nothing, while a developer gets the real flag, which is what lets the dashboard badge a
developer-only field without a hardcoded key list.
"""

from typing import Annotated

from pydantic import BaseModel, Field

from app.schemas.common import Page
from app.services.mail_templates import TemplateKind


class SettingRead(BaseModel):
    key: str
    value: str
    value_type: str
    is_developer_only: bool


class SettingsPage(Page[SettingRead]):
    """The page envelope plus two derived, read-only flags beside `items`.

    Top-level rather than synthetic rows: they are not `system_settings` rows, cannot be
    written, and an admin gets `reminders_paused` without seeing the developer-only template
    ids behind it.
    """

    business_timezone_locked: bool
    reminders_paused: bool


class SettingWrite(BaseModel):
    key: str
    value: str


class SettingsUpdate(BaseModel):
    updates: Annotated[list[SettingWrite], Field(min_length=1)]


class EmailTemplateTest(BaseModel):
    """An unsaved draft to email to the caller; `mail_templates` checks its rules."""

    template: TemplateKind
    subject: str
    body: str
