"""Takeover, Transfer and Hand-back notices, the 24-hour window, Retry and `GET /api/me` (#109),
over HTTP with `fake_twilio`.

The window is measured from the real clock, so the boundary cases put the Guardian's message
a little inside or exactly at 24 hours before the request: by the time the route reads the
clock, "exactly 24 hours" is past it. The rule itself is pinned at the exact instant through
`conversation_service.is_window_open`.

Expected copy comes from `bot_messages.MESSAGES`, the reviewed catalogue, never from `render`
called the way the code calls it.
"""

import datetime
import threading
import time
import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.booking_reminder import BookingReminder
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    Language,
    MessageAuthor,
    MessageStatus,
    ReminderStatus,
    SystemMessageKind,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.tutor import Tutor
from app.models.user import User
from app.routers import conversations as conversations_router
from app.routers.conversations import (
    ALREADY_HELD_ERROR,
    CONVERSATION_NOT_FOUND_ERROR,
    MESSAGE_NOT_FOUND_ERROR,
    NOT_HELD_ERROR,
    NOT_RETRYABLE_ERROR,
    NOTICE_OUTDATED_ERROR,
    RETRY_WINDOW_CLOSED_ERROR,
    TAKEOVER_WINDOW_CLOSED_ERROR,
)
from app.security import create_access_token, hash_password
from app.services import conversation_service
from app.services.bot_messages import MESSAGES
from app.services.broadcast_service import (
    BroadcastEvent,
    ConversationUpdated,
    MessageCreated,
    MessageUpdated,
)
from tests.fake_twilio import CODE_OUTSIDE_WINDOW, CODE_UNDELIVERABLE, FakeTwilio

STAFF_NAME = "Ana Souza"

INSIDE_WINDOW = datetime.timedelta(hours=23, minutes=59)
AT_WINDOW_END = datetime.timedelta(hours=24)
OUTSIDE_WINDOW = datetime.timedelta(hours=25)

LANGUAGES = [(None, "en"), (Language.ES, "es")]
LANGUAGE_IDS = ["unset is English", "Spanish"]
# A Guardian who last wrote exactly 24 hours ago, and one who never wrote.
CLOSED_WINDOWS = [AT_WINDOW_END, None]
CLOSED_WINDOW_IDS = ["24h00 ago", "never wrote"]
NAMING_ACTIONS = ["takeover", "transfer"]


# --- the window ------------------------------------------------------------------------------


def test_the_window_is_open_23h59_after_the_guardian_last_wrote(
    api: TestClient, db: Session
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)

    body = api.get(f"/api/conversations/{conversation.id}", headers=_auth(staff)).json()

    assert body["is_window_open"] is True
    assert body["last_client_message_at"] is not None


def test_the_window_is_closed_24h00_after_the_guardian_last_wrote(
    api: TestClient, db: Session
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=AT_WINDOW_END)

    body = api.get(f"/api/conversations/{conversation.id}", headers=_auth(staff)).json()

    assert body["is_window_open"] is False


def test_the_window_rule_closes_at_exactly_24_hours() -> None:
    last_wrote = datetime.datetime(2026, 10, 5, 12, 0, tzinfo=datetime.UTC)

    assert conversation_service.is_window_open(last_wrote, now=last_wrote + INSIDE_WINDOW)
    assert not conversation_service.is_window_open(last_wrote, now=last_wrote + AT_WINDOW_END)
    assert not conversation_service.is_window_open(None, now=last_wrote)


def test_an_outbound_message_does_not_extend_the_window(api: TestClient, db: Session) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=OUTSIDE_WINDOW)
    client_message = _only(db, conversation.id, MessageAuthor.CLIENT)
    _make_message(db, conversation, author_kind=MessageAuthor.BOT, ago=datetime.timedelta(0))

    body = api.get(f"/api/conversations/{conversation.id}", headers=_auth(staff)).json()

    assert body["is_window_open"] is False
    assert _parse(body["last_client_message_at"]) == client_message.created_at


def test_a_thread_the_guardian_never_wrote_in_is_outside_the_window(
    api: TestClient, db: Session
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=None)

    body = api.get(f"/api/conversations/{conversation.id}", headers=_auth(staff)).json()

    assert (body["is_window_open"], body["last_client_message_at"]) == (False, None)


