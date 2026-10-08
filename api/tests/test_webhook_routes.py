"""The system's only unauthenticated write surface, exercised over HTTP.

Three properties are load-bearing here and each one has a test written to go **red against the
wrong implementation**, not merely green against the right one (**P7-X**).

**REQ-071 is an ordering property, not a validation property.** It is not enough that a forged
signature is refused: nothing may have happened before the refusal. Every 403 case therefore
asserts the absence of the `conversations` row, of the `messages` row, of any published event,
and of the call into `bot_service` — a handler that inserted the message first and validated
second would pass a status-code-only test and would be a security regression.

**The signature is computed over the full URL, scheme included.**
`test_the_forwarded_scheme_is_what_the_signature_validates_against` drives a request through a
`create_app()` that trusts a proxy, signing over `https://` while the socket speaks `http://`.
An implementation that rebuilt the URL from `Host` plus a literal `http://` — the mistake every
deployment behind a TLS terminator makes — fails that test and only that test, which is the
whole reason `signed_request_url` exists as one named function.

**A flag does not suppress the reply, and a paused conversation is still recorded.** Both are
features that fail silently: the client still gets an answer and the admin still sees what was
said while the bot was quiet, and asserting only the response body would miss either.

`bot_service.reply_for` is monkeypatched in every test in this module (**P7-I**). Nothing here
calls Anthropic; this file tests the webhook's ordering, idempotency, branching and TwiML.
"""

import datetime
import threading
import uuid
from collections.abc import Generator, Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request
from twilio.request_validator import RequestValidator

from app.config import get_settings
from app.db import get_db
from app.dependencies import get_current_user, get_tutor_scope, require_admin
from app.main import app, create_app
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    Language,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User
from app.routers import webhook
from app.routers.webhook import (
    INVALID_SIGNATURE_ERROR,
    MISSING_FIELD_ERROR,
    get_twilio_form,
    signed_request_url,
)
from app.schemas.bot import BotTurn, GuardianLanguage, ReminderButton
from app.security import hash_password
from app.services import bot_service, conversation_service, message_service
from app.services.bot_messages import render
from app.services.broadcast_service import BroadcastEvent, MessageCreated, MessageUpdated

AUTH_TOKEN = "an-auth-token-only-twilio-and-this-process-know"
AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN"
TRUSTED_PROXIES_ENV = "TRUSTED_PROXIES"

BASE_URL = "http://testserver"
INBOUND_PATH = "/webhook/whatsapp"
STATUS_PATH = "/webhook/whatsapp/status"
INBOUND_URL = BASE_URL + INBOUND_PATH
HTTPS_INBOUND_URL = "https://testserver" + INBOUND_PATH

PROXY = "10.1.2.3"
PEER_PORT = 51000

PHONE_NUMBER = "+15555550100"
TWILIO_FROM = f"whatsapp:{PHONE_NUMBER}"
INBOUND_SID = "SM00000000000000000000000000000001"
OUTBOUND_SID = "SM00000000000000000000000000000002"
SECOND_INBOUND_SID = "SM00000000000000000000000000000003"
INBOUND_BODY = "I'd like to book a session"
BOT_REPLY = "Which subject?"
EMPTY_TWIML = "<Response></Response>"


