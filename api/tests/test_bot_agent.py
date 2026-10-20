"""`bot_agent`: the production wiring a worker turn runs with.

Through `take_turn`, the seam the worker calls: the real tools, prompt and context, with the
model scripted or left unconfigured. No test here calls Anthropic.
"""

from collections.abc import Generator
from dataclasses import replace

import pytest
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.conversation import Conversation
from app.models.enums import FlagReason
from app.services import bot_agent, bot_messages, bot_prompt, conversation_service, message_service
from tests.fake_twilio import FakeTwilio
from tests.test_bot_turn import FakeModel, reply

AGENT_TOOLS = {
    "create_guardian",
    "update_guardian",
    "create_home",
    "update_home",
    "create_child",
    "update_child",
    "list_subjects",
    "set_reminder_preference",
    "hand_off_to_office",
    "list_slots",
    "propose",
    "commit_proposal",
    "reply",
}
PHONE_NUMBER = "+12025550188"


@pytest.fixture
def no_api_key(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


def _chat_with_a_message(db: Session) -> Conversation:
    conversation = conversation_service.resolve_or_create(db, phone_number=PHONE_NUMBER)
    message_service.record_inbound(
        db, conversation=conversation, body="hello", twilio_sid="SMin000000000000000000000000000001"
    )
    db.commit()
    return conversation


def test_a_turn_offers_the_model_every_agent_tool_and_the_cached_prompt(
    db: Session, fake_twilio: FakeTwilio
) -> None:
    conversation = _chat_with_a_message(db)
    model = FakeModel(script=[reply("Hello! What's your name?")])
    run = bot_agent.turn_runner(replace(bot_agent.default_deps(), model=model))

    outcome = run(db, conversation.id)

    [request] = model.requests
    assert outcome.kind == "replied"
    assert {tool["name"] for tool in request["tools"]} == AGENT_TOOLS
    assert request["system"] == bot_prompt.system_prompt()
    assert "Guardian: hello" in request["messages"][0]["content"]


def test_with_no_api_key_a_turn_is_an_outage_the_office_can_see(
    db: Session, fake_twilio: FakeTwilio, no_api_key: None
) -> None:
    conversation = _chat_with_a_message(db)
    run = bot_agent.turn_runner(bot_agent.default_deps())

    outcome = run(db, conversation.id)

    db.refresh(conversation)
    assert outcome.kind == "outage"
    assert conversation.flag_reason is FlagReason.STUCK
    assert [sent.body for sent in fake_twilio.sent] == [bot_messages.render("OUTAGE_APOLOGY", "en")]