# --- Takeover ------------------------------------------------------------------------------


@pytest.mark.parametrize(("language", "code"), LANGUAGES, ids=LANGUAGE_IDS)
def test_a_takeover_inside_the_window_sends_the_free_form_notice_naming_the_staff_member(
    api: TestClient,
    db: Session,
    fake_twilio: FakeTwilio,
    broadcasts: list[BroadcastEvent],
    language: Language | None,
    code: str,
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW, language=language)
    expected = MESSAGES["TAKEOVER_NOTICE"][code].format(staff=STAFF_NAME)

    response = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    notice = _only(db, conversation.id, MessageAuthor.SYSTEM)
    assert response.status_code == 200
    assert [(sent.to, sent.body) for sent in fake_twilio.sent] == [
        (conversation.phone_number, expected)
    ]
    assert (notice.system_kind, notice.body, notice.status) == (
        SystemMessageKind.TAKEOVER_NOTICE,
        expected,
        MessageStatus.QUEUED,
    )
    assert (notice.author_user_id, notice.twilio_sid) == (staff.id, fake_twilio.sent[0].sid)
    assert [type(event) for event in broadcasts] == [ConversationUpdated, MessageCreated]
    assert broadcasts[1].message["id"] == str(notice.id)


@pytest.mark.parametrize("client_wrote_ago", CLOSED_WINDOWS, ids=CLOSED_WINDOW_IDS)
def test_a_takeover_with_the_window_closed_is_refused_and_changes_nothing(
    api: TestClient,
    db: Session,
    fake_twilio: FakeTwilio,
    broadcasts: list[BroadcastEvent],
    client_wrote_ago: datetime.timedelta | None,
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=client_wrote_ago)

    response = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    assert (response.status_code, response.json()) == (
        409,
        {"detail": TAKEOVER_WINDOW_CLOSED_ERROR},
    )
    assert _row(db, conversation.id).status is ConversationStatus.BOT
    assert _lines(db, conversation.id, MessageAuthor.SYSTEM) == []
    assert fake_twilio.sent == []
    assert broadcasts == []


def test_a_takeover_of_a_chat_another_holds_with_the_window_closed_gets_the_window_refusal(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    holder = _make_user(db)
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=AT_WINDOW_END, holder=holder)

    response = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    assert (response.status_code, response.json()) == (
        409,
        {"detail": TAKEOVER_WINDOW_CLOSED_ERROR},
    )
    assert _row(db, conversation.id).taken_over_by_user_id == holder.id
    assert fake_twilio.sent == []


def test_a_repeat_claim_by_the_holder_with_the_window_closed_is_a_silent_success(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=OUTSIDE_WINDOW, holder=staff)

    response = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    assert response.status_code == 200
    assert response.json()["taken_over_by"]["id"] == str(staff.id)
    assert _lines(db, conversation.id, MessageAuthor.SYSTEM) == []
    assert fake_twilio.sent == []


