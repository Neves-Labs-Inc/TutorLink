"""The contract between `bot_service` and `parser_service`, driven through the real wire shape.

`test_bot_service.py` replaces `parse_intent` outright, so it cannot see the two modules drift
apart — and they did: the bot read each answer under the step's own name, and the model named
that key whatever it liked. Here `reply_for` runs through the real `parse_intent`, and only
`parser_service._client` is stubbed, returning raw JSON wire text that is validated through
`output_format` the way the SDK does. **No test here calls Anthropic** (P7-I): a turn that
reaches the client with nothing queued fails loudly.
"""

import datetime
import json
from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from sqlalchemy.orm import Session

from app.models.guardian import Guardian
from app.models.enums import FlagReason
from app.schemas.bot import AnswerKind, BotIntent
from app.services import bot_messages, bot_service, parser_service
from app.services.bot_messages import render
from app.services.bot_state import FlowState, load_state
from tests.test_bot_service import (
    _nudge,
    DATE,
    INBOUND_NUMBER,
    NOW,
    CHILD_LEVEL,
    _evaluate,
    _make_client,
    _make_world,
)

FRANKLIN_WIRE = (
    '{"intent":"unknown","answer":"Franklin Neves",'
    '"fields":[{"name":"parent_name","value":"Franklin Neves"}],"confidence_is_low":false,'
    '"language":"en","reminders":null}'
)


