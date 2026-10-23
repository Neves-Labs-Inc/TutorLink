"""One bot turn through `take_turn`, with a scripted FakeModel, fake tools and fake_twilio."""

import datetime
import itertools
import json
import logging
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    FlagReason,
    Language,
    MessageAuthor,
    MessageStatus,
    RedactedField,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.message import Message
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User
from app.services import (
    bot_context,
    bot_messages,
    bot_tools_booking,
    bot_tools_profile,
    bot_turn,
    conversation_service,
    message_service,
)
from app.services.bot_model import ModelResponse, ModelUnavailable, ModelUsage, ToolCall
from app.services.bot_tool_contract import (
    CommittedAction,
    SavedValue,
    ToolContext,
    ToolResult,
    ToolSpec,
)
from app.services.bot_turn import TurnDeps, TurnOutcome, take_turn
from tests.fake_twilio import CODE_OUTSIDE_WINDOW, FakeTwilio

START = datetime.datetime(2026, 10, 19, 15, 0, tzinfo=datetime.UTC)
SNAPSHOT = "Guardian: not named yet"
TRANSCRIPT = "[Mon 15:00] Guardian: hi"
SYSTEM_PROMPT = "You are the WhatsApp assistant."
EMPTY_SCHEMA = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
SESSION_DATE = datetime.date(2026, 10, 20)

_sid_numbers = itertools.count(1)


# --- the fakes ---------------------------------------------------------------------------------


def reply(text: str, language: str = "en") -> "Step":
    return Step(calls=(("reply", {"text": text, "language": language}),))


def call(*calls: tuple[str, dict[str, Any]]) -> "Step":
    return Step(calls=calls)


def say(text: str) -> "Step":
    return Step(text=text)


@dataclass(frozen=True)
class Step:
    """One scripted model response: text and tool calls, in that order."""

    text: str = ""
    calls: tuple[tuple[str, dict[str, Any]], ...] = ()


@dataclass
class FakeModel:
    """Answers each `create` with the next scripted step; an exception step is raised. A
    warm-up is recorded and answered with `warm_up_answer`, or raises it."""

    script: list[Step | Exception]
    requests: list[dict[str, Any]] = field(default_factory=list)
    warm_ups: list[dict[str, Any]] = field(default_factory=list)
    warm_up_answer: float | Exception | None = None
    _ids: Iterator[int] = field(default_factory=lambda: itertools.count(1))

    def warm_up(self, *, system: str, tools: list[dict[str, Any]]) -> float | None:
        self.warm_ups.append({"system": system, "tools": tools})
        if isinstance(self.warm_up_answer, Exception):
            raise self.warm_up_answer
        return self.warm_up_answer

    def create(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        timeout_s: float,
    ) -> ModelResponse:
        self.requests.append(
            {"system": system, "tools": tools, "messages": list(messages), "timeout_s": timeout_s}
        )
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step

        calls = tuple(
            ToolCall(id=f"toolu_{next(self._ids)}", name=name, input=tool_input)
            for name, tool_input in step.calls
        )
        text_blocks = [{"type": "text", "text": step.text}] if step.text else []
        tool_blocks = [
            {"type": "tool_use", "id": c.id, "name": c.name, "input": c.input} for c in calls
        ]
        return ModelResponse(
            text=step.text,
            tool_calls=calls,
            stop_reason="tool_use" if calls else "end_turn",
            usage=ModelUsage(
                input_tokens=10,
                output_tokens=5,
                cache_read_input_tokens=0,
                cache_creation_input_tokens=0,
            ),
            assistant_content=tuple(text_blocks + tool_blocks),
        )


@dataclass(frozen=True)
class FakeContext:
    snapshot: str
    transcript: str


def build_context(
    db: Session, *, conversation: Conversation, now: datetime.datetime
) -> FakeContext:
    return FakeContext(snapshot=SNAPSHOT, transcript=TRANSCRIPT)


def bot_context_for(
    db: Session, *, conversation: Conversation, now: datetime.datetime
) -> bot_context.TurnContext:
    """The real snapshot and history, for a test replaying a whole chat."""
    return bot_context.build_turn_context(db, conversation=conversation, now=now)