def test_a_repeat_claim_by_the_holder_sends_no_notice(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    path = f"/api/conversations/{conversation.id}/takeover"

    api.post(path, headers=_auth(staff))
    second = api.post(path, headers=_auth(staff))

    assert second.status_code == 200
    assert len(fake_twilio.sent) == 1
    assert len(_lines(db, conversation.id, MessageAuthor.SYSTEM)) == 1


def test_a_failed_send_leaves_the_takeover_in_place_and_stores_the_code(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW)

    response = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    notice = _only(db, conversation.id, MessageAuthor.SYSTEM)
    assert response.status_code == 200
    assert _row(db, conversation.id).taken_over_by_user_id == staff.id
    assert (notice.status, notice.error_code, notice.twilio_sid) == (
        MessageStatus.FAILED,
        CODE_OUTSIDE_WINDOW,
        None,
    )


def test_the_thread_shows_the_notice_with_its_kind_reason_and_the_staff_member(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    """The Guardian may be sent the nameless notice; Staff still see who took over."""
    staff = _make_user(db, is_nameless=True)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW)
    api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    item = api.get(f"/api/conversations/{conversation.id}/messages", headers=_auth(staff)).json()[
        "items"
    ][0]

    assert item["author_kind"] == "system"
    assert item["author"] == {"id": str(staff.id), "display_name": staff.display_name}
    assert (item["system_kind"], item["status"], item["error_code"]) == (
        "takeover_notice",
        "failed",
        CODE_OUTSIDE_WINDOW,
    )
    assert item["reminder_child_names"] is None


# --- a holder with no real Display name --------------------------------------------------------


@pytest.mark.parametrize("action", NAMING_ACTIONS)
@pytest.mark.parametrize(("language", "code"), LANGUAGES, ids=LANGUAGE_IDS)
def test_a_nameless_holder_inside_the_window_sends_the_generic_notice(
    api: TestClient,
    db: Session,
    fake_twilio: FakeTwilio,
    action: str,
    language: Language | None,
    code: str,
) -> None:
    staff = _make_user(db, is_nameless=True)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW, language=language)
    _act(api, db, action=action, conversation=conversation, staff=staff)

    expected = MESSAGES["TAKEOVER_NOTICE_GENERIC"][code]
    assert [sent.body for sent in fake_twilio.sent] == [expected]
    assert staff.display_name not in expected
    assert _only(db, conversation.id, MessageAuthor.SYSTEM).body == expected


# --- the window closing as the notice is planned ---------------------------------------------


@pytest.mark.parametrize("action", NAMING_ACTIONS)
def test_a_notice_planned_after_the_window_closed_is_a_failed_line_and_the_change_stands(
    api: TestClient,
    db: Session,
    fake_twilio: FakeTwilio,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
) -> None:
    """The claim judged the window open; by the time the notice is planned it has closed."""
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    monkeypatch.setattr(conversation_service, "window_is_open", lambda *_args, **_kwargs: False)

    _act(api, db, action=action, conversation=conversation, staff=staff)

    notice = _only(db, conversation.id, MessageAuthor.SYSTEM)
    assert _row(db, conversation.id).taken_over_by_user_id == staff.id
    assert fake_twilio.sent == []
    assert (notice.status, notice.error_code) == (MessageStatus.FAILED, "window_closed")


# --- Transfer ------------------------------------------------------------------------------


def test_a_transfer_moves_the_chat_to_the_caller_with_one_notice_and_a_broadcast(
    api: TestClient, db: Session, fake_twilio: FakeTwilio, broadcasts: list[BroadcastEvent]
) -> None:
    previous = _make_user(db)
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW, holder=previous)

    response = api.post(f"/api/conversations/{conversation.id}/transfer", headers=_auth(staff))

    notice = _only(db, conversation.id, MessageAuthor.SYSTEM)
    assert response.status_code == 200
    assert response.json()["taken_over_by"] == {
        "id": str(staff.id),
        "display_name": staff.display_name,
    }
    assert (notice.system_kind, notice.author_user_id) == (
        SystemMessageKind.TRANSFER_NOTICE,
        staff.id,
    )
    assert [sent.body for sent in fake_twilio.sent] == [
        MESSAGES["TAKEOVER_NOTICE"]["en"].format(staff=STAFF_NAME)
    ]
    updates = [event for event in broadcasts if isinstance(event, ConversationUpdated)]
    assert [event.conversation["taken_over_by"]["id"] for event in updates] == [str(staff.id)]


