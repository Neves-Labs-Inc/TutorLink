"""Age- and expiry-based cleanup: chat history past `chat_retention_days`, bot flows past their
`expires_at`, and login attempts past the larger rate-limit window.

This is a separate module from `message_service` and `conversation_service` on purpose
(**P7-R**): the age-based DELETE shares no query with the record-and-read path those two modules
own. It imports `Conversation` and `Message` read-only and writes its own two statements rather
than reusing theirs. The two reaps live beside it because all three run in the same nightly
transaction — `retention_scheduler.run_guarded_purge`, the one caller of all three, reached from
the API's hourly tick and from the `purge-messages` CLI command alike.

**The two reaps run even when `chat_retention_days = 0`.** That setting is a records-retention
choice about chat history (`erd.md:358`); `bot_flow_state` and `login_attempts` are not records.
A flow past its `expires_at` is already dead to the bot, and a login attempt older than every
rate-limit window is already invisible to the limiter, so deleting them is expiry, not
retention — and skipping them because chat purging is off would let both tables grow forever.

Nothing here commits. The caller owns the transaction boundary, and it has to be one transaction
for all three: `run_guarded_purge` holds a transaction-scoped advisory lock across them, and a
commit in the middle would release it while the rest of the run is still deleting.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.bot_flow_state import BotFlowState
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.login_attempt import LoginAttempt
from app.models.message import Message
from app.services.rate_limit_service import (
    EMAIL_WINDOW_SECONDS_SETTING,
    FORGOT_EMAIL_WINDOW_SECONDS_SETTING,
    FORGOT_IP_WINDOW_SECONDS_SETTING,
    IP_WINDOW_SECONDS_SETTING,
)
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


def reap_expired_flow_states(db: Session) -> int:
    return db.execute(delete(BotFlowState).where(BotFlowState.expires_at <= func.now())).rowcount


def reap_expired_login_attempts(db: Session) -> int:
    """Delete attempts older than the *largest* of the four windows, on the database's clock.

    One DELETE covers every bucket — login's two and forgot-password's two — so it takes the
    longest window: a shorter one would delete rows another bucket still counts and hand back
    budget an attacker already spent. The cutoff is measured on the database's clock — the one
    `rate_limit_service` stamps and prunes with — so no host's drift enters it.
    """
    window_seconds = max(
        get_int_setting(db, key=IP_WINDOW_SECONDS_SETTING),
        get_int_setting(db, key=EMAIL_WINDOW_SECONDS_SETTING),
        get_int_setting(db, key=FORGOT_IP_WINDOW_SECONDS_SETTING),
        get_int_setting(db, key=FORGOT_EMAIL_WINDOW_SECONDS_SETTING),
    )
    cutoff = func.now() - timedelta(seconds=window_seconds)

    return db.execute(delete(LoginAttempt).where(LoginAttempt.attempted_at < cutoff)).rowcount