class Clock:
    """A turn clock that tests move forward by hand."""

    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime.datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += datetime.timedelta(seconds=seconds)


def tool(name: str, run: Callable[[ToolContext, dict[str, Any]], ToolResult]) -> ToolSpec:
    return ToolSpec(name=name, description=f"The {name} tool.", input_schema=EMPTY_SCHEMA, run=run)


def ok(progress: bool = False) -> Callable[[ToolContext, dict[str, Any]], ToolResult]:
    return lambda ctx, tool_input: ToolResult(
        status="ok", content={"done": True}, progress=progress
    )


def lookup() -> ToolSpec:
    return tool("list_subjects", ok(progress=False))


@dataclass
class Turn:
    db: Session
    conversation: Conversation
    clock: Clock
    sleeps: list[float]

    def run(
        self,
        script: list[Step | Exception],
        tools: tuple[ToolSpec, ...] = (),
        context: Callable[..., Any] = build_context,
    ) -> TurnOutcome:
        self.model = FakeModel(script=list(script))
        deps = TurnDeps(
            model=self.model,
            tools=tools,
            system_prompt=lambda: SYSTEM_PROMPT,
            build_context=context,
            clock=self.clock,
            sleep=self.sleeps.append,
        )
        # The worker hands `take_turn` a session with nothing in flight.
        self.db.commit()
        return take_turn(self.db, conversation_id=self.conversation.id, deps=deps)

    def guardian_says(self, body: str) -> Message:
        message = message_service.record_inbound(
            self.db,
            conversation=self.conversation,
            body=body,
            twilio_sid=f"SMin{next(_sid_numbers):030d}",
        )
        assert message is not None
        self.db.flush()
        return message

    def bot_messages(self) -> list[Message]:
        return list(
            self.db.scalars(
                select(Message)
                .where(
                    Message.conversation_id == self.conversation.id,
                    Message.author_kind == MessageAuthor.BOT,
                )
                .order_by(Message.created_at)
            )
        )

    def refreshed(self) -> Conversation:
        self.db.refresh(self.conversation)
        return self.conversation


@pytest.fixture
def turn(db: Session) -> Turn:
    conversation = conversation_service.resolve_or_create(
        db, phone_number=f"+1555{uuid.uuid4().int % 10**7:07d}"
    )
    return Turn(db=db, conversation=conversation, clock=Clock(), sleeps=[])


# --- tests -------------------------------------------------------------------------------------