def test_a_transfer_in_spanish_names_the_staff_member_in_spanish(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    previous = _make_user(db)
    staff = _make_user(db)
    conversation = _make_conversation(
        db, client_wrote_ago=INSIDE_WINDOW, holder=previous, language=Language.ES
    )

    api.post(f"/api/conversations/{conversation.id}/transfer", headers=_auth(staff))

    expected = MESSAGES["TAKEOVER_NOTICE"]["es"].format(staff=STAFF_NAME)
    assert [sent.body for sent in fake_twilio.sent] == [expected]
    assert _only(db, conversation.id, MessageAuthor.SYSTEM).body == expected


@pytest.mark.parametrize("client_wrote_ago", CLOSED_WINDOWS, ids=CLOSED_WINDOW_IDS)
def test_a_transfer_with_the_window_closed_is_refused_and_changes_nothing(
    api: TestClient,
    db: Session,
    fake_twilio: FakeTwilio,
    broadcasts: list[BroadcastEvent],
    client_wrote_ago: datetime.timedelta | None,
) -> None:
    previous = _make_user(db)
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=client_wrote_ago, holder=previous)

    response = api.post(f"/api/conversations/{conversation.id}/transfer", headers=_auth(staff))

    assert (response.status_code, response.json()) == (
        409,
        {"detail": TAKEOVER_WINDOW_CLOSED_ERROR},
    )
    assert _row(db, conversation.id).taken_over_by_user_id == previous.id
    assert _lines(db, conversation.id, MessageAuthor.SYSTEM) == []
    assert fake_twilio.sent == []
    assert broadcasts == []


def test_a_transfer_of_a_chat_the_bot_holds_is_refused(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)

    response = api.post(f"/api/conversations/{conversation.id}/transfer", headers=_auth(staff))

    assert (response.status_code, response.json()) == (409, {"detail": NOT_HELD_ERROR})
    assert _row(db, conversation.id).status is ConversationStatus.BOT
    assert fake_twilio.sent == []


def test_a_transfer_to_the_current_holder_is_refused(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW, holder=staff)

    response = api.post(f"/api/conversations/{conversation.id}/transfer", headers=_auth(staff))

    assert (response.status_code, response.json()) == (409, {"detail": ALREADY_HELD_ERROR})
    assert fake_twilio.sent == []


def test_a_tutor_may_not_transfer_a_chat(api: TestClient, db: Session) -> None:
    holder = _make_user(db)
    tutor = _make_tutor_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW, holder=holder)

    response = api.post(f"/api/conversations/{conversation.id}/transfer", headers=_auth(tutor))

    assert response.status_code == 403
    assert _row(db, conversation.id).taken_over_by_user_id == holder.id


def test_a_transfer_of_an_unknown_conversation_is_404(api: TestClient, db: Session) -> None:
    staff = _make_user(db)

    response = api.post(f"/api/conversations/{uuid.uuid4()}/transfer", headers=_auth(staff))

    assert (response.status_code, response.json()) == (
        404,
        {"detail": CONVERSATION_NOT_FOUND_ERROR},
    )


def test_a_transfer_waits_behind_a_held_row_lock_and_judges_the_committed_holder(
    session_per_request_api: TestClient, committed_sessions: sessionmaker[Session]
) -> None:
    """A second connection transfers the chat to B and holds the lock. B's own transfer must
    wait, then see that B already holds it. Without the lock it reads the old holder, moves the
    chat a second time and answers 200."""
    with committed_sessions() as session:
        previous = _make_user(session)
        staff = _make_user(session)
        conversation = _make_conversation(session, client_wrote_ago=INSIDE_WINDOW, holder=previous)
        session.commit()
    hold_seconds = 0.4
    locked = threading.Event()

    def hold_lock() -> None:
        with committed_sessions() as session:
            conversation_service.transfer(
                session, conversation_id=conversation.id, user_id=staff.id
            )
            locked.set()
            time.sleep(hold_seconds)
            session.commit()

    try:
        holder = threading.Thread(target=hold_lock)
        holder.start()
        locked.wait(timeout=5)

        started = time.monotonic()
        response = session_per_request_api.post(
            f"/api/conversations/{conversation.id}/transfer", headers=_auth(staff)
        )
        elapsed = time.monotonic() - started
        holder.join(timeout=5)

        assert elapsed >= hold_seconds * 0.8
        assert (response.status_code, response.json()) == (409, {"detail": ALREADY_HELD_ERROR})
    finally:
        with committed_sessions() as session:
            session.execute(delete(Message).where(Message.conversation_id == conversation.id))
            session.execute(delete(Conversation).where(Conversation.id == conversation.id))
            session.execute(delete(User).where(User.id.in_([previous.id, staff.id])))
            session.commit()


# --- Hand-back -----------------------------------------------------------------------------


