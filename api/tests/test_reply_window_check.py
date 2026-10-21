"""`conversation_service.flag_closed_reply_windows`: a Taken-over chat whose Guardian's 24-hour
reply window has closed goes back to Needs attention as `reply_window_closed`, once per window.

`now` is injected, so every case places its client message relative to a fixed `NOON` rather
than to the wall clock. The function returns the ids it flagged; assertions read the row too,
because the queue the Admin sees is the row.
"""

import datetime
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
    UserRole,
)
from app.models.message import Message
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services.conversation_service import flag_closed_reply_windows, mark_handled

NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)
DAY = datetime.timedelta(hours=24)
ONE_SECOND = datetime.timedelta(seconds=1)
EARLIER_FLAG_AT = NOON - datetime.timedelta(hours=30)


def test_a_taken_over_chat_whose_window_closed_is_flagged_reply_window_closed(
    db: Session,
) -> None:
    conversation = _taken_over(db)
    _client_message(db, conversation, at=NOON)

    flagged = flag_closed_reply_windows(db, now=NOON + DAY)

    assert conversation.id in flagged
    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.REPLY_WINDOW_CLOSED
    assert row.flagged_at is not None
    assert row.reply_window_flagged_for == NOON


def test_a_chat_still_inside_its_window_is_not_flagged(db: Session) -> None:
    conversation = _taken_over(db)
    _client_message(db, conversation, at=NOON)

    flagged = flag_closed_reply_windows(db, now=NOON + DAY - ONE_SECOND)

    assert conversation.id not in flagged
    assert _row(db, conversation.id).flag_reason is None


def test_a_bot_chat_is_never_flagged(db: Session) -> None:
    conversation = _conversation(db, holder=None)
    _client_message(db, conversation, at=NOON)

    flagged = flag_closed_reply_windows(db, now=NOON + 2 * DAY)

    assert conversation.id not in flagged
    assert _row(db, conversation.id).flag_reason is None


def test_a_taken_over_chat_with_no_client_message_is_not_flagged(db: Session) -> None:
    conversation = _taken_over(db)

    flagged = flag_closed_reply_windows(db, now=NOON + 2 * DAY)

    assert conversation.id not in flagged
    assert _row(db, conversation.id).flag_reason is None


def test_a_chat_flagged_stuck_keeps_stuck_until_that_flag_is_cleared(db: Session) -> None:
    conversation = _taken_over(db, reason=FlagReason.STUCK)
    _client_message(db, conversation, at=NOON)

    first = flag_closed_reply_windows(db, now=NOON + DAY)

    assert conversation.id not in first
    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.STUCK
    assert row.flagged_at == EARLIER_FLAG_AT

    mark_handled(db, conversation_id=conversation.id, flagged_at=EARLIER_FLAG_AT)
    second = flag_closed_reply_windows(db, now=NOON + DAY + ONE_SECOND)

    assert conversation.id in second
    assert _row(db, conversation.id).flag_reason is FlagReason.REPLY_WINDOW_CLOSED


def test_running_the_check_twice_flags_once(db: Session) -> None:
    conversation = _taken_over(db)
    _client_message(db, conversation, at=NOON)
    flag_closed_reply_windows(db, now=NOON + DAY)
    first_flagged_at = _row(db, conversation.id).flagged_at

    second = flag_closed_reply_windows(db, now=NOON + DAY + datetime.timedelta(minutes=5))

    assert conversation.id not in second
    assert _row(db, conversation.id).flagged_at == first_flagged_at


def test_after_mark_done_the_same_window_never_flags_again(db: Session) -> None:
    conversation = _taken_over(db)
    _client_message(db, conversation, at=NOON)
    flag_closed_reply_windows(db, now=NOON + DAY)
    flagged_at = _row(db, conversation.id).flagged_at
    assert flagged_at is not None

    mark_handled(db, conversation_id=conversation.id, flagged_at=flagged_at)
    again = flag_closed_reply_windows(db, now=NOON + 3 * DAY)

    assert conversation.id not in again
    assert _row(db, conversation.id).flag_reason is None