def test_a_reply_is_recorded_queued_then_sent_with_its_sid(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("hi")

    outcome = turn.run([reply("Hello! How can I help?")])

    [message] = turn.bot_messages()
    assert outcome.kind == "replied"
    assert outcome.sent_message_ids == (message.id,)
    assert message.body == "Hello! How can I help?"
    assert message.status is MessageStatus.QUEUED
    assert [sent.body for sent in fake_twilio.sent] == ["Hello! How can I help?"]
    assert message.twilio_sid == fake_twilio.sent[0].sid
    assert fake_twilio.sent[0].to == turn.conversation.phone_number


def test_the_typing_indicator_is_shown_against_the_latest_inbound_message(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("hi")
    latest = turn.guardian_says("are you there?")

    turn.run([reply("Yes, I'm here.")])

    assert fake_twilio.typing_indicators == [latest.twilio_sid]


def test_a_failed_typing_indicator_does_not_stop_the_turn(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("hi")
    fake_twilio.fail_next_typing_indicator()

    outcome = turn.run([reply("Hello!")])

    assert outcome.kind == "replied"
    assert [sent.body for sent in fake_twilio.sent] == ["Hello!"]


def test_a_reply_goes_out_as_at_most_four_messages(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.guardian_says("answer in six separate messages")

    turn.run([reply("one\n\ntwo\n\nthree\n\nfour\n\nfive\n\nsix")])

    assert [sent.body for sent in fake_twilio.sent] == [
        "one",
        "two",
        "three",
        "four\n\nfive\n\nsix",
    ]


def test_each_paragraph_of_the_reply_is_its_own_message_in_order(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("done")

    turn.run([reply("Diego's first session is an evaluation.\n\n\n\nWould you like reminders?")])

    assert [m.body for m in turn.bot_messages()] == [
        "Diego's first session is an evaluation.",
        "Would you like reminders?",
    ]
    assert [sent.body for sent in fake_twilio.sent] == [
        "Diego's first session is an evaluation.",
        "Would you like reminders?",
    ]


def test_a_reply_echoing_a_private_value_saved_this_turn_is_marked_with_its_field(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    """A paragraph echoing the address ("Saved 12 Oak Street") is marked like the Guardian's
    message that gave it (spec §5); one that doesn't echo a value is not."""
    turn.guardian_says("12 Oak Street, gate code 1234")
    saved = ToolResult(
        status="ok",
        content={"home_id": "h1"},
        progress=True,
        redacted=(
            SavedValue(field=RedactedField.HOME_ADDRESS, text="12 Oak Street"),
            SavedValue(field=RedactedField.HOME_DIRECTIONS, text="gate code 1234"),
        ),
    )

    turn.run(
        [
            call(("create_home", {})),
            reply("Saved 12 oak street.\n\nWhat's your child's name?"),
        ],
        tools=(tool("create_home", lambda ctx, tool_input: saved),),
    )

    assert [m.redacted_fields for m in turn.bot_messages()] == [["home_address"], None]


def test_details_given_with_the_address_reach_the_next_turn_without_the_address(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    """The production Intake: once `create_home` saved the address, the next turn still saw
    the child's name, school, grade, the booking request and its own question (spec §5)."""
    turn.conversation = conversation_service.resolve_or_create(
        turn.db, phone_number=f"+1202555{uuid.uuid4().int % 10**4:04d}"
    )
    tools = bot_tools_profile.TOOLS
    another_parent = "Are any of your children already with us through another parent?"

    turn.guardian_says("I want to book a tutoring class for 2h Next friday for Sofia Reyes")
    turn.run([reply("Happy to help! What's your name and address?")], tools, bot_context_for)
    turn.guardian_says(
        "Laura Reyes\nAddress: 48 Maple Ave,\nApt 3B\nSchool: Lincoln Elementary\nGrade: 4"
    )
    turn.run(
        [
            call(
                ("create_guardian", {"name": "Laura Reyes"}),
                ("create_home", {"address": "48 Maple Ave, Apt 3B"}),
            ),
            reply(f"Thanks Laura, I saved your details.\n\n{another_parent}"),
        ],
        tools,
        bot_context_for,
    )
    turn.guardian_says("Nope")
    turn.run(
        [
            call(
                (
                    "create_child",
                    {"name": "Sofia Reyes", "school": "Lincoln Elementary", "grade": 4},
                )
            ),
            reply("Sofia is added."),
        ],
        tools,
        bot_context_for,
    )

    turn_input = turn.model.requests[0]["messages"][0]["content"]
    assert "Sofia Reyes" in turn_input
    assert "School: Lincoln Elementary" in turn_input
    assert "Grade: 4" in turn_input
    assert "next friday" in turn_input.lower()
    assert another_parent in turn_input
    assert "[the Home address: saved]" in turn_input
    assert "Maple" not in turn_input
    assert "3B" not in turn_input
    guardian_id = turn.refreshed().guardian_id
    [child] = turn.db.scalars(
        select(Child)
        .join(ChildGuardian, ChildGuardian.child_id == Child.id)
        .where(ChildGuardian.guardian_id == guardian_id)
    ).all()
    assert (child.name, child.school_name, child.grade_level) == (
        "Sofia Reyes",
        "Lincoln Elementary",
        4,
    )


def test_a_reply_after_no_private_save_is_not_marked(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.guardian_says("hi")

    turn.run([call(("list_subjects", {})), reply("We teach Maths.")], tools=(lookup(),))

    assert [m.redacted_fields for m in turn.bot_messages()] == [None]


def test_the_model_gets_the_prompt_the_tools_with_reply_and_one_user_message(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("hi")

    turn.run([reply("Hello!")], tools=(lookup(),))

    [request] = turn.model.requests
    assert request["system"] == SYSTEM_PROMPT
    assert [t["name"] for t in request["tools"]] == ["list_subjects", "reply"]
    [message] = request["messages"]
    assert message["role"] == "user"
    assert SNAPSHOT in message["content"]
    assert TRANSCRIPT in message["content"]
    # The whole turn's budget: the model client fits its attempt and retry inside it.
    assert request["timeout_s"] == pytest.approx(60)


def test_tool_results_are_fed_back_until_the_reply(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.guardian_says("what subjects?")

    turn.run([call(("list_subjects", {})), reply("Math and Reading.")], tools=(lookup(),))

    second = turn.model.requests[1]["messages"]
    assert [m["role"] for m in second] == ["user", "assistant", "user"]
    [result] = second[2]["content"]
    assert result["type"] == "tool_result"
    assert result["tool_use_id"] == second[1]["content"][0]["id"]
    assert '"done": true' in result["content"]
    assert [sent.body for sent in fake_twilio.sent] == ["Math and Reading."]


def test_an_end_turn_without_reply_sends_its_text_in_the_current_language(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.conversation.language = Language.ES
    turn.guardian_says("hola")

    turn.run([say("Hola, ¿en qué le puedo ayudar?")])

    assert [sent.body for sent in fake_twilio.sent] == ["Hola, ¿en qué le puedo ayudar?"]
    assert turn.refreshed().language is Language.ES


def test_the_conversation_language_follows_the_reply(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.conversation.language = Language.EN
    turn.guardian_says("hola")

    turn.run([reply("Hola.", language="es")])

    assert turn.refreshed().language is Language.ES


def test_a_reply_made_alongside_a_refused_call_is_not_sent_and_the_model_replies_again(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    refuse = tool(
        "propose",
        lambda ctx, tool_input: ToolResult(status="refused", content={"reason": "slot taken"}),
    )
    turn.guardian_says("book tuesday")

    turn.run(
        [
            call(("propose", {}), ("reply", {"text": "Should I book it?", "language": "en"})),
            reply("That time was just taken."),
        ],
        tools=(refuse,),
    )

    assert [sent.body for sent in fake_twilio.sent] == ["That time was just taken."]
    results = turn.model.requests[1]["messages"][2]["content"]
    assert len(results) == 2
    assert "slot taken" in results[0]["content"]
    assert "Not sent" in results[1]["content"]


def test_a_chat_taken_over_before_the_turn_starts_is_skipped(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("hi")
    conversation_service.claim(
        turn.db, conversation_id=turn.conversation.id, user_id=_staff(turn.db)
    )

    outcome = turn.run([reply("Hello!")])

    assert outcome == TurnOutcome(kind="skipped_takeover", sent_message_ids=())
    assert turn.model.requests == []
    assert fake_twilio.typing_indicators == []
    assert turn.bot_messages() == []


# --- propose -> commit -------------------------------------------------------------------------


def test_a_proposal_then_a_yes_commits_and_sends_the_confirmation_before_the_agent_line(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    family = _Family(turn.db)

    def propose(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        ctx.conversation.proposal_actions = [{"kind": "book"}]
        ctx.conversation.proposed_at = ctx.now
        ctx.db.flush()
        return ToolResult(status="ok", content={"summary": "Sam, Tuesday 4 PM"}, progress=True)

    def commit(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        booking_id = family.book()
        ctx.conversation.proposal_actions = None
        ctx.conversation.proposed_at = None
        ctx.db.flush()
        return ToolResult(
            status="ok",
            content={"committed": True},
            progress=True,
            committed=(CommittedAction(kind="book", booking_id=booking_id),),
        )

    tools = (tool("propose", propose), tool("commit_proposal", commit))
    turn.guardian_says("Can Sam do Tuesday at 4?")
    turn.run(
        [call(("propose", {})), reply("Tuesday at 4 PM with Ada works. Should I book it?")], tools
    )
    turn.guardian_says("yes please")

    outcome = turn.run([call(("commit_proposal", {})), reply("Anything else?")], tools)

    offer, confirmation, agent_line = turn.bot_messages()
    assert offer.body == "Tuesday at 4 PM with Ada works. Should I book it?"
    assert confirmation.body.startswith(
        "Your session is booked:\nTuesday, October 20, 4:00-5:00 PM"
    )
    assert agent_line.body == "Anything else?"
    assert outcome.sent_message_ids == (confirmation.id, agent_line.id)
    assert [sent.body for sent in fake_twilio.sent] == [
        offer.body,
        confirmation.body,
        agent_line.body,
    ]
    for message, sent in zip((confirmation, agent_line), fake_twilio.sent[1:], strict=True):
        assert message.status is MessageStatus.QUEUED
        assert message.twilio_sid == sent.sid
    assert turn.refreshed().proposal_actions is None


def test_an_offer_that_was_never_sent_drops_its_proposal(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("Can Sam do Tuesday at 4?")
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW, times=2)

    turn.run([call(("propose", {})), reply("Should I book it?")], (_propose_tool(),))

    conversation = turn.refreshed()
    assert conversation.proposal_actions is None
    assert conversation.proposed_at is None


def test_a_sent_offer_opens_its_proposal_after_the_send(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("Can Sam do Tuesday at 4?")

    turn.run([call(("propose", {})), reply("Should I book it?")], (_propose_tool(),))

    [offer] = turn.bot_messages()
    conversation = turn.refreshed()
    assert conversation.proposal_actions == [{"kind": "book"}]
    assert conversation.proposed_at is not None
    assert conversation.proposed_at > offer.created_at


def test_a_proposal_from_an_earlier_turn_keeps_its_stamp(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.conversation.proposal_actions = [{"kind": "book"}]
    turn.conversation.proposed_at = START
    turn.guardian_says("hmm, let me think")

    turn.run([reply("Take your time.")])

    assert turn.refreshed().proposed_at == START


def test_a_commit_with_an_empty_reply_sends_only_the_confirmation(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    family = _Family(turn.db)
    commit = tool(
        "commit_proposal",
        lambda ctx, tool_input: ToolResult(
            status="ok",
            content={},
            progress=True,
            committed=(CommittedAction(kind="book", booking_id=family.book()),),
        ),
    )
    turn.guardian_says("yes")

    turn.run([call(("commit_proposal", {})), reply("", language="es")], (commit,))

    [confirmation] = turn.bot_messages()
    assert confirmation.body.startswith("Su sesión está reservada:")


# --- outages -----------------------------------------------------------------------------------


def test_a_tool_exception_rolls_back_the_turn_flags_stuck_and_apologises_once(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    tools = (_save_guardian_tool(), tool("list_subjects", _raise))
    turn.guardian_says("I'm Maria")

    outcome = turn.run([call(("create_guardian", {})), call(("list_subjects", {}))], tools)

    [apology] = turn.bot_messages()
    conversation = turn.refreshed()
    assert outcome == TurnOutcome(kind="outage", sent_message_ids=(apology.id,))
    assert _guardians_named(turn.db, SAVED_NAME) == 0
    assert conversation.flag_reason is FlagReason.STUCK
    assert conversation.outage_apology_sent_at is not None
    assert apology.body == bot_messages.render("OUTAGE_APOLOGY", "en")
    assert [sent.body for sent in fake_twilio.sent] == [apology.body]
    assert apology.twilio_sid == fake_twilio.sent[0].sid


def test_the_apology_is_in_the_conversation_language(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.conversation.language = Language.ES
    turn.guardian_says("hola")

    turn.run([ModelUnavailable("down")])

    assert [sent.body for sent in fake_twilio.sent] == [bot_messages.render("OUTAGE_APOLOGY", "es")]


def test_a_second_failing_turn_sends_nothing_and_a_success_ends_the_stretch(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("hi")
    turn.run([ModelUnavailable("down")])
    turn.guardian_says("hello?")

    second = turn.run([ModelUnavailable("still down")])

    assert second == TurnOutcome(kind="silent_outage", sent_message_ids=())
    assert len(fake_twilio.sent) == 1
    assert turn.refreshed().flag_reason is FlagReason.STUCK

    turn.guardian_says("anyone?")
    third = turn.run([reply("Sorry for the wait. How can I help?")])

    assert third.kind == "replied"
    assert turn.refreshed().outage_apology_sent_at is None


def test_a_model_failure_after_its_retry_is_an_outage(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.guardian_says("hi")

    outcome = turn.run([ModelUnavailable("the Anthropic API timed out")])

    assert outcome.kind == "outage"
    assert turn.refreshed().flag_reason is FlagReason.STUCK


def test_a_turn_past_60_seconds_is_an_outage_and_its_saves_roll_back(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    def slow_save(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        result = _save_guardian(ctx, tool_input)
        turn.clock.advance(61)
        return result

    turn.guardian_says("I'm Maria")

    outcome = turn.run(
        [call(("create_guardian", {})), reply("Thanks, Maria.")],
        (tool("create_guardian", slow_save),),
    )

    assert outcome.kind == "outage"
    assert len(turn.model.requests) == 1
    assert _guardians_named(turn.db, SAVED_NAME) == 0
    assert [sent.body for sent in fake_twilio.sent] == [bot_messages.render("OUTAGE_APOLOGY", "en")]


def test_each_model_call_gets_at_most_the_time_left_in_the_turn(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    def slow_lookup(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        turn.clock.advance(55)
        return ToolResult(status="ok", content={})

    turn.guardian_says("hi")

    turn.run([call(("list_subjects", {})), reply("Hello")], (tool("list_subjects", slow_lookup),))

    assert turn.model.requests[1]["timeout_s"] == pytest.approx(5)


# --- send failures -----------------------------------------------------------------------------


def test_a_send_rejected_twice_is_failed_with_the_code_flags_stuck_and_keeps_the_saves(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("I'm Maria")
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW, times=2)

    outcome = turn.run(
        [call(("create_guardian", {})), reply("Thanks, Maria.")], (_save_guardian_tool(),)
    )

    [message] = turn.bot_messages()
    assert outcome.kind == "replied"
    assert message.status is MessageStatus.FAILED
    assert message.error_code == CODE_OUTSIDE_WINDOW
    assert message.twilio_sid is None
    assert turn.refreshed().flag_reason is FlagReason.STUCK
    assert _guardians_named(turn.db, SAVED_NAME) == 1
    assert turn.sleeps == [pytest.approx(3.0)]


def test_a_send_rejected_once_is_retried_and_succeeds(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.guardian_says("hi")
    fake_twilio.fail_next_with_timeout()

    turn.run([reply("Hello!")])

    [message] = turn.bot_messages()
    assert message.twilio_sid == fake_twilio.sent[0].sid
    assert turn.refreshed().flag_reason is None


def test_messages_after_a_failed_one_are_not_sent(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.guardian_says("done")
    fake_twilio.fail_next(code=CODE_OUTSIDE_WINDOW, times=2)

    turn.run([reply("First.\n\nSecond.")])

    first, second = turn.bot_messages()
    assert fake_twilio.sent == []
    assert (first.status, first.error_code) == (MessageStatus.FAILED, CODE_OUTSIDE_WINDOW)
    assert (second.status, second.error_code) == (MessageStatus.FAILED, None)


# --- the no-progress cap -----------------------------------------------------------------------


def test_the_cap_flags_didnt_understand_when_the_count_reaches_four(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.conversation.no_progress_count = 2
    turn.guardian_says("huh")
    turn.guardian_says("what")

    turn.run([call(("list_subjects", {})), reply("Sorry, could you say that again?")], (lookup(),))

    conversation = turn.refreshed()
    assert conversation.no_progress_count == 4
    assert conversation.flag_reason is FlagReason.DIDNT_UNDERSTAND
    assert [sent.body for sent in fake_twilio.sent] == ["Sorry, could you say that again?"]


def test_below_the_cap_nothing_is_flagged(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.conversation.no_progress_count = 2
    turn.guardian_says("huh")

    turn.run([reply("Sorry?")])

    conversation = turn.refreshed()
    assert conversation.no_progress_count == 3
    assert conversation.flag_reason is None


def test_the_cap_fires_once_per_stretch(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.conversation.no_progress_count = 4
    turn.guardian_says("huh")

    turn.run([reply("Sorry?")])

    conversation = turn.refreshed()
    assert conversation.no_progress_count == 5
    assert conversation.flag_reason is None


def test_progress_resets_the_count(turn: Turn, fake_twilio: FakeTwilio) -> None:
    turn.conversation.no_progress_count = 3
    turn.guardian_says("I'm Maria")

    turn.run([call(("create_guardian", {})), reply("Thanks, Maria.")], (_save_guardian_tool(),))

    conversation = turn.refreshed()
    assert conversation.no_progress_count == 0
    assert conversation.flag_reason is None


def test_only_guardian_messages_since_the_last_bot_reply_count_and_keywords_never_do(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    turn.guardian_says("old message")
    turn.run([reply("Hello")])
    turn.guardian_says("STOP")
    turn.guardian_says("huh")
    turn.conversation.no_progress_count = 0

    turn.run([reply("Sorry?")])

    assert turn.refreshed().no_progress_count == 1


# --- the Takeover race -------------------------------------------------------------------------


# --- helpers -----------------------------------------------------------------------------------

SAVED_NAME = "Maria Saved"


def test_create_guardian_links_the_chat_without_a_concurrent_change_warning(
    turn: Turn, fake_twilio: FakeTwilio, caplog: pytest.LogCaptureFixture
) -> None:
    """`create_client` links the locked row itself in the turn's transaction, and the tool links
    the turn's copy too: the same value from the same turn is not someone else's change."""
    turn.conversation = conversation_service.resolve_or_create(
        turn.db, phone_number=f"+120255501{uuid.uuid4().int % 100:02d}"
    )
    create_guardian = next(
        spec for spec in bot_tools_profile.TOOLS if spec.name == "create_guardian"
    )

    with caplog.at_level(logging.DEBUG, logger=bot_turn.__name__):
        turn.run(
            [call(("create_guardian", {"name": "Maria Lopez"})), reply("Hi Maria")],
            (create_guardian,),
        )

    guardian_id = turn.refreshed().guardian_id
    assert guardian_id is not None
    assert turn.db.get_one(Guardian, guardian_id).name == "Maria Lopez"
    assert not [r for r in caplog.records if "concurrent change" in r.getMessage()]


def test_a_column_someone_else_changed_mid_turn_keeps_their_value_and_warns(
    turn: Turn, fake_twilio: FakeTwilio, caplog: pytest.LogCaptureFixture
) -> None:
    staff_value = Language.ES

    def language_changed_meanwhile(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        ctx.conversation.no_progress_count = 3
        row = ctx.db.get_one(Conversation, ctx.conversation.id)
        row.no_progress_count = 2
        row.language = staff_value
        ctx.db.flush()
        return ToolResult(status="ok", content={})

    with caplog.at_level(logging.WARNING, logger=bot_turn.__name__):
        turn.run(
            [call(("list_subjects", {})), reply("Hola", "es")],
            (tool("list_subjects", language_changed_meanwhile),),
        )

    assert [r.getMessage() for r in caplog.records if "concurrent change" in r.getMessage()] == [
        f"bot turn on conversation {turn.conversation.id} kept a concurrent change to "
        "no_progress_count"
    ]


@pytest.mark.parametrize(
    "malformed",
    [
        pytest.param({"actions": '[{"kind": "book"}]'}, id="actions as JSON text"),
        pytest.param({"actions": ["book"]}, id="actions items as strings"),
        pytest.param(
            {"book": ["book"], "cancel": [], "reschedule": []}, id="book items as strings"
        ),
        pytest.param({"book": "oops", "cancel": [], "reschedule": []}, id="book as plain text"),
    ],
)
def test_a_malformed_propose_is_refused_back_to_the_model_not_an_outage(
    turn: Turn, fake_twilio: FakeTwilio, malformed: dict[str, Any]
) -> None:
    """The eval's Haiku run sent `actions` items as strings, which raised and became an outage."""
    turn.guardian_says("book math for ana on monday")

    outcome = turn.run(
        [call(("propose", malformed)), reply("Which time would you like?")],
        (bot_tools_booking.PROPOSE,),
    )

    assert outcome.kind == "replied"
    [result] = turn.model.requests[1]["messages"][2]["content"]
    content = json.loads(result["content"])
    assert content["reason"] == "invalid_input"
    assert content["problems"][0]["expected"]
    assert [sent.body for sent in fake_twilio.sent] == ["Which time would you like?"]


def test_a_refused_propose_then_a_fixed_one_replies_in_the_same_turn(
    turn: Turn, fake_twilio: FakeTwilio
) -> None:
    """Every problem is named in the first refusal, so one retry is enough."""
    turn.guardian_says("book math for ana on monday")
    fixed = {"book": [], "cancel": [], "reschedule": []}
    propose_calls: list[dict[str, Any]] = []

    def propose(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
        propose_calls.append(tool_input)
        return (
            bot_tools_booking.PROPOSE.run(ctx, tool_input)
            if len(propose_calls) == 1
            else ok(progress=True)(ctx, tool_input)
        )

    outcome = turn.run(
        [
            call(("propose", {"book": [{"date": "Monday", "start_time": "4pm"}]})),
            call(("propose", fixed)),
            reply("Should I book it?"),
        ],
        (tool("propose", propose),),
    )

    assert outcome.kind == "replied"
    assert len(turn.model.requests) == 3
    refusal = json.loads(turn.model.requests[1]["messages"][2]["content"][0]["content"])
    assert {problem["at"] for problem in refusal["problems"]} >= {
        "book[0].child_id",
        "book[0].date",
        "book[0].start_time",
        "book[0].location",
    }


def _save_guardian(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
    ctx.db.add(Guardian(name=SAVED_NAME, phone_number=ctx.conversation.phone_number))
    ctx.db.flush()
    return ToolResult(status="ok", content={"saved": True}, progress=True)


def _propose(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
    ctx.conversation.proposal_actions = [{"kind": "book"}]
    ctx.conversation.proposed_at = ctx.now
    ctx.db.flush()
    return ToolResult(status="ok", content={"summary": "Sam, Tuesday 4 PM"}, progress=True)


def _propose_tool() -> ToolSpec:
    return tool("propose", _propose)


def _save_guardian_tool() -> ToolSpec:
    return tool("create_guardian", _save_guardian)


def _raise(ctx: ToolContext, tool_input: dict[str, Any]) -> ToolResult:
    raise RuntimeError("database went away")


def _guardians_named(db: Session, name: str) -> int:
    return len(list(db.scalars(select(Guardian).where(Guardian.name == name))))


def _staff(db: Session) -> uuid.UUID:
    suffix = uuid.uuid4().hex[:10]
    user = User(email=f"staff-{suffix}@example.com", name="Laura", role=UserRole.ADMIN)
    db.add(user)
    db.flush()
    return user.id


class _Family:
    """A Guardian, Child, Subject and Home that a fake commit can book against."""

    def __init__(self, db: Session) -> None:
        suffix = uuid.uuid4().hex[:10]
        self.db = db
        self.guardian = Guardian(name="Ada Guardian", phone_number=f"+1{suffix}")
        self.child = Child(
            name="Sam", date_of_birth=datetime.date(2014, 5, 2), grade_level=7, school_name="S"
        )
        self.subject = Subject(name=f"Math {suffix}", name_es=f"Matemáticas {suffix}")
        self.home = Home(label="Ada's", address="1 Test Street")
        db.add_all([self.guardian, self.child, self.subject, self.home])
        db.flush()
        db.add(ChildGuardian(child_id=self.child.id, guardian_id=self.guardian.id))
        db.add(GuardianHome(guardian_id=self.guardian.id, home_id=self.home.id))
        db.flush()

    def book(self) -> uuid.UUID:
        suffix = uuid.uuid4().hex[:10]
        tutor = Tutor(
            user=User(email=f"t-{suffix}@example.com", name="Ada Lovelace", role=UserRole.TUTOR),
            phone_number=f"+1{suffix}",
        )
        self.db.add(tutor)
        self.db.flush()
        booking = Booking(
            child_id=self.child.id,
            user_id=tutor.user_id,
            kind=BookingKind.REGULAR,
            location=BookingLocation.HOME,
            subject_id=self.subject.id,
            home_id=self.home.id,
            booked_by_guardian_id=self.guardian.id,
            scheduled_date=SESSION_DATE,
            start_time=datetime.time(16, 0),
            end_time=datetime.time(17, 0),
            status=BookingStatus.CONFIRMED,
        )
        self.db.add(booking)
        self.db.flush()
        return booking.id