@pytest.mark.parametrize(("language", "code"), LANGUAGES, ids=LANGUAGE_IDS)
def test_a_hand_back_inside_the_window_tells_the_guardian_the_assistant_is_back(
    api: TestClient,
    db: Session,
    fake_twilio: FakeTwilio,
    language: Language | None,
    code: str,
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(
        db, client_wrote_ago=INSIDE_WINDOW, holder=staff, language=language
    )

    response = api.delete(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    notice = _only(db, conversation.id, MessageAuthor.SYSTEM)
    assert response.status_code == 200
    assert [sent.body for sent in fake_twilio.sent] == [MESSAGES["HANDBACK_NOTICE"][code]]
    assert (notice.system_kind, notice.status, notice.twilio_sid) == (
        SystemMessageKind.HANDBACK_NOTICE,
        MessageStatus.QUEUED,
        fake_twilio.sent[0].sid,
    )


def test_a_hand_back_outside_the_window_sends_nothing_and_records_why(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=OUTSIDE_WINDOW, holder=staff)

    response = api.delete(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    notice = _only(db, conversation.id, MessageAuthor.SYSTEM)
    assert response.status_code == 200
    assert response.json()["status"] == "bot"
    assert fake_twilio.sent == []
    assert (notice.system_kind, notice.status, notice.error_code) == (
        SystemMessageKind.HANDBACK_NOTICE,
        MessageStatus.FAILED,
        "window_closed",
    )


def test_releasing_a_chat_the_bot_already_has_sends_no_notice(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)

    api.delete(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    assert fake_twilio.sent == []
    assert _lines(db, conversation.id, MessageAuthor.SYSTEM) == []


# --- Retry ---------------------------------------------------------------------------------


def test_a_retry_inside_the_window_resends_the_free_form_notice_on_the_same_row(
    api: TestClient, db: Session, fake_twilio: FakeTwilio, broadcasts: list[BroadcastEvent]
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW)
    api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))
    failed = _only(db, conversation.id, MessageAuthor.SYSTEM)

    response = api.post(
        f"/api/conversations/{conversation.id}/messages/{failed.id}/retry", headers=_auth(staff)
    )

    retried = _only(db, conversation.id, MessageAuthor.SYSTEM)
    expected = MESSAGES["TAKEOVER_NOTICE"]["en"].format(staff=STAFF_NAME)
    assert response.status_code == 200
    assert response.json()["id"] == str(failed.id)
    assert retried.id == failed.id
    assert (retried.status, retried.error_code, retried.body) == (
        MessageStatus.QUEUED,
        None,
        expected,
    )
    assert [(sent.to, sent.body) for sent in fake_twilio.sent] == [
        (conversation.phone_number, expected)
    ]
    assert retried.twilio_sid == fake_twilio.sent[0].sid
    assert isinstance(broadcasts[-1], MessageUpdated)
    assert broadcasts[-1].message["status"] == "queued"


def test_a_retry_with_the_window_closed_is_refused_and_leaves_the_row_alone(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW)
    api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))
    failed = _only(db, conversation.id, MessageAuthor.SYSTEM)
    before = (failed.status, failed.error_code, failed.body)
    _age_client_messages(db, conversation, by=AT_WINDOW_END)

    response = api.post(
        f"/api/conversations/{conversation.id}/messages/{failed.id}/retry", headers=_auth(staff)
    )

    after = _only(db, conversation.id, MessageAuthor.SYSTEM)
    assert (response.status_code, response.json()) == (
        409,
        {"detail": RETRY_WINDOW_CLOSED_ERROR},
    )
    assert (after.status, after.error_code, after.body) == before
    assert before[:2] == (MessageStatus.FAILED, CODE_OUTSIDE_WINDOW)
    assert fake_twilio.sent == []


def test_a_retry_that_fails_again_keeps_the_new_reason(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW)
    api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))
    failed = _only(db, conversation.id, MessageAuthor.SYSTEM)
    fake_twilio.fail_next(code=CODE_UNDELIVERABLE)

    response = api.post(
        f"/api/conversations/{conversation.id}/messages/{failed.id}/retry", headers=_auth(staff)
    )

    assert response.status_code == 200
    assert (response.json()["status"], response.json()["error_code"]) == (
        "failed",
        CODE_UNDELIVERABLE,
    )
    assert fake_twilio.sent == []