def test_a_bot_conversation_gets_the_reply_back_as_twiml(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    response = _post_inbound(webhook_client)

    assert response.status_code == 200
    assert response.text == f"<Response><Message>{BOT_REPLY}</Message></Response>"
    assert bot.calls == [
        {
            "phone_number": PHONE_NUMBER,
            "body": INBOUND_BODY,
            "guardian_id": None,
            "reactivation_pending": False,
            "language": None,
            "button": None,
        }
    ]

    reply = _messages(db, author_kind=MessageAuthor.BOT)[0]

    assert reply.status is MessageStatus.SENT
    assert reply.twilio_sid is None
    assert reply.body == BOT_REPLY


def test_the_whatsapp_prefix_is_stripped_and_the_number_is_stored_verbatim(
    webhook_client: TestClient, db: Session
) -> None:
    """P7-H: no `phone_service` on this path, so an unparseable-but-delivered number is kept.

    An inbound message is proof of dialability by delivery. Refusing it on stale
    libphonenumber metadata would drop a real client's message behind a 400 Twilio retries.
    """
    _post_inbound(webhook_client, form=_form(**{"From": "whatsapp:+1 (555) 555-0199 ext 4"}))

    assert _conversation(db, phone_number="+1 (555) 555-0199 ext 4") is not None


@pytest.mark.parametrize(
    "case",
    ["missing", "tampered", "signed over another body", "signed over another url"],
)
def test_a_bad_signature_is_403_and_nothing_at_all_is_written(
    webhook_client: TestClient,
    db: Session,
    published: list[BroadcastEvent],
    bot: "BotDouble",
    case: str,
) -> None:
    """REQ-071 in its exact form: the check precedes every side effect, the insert included."""
    form = _form()
    signature = {
        "missing": None,
        "tampered": "not-a-signature",
        "signed over another body": _sign(INBOUND_URL, _form(Body="something else entirely")),
        "signed over another url": _sign(HTTPS_INBOUND_URL, form),
    }[case]

    response = _post(webhook_client, INBOUND_PATH, form, signature=signature)

    assert response.status_code == 403
    assert response.json() == {"detail": INVALID_SIGNATURE_ERROR}
    assert published == []
    assert bot.calls == []
    assert _conversation(db, phone_number=PHONE_NUMBER) is None
    assert db.scalar(select(func.count()).select_from(Message)) == 0


def test_an_unset_auth_token_refuses_a_correctly_signed_request(
    webhook_client: TestClient, monkeypatch: pytest.MonkeyPatch, db: Session
) -> None:
    """The unconfigured deployment refuses the endpoint rather than accepting everything."""
    monkeypatch.delenv(AUTH_TOKEN_ENV, raising=False)
    get_settings.cache_clear()

    response = _post_inbound(webhook_client)

    assert response.status_code == 403
    assert _conversation(db, phone_number=PHONE_NUMBER) is None


def test_the_forwarded_scheme_is_what_the_signature_validates_against(
    proxied_client: TestClient, db: Session
) -> None:
    """Twilio signs `https://…`; this process is handed `http://…`. Only the scope reconciles.

    The signature here is computed over the `https://` URL Twilio would have posted to, while
    the request itself arrives over plain HTTP from Caddy's address. It validates because
    `ProxyHeadersMiddleware` rewrote `scope["scheme"]` and `signed_request_url` reads it from
    there. Rebuilding the URL from `Host` plus a literal scheme fails this and nothing else.
    """
    form = _form()
    signature = _sign(HTTPS_INBOUND_URL, form)

    proxied = _post(
        proxied_client,
        INBOUND_PATH,
        form,
        signature=signature,
        headers={"X-Forwarded-Proto": "https"},
    )

    assert proxied.status_code == 200
    assert _conversation(db, phone_number=PHONE_NUMBER) is not None


def test_the_same_https_signature_fails_without_the_forwarded_header(
    proxied_client: TestClient, db: Session
) -> None:
    """The paired negative: without the header the scheme really is `http`, and it must fail.

    Without this, an implementation that ignored the scheme entirely would pass the test above.
    """
    form = _form()
    signature = _sign(HTTPS_INBOUND_URL, form)

    unproxied = _post(proxied_client, INBOUND_PATH, form, signature=signature)

    assert unproxied.status_code == 403
    assert _conversation(db, phone_number=PHONE_NUMBER) is None


@pytest.mark.parametrize(
    ("scheme", "expected"),
    [
        ("https", "https://bot.example.com/webhook/whatsapp?hello=1"),
        ("http", "http://bot.example.com/webhook/whatsapp?hello=1"),
    ],
)
def test_signed_request_url_takes_the_scheme_from_the_scope(scheme: str, expected: str) -> None:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": scheme,
            "server": ("10.0.0.7", 8000),
            "root_path": "",
            "path": INBOUND_PATH,
            "query_string": b"hello=1",
            "headers": [(b"host", b"bot.example.com")],
        }
    )

    assert signed_request_url(request) == expected


def test_a_redelivered_sid_answers_empty_twiml_and_repeats_no_side_effect(
    webhook_client: TestClient, db: Session, published: list[BroadcastEvent], bot: "BotDouble"
) -> None:
    """The unique index on `messages.twilio_sid` is the only redelivery guard (REQ-144).

    A second POST with the same `MessageSid` conflicts on that insert, `record_inbound` returns
    `None`, and `_turn` stops there: no row, no bot call, nothing published.
    """
    first = _post_inbound(webhook_client)
    published_once = len(published)

    second = _post_inbound(webhook_client)

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.text == EMPTY_TWIML
    assert len(bot.calls) == 1
    assert db.scalar(select(func.count()).select_from(Message)) == 2
    assert len(published) == published_once


