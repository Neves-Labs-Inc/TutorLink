"""The contract between `bot_service` and `parser_service`, driven through the real wire shape.

`test_bot_service.py` replaces `parse_intent` outright, so it cannot see the two modules drift
apart — and they did: the bot read each answer under the step's own name, and the model named
that key whatever it liked. Here `reply_for` runs through the real `parse_intent`, and only
`parser_service._client` is stubbed, returning raw JSON wire text that is validated through
`output_format` the way the SDK does. **No test here calls Anthropic** (P7-I): a turn that
reaches the client with nothing queued fails loudly.
"""

import json
from dataclasses import dataclass, field

import pytest
from sqlalchemy.orm import Session

from app.models.guardian import Guardian
from app.services import bot_service, parser_service
from app.services.bot_state import FlowState, load_state
from tests.test_bot_service import (
    INBOUND_NUMBER,
    NOW,
    _make_client,
    _make_world,
)

FRANKLIN_WIRE = (
    '{"intent":"unknown","answer":"Franklin Neves",'
    '"fields":[{"name":"parent_name","value":"Franklin Neves"}],"confidence_is_low":false}'
)


def _wire(answer: str | None, *, intent: str = "unknown") -> str:
    return json.dumps(
        {"intent": intent, "answer": answer, "fields": [], "confidence_is_low": False}
    )


class _StubResponse:
    def __init__(self, parsed_output: object) -> None:
        self.parsed_output = parsed_output


@dataclass
class _WireMessages:
    """`messages.parse`, answering from a queue of raw wire texts and recording each prompt."""

    queued: list[str] = field(default_factory=list)
    prompts: list[str] = field(default_factory=list)

    def parse(self, **kwargs: object) -> _StubResponse:
        messages = kwargs["messages"]
        output_format = kwargs["output_format"]
        assert isinstance(messages, list)
        assert isinstance(output_format, type)
        if not self.queued:
            raise AssertionError("unscripted parse: no test said what the model returns")

        self.prompts.append(messages[0]["content"])

        return _StubResponse(output_format.model_validate_json(self.queued.pop(0)))


@dataclass
class _WireClient:
    messages: _WireMessages = field(default_factory=_WireMessages)


@dataclass
class WireChat:
    """One WhatsApp thread whose every parse goes through the real `parse_intent`."""

    db: Session
    wire: _WireMessages

    def say(self, body: str, wire: str | None = None) -> str:
        """Send `body`; `wire` is what the model returns for it, if the turn parses at all."""
        if wire is not None:
            self.wire.queued.append(wire)

        turn = bot_service.reply_for(
            self.db, phone_number=INBOUND_NUMBER, body=body, guardian_id=None
        )
        assert self.wire.queued == [], "the turn did not consume its scripted parse"

        return turn.reply

    @property
    def step(self) -> str | None:
        state = load_state(self.db, phone_number=INBOUND_NUMBER)

        return None if state is None else state.step

    @property
    def state(self) -> FlowState:
        state = load_state(self.db, phone_number=INBOUND_NUMBER)
        assert state is not None

        return state


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bot_service, "server_now", lambda: NOW)


@pytest.fixture
def chat(db: Session, monkeypatch: pytest.MonkeyPatch) -> WireChat:
    client = _WireClient()
    monkeypatch.setattr(parser_service, "_client", client)

    return WireChat(db=db, wire=client.messages)


def _through_the_child_name(chat: WireChat) -> None:
    chat.say("hello?")
    chat.say("My name is Franklin Neves", FRANKLIN_WIRE)
    chat.say("1 Test Street", _wire("1 Test Street"))
    chat.say("code is 1234", _wire("1234"))
    chat.say("Home", _wire("Home"))
    chat.say("no", _wire("no"))
    chat.say("Sam", _wire("Sam"))


def test_a_full_name_given_in_a_sentence_moves_intake_on_to_the_address(
    chat: WireChat,
) -> None:
    """The production bug: the model put the name under `parent_name`, not `intake_name`."""
    chat.say("hello?")

    reply = chat.say("My name is Franklin Neves", FRANKLIN_WIRE)

    assert bot_service.ASK_ADDRESS in reply
    assert chat.step == bot_service.STEP_INTAKE_ADDRESS
    assert chat.state.collected_data["guardian_name"] == "Franklin Neves"


def test_the_prompt_shows_the_question_once_and_not_as_collected_context(
    chat: WireChat,
) -> None:
    chat.say("hello?")
    chat.say("My name is Franklin Neves", FRANKLIN_WIRE)

    prompt = chat.wire.prompts[0]
    collected = prompt.split("Collected so far:", 1)[1].split("The parent just sent:", 1)[0]

    assert prompt.count(bot_service.ASK_GUARDIAN_NAME) == 1
    assert "- prompt:" not in collected


def test_a_no_at_the_already_registered_question_moves_on_to_the_childs_name(
    chat: WireChat,
) -> None:
    chat.say("hello?")
    chat.say("My name is Franklin Neves", FRANKLIN_WIRE)
    chat.say("1 Test Street", _wire("1 Test Street"))
    chat.say("code is 1234", _wire("1234"))
    chat.say("Home", _wire("Home"))

    reply = chat.say("nope", _wire("no"))

    assert bot_service.ASK_CHILD_NAME in reply
    assert chat.step == bot_service.STEP_CHILD_NAME


def test_a_grade_answered_as_a_number_moves_on_to_the_school(chat: WireChat) -> None:
    _through_the_child_name(chat)
    chat.say("23 April 2016", _wire("2016-04-23"))

    reply = chat.say("she's in year 3", _wire("3"))

    assert bot_service.ASK_CHILD_SCHOOL in reply
    assert chat.step == bot_service.STEP_CHILD_SCHOOL
    assert chat.state.collected_data["child_grade"] == "3"


def test_a_no_to_another_child_finishes_intake_and_writes_the_guardian(
    chat: WireChat, db: Session
) -> None:
    _through_the_child_name(chat)
    chat.say("23 April 2016", _wire("2016-04-23"))
    chat.say("3", _wire("3"))
    chat.say("Test School", _wire("Test School"))
    chat.say("none", _wire("none"))

    chat.say("no that's all", _wire("no"))

    assert chat.step != bot_service.STEP_CHILD_MORE
    assert db.query(Guardian).filter_by(name="Franklin Neves").count() == 1


def test_a_subject_picked_by_its_number_moves_on_to_the_tutor(chat: WireChat, db: Session) -> None:
    _make_client(db)
    _make_world(db)
    chat.say("hi")
    chat.say("I'd like to book", _wire(None, intent="book"))

    reply = chat.say("1", _wire("1"))

    assert bot_service.ASK_TUTOR in reply
    assert chat.step == bot_service.STEP_BOOK_TUTOR


def test_an_answer_only_under_the_step_name_is_a_re_prompt(chat: WireChat) -> None:
    """No fallback to `fields[<step>]`: the fixed `answer` slot is the only contract."""
    chat.say("hello?")
    wire = (
        '{"intent":"unknown","answer":null,'
        '"fields":[{"name":"intake_name","value":"Franklin Neves"}],"confidence_is_low":false}'
    )

    reply = chat.say("My name is Franklin Neves", wire)

    assert bot_service.NOT_UNDERSTOOD in reply
    assert bot_service.ASK_GUARDIAN_NAME in reply
    assert chat.step == bot_service.STEP_INTAKE_NAME
    assert chat.state.misses == 1