def test_only_a_failed_takeover_or_transfer_notice_may_be_retried(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=OUTSIDE_WINDOW, holder=staff)
    api.delete(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))
    hand_back = _only(db, conversation.id, MessageAuthor.SYSTEM)
    client_line = _only(db, conversation.id, MessageAuthor.CLIENT)
    delivered = _make_message(
        db,
        conversation,
        author_kind=MessageAuthor.SYSTEM,
        ago=datetime.timedelta(0),
        system_kind=SystemMessageKind.TAKEOVER_NOTICE,
        author=staff,
    )

    responses = [
        api.post(
            f"/api/conversations/{conversation.id}/messages/{message.id}/retry",
            headers=_auth(staff),
        )
        for message in (hand_back, client_line, delivered)
    ]

    assert [(row.status_code, row.json()) for row in responses] == [
        (409, {"detail": NOT_RETRYABLE_ERROR})
    ] * 3
    assert fake_twilio.sent == []


def test_a_retry_after_the_chat_was_handed_back_is_refused_and_sends_nothing(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    """The bot is answering again; "Ana has joined" would tell the Guardian otherwise."""
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW, times=2)
    api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))
    failed = _only_notice(db, conversation.id, SystemMessageKind.TAKEOVER_NOTICE)
    api.delete(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    response = api.post(
        f"/api/conversations/{conversation.id}/messages/{failed.id}/retry", headers=_auth(staff)
    )

    assert (response.status_code, response.json()) == (409, {"detail": NOTICE_OUTDATED_ERROR})
    assert fake_twilio.sent == []
    assert _only_notice(db, conversation.id, SystemMessageKind.TAKEOVER_NOTICE).status is (
        MessageStatus.FAILED
    )


def test_a_retry_after_the_chat_was_transferred_to_someone_else_is_refused(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    first = _make_user(db)
    second = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW, times=2)
    api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(first))
    failed = _only_notice(db, conversation.id, SystemMessageKind.TAKEOVER_NOTICE)
    api.post(f"/api/conversations/{conversation.id}/transfer", headers=_auth(second))

    response = api.post(
        f"/api/conversations/{conversation.id}/messages/{failed.id}/retry", headers=_auth(first)
    )

    assert (response.status_code, response.json()) == (409, {"detail": NOTICE_OUTDATED_ERROR})
    assert fake_twilio.sent == []


def test_a_retry_of_a_message_in_another_conversation_is_404(api: TestClient, db: Session) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    other = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)
    api.post(f"/api/conversations/{other.id}/takeover", headers=_auth(staff))
    notice = _only(db, other.id, MessageAuthor.SYSTEM)

    responses = [
        api.post(
            f"/api/conversations/{conversation.id}/messages/{message_id}/retry",
            headers=_auth(staff),
        )
        for message_id in (notice.id, uuid.uuid4())
    ]

    assert [(row.status_code, row.json()) for row in responses] == [
        (404, {"detail": MESSAGE_NOT_FOUND_ERROR})
    ] * 2


def test_a_tutor_may_not_retry_a_notice(api: TestClient, db: Session) -> None:
    tutor = _make_tutor_user(db)
    conversation = _make_conversation(db, client_wrote_ago=OUTSIDE_WINDOW)

    response = api.post(
        f"/api/conversations/{conversation.id}/messages/{uuid.uuid4()}/retry", headers=_auth(tutor)
    )

    assert response.status_code == 403


# --- reminder lines ------------------------------------------------------------------------