def test_a_concurrent_redelivery_still_runs_the_bot_exactly_once(
    session_per_request_client: TestClient,
    committed_sessions: sessionmaker[Session],
    bot: "BotDouble",
    published: list[BroadcastEvent],
) -> None:
    """REQ-144.3: the same guard, proved against two connections actually contending for it.

    Every other test in this module shares the rolled-back `db` fixture, whose one transaction
    can never produce a real unique-index conflict — two requests through it just run one after
    another. Here two threads each open their own committed session and post the identical
    signed delivery behind a `Barrier`, so the second's insert genuinely blocks on the first's
    uncommitted row and then conflicts once it commits, the way two overlapping Twilio retries
    of one delivery would.
    """
    barrier = threading.Barrier(2)
    responses: list[Response] = []
    responses_lock = threading.Lock()

    def post_one() -> None:
        barrier.wait(timeout=5)
        response = _post_inbound(session_per_request_client)
        with responses_lock:
            responses.append(response)

    threads = [threading.Thread(target=post_one) for _ in range(2)]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        assert [response.status_code for response in responses] == [200, 200]
        assert len(bot.calls) == 1
        assert _published(published) == [
            ("message.created", INBOUND_BODY, "client"),
            ("message.created", BOT_REPLY, "bot"),
        ]
        with committed_sessions() as session:
            rows = session.scalars(select(Message).where(Message.twilio_sid == INBOUND_SID)).all()
        assert len(rows) == 1
    finally:
        with committed_sessions() as session:
            conversation_ids = select(Conversation.id).where(
                Conversation.phone_number == PHONE_NUMBER
            )
            session.execute(delete(Message).where(Message.conversation_id.in_(conversation_ids)))
            session.execute(delete(Conversation).where(Conversation.phone_number == PHONE_NUMBER))
            session.commit()


def test_a_human_conversation_answers_empty_twiml_and_still_records_and_broadcasts(
    webhook_client: TestClient, db: Session, published: list[BroadcastEvent], bot: "BotDouble"
) -> None:
    """The takeover feature's whole point. Asserting only the empty body would miss it."""
    _taken_over_conversation(db)

    response = _post_inbound(webhook_client)
    recorded = _messages(db, author_kind=MessageAuthor.CLIENT)

    assert response.text == EMPTY_TWIML
    assert bot.calls == []
    assert [row.body for row in recorded] == [INBOUND_BODY]
    assert recorded[0].status is MessageStatus.RECEIVED
    assert _messages(db, author_kind=MessageAuthor.BOT) == []
    assert _published(published) == [("message.created", INBOUND_BODY, "client")]


def test_a_bot_conversation_broadcasts_the_client_message_and_the_reply(
    webhook_client: TestClient, published: list[BroadcastEvent]
) -> None:
    _post_inbound(webhook_client)

    assert _published(published) == [
        ("message.created", INBOUND_BODY, "client"),
        ("message.created", BOT_REPLY, "bot"),
    ]


@pytest.mark.parametrize("status", [ConversationStatus.BOT, ConversationStatus.HUMAN])
def test_last_message_at_moves_in_both_branches(
    webhook_client: TestClient, db: Session, status: ConversationStatus
) -> None:
    stale = datetime.datetime(2020, 1, 1, tzinfo=datetime.UTC)

    if status is ConversationStatus.HUMAN:
        conversation = _taken_over_conversation(db)
    else:
        conversation = Conversation(phone_number=PHONE_NUMBER, last_message_at=stale)
        db.add(conversation)

    conversation.last_message_at = stale
    db.flush()

    _post_inbound(webhook_client)
    db.refresh(conversation)

    assert conversation.last_message_at > stale


