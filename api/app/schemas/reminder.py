"""Wire shapes for `GET /api/reminders/week` (one week's preview and its reminder rows) and for
one Guardian's reminder status and consent under `/api/clients/{id}/reminders`.

Deliberately without the send weekday, hour or timezone: those are settings, which only Admin
and Developer may read, and the Reminders page takes them from there.
"""

import datetime
import uuid
from typing import Literal

from pydantic import BaseModel

from app.models.enums import (
    ConsentAction,
    ConsentSource,
    Language,
    ReminderSkipReason,
    ReminderStatus,
)


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


class ConsentRead(BaseModel):
    """The current consent: the latest row's action, or `never` when there is none.

    `blocked_by_whatsapp` is true while WhatsApp's `system` opt-out is newer than every row the
    Guardian wrote, Staff rows since included: Record opt-in is then refused (409), and only the
    Guardian's own START lifts it. It can be true while `source` is `staff`."""

    state: Literal["opt_in", "opt_out", "never"]
    source: ConsentSource | None
    set_at: datetime.datetime | None
    blocked_by_whatsapp: bool


class LastReminderRead(BaseModel):
    week_start: datetime.date
    status: ReminderStatus
    error_code: str | None
    skip_reason: ReminderSkipReason | None


class ConsentHistoryRead(BaseModel):
    """`who` is the Staff member's Display name for a `staff` row, "Guardian" for `intake` and
    `message`, and "WhatsApp" for `system` (Twilio reporting the number blocked)."""

    id: uuid.UUID
    action: ConsentAction
    source: ConsentSource
    created_at: datetime.datetime
    who: str


class GuardianRemindersRead(BaseModel):
    """`GET /api/clients/{id}/reminders`. `history` is newest first; `last_reminder` is `null`
    until a weekly run has reminded or skipped the Guardian."""

    consent: ConsentRead
    last_reminder: LastReminderRead | None
    history: list[ConsentHistoryRead]


class ConsentRecord(BaseModel):
    """`POST /api/clients/{id}/reminders/consent`: Staff record an opt-in or opt-out."""

    action: ConsentAction