def test_a_reminder_line_lists_the_children_it_named(api: TestClient, db: Session) -> None:
    staff = _make_user(db)
    conversation = _make_conversation(db, client_wrote_ago=None)
    guardian = _make_guardian(db)
    ana = _make_child(db, name="Ana")
    luis = _make_child(db, name="Luis")
    sid = f"SM{uuid.uuid4().hex}"
    db.add(
        BookingReminder(
            guardian_id=guardian.id,
            week_start=datetime.date(2026, 10, 12),
            language=Language.EN,
            child_ids=[ana.id, luis.id],
            twilio_sid=sid,
            status=ReminderStatus.SENT,
        )
    )
    _make_message(
        db,
        conversation,
        author_kind=MessageAuthor.SYSTEM,
        ago=datetime.timedelta(0),
        system_kind=SystemMessageKind.BOOKING_REMINDER,
        twilio_sid=sid,
    )

    item = api.get(f"/api/conversations/{conversation.id}/messages", headers=_auth(staff)).json()[
        "items"
    ][0]

    assert (item["system_kind"], item["reminder_child_names"]) == (
        "booking_reminder",
        ["Ana", "Luis"],
    )


# --- naming a nameless holder ------------------------------------------------------------------


@pytest.mark.parametrize("setter", ["me", "users"])
def test_once_a_nameless_holder_is_named_the_next_takeover_notice_uses_the_name(
    api: TestClient, db: Session, fake_twilio: FakeTwilio, setter: str
) -> None:
    """`PATCH /api/me` and the Users update both clear `display_name_is_default` (#109)."""
    staff = _make_user(db, role=UserRole.MANAGER, is_nameless=True)
    if setter == "me":
        renamed = api.patch("/api/me", headers=_auth(staff), json={"display_name": "Maria"})
    else:
        admin = _make_user(db)
        renamed = api.patch(
            f"/api/users/{staff.id}", headers=_auth(admin), json={"display_name": "Maria"}
        )
    conversation = _make_conversation(db, client_wrote_ago=INSIDE_WINDOW)

    taken = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(staff))

    assert (renamed.status_code, taken.status_code) == (200, 200)
    assert taken.json()["taken_over_by"] == {"id": str(staff.id), "display_name": "Maria"}
    assert [sent.body for sent in fake_twilio.sent] == [
        MESSAGES["TAKEOVER_NOTICE"]["en"].format(staff="Maria")
    ]


# --- GET /api/me ---------------------------------------------------------------------------


@pytest.mark.parametrize("role", [UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER])
def test_me_returns_the_staff_members_own_account(
    api: TestClient, db: Session, role: UserRole
) -> None:
    staff = _make_user(db, role=role)
    _make_user(db)

    response = api.get("/api/me", headers=_auth(staff))

    assert response.status_code == 200
    assert response.json() == {
        "id": str(staff.id),
        "email": staff.email,
        "role": role.value,
        "display_name": STAFF_NAME,
    }


def test_me_is_open_to_a_tutor(api: TestClient, db: Session) -> None:
    tutor = _make_tutor_user(db)

    response = api.get("/api/me", headers=_auth(tutor))

    assert response.status_code == 200
    assert response.json() == {
        "id": str(tutor.id),
        "email": tutor.email,
        "role": "tutor",
        "display_name": STAFF_NAME,
    }


def test_me_without_a_token_is_401(api: TestClient) -> None:
    response = api.get("/api/me")

    assert response.status_code == 401


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def broadcasts(monkeypatch: pytest.MonkeyPatch) -> list[BroadcastEvent]:
    """Every event the routes publish, in order; none reaches the real NOTIFY."""
    recorded: list[BroadcastEvent] = []
    monkeypatch.setattr(conversations_router, "publish", recorded.append)

    return recorded


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def session_per_request_api(
    committed_sessions: sessionmaker[Session],
) -> Generator[TestClient, None, None]:
    from app.db import get_db
    from app.main import app

    def one_session_per_request() -> Generator[Session, None, None]:
        session = committed_sessions()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = one_session_per_request
    try:
        yield TestClient(app)
    finally:
        del app.dependency_overrides[get_db]


def _act(
    api: TestClient, db: Session, *, action: str, conversation: Conversation, staff: User
) -> None:
    """Take the chat over directly, or transfer it from another Staff member."""
    if action == "transfer":
        _hold(db, conversation, holder=_make_user(db))

    response = api.post(f"/api/conversations/{conversation.id}/{action}", headers=_auth(staff))

    assert response.status_code == 200, response.text


def _hold(db: Session, conversation: Conversation, *, holder: User) -> None:
    conversation.status = ConversationStatus.HUMAN
    conversation.taken_over_by_user_id = holder.id
    conversation.taken_over_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()