def test_a_flagged_turn_writes_the_flag_and_still_returns_the_reply(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    """REQ-078.5 / REQ-078.6. A flag brings an admin to look; it does not replace the answer."""
    bot.turn = BotTurn(reply=BOT_REPLY, flag_reason=FlagReason.STUCK)

    response = _post_inbound(webhook_client)
    conversation = _conversation(db, phone_number=PHONE_NUMBER)

    assert response.text == f"<Response><Message>{BOT_REPLY}</Message></Response>"
    assert conversation is not None
    assert conversation.flag_reason is FlagReason.STUCK
    assert conversation.flagged_at is not None
    assert conversation.status is ConversationStatus.BOT
    assert [row.body for row in _messages(db, author_kind=MessageAuthor.BOT)] == [BOT_REPLY]


@pytest.mark.parametrize("reason", [FlagReason.BOOKING_REQUEST, FlagReason.QUESTION])
def test_a_routine_handoff_turn_flags_the_conversation_and_returns_the_reply(
    webhook_client: TestClient, db: Session, bot: "BotDouble", reason: FlagReason
) -> None:
    """A booking request or a question is a handoff, not a failure: it flags like any reason."""
    bot.turn = BotTurn(reply=BOT_REPLY, flag_reason=reason)

    response = _post_inbound(webhook_client)
    conversation = _conversation(db, phone_number=PHONE_NUMBER)

    assert response.text == f"<Response><Message>{BOT_REPLY}</Message></Response>"
    assert conversation is not None
    assert conversation.flag_reason is reason
    assert conversation.flagged_at is not None


@pytest.mark.parametrize(
    "pending",
    [
        FlagReason.BOOKING_REQUEST,
        FlagReason.GUARDIAN_LINK_REQUEST,
        FlagReason.STUCK,
        FlagReason.PARSE_ERROR,
    ],
)
def test_a_question_does_not_replace_an_existing_flag_but_is_still_answered(
    webhook_client: TestClient, db: Session, bot: "BotDouble", pending: FlagReason
) -> None:
    """Marking the question handled would otherwise drop the request or the failed handoff
    from every queue."""
    conversation = _bot_conversation(db)
    conversation_service.flag(db, conversation=conversation, reason=pending)
    flagged_at = conversation.flagged_at
    bot.turn = BotTurn(reply=BOT_REPLY, flag_reason=FlagReason.QUESTION)

    response = _post_inbound(webhook_client)
    db.refresh(conversation)

    assert response.text == f"<Response><Message>{BOT_REPLY}</Message></Response>"
    assert conversation.flag_reason is pending
    assert conversation.flagged_at == flagged_at


def test_a_question_does_not_replace_a_pending_reactivation_request(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    conversation = _bot_conversation(db)
    conversation_service.request_reactivation(
        db, conversation=conversation, child_id=_inactive_child_id(db)
    )
    bot.turn = BotTurn(reply=BOT_REPLY, flag_reason=FlagReason.QUESTION)

    _post_inbound(webhook_client)
    db.refresh(conversation)

    assert conversation.flag_reason is FlagReason.REACTIVATION_REQUEST


def test_a_second_question_leaves_the_conversation_flagged_question(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    bot.turn = BotTurn(reply=BOT_REPLY, flag_reason=FlagReason.QUESTION)

    _post_inbound(webhook_client)
    _post_inbound(webhook_client, form=_form(MessageSid=SECOND_INBOUND_SID))
    conversation = _conversation(db, phone_number=PHONE_NUMBER)

    assert len(bot.calls) == 2
    assert conversation is not None
    assert conversation.flag_reason is FlagReason.QUESTION


def test_a_stuck_turn_still_replaces_a_pending_office_request(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    """Only a question defers to a request; a failure flag keeps last-write-wins."""
    conversation = _bot_conversation(db)
    conversation_service.flag(db, conversation=conversation, reason=FlagReason.BOOKING_REQUEST)
    bot.turn = BotTurn(reply=BOT_REPLY, flag_reason=FlagReason.STUCK)

    _post_inbound(webhook_client)
    db.refresh(conversation)

    assert conversation.flag_reason is FlagReason.STUCK


def test_a_turn_carrying_a_guardian_backfills_the_conversation(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    guardian_id = _guardian_id(db)
    bot.turn = BotTurn(reply=BOT_REPLY, link_guardian_id=guardian_id)

    _post_inbound(webhook_client)
    conversation = _conversation(db, phone_number=PHONE_NUMBER)

    assert conversation is not None
    assert conversation.guardian_id == guardian_id


def test_a_turn_carrying_a_reactivation_request_records_and_flags_it(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    """REQ-132.3 through the webhook (P7-C): the bot reports the child, `_apply` records the
    request, and the reply is recorded as usual."""
    child_id = _inactive_child_id(db)
    bot.turn = BotTurn(reply=BOT_REPLY, reactivation_child_id=child_id)

    response = _post_inbound(webhook_client)
    conversation = _conversation(db, phone_number=PHONE_NUMBER)

    assert response.text == f"<Response><Message>{BOT_REPLY}</Message></Response>"
    assert conversation is not None
    assert conversation.reactivation_child_id == child_id
    assert conversation.flag_reason is FlagReason.REACTIVATION_REQUEST
    assert conversation.flagged_at is not None
    assert [row.body for row in _messages(db, author_kind=MessageAuthor.BOT)] == [BOT_REPLY]
    assert bot.calls[0]["reactivation_pending"] is False


def test_a_pending_request_is_passed_to_the_bot(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    conversation = _bot_conversation(db)
    conversation.reactivation_child_id = _inactive_child_id(db)
    db.flush()

    _post_inbound(webhook_client)

    assert bot.calls[0]["reactivation_pending"] is True


def test_the_pending_request_is_read_from_the_row_not_the_identity_map(
    webhook_client: TestClient, db: Session, bot: "BotDouble", monkeypatch: pytest.MonkeyPatch
) -> None:
    """REQ-130.4, P7D-I. A request recorded by an overlapping turn — here a Core `UPDATE` the
    ORM cannot see, issued once the conversation is loaded — must still reach the bot as
    pending. Fails when the `db.refresh` in `_turn` is removed."""
    _bot_conversation(db)
    child_id = _inactive_child_id(db)
    real = conversation_service.resolve_or_create

    def resolved_then_requested_elsewhere(session: Session, *, phone_number: str) -> Conversation:
        conversation = real(session, phone_number=phone_number)
        session.execute(
            text("UPDATE conversations SET reactivation_child_id = :child WHERE id = :id"),
            {"child": child_id, "id": conversation.id},
        )

        return conversation

    monkeypatch.setattr(
        conversation_service, "resolve_or_create", resolved_then_requested_elsewhere
    )

    _post_inbound(webhook_client)

    assert bot.calls[0]["reactivation_pending"] is True


def test_a_refused_second_request_leaves_the_pending_one_untouched(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    """REQ-132.6, OQ-74 — criterion 7, webhook level. The refusal carries nothing to apply, so
    the first request, its flag and its flag time are exactly what they were."""
    child_id = _inactive_child_id(db)
    conversation = _bot_conversation(db)
    conversation_service.request_reactivation(db, conversation=conversation, child_id=child_id)
    db.refresh(conversation)
    flagged_at = conversation.flagged_at
    bot.turn = BotTurn(reply=f"{render('REACTIVATION_PENDING', 'en')} {render('ASK_MENU', 'en')}")

    _post_inbound(webhook_client)
    db.refresh(conversation)

    assert bot.calls[0]["reactivation_pending"] is True
    assert conversation.reactivation_child_id == child_id
    assert conversation.flag_reason is FlagReason.REACTIVATION_REQUEST
    assert conversation.flagged_at == flagged_at


def test_the_stored_language_is_passed_to_the_bot(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    conversation = _bot_conversation(db)
    conversation.language = Language.ES
    db.flush()

    _post_inbound(webhook_client)

    assert bot.calls[0]["language"] == "es"


def test_a_language_the_turn_adopted_is_stored_on_the_conversation(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    conversation = _bot_conversation(db)
    conversation.language = Language.ES
    db.flush()
    bot.turn = BotTurn(reply=BOT_REPLY, language="en")

    _post_inbound(webhook_client)

    assert _conversation(db, phone_number=PHONE_NUMBER).language is Language.EN


def test_a_turn_that_adopted_no_language_leaves_the_stored_one(
    webhook_client: TestClient, db: Session, bot: "BotDouble"
) -> None:
    conversation = _bot_conversation(db)
    conversation.language = Language.ES
    db.flush()

    _post_inbound(webhook_client)

    assert _conversation(db, phone_number=PHONE_NUMBER).language is Language.ES


@pytest.mark.parametrize("field", ["From", "MessageSid"])
def test_a_signed_request_missing_a_required_field_is_400(
    webhook_client: TestClient, field: str
) -> None:
    form = {key: value for key, value in _form().items() if key != field}

    response = _post(webhook_client, INBOUND_PATH, form)

    assert response.status_code == 400
    assert response.json() == {"detail": MISSING_FIELD_ERROR.format(field=field)}


def test_the_status_callback_advances_queued_through_delivered(
    webhook_client: TestClient, db: Session
) -> None:
    message = _admin_message(db)

    for reported, expected in (
        ("sent", MessageStatus.SENT),
        ("delivered", MessageStatus.DELIVERED),
    ):
        response = _post_status(webhook_client, message_status=reported)
        db.refresh(message)

        assert response.status_code == 204
        assert response.content == b""
        assert message.status is expected


def test_the_status_callback_records_the_error_code_on_failure(
    webhook_client: TestClient, db: Session
) -> None:
    message = _admin_message(db)

    response = _post_status(webhook_client, message_status="failed", error_code="63016")
    db.refresh(message)

    assert response.status_code == 204
    assert message.status is MessageStatus.FAILED
    assert message.error_code == "63016"


@pytest.mark.parametrize(
    ("case", "message_status"),
    [
        ("purged or never ours", "delivered"),
        ("a status this schema does not model", "accepted"),
    ],
)
def test_a_status_callback_that_matches_nothing_is_acknowledged_with_204(
    webhook_client: TestClient,
    db: Session,
    published: list[BroadcastEvent],
    case: str,
    message_status: str,
) -> None:
    """Never a 404: a 404 only teaches Twilio to retry a row that no longer exists.

    And nothing is announced: no row moved, so there is nothing for an open thread to redraw.
    """
    if case == "a status this schema does not model":
        _admin_message(db)

    response = _post_status(webhook_client, message_status=message_status)

    assert response.status_code == 204
    assert response.content == b""
    assert published == []


def test_a_status_callback_that_advances_a_row_publishes_one_message_updated(
    webhook_client: TestClient, db: Session, published: list[BroadcastEvent]
) -> None:
    """#72: an open thread hears about the delivery, or the bubble says "Sending…" for good."""
    message = _admin_message(db)

    response = _post_status(webhook_client, message_status="delivered")

    assert response.status_code == 204
    assert [
        (event.type, event.conversation_id, event.message["id"], event.message["status"])
        for event in published
        if isinstance(event, MessageUpdated)
    ] == [("message.updated", message.conversation_id, str(message.id), "delivered")]
    assert len(published) == 1


def test_a_bad_signature_on_the_status_callback_is_403_and_changes_nothing(
    webhook_client: TestClient, db: Session, published: list[BroadcastEvent]
) -> None:
    message = _admin_message(db)

    response = _post(
        webhook_client, STATUS_PATH, _status_form("delivered"), signature="not-a-signature"
    )
    db.refresh(message)

    assert response.status_code == 403
    assert response.json() == {"detail": INVALID_SIGNATURE_ERROR}
    assert message.status is MessageStatus.QUEUED
    assert published == []


def test_a_bot_reply_never_reaches_the_status_callback(
    webhook_client: TestClient, db: Session
) -> None:
    """Amendment P7-3: the TwiML and REST lifecycles are separate and stay separate.

    A TwiML reply is recorded `sent` with a NULL `twilio_sid`, so there is nothing for the
    callback to match — and that is what stops every bot reply sitting at `queued` forever.
    """
    _post_inbound(webhook_client)
    reply = _messages(db, author_kind=MessageAuthor.BOT)[0]

    response = _post_status(webhook_client, message_status="delivered")
    db.refresh(reply)

    assert response.status_code == 204
    assert reply.twilio_sid is None
    assert reply.status is MessageStatus.SENT


@pytest.mark.parametrize("path", [INBOUND_PATH, STATUS_PATH])
def test_neither_route_resolves_an_auth_dependency(path: str) -> None:
    """§13 does not reach `/webhook/*`, and `TutorScope` here would 500 every query (§15)."""
    guards = {get_current_user, require_admin, get_tutor_scope}
    calls = _dependency_calls(_dependant(app, path))

    # The route's own dependency has to be in there, or the assertion below is inspecting
    # nothing and would hold just as well against a route that does take a principal.
    assert get_twilio_form in calls
    assert calls & guards == set()


def test_an_unauthenticated_request_succeeds(webhook_client: TestClient) -> None:
    response = _post_inbound(webhook_client)

    assert "authorization" not in {key.lower() for key in response.request.headers}
    assert response.status_code == 200


class BotDouble:
    """`bot_service.reply_for` with its call log — no LLM ever runs in pytest (**P7-I**)."""

    def __init__(self) -> None:
        self.turn = BotTurn(reply=BOT_REPLY)
        self.calls: list[dict[str, object]] = []

    def __call__(
        self,
        db: Session,
        *,
        phone_number: str,
        body: str,
        guardian_id: uuid.UUID | None,
        reactivation_pending: bool = False,
        language: GuardianLanguage | None = None,
        button: ReminderButton | None = None,
    ) -> BotTurn:
        self.calls.append(
            {
                "phone_number": phone_number,
                "body": body,
                "guardian_id": guardian_id,
                "reactivation_pending": reactivation_pending,
                "language": language,
                "button": button,
            }
        )

        return self.turn


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[BroadcastEvent]:
    """Captures every event handed to `broadcast_service.publish`, patched on the router.

    This is the assertion target for the fan-out: it proves the event left the handler through
    `publish` itself rather than through a stub the test installed, which is what **P7-X** asks
    of a gate.
    """
    recorded: list[BroadcastEvent] = []
    monkeypatch.setattr(webhook, "publish", recorded.append)

    return recorded


@pytest.fixture
def bot(monkeypatch: pytest.MonkeyPatch) -> BotDouble:
    double = BotDouble()
    monkeypatch.setattr(bot_service, "reply_for", double)

    return double


@pytest.fixture
def twilio_auth_token(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    """`TWILIO_AUTH_TOKEN` for one test, cleared out of the process-wide settings cache after.

    The cache is shared with every later test in the session, so a token left in it would be
    handed to modules that assert on an unconfigured deployment.
    """
    monkeypatch.setenv(AUTH_TOKEN_ENV, AUTH_TOKEN)
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def session_per_request_client(
    committed_sessions: sessionmaker[Session], bot: BotDouble, twilio_auth_token: None
) -> Generator[TestClient, None, None]:
    """One committed session per request, in place of the shared, rolled-back `db` fixture.

    Only `test_a_concurrent_redelivery_still_runs_the_bot_exactly_once` needs this: it is the
    one test in this module where two requests must genuinely contend for a row lock, which a
    single rolled-back transaction can never do.
    """

    def open_and_close_one_session_per_request() -> Generator[Session, None, None]:
        session = committed_sessions()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = open_and_close_one_session_per_request
    try:
        yield TestClient(app)
    finally:
        del app.dependency_overrides[get_db]


@pytest.fixture
def webhook_client(
    db: Session, bot: BotDouble, twilio_auth_token: None
) -> Generator[TestClient, None, None]:
    yield from _wired(app, db)


@pytest.fixture
def proxied_client(
    db: Session,
    bot: BotDouble,
    twilio_auth_token: None,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    """An app that trusts `PROXY`, so `X-Forwarded-Proto` reaches `scope["scheme"]`.

    Built here rather than reusing the shipped `app` because Starlette refuses `add_middleware`
    once an app has served a request, so the trusted set cannot be varied on the module-level
    one (`test_trusted_proxies.py`).
    """
    monkeypatch.setenv(TRUSTED_PROXIES_ENV, PROXY)
    get_settings.cache_clear()

    yield from _wired(create_app(), db, peer=(PROXY, PEER_PORT))


def _wired(
    built: FastAPI,
    db: Session,
    *,
    peer: tuple[str, int] | None = None,
) -> Generator[TestClient, None, None]:
    built.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(built, client=peer) if peer else TestClient(built)
    finally:
        del built.dependency_overrides[get_db]


def _form(**overrides: str) -> dict[str, str]:
    """A Twilio POST body, carrying the parameters the handler ignores as well as the three
    it reads — the signature is computed over all of them, so a handler that signed only what
    it parsed would fail against a real Twilio request."""
    form = {
        "From": TWILIO_FROM,
        "To": "whatsapp:+15555550199",
        "Body": INBOUND_BODY,
        "MessageSid": INBOUND_SID,
        "AccountSid": "AC00000000000000000000000000000000",
        "NumMedia": "0",
    }
    form.update(overrides)

    return form


def _status_form(message_status: str, *, error_code: str | None = None) -> dict[str, str]:
    form = {
        "MessageSid": OUTBOUND_SID,
        "MessageStatus": message_status,
        "AccountSid": "AC00000000000000000000000000000000",
    }
    if error_code is not None:
        form["ErrorCode"] = error_code

    return form


def _sign(url: str, form: dict[str, str]) -> str:
    return RequestValidator(AUTH_TOKEN).compute_signature(url, form)


def _post(
    client: TestClient,
    path: str,
    form: dict[str, str],
    *,
    signature: str | None = "sign it",
    headers: dict[str, str] | None = None,
) -> Response:
    sent = dict(headers or {})
    if signature == "sign it":
        signature = _sign(BASE_URL + path, form)
    if signature is not None:
        sent["X-Twilio-Signature"] = signature

    return client.post(path, data=form, headers=sent)


@pytest.mark.parametrize(
    ("payload", "button"),
    [
        ("book_session", ReminderButton.BOOK_SESSION),
        ("stop_reminders", ReminderButton.STOP_REMINDERS),
        ("some_other_button", None),
    ],
)
def test_a_reminder_button_payload_reaches_the_bot_and_any_other_is_dropped(
    webhook_client: TestClient, bot: "BotDouble", payload: str, button: ReminderButton | None
) -> None:
    response = _post_inbound(webhook_client, form={**_form(), "ButtonPayload": payload})

    assert response.status_code == 200
    assert bot.calls[0]["button"] is button


def _post_inbound(client: TestClient, *, form: dict[str, str] | None = None) -> Response:
    return _post(client, INBOUND_PATH, form if form is not None else _form())


def _post_status(
    client: TestClient, *, message_status: str, error_code: str | None = None
) -> Response:
    return _post(client, STATUS_PATH, _status_form(message_status, error_code=error_code))


def _conversation(db: Session, *, phone_number: str) -> Conversation | None:
    return db.scalars(
        select(Conversation).where(Conversation.phone_number == phone_number)
    ).one_or_none()


def _messages(db: Session, *, author_kind: MessageAuthor) -> list[Message]:
    return list(
        db.scalars(
            select(Message).where(Message.author_kind == author_kind).order_by(Message.created_at)
        ).all()
    )


def _published(events: list[BroadcastEvent]) -> list[tuple[str, str, str]]:
    return [
        (event.type, event.message["body"], event.message["author_kind"])
        for event in events
        if isinstance(event, MessageCreated)
    ]


def _taken_over_conversation(db: Session) -> Conversation:
    holder = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password("webhook-password"),
        role=UserRole.ADMIN,
    )
    db.add(holder)
    db.flush()

    conversation = Conversation(
        phone_number=PHONE_NUMBER,
        status=ConversationStatus.HUMAN,
        taken_over_by_user_id=holder.id,
        taken_over_at=datetime.datetime.now(tz=datetime.UTC),
        last_message_at=datetime.datetime.now(tz=datetime.UTC),
    )
    db.add(conversation)
    db.flush()

    return conversation


def _admin_message(db: Session) -> Message:
    conversation = Conversation(
        phone_number=PHONE_NUMBER,
        last_message_at=datetime.datetime.now(tz=datetime.UTC),
    )
    db.add(conversation)
    db.flush()
    holder = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password("webhook-password"),
        role=UserRole.ADMIN,
    )
    db.add(holder)
    db.flush()

    return message_service.record_admin_message(
        db,
        conversation=conversation,
        body="I'll take it from here.",
        author_user_id=holder.id,
        twilio_sid=OUTBOUND_SID,
    )


def _bot_conversation(db: Session) -> Conversation:
    conversation = Conversation(
        phone_number=PHONE_NUMBER,
        last_message_at=datetime.datetime.now(tz=datetime.UTC),
    )
    db.add(conversation)
    db.flush()

    return conversation


def _inactive_child_id(db: Session) -> uuid.UUID:
    child = Child(
        name="Sam Jones",
        date_of_birth=datetime.date(2015, 3, 9),
        grade_level=6,
        school_name="Test School",
        is_active=False,
    )
    db.add(child)
    db.flush()

    return child.id


def _guardian_id(db: Session) -> uuid.UUID:
    guardian = Guardian(name="Ada Lovelace", phone_number=PHONE_NUMBER)
    db.add(guardian)
    db.flush()

    return guardian.id


def _dependant(built: FastAPI, path: str) -> Dependant:
    route = next(entry for entry in _routes(built) if getattr(entry, "path", None) == path)

    return route.dependant


def _routes(node: Any) -> Iterator[Any]:
    """Every route, including the ones this FastAPI version nests under an included router."""
    for entry in getattr(node, "routes", ()):
        yield entry
        nested = getattr(entry, "original_router", None)
        if nested is not None:
            yield from _routes(nested)


def _dependency_calls(dependant: Dependant) -> set[Any]:
    calls = {dependant.call} if dependant.call is not None else set()
    for nested in dependant.dependencies:
        calls |= _dependency_calls(nested)

    return calls
