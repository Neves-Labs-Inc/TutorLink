"""Wire shapes for `GET /api/reminders/week`: one week's preview and its reminder rows.

Deliberately without the send weekday, hour or timezone: those are settings, which only Admin
and Developer may read, and the Reminders page takes them from there.
"""

import datetime
import uuid

from pydantic import BaseModel

from app.models.enums import Language, ReminderSkipReason, ReminderStatus


class ReminderPreviewItem(BaseModel):
    """A Guardian the coming run would remind, or skip when `skip_reason` is set."""

    guardian_id: uuid.UUID
    guardian_name: str
    child_names: list[str]
    language: Language
    skip_reason: ReminderSkipReason | None


class ReminderRowRead(BaseModel):
    """One reminder the run wrote.

    `may_have_been_delivered` is true for a `failed` row whose send's outcome is unknown: the
    process stopped mid-send (`interrupted`) or the send timed out or was reset
    (`delivery_unknown`). Twilio may have delivered either, so it is not "not sent".
    """

    guardian_id: uuid.UUID
    guardian_name: str
    child_names: list[str]
    language: Language
    status: ReminderStatus
    skip_reason: ReminderSkipReason | None
    error_code: str | None
    may_have_been_delivered: bool
    sent_at: datetime.datetime | None


class ReminderWeekRead(BaseModel):
    """`preview` is `None` once the week's run has happened, and for any week but the one the
    next or current run covers."""

    week_start: datetime.date
    has_run: bool
    preview: list[ReminderPreviewItem] | None
    rows: list[ReminderRowRead]