def _age_client_messages(
    db: Session, conversation: Conversation, *, by: datetime.timedelta
) -> None:
    db.execute(
        text(
            "UPDATE messages SET created_at = now() - make_interval(secs => :seconds)"
            " WHERE conversation_id = :conversation_id AND author_kind = 'client'"
        ),
        {"seconds": by.total_seconds(), "conversation_id": conversation.id},
    )


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _parse(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value)


def _phone_number() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"


def _make_user(
    db: Session,
    *,
    role: UserRole = UserRole.ADMIN,
    is_nameless: bool = False,
    tutor_id: uuid.UUID | None = None,
) -> User:
    local_part = f"jane.doe.{uuid.uuid4().hex[:12]}"
    user = User(
        email=f"{local_part}@example.com",
        display_name=local_part if is_nameless else STAFF_NAME,
        display_name_is_default=is_nameless,
        hashed_password=hash_password("conversation-notice-password"),
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


def _make_tutor_user(db: Session) -> User:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(name=STAFF_NAME, phone_number=_phone_number(), email=f"t-{suffix}@example.com")
    db.add(tutor)
    db.flush()

    return _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)


def _make_conversation(
    db: Session,
    *,
    client_wrote_ago: datetime.timedelta | None,
    holder: User | None = None,
    language: Language | None = None,
) -> Conversation:
    now = datetime.datetime.now(tz=datetime.UTC)
    conversation = Conversation(
        phone_number=_phone_number(),
        status=ConversationStatus.BOT if holder is None else ConversationStatus.HUMAN,
        taken_over_by_user_id=None if holder is None else holder.id,
        taken_over_at=None if holder is None else now,
        last_message_at=now,
        language=language,
    )
    db.add(conversation)
    db.flush()

    if client_wrote_ago is not None:
        _make_message(db, conversation, author_kind=MessageAuthor.CLIENT, ago=client_wrote_ago)

    return conversation


def _make_message(
    db: Session,
    conversation: Conversation,
    *,
    author_kind: MessageAuthor,
    ago: datetime.timedelta,
    system_kind: SystemMessageKind | None = None,
    author: User | None = None,
    twilio_sid: str | None = None,
) -> Message:
    is_client = author_kind is MessageAuthor.CLIENT
    message = Message(
        conversation_id=conversation.id,
        author_kind=author_kind,
        author_user_id=None if author is None else author.id,
        body="hello",
        status=MessageStatus.RECEIVED if is_client else MessageStatus.SENT,
        twilio_sid=f"SM{uuid.uuid4().hex}" if is_client else twilio_sid,
        system_kind=system_kind,
        created_at=datetime.datetime.now(tz=datetime.UTC) - ago,
    )
    db.add(message)
    db.flush()

    return message


def _make_guardian(db: Session) -> Guardian:
    guardian = Guardian(phone_number=_phone_number(), name="Maria Lopez")
    db.add(guardian)
    db.flush()

    return guardian


def _make_child(db: Session, *, name: str) -> Child:
    child = Child(name=name, school_name="Elm Primary")
    db.add(child)
    db.flush()

    return child


def _lines(db: Session, conversation_id: uuid.UUID, author_kind: MessageAuthor) -> list[Message]:
    db.expire_all()

    return list(
        db.scalars(
            select(Message).where(
                Message.conversation_id == conversation_id, Message.author_kind == author_kind
            )
        ).all()
    )


def _only(db: Session, conversation_id: uuid.UUID, author_kind: MessageAuthor) -> Message:
    lines = _lines(db, conversation_id, author_kind)

    assert len(lines) == 1

    return lines[0]


def _only_notice(db: Session, conversation_id: uuid.UUID, kind: SystemMessageKind) -> Message:
    notices = [
        line
        for line in _lines(db, conversation_id, MessageAuthor.SYSTEM)
        if line.system_kind is kind
    ]

    assert len(notices) == 1

    return notices[0]


def _row(db: Session, conversation_id: uuid.UUID) -> Conversation:
    db.expire_all()

    return db.get_one(Conversation, conversation_id)
