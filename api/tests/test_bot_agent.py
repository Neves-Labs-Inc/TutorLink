"""`bot_agent`: the production wiring a worker turn runs with.

Through `take_turn`, the seam the worker calls: the real tools, prompt and context, with the
model scripted or left unconfigured. No test here calls Anthropic.
"""

import logging
import threading
from collections.abc import Generator
from dataclasses import replace
from typing import Any

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


def test_the_warm_up_sends_the_tools_and_prompt_a_turn_sends_once(
    db: Session, fake_twilio: FakeTwilio
) -> None:
    conversation = _chat_with_a_message(db)
    model = FakeModel(script=[reply("Hello! What's your name?")], warm_up_answer=8.5)
    deps = replace(bot_agent.default_deps(), model=model)

    seconds = bot_agent.warm_up(deps)
    bot_agent.turn_runner(deps)(db, conversation.id)

    [warm_up] = model.warm_ups
    [request] = model.requests
    assert seconds == 8.5
    assert warm_up["tools"] == request["tools"]
    assert {tool["name"] for tool in warm_up["tools"]} == AGENT_TOOLS
    assert warm_up["system"] == request["system"] == bot_prompt.system_prompt()


def test_a_crashing_warm_up_is_logged_and_never_raises(caplog: pytest.LogCaptureFixture) -> None:
    model = FakeModel(script=[], warm_up_answer=RuntimeError("boom"))

    with caplog.at_level(logging.ERROR, logger="app.services.bot_agent"):
        seconds = bot_agent.warm_up(replace(bot_agent.default_deps(), model=model))

    assert seconds is None
    assert "bot model warm-up crashed" in caplog.text


def test_with_no_api_key_the_warm_up_is_skipped(
    no_api_key: None, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.services.bot_agent"):
        seconds = bot_agent.warm_up(bot_agent.default_deps())

    assert seconds is None
    assert "warm-up skipped" in caplog.text


class BlockingModel(FakeModel):
    """A warm-up that waits until released, like one stuck on a slow schema compile."""

    def __init__(self) -> None:
        super().__init__(script=[])
        self.release = threading.Event()

    def warm_up(self, *, system: str, tools: list[dict[str, Any]]) -> float | None:
        self.release.wait(5)
        return None


def test_the_background_warm_up_returns_before_the_request_finishes() -> None:
    model = BlockingModel()

    thread = bot_agent.start_warm_up(replace(bot_agent.default_deps(), model=model))

    assert thread.is_alive()
    assert thread.daemon
    model.release.set()
    thread.join(5)
    assert not thread.is_alive()


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
