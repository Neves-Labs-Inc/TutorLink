"""The `fake_twilio` test double: what later tickets rely on when they send through Twilio.

The send tests call the patched names on the callers' modules, the same references production
code reaches, so a fixture that patched the wrong place would fail here first.
"""

import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
)
from app.models.message import Message
from app.config import get_settings
from app.routers import conversation_stream
from app.services import twilio_service
from app.services.twilio_service import TwilioSendFailed
from tests.fake_twilio import (
    CODE_OUTSIDE_WINDOW,
    CODE_UNDELIVERABLE,
    FakeTwilio,
    SentMessage,
)

PHONE_NUMBER = "+15555550142"
CONTENT_SID = "HX00000000000000000000000000000001"


def test_free_form_sends_are_recorded_with_increasing_sids(fake_twilio: FakeTwilio) -> None:
    first = conversation_stream.send_whatsapp_message(to=PHONE_NUMBER, body="hola")
    second = conversation_stream.send_whatsapp_message(to=PHONE_NUMBER, body="adiós")

    assert fake_twilio.sent == [
        SentMessage(sid=first, to=PHONE_NUMBER, body="hola"),
        SentMessage(sid=second, to=PHONE_NUMBER, body="adiós"),
    ]
    assert first < second


def test_a_template_send_is_recorded_with_its_content_sid_and_variables(
    fake_twilio: FakeTwilio,
) -> None:
    sid = fake_twilio.send_whatsapp_template(
        to=PHONE_NUMBER, content_sid=CONTENT_SID, content_variables={"1": "Ana"}
    )

    assert fake_twilio.sent == [
        SentMessage(
            sid=sid,
            to=PHONE_NUMBER,
            content_sid=CONTENT_SID,
            content_variables={"1": "Ana"},
        )
    ]


def test_an_armed_fake_raises_for_the_next_calls_only_and_records_none_of_them(
    fake_twilio: FakeTwilio,
) -> None:
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW, times=2)

    for _ in range(2):
        with pytest.raises(TwilioSendFailed) as raised:
            conversation_stream.send_whatsapp_message(to=PHONE_NUMBER, body="hola")
        assert (raised.value.code, raised.value.is_retryable) == (CODE_OUTSIDE_WINDOW, False)

    conversation_stream.send_whatsapp_message(to=PHONE_NUMBER, body="hola")

    assert [message.body for message in fake_twilio.sent] == ["hola"]


def test_a_fake_armed_with_a_server_error_raises_a_retryable_failure(
    fake_twilio: FakeTwilio,
) -> None:
    fake_twilio.fail_next_with_server_error()

    with pytest.raises(TwilioSendFailed) as raised:
        fake_twilio.send_whatsapp_template(
            to=PHONE_NUMBER, content_sid=CONTENT_SID, content_variables={}
        )

    assert raised.value.is_retryable is True


def test_a_fake_armed_with_a_network_error_raises_a_retryable_failure_with_no_code(
    fake_twilio: FakeTwilio,
) -> None:
    fake_twilio.fail_next_with_network_error()

    with pytest.raises(TwilioSendFailed) as raised:
        fake_twilio.send_whatsapp_template(
            to=PHONE_NUMBER, content_sid=CONTENT_SID, content_variables={}
        )

    assert (raised.value.code, raised.value.is_retryable) == (None, True)


def test_a_fake_armed_with_a_template_code_raises_it_from_a_template_send(
    fake_twilio: FakeTwilio,
) -> None:
    fake_twilio.fail_next(code=CODE_UNDELIVERABLE)

    with pytest.raises(TwilioSendFailed) as raised:
        fake_twilio.send_whatsapp_template(
            to=PHONE_NUMBER, content_sid=CONTENT_SID, content_variables={}
        )

    assert raised.value.code == CODE_UNDELIVERABLE


def test_the_signed_status_callback_is_accepted_by_the_real_route(
    api: TestClient, db: Session, fake_twilio: FakeTwilio
) -> None:
    sid = conversation_stream.send_whatsapp_message(to=PHONE_NUMBER, body="hola")
    message = _queued_message(db, twilio_sid=sid)

    response = fake_twilio.post_status(api, sid=sid, status="failed", error_code="63016")
    db.refresh(message)

    assert response.status_code == 204
    assert (message.status, message.error_code) == (MessageStatus.FAILED, "63016")


def test_a_send_through_twilio_service_never_reaches_the_real_client(
    monkeypatch: pytest.MonkeyPatch, fake_twilio: FakeTwilio
) -> None:
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC00000000000000000000000000000000")
    monkeypatch.setenv("TWILIO_WHATSAPP_NUMBER", "+15555550100")
    get_settings.cache_clear()

    with pytest.raises(AssertionError, match="real Twilio client"):
        twilio_service.send_whatsapp_message(to=PHONE_NUMBER, body="hola")

    assert fake_twilio.sent == []


def _queued_message(db: Session, *, twilio_sid: str) -> Message:
    conversation = Conversation(
        phone_number=PHONE_NUMBER,
        status=ConversationStatus.BOT,
        last_message_at=datetime.datetime.now(datetime.UTC),
    )
    db.add(conversation)
    db.flush()
    message = Message(
        conversation_id=conversation.id,
        author_kind=MessageAuthor.SYSTEM,
        system_kind=SystemMessageKind.BOOKING_REMINDER,
        body="hola",
        status=MessageStatus.QUEUED,
        twilio_sid=twilio_sid,
    )
    db.add(message)
    db.flush()

    return message