def test_a_new_client_message_whose_window_closes_flags_again_after_mark_done(
    db: Session,
) -> None:
    conversation = _taken_over(db)
    _client_message(db, conversation, at=NOON)
    flag_closed_reply_windows(db, now=NOON + DAY)
    flagged_at = _row(db, conversation.id).flagged_at
    assert flagged_at is not None
    mark_handled(db, conversation_id=conversation.id, flagged_at=flagged_at)

    written_again_at = NOON + 2 * DAY
    _client_message(db, conversation, at=written_again_at)
    inside = flag_closed_reply_windows(db, now=written_again_at + DAY - ONE_SECOND)
    closed = flag_closed_reply_windows(db, now=written_again_at + DAY)

    assert conversation.id not in inside
    assert conversation.id in closed
    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.REPLY_WINDOW_CLOSED
    assert row.reply_window_flagged_for == written_again_at


def test_a_client_message_from_before_a_number_change_note_does_not_count(
    db: Session,
) -> None:
    conversation = _taken_over(db)
    _client_message(db, conversation, at=NOON - DAY)
    _number_change_note(db, conversation, at=NOON - datetime.timedelta(hours=1))

    flagged = flag_closed_reply_windows(db, now=NOON + DAY)

    assert conversation.id not in flagged
    assert _row(db, conversation.id).flag_reason is None


def test_flagged_chats_appear_in_the_flagged_inbox_with_reason_reply_window_closed(
    db: Session, api: TestClient
) -> None:
    admin = _user(db)
    conversation = _taken_over(db, holder=admin)
    _client_message(db, conversation, at=NOON)
    flag_closed_reply_windows(db, now=NOON + DAY)

    response = api.get(
        "/api/conversations",
        params={"flagged": "true", "q": conversation.phone_number},
        headers=_auth(admin),
    )

    assert response.status_code == 200
    items = {item["id"]: item for item in response.json()["items"]}
    assert items[str(conversation.id)]["flag_reason"] == "reply_window_closed"


# --- helpers -----------------------------------------------------------------------------------


def _taken_over(
    db: Session, *, holder: User | None = None, reason: FlagReason | None = None
) -> Conversation:
    return _conversation(db, holder=holder or _user(db), reason=reason)


def _conversation(
    db: Session, *, holder: User | None, reason: FlagReason | None = None
) -> Conversation:
    conversation = Conversation(
        phone_number=f"+1555{uuid.uuid4().int % 10**7:07d}",
        status=ConversationStatus.BOT if holder is None else ConversationStatus.HUMAN,
        taken_over_by_user_id=None if holder is None else holder.id,
        taken_over_at=None if holder is None else NOON,
        last_message_at=NOON,
        flag_reason=reason,
        flagged_at=None if reason is None else EARLIER_FLAG_AT,
    )
    db.add(conversation)
    db.flush()

    return conversation


def _client_message(db: Session, conversation: Conversation, *, at: datetime.datetime) -> None:
    db.add(
        Message(
            conversation_id=conversation.id,
            author_kind=MessageAuthor.CLIENT,
            body="hello?",
            status=MessageStatus.RECEIVED,
            created_at=at,
        )
    )
    db.flush()


def _number_change_note(db: Session, conversation: Conversation, *, at: datetime.datetime) -> None:
    db.add(
        Message(
            conversation_id=conversation.id,
            author_kind=MessageAuthor.SYSTEM,
            system_kind=SystemMessageKind.NUMBER_CHANGE_NOTE,
            body="Number changed",
            status=MessageStatus.SENT,
            created_at=at,
        )
    )
    db.flush()


def _user(db: Session) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        name="Test Admin",
        hashed_password=hash_password("correct horse battery staple"),
        role=UserRole.ADMIN,
        is_archived=False,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)
    return {"Authorization": f"Bearer {token}"}


def _row(db: Session, conversation_id: uuid.UUID) -> Conversation:
    db.expire_all()
    return db.get_one(Conversation, conversation_id)