def _wire(answer: str | None, *, intent: str = "unknown", language: str | None = None) -> str:
    return json.dumps(
        {
            "intent": intent,
            "answer": answer,
            "fields": [],
            "confidence_is_low": False,
            "language": language,
            "reminders": None,
        }
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
        """Send `body`; `wire` is what the model returns for it. Every turn parses, the opener
        included (for its language), so a turn with no `wire` gets a neutral parse."""
        self.wire.queued.append(_wire(None) if wire is None else wire)

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
def frozen_clock(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(NOW)


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

    assert render("ASK_ADDRESS", "en") in reply
    assert chat.step == bot_service.STEP_INTAKE_ADDRESS
    assert chat.state.collected_data["guardian_name"] == "Franklin Neves"


def test_the_prompt_shows_the_question_once_and_not_as_collected_context(
    chat: WireChat,
) -> None:
    chat.say("hello?")
    chat.say("My name is Franklin Neves", FRANKLIN_WIRE)

    # The opener's parse is prompts[0]; the name question's is the next one.
    prompt = chat.wire.prompts[1]
    collected = prompt.split("Collected so far:", 1)[1].split("The parent just sent:", 1)[0]

    assert prompt.count(render("ASK_GUARDIAN_NAME", "en")) == 1
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

    assert render("ASK_CHILD_NAME", "en") in reply
    assert chat.step == bot_service.STEP_CHILD_NAME


def test_a_no_to_another_child_finishes_intake_and_writes_the_guardian(
    chat: WireChat, db: Session
) -> None:
    _through_the_child_name(chat)
    chat.say("23 April 2016", _wire("2016-04-23"))
    chat.say("Test School", _wire("Test School"))
    chat.say("fifth grade", _wire("5"))
    chat.say("none", _wire("none"))

    chat.say("no that's all", _wire("no"))

    assert chat.step != bot_service.STEP_CHILD_MORE
    assert db.query(Guardian).filter_by(name="Franklin Neves").count() == 1


def test_a_subject_picked_by_its_number_moves_on_to_the_tutor(chat: WireChat, db: Session) -> None:
    client = _make_client(db)
    world = _make_world(db)
    _evaluate(db, client.child_id, levels={world.subject_id: CHILD_LEVEL})
    chat.say("hi")
    chat.say("I'd like to book", _wire(None, intent="book"))

    reply = chat.say("1", _wire("1"))

    assert render("ASK_TUTOR", "en") in reply
    assert chat.step == bot_service.STEP_BOOK_TUTOR


def test_an_answer_only_under_the_step_name_is_a_re_prompt(chat: WireChat) -> None:
    """No fallback to `fields[<step>]`: the fixed `answer` slot is the only contract."""
    chat.say("hello?")
    wire = (
        '{"intent":"unknown","answer":null,'
        '"fields":[{"name":"intake_name","value":"Franklin Neves"}],"confidence_is_low":false,'
        '"language":null,"reminders":null}'
    )

    reply = chat.say("My name is Franklin Neves", wire)

    assert reply == _nudge(bot_service.STEP_INTAKE_NAME)
    assert chat.step == bot_service.STEP_INTAKE_NAME
    assert chat.state.misses == 1


def test_the_prompt_names_the_expected_answer_kind_and_todays_date(chat: WireChat) -> None:
    """The parser can only resolve "next Tuesday" or "the second one" into the form the bot
    reads if it is told that form and the day it is counting from."""
    _through_the_child_name(chat)
    chat.say("23rd April 2016", _wire("2016-04-23"))

    registered_prompt = chat.wire.prompts[5]
    birth_date_prompt = chat.wire.prompts[-1]

    assert "Expected answer: yes_no" in registered_prompt
    assert "exactly `yes` or `no`" in registered_prompt
    assert "Expected answer: date" in birth_date_prompt
    assert "YYYY-MM-DD" in birth_date_prompt
    assert f"Today is {NOW.date().isoformat()}" in birth_date_prompt


def test_the_prompt_dates_today_by_the_business_clock_not_utc(
    chat: WireChat, business_evening: datetime.datetime
) -> None:
    _through_the_child_name(chat)
    chat.say("23rd April 2016", _wire("2016-04-23"))

    assert "Today is 2026-09-28 (Monday)" in chat.wire.prompts[-1]


def test_small_talk_from_the_wire_gets_the_menu_back_without_a_re_prompt(
    chat: WireChat, db: Session
) -> None:
    _make_client(db)
    chat.say("hi")

    reply = chat.say("thanks!", _wire(None, intent="chit_chat"))

    assert reply.endswith(render("ASK_MENU", "en"))
    assert chat.step == bot_service.STEP_MENU
    assert chat.state.misses == 0


def test_a_question_from_the_wire_is_flagged_for_the_office(chat: WireChat, db: Session) -> None:
    _make_client(db)
    chat.say("hi")
    chat.wire.queued.append(_wire(None, intent="question"))

    turn = bot_service.reply_for(
        db, phone_number=INBOUND_NUMBER, body="how much is a session?", guardian_id=None
    )

    assert turn.reply == f"{render('QUESTION_PASSED_ON', 'en')} {render('ASK_MENU', 'en')}"
    assert turn.flag_reason is FlagReason.QUESTION
    assert chat.step == bot_service.STEP_MENU
    assert chat.state.misses == 0


def test_a_spanish_opener_from_the_wire_is_greeted_in_spanish_and_reported_for_storing(
    chat: WireChat, db: Session
) -> None:
    chat.wire.queued.append(_wire(None, language="es"))

    turn = bot_service.reply_for(db, phone_number=INBOUND_NUMBER, body="Hola", guardian_id=None)

    assert turn.reply == f"{render('GREETING_NEW', 'es')} {render('ASK_GUARDIAN_NAME', 'es')}"
    assert turn.language == "es"
    assert "Current step: opening" in chat.wire.prompts[0]


def test_the_system_prompt_defines_every_intent() -> None:
    for intent in BotIntent:
        assert f"`{intent.value}`" in parser_service.SYSTEM_PROMPT


def test_the_system_prompt_explains_every_answer_kind() -> None:
    for kind in AnswerKind:
        assert f"`{kind.value}`" in parser_service.SYSTEM_PROMPT


def test_the_prompt_tells_the_parser_a_hedge_is_no_yes_or_no(chat: WireChat) -> None:
    """At the already-registered question a hedge coerced to `no` registers a duplicate."""
    _through_the_child_name(chat)

    registered_prompt = chat.wire.prompts[5]

    assert "not sure" in registered_prompt


def test_a_yes_to_another_child_starts_the_next_child(chat: WireChat) -> None:
    _through_the_child_name(chat)
    chat.say("23 April 2016", _wire("2016-04-23"))
    chat.say("Test School", _wire("Test School"))
    chat.say("fifth grade", _wire("5"))
    chat.say("none", _wire("none"))

    reply = chat.say("yes please", _wire("yes"))

    assert reply == render("ASK_CHILD_REGISTERED", "en")
    assert chat.step == bot_service.STEP_CHILD_REGISTERED


def test_a_booking_day_and_a_slot_number_lead_to_the_confirmation(
    chat: WireChat, db: Session
) -> None:
    client = _make_client(db)
    world = _make_world(db)
    _evaluate(db, client.child_id, levels={world.subject_id: CHILD_LEVEL})
    chat.say("hi")
    chat.say("I'd like to book", _wire(None, intent="book"))
    chat.say("maths", _wire("1"))
    tutor_prompt_index = len(chat.wire.prompts)
    chat.say("anyone", _wire("3"))

    offer = chat.say("next week's one", _wire(DATE.isoformat()))
    confirm = chat.say("the first one", _wire("1"))

    assert "Expected answer: choice" in chat.wire.prompts[tutor_prompt_index]
    assert bot_messages.format_date(DATE, "en") in offer
    assert chat.step == bot_service.STEP_BOOK_CONFIRM
    assert world.first_tutor_name in confirm or world.second_tutor_name in confirm
