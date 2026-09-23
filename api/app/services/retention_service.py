"""Purging chat history older than `chat_retention_days`.

This is a separate module from `message_service` and `conversation_service` on purpose
(**P7-R**): the age-based DELETE has one caller — the `purge-messages` CLI command — and
shares no query with the record-and-read path those two modules own. It imports `Conversation`
and `Message` read-only and writes its own two statements rather than reusing theirs.

Nothing here commits. The caller — `app/cli.py`'s `purge-messages` command — owns the
transaction boundary, the same as `seed_admin`/`seed_developer` do for their own writes,
because a CLI command has no router above it to commit on its behalf.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.message import Message
from app.services.settings_service import get_int_setting

CHAT_RETENTION_DAYS_SETTING = "chat_retention_days"


@dataclass(frozen=True, slots=True)
class PurgeResult:
    """`ran` is what separates "0 because retention is off" from "0 because nothing qualified".

    `chat_retention_days = 0` means never purge (`erd.md:358`), which is a different outcome
    from a purge that ran and found nothing old enough to delete — both report zero counts, and
    a caller logging the result needs to tell them apart.
    """

    ran: bool
    messages_deleted: int
    conversations_deleted: int


def purge_expired_messages(db: Session) -> PurgeResult:
    retention_days = get_int_setting(db, key=CHAT_RETENTION_DAYS_SETTING)

    if retention_days == 0:
        result = PurgeResult(ran=False, messages_deleted=0, conversations_deleted=0)
    else:
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        messages_deleted = db.execute(delete(Message).where(Message.created_at < cutoff)).rowcount
        has_surviving_message = (
            select(Message.id).where(Message.conversation_id == Conversation.id).exists()
        )
        conversations_deleted = db.execute(
            delete(Conversation).where(
                Conversation.last_message_at < cutoff,
                Conversation.status != ConversationStatus.HUMAN,
                ~has_surviving_message,
            )
        ).rowcount
        result = PurgeResult(
            ran=True,
            messages_deleted=messages_deleted,
            conversations_deleted=conversations_deleted,
        )

    return result
