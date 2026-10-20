"""One bot agent turn for one chat (docs/specs/whatsapp-bot-agent.md §2, §4, §6, §7).

`take_turn` is generic: the model, tools, system prompt and context builder arrive in
`TurnDeps`, so the loop is tested with a scripted model and fake tools.

**The row lock is taken only at the start and the end** (Franklin, round 1 of ticket 10). The
webhook and Takeover write the conversation row, and must never wait on a model call. So the
turn locks the row briefly to read it, then lets go. The tools work on a detached copy of the
row (`ToolContext.conversation`), and their changes to it are applied under the lock at the
end. A column someone else changed meanwhile keeps their value. One turn per chat at a time is
the worker's per-chat advisory lock (`bot_worker`), held across the whole of `take_turn`,
sending and settling the proposal included: the proposal "yes" rule relies on it.

**One transaction for the saves.** Every save the tools make joins one transaction, committed
with the reply. An outage (the model failing after its retry, a tool raising, the 60 s cap, or
a database error such as a deadlock while recording the reply) rolls all of it back. A fresh
transaction then flags "Bot got stuck" and, once per outage stretch, records the fixed apology.

**The Takeover check** runs under the end lock, right before the reply is recorded and sent: a
chat Taken over during the turn drops the reply. The turn's saves stay.

**Send after commit.** Replies are recorded `queued` and sent only once committed, so a reply
the process dies before sending is still a line in the thread. A send that fails twice is
marked failed and flags "Bot got stuck"; the turn's saves stay.

**A proposal opens for a yes only once its offer is sent.** `commit_proposal` takes a Guardian
message newer than `proposed_at` as the yes. So a proposal made this turn is stamped after its
offer is accepted by Twilio. A message the Guardian wrote earlier, mid-turn included, can't
count. If the offer never went out, the proposal is dropped.

**The agent ends a turn with `reply(text, language)`.** The text is split on blank lines, and
each paragraph goes out as its own WhatsApp message, at most `MAX_REPLY_MESSAGES`. A commit's
fixed confirmation goes first.
"""

import copy
import datetime
import json
import logging
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from sqlalchemy import inspect, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    Language,
    MessageAuthor,
    RedactedField,
)
from app.models.message import Message
from app.services import bot_messages, conversation_service, message_service
from app.services.bot_model import ModelClient, ModelResponse, ModelUnavailable, ToolCall
from app.services.bot_tool_contract import ToolContext, ToolResult, ToolSpec
from app.services.twilio_service import (
    TwilioSendFailed,
    TwilioServiceError,
    send_typing_indicator,
    send_whatsapp_message,
)

TURN_CAP_SECONDS = 60.0
# A backstop for a model that never calls `reply`; the time cap stops a slow one first.
MAX_MODEL_CALLS = 10
NO_PROGRESS_CAP = 4
# The first try and one retry, a few seconds apart.
SEND_ATTEMPTS = 2
SEND_RETRY_DELAY_SECONDS = 3.0
# One indicator lasts about 25 s.
TYPING_RENEW_SECONDS = 20.0
PARAGRAPH_BREAK = "\n\n"
# A Guardian can't make the bot flood their number: later paragraphs join the last message.
MAX_REPLY_MESSAGES = 4

REPLY_TOOL_NAME = "reply"
REPLY_LANGUAGES = tuple(language.value for language in Language)
REPLY_TOOL = {
    "name": REPLY_TOOL_NAME,
    "description": (
        "Send your reply to the Guardian and end the turn. `text` is what the Guardian reads; "
        "separate messages with a blank line. `language` is the language of the Guardian's "
        "latest message."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "language": {"type": "string", "enum": list(REPLY_LANGUAGES)},
        },
        "required": ["text", "language"],
        "additionalProperties": False,
    },
}
UNKNOWN_TOOL_RESULT = {"reason": "There is no tool with that name."}
# Sent back for a `reply` made alongside a refused tool call: it was written before the refusal.
REPLY_NOT_SENT_RESULT = {
    "reason": "Not sent: a tool call in the same step was refused. Reply again with its result."
}

logger = logging.getLogger(__name__)


class TurnContext(Protocol):
    """What `build_context` returns (`bot_context.TurnContext`)."""

    @property
    def snapshot(self) -> str: ...

    @property
    def transcript(self) -> str: ...


def _utc_now() -> datetime.datetime:
    return datetime.datetime.now(tz=datetime.UTC)


@dataclass(frozen=True)
class TurnDeps:
    model: ModelClient
    tools: tuple[ToolSpec, ...]
    system_prompt: Callable[[], str]
    build_context: Callable[..., TurnContext]
    # Injected so tests can pass the 60 s cap and skip the send retry's wait.
    clock: Callable[[], datetime.datetime] = _utc_now
    sleep: Callable[[float], None] = time.sleep


@dataclass(frozen=True)
class TurnOutcome:
    kind: Literal["replied", "outage", "skipped_takeover", "silent_outage"]
    sent_message_ids: tuple[uuid.UUID, ...]


class _Outage(Exception):
    """The turn can't finish: the model failed after its retry, a tool raised, or the cap hit."""


@dataclass(frozen=True)
class _AgentReply:
    text: str
    language: Language
    results: tuple[ToolResult, ...]


@dataclass(frozen=True)
class _TurnStart:
    """What the turn read under its start lock."""

    # The detached copy the tools change; never added to the session.
    working: Conversation
    # The row's column values at the start, to tell the tools' changes from everyone else's.
    baseline: dict[str, Any]
    inbound_sid: str | None


@dataclass(frozen=True)
class _Recorded:
    outcome: TurnOutcome
    # The `proposed_at` committed for a proposal made this turn, settled after the send.
    new_proposal_at: datetime.datetime | None = None


@dataclass
class _Loop:
    """The running conversation with the model inside one turn."""

    db: Session
    conversation: Conversation
    deps: TurnDeps
    started_at: datetime.datetime
    tools_by_name: dict[str, ToolSpec]
    messages: list[dict[str, Any]]
    results: list[ToolResult] = field(default_factory=list)


_COLUMN_KEYS = tuple(column.key for column in inspect(Conversation).column_attrs)


def take_turn(db: Session, *, conversation_id: uuid.UUID, deps: TurnDeps) -> TurnOutcome:
    """Run one turn for the chat and send its reply. Commits; the caller passes a session with
    no transaction of its own in flight, and holds the chat's advisory lock."""
    started_at = deps.clock()
    start = _start_turn(db, conversation_id=conversation_id)
    if start is None:
        return TurnOutcome(kind="skipped_takeover", sent_message_ids=())

    with _typing_indicator(start.inbound_sid, conversation_id):
        try:
            recorded = _record_reply(db, start, _run_agent(db, start.working, deps, started_at))
        except _Outage as exc:
            logger.error("bot turn on conversation %s is an outage: %s", conversation_id, exc)
            recorded = _outage(db, conversation_id=conversation_id, deps=deps)
        except DBAPIError as exc:
            # A deadlock or lock timeout at the end lock (a number change racing the turn, for
            # one). No statement text: it can quote the Guardian's data.
            logger.error(
                "bot turn on conversation %s is an outage: database error %s",
                conversation_id,
                type(exc.orig).__name__,
            )
            recorded = _outage(db, conversation_id=conversation_id, deps=deps)

        is_delivered = _send(
            db,
            conversation_id=conversation_id,
            message_ids=recorded.outcome.sent_message_ids,
            deps=deps,
        )
        if recorded.new_proposal_at is not None:
            _settle_proposal(
                db,
                conversation_id=conversation_id,
                committed_at=recorded.new_proposal_at,
                is_offer_sent=is_delivered,
            )

    return recorded.outcome


def _outage(db: Session, *, conversation_id: uuid.UUID, deps: TurnDeps) -> _Recorded:
    db.rollback()
    return _Recorded(_record_outage(db, conversation_id=conversation_id, deps=deps))


def _start_turn(db: Session, *, conversation_id: uuid.UUID) -> _TurnStart | None:
    """Read the row under a brief lock and let go; `None` when the chat is Taken over."""
    row = conversation_service.lock(db, conversation_id=conversation_id)
    start = None
    if row.status is ConversationStatus.BOT:
        baseline = {key: copy.deepcopy(getattr(row, key)) for key in _COLUMN_KEYS}
        start = _TurnStart(
            working=Conversation(**copy.deepcopy(baseline)),
            baseline=baseline,
            inbound_sid=_latest_inbound_sid(db, row),
        )
    # Nothing was written: ending the transaction releases the lock before any model call.
    db.rollback()
    return start


# --- the agent loop ----------------------------------------------------------------------------


def _run_agent(
    db: Session, conversation: Conversation, deps: TurnDeps, started_at: datetime.datetime
) -> _AgentReply:
    context = deps.build_context(db, conversation=conversation, now=started_at)
    loop = _Loop(
        db=db,
        conversation=conversation,
        deps=deps,
        started_at=started_at,
        tools_by_name={spec.name: spec for spec in deps.tools},
        messages=[{"role": "user", "content": _turn_input(context)}],
    )
    definitions = [
        {"name": spec.name, "description": spec.description, "input_schema": spec.input_schema}
        for spec in deps.tools
    ] + [REPLY_TOOL]

    for _ in range(MAX_MODEL_CALLS):
        response = _call_model(loop, definitions)
        agent_reply = _act_on(loop, response)
        if agent_reply is not None:
            return agent_reply

    raise _Outage(f"no reply after {MAX_MODEL_CALLS} model calls")


def _turn_input(context: TurnContext) -> str:
    return f"## Guardian snapshot\n{context.snapshot}\n\n## Chat history\n{context.transcript}"


def _call_model(loop: _Loop, definitions: list[dict[str, Any]]) -> ModelResponse:
    try:
        # The whole time left: the model client fits its attempt and retry inside it.
        response = loop.deps.model.create(
            system=loop.deps.system_prompt(),
            tools=definitions,
            messages=loop.messages,
            timeout_s=_seconds_left(loop),
        )
    except ModelUnavailable as exc:
        raise _Outage(f"model unavailable: {exc}") from exc

    usage = response.usage
    logger.info(
        "bot model call on conversation %s: stop %s, input %s, output %s, cache read %s, "
        "cache write %s",
        loop.conversation.id,
        response.stop_reason,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
    )
    _check_cap(loop)
    return response


def _act_on(loop: _Loop, response: ModelResponse) -> _AgentReply | None:
    """Run the response's tool calls. The reply when the turn is over, else `None` with the
    results appended for the next call."""
    reply_call = next((c for c in response.tool_calls if c.name == REPLY_TOOL_NAME), None)
    other_calls = [c for c in response.tool_calls if c.name != REPLY_TOOL_NAME]

    if not response.tool_calls:
        # An end_turn without `reply`: its text is the reply.
        return _AgentReply(
            text=response.text,
            language=_current_language(loop.conversation),
            results=tuple(loop.results),
        )

    tool_results = [_run_tool(loop, c) for c in other_calls]
    is_any_refused = any(result is None or result.status == "refused" for result in tool_results)

    agent_reply = None
    if reply_call is not None and not is_any_refused:
        agent_reply = _reply_from(loop, reply_call)
    else:
        result_blocks = [
            _result_block(c.id, UNKNOWN_TOOL_RESULT if result is None else result.content)
            for c, result in zip(other_calls, tool_results, strict=True)
        ]
        if reply_call is not None:
            result_blocks.append(_result_block(reply_call.id, REPLY_NOT_SENT_RESULT))
        loop.messages = [
            *loop.messages,
            {"role": "assistant", "content": list(response.assistant_content)},
            {"role": "user", "content": result_blocks},
        ]
    return agent_reply


def _run_tool(loop: _Loop, tool_call: ToolCall) -> ToolResult | None:
    """Run one tool; `None` for a name no tool has. Any exception is an outage."""
    spec = loop.tools_by_name.get(tool_call.name)
    if spec is None:
        logger.warning(
            "bot called unknown tool %s on conversation %s", tool_call.name, loop.conversation.id
        )
        return None

    context = ToolContext(db=loop.db, conversation=loop.conversation, now=loop.started_at)
    try:
        result = spec.run(context, tool_call.input)
    except Exception as exc:
        logger.exception(
            "bot tool %s raised on conversation %s", tool_call.name, loop.conversation.id
        )
        raise _Outage(f"tool {tool_call.name} raised {type(exc).__name__}") from exc

    # Field names only: tool inputs and results carry addresses, notes and phone numbers.
    logger.info(
        "bot tool %s on conversation %s: input fields %s, status %s, progress %s, reason %s",
        tool_call.name,
        loop.conversation.id,
        sorted(tool_call.input),
        result.status,
        result.progress,
        result.content.get("reason") if result.status == "refused" else None,
    )
    loop.results.append(result)
    _check_cap(loop)
    return result


def _result_block(tool_use_id: str, content: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": json.dumps(content, sort_keys=True, default=str),
    }


def _reply_from(loop: _Loop, reply_call: ToolCall) -> _AgentReply:
    language = reply_call.input.get("language")
    return _AgentReply(
        text=str(reply_call.input.get("text", "")),
        language=Language(language)
        if language in REPLY_LANGUAGES
        else _current_language(loop.conversation),
        results=tuple(loop.results),
    )


def _current_language(conversation: Conversation) -> Language:
    return conversation.language or Language.EN


def _seconds_left(loop: _Loop) -> float:
    elapsed = (loop.deps.clock() - loop.started_at).total_seconds()
    return TURN_CAP_SECONDS - elapsed


def _check_cap(loop: _Loop) -> None:
    if _seconds_left(loop) <= 0:
        raise _Outage(f"turn passed the {TURN_CAP_SECONDS:.0f} s cap")


# --- recording ---------------------------------------------------------------------------------


def _record_reply(db: Session, start: _TurnStart, agent_reply: _AgentReply) -> _Recorded:
    """Under the end lock: apply the tools' changes, the progress cap and language, then the
    Takeover check, then the confirmation and reply recorded `queued`. One commit with the
    turn's saves."""
    row = conversation_service.lock(db, conversation_id=start.working.id)
    _apply_tool_changes(row, start)
    _count_progress(db, row, agent_reply.results)
    conversation_service.set_language(db, conversation=row, language=agent_reply.language)
    # A model call succeeded, so any outage stretch is over.
    row.outage_apology_sent_at = None
    db.flush()

    if row.status is ConversationStatus.HUMAN:
        db.commit()
        recorded = _Recorded(TurnOutcome(kind="skipped_takeover", sent_message_ids=()))
    else:
        confirmation, paragraphs = _reply_bodies(db, agent_reply)
        # The reply may echo a private value saved this turn, so it is marked like the
        # Guardian's message that gave it (spec §5). The fixed confirmation never does.
        redacted = tuple(field for result in agent_reply.results for field in result.redacted)
        bodies: list[tuple[str, tuple[RedactedField, ...]]] = [
            *([] if confirmation is None else [(confirmation, ())]),
            *((body, redacted) for body in paragraphs),
        ]
        messages = [
            message_service.record_bot_reply(
                db, conversation=row, body=body, redacted_fields=fields
            )
            for body, fields in bodies
        ]
        new_proposal_at = _hold_new_proposal(db, row, start)
        db.commit()
        recorded = _Recorded(
            TurnOutcome(kind="replied", sent_message_ids=tuple(m.id for m in messages)),
            new_proposal_at=new_proposal_at,
        )
    return recorded


def _apply_tool_changes(row: Conversation, start: _TurnStart) -> None:
    """Copy each column the tools changed on the working copy onto the locked row, unless
    someone else changed that column during the turn: their write stands."""
    for key, before in start.baseline.items():
        after = getattr(start.working, key)
        if after == before:
            continue
        if getattr(row, key) != before:
            logger.warning(
                "bot turn on conversation %s kept a concurrent change to %s", row.id, key
            )
            continue
        setattr(row, key, after)


def _reply_bodies(db: Session, agent_reply: _AgentReply) -> tuple[str | None, list[str]]:
    """The commit confirmation, if anything was committed, and the reply's paragraphs, at most
    `MAX_REPLY_MESSAGES`."""
    paragraphs = [part.strip() for part in agent_reply.text.split(PARAGRAPH_BREAK) if part.strip()]
    if len(paragraphs) > MAX_REPLY_MESSAGES:
        kept = MAX_REPLY_MESSAGES - 1
        paragraphs = [*paragraphs[:kept], PARAGRAPH_BREAK.join(paragraphs[kept:])]

    committed = [action for result in agent_reply.results for action in result.committed]
    confirmation = (
        bot_messages.commit_confirmation(
            db,
            committed=[(action.kind, action.booking_id) for action in committed],
            language=agent_reply.language.value,
        )
        if committed
        else None
    )
    return confirmation, paragraphs


def _hold_new_proposal(
    db: Session, row: Conversation, start: _TurnStart
) -> datetime.datetime | None:
    """A proposal made this turn is stamped now, so nothing the Guardian wrote during the turn
    is newer; `_settle_proposal` re-stamps it once the offer is sent. Its stamp, or `None`.

    Wall-clock time: the clock `message_service` stamps `messages.created_at` with.
    """
    stamp = None
    is_new_proposal = (
        row.proposed_at is not None and row.proposed_at != start.baseline["proposed_at"]
    )
    if is_new_proposal:
        stamp = datetime.datetime.now(tz=datetime.UTC)
        row.proposed_at = stamp
        db.flush()
    return stamp


def _settle_proposal(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    committed_at: datetime.datetime,
    is_offer_sent: bool,
) -> None:
    """After the send: open the proposal for a yes from now on, or drop it if its offer never
    went out. Untouched if it was replaced or dropped meanwhile (a Hand-back)."""
    row = conversation_service.lock(db, conversation_id=conversation_id)
    if row.proposed_at == committed_at:
        if is_offer_sent:
            row.proposed_at = datetime.datetime.now(tz=datetime.UTC)
        else:
            row.proposal_actions = None
            row.proposed_at = None
        db.flush()
    db.commit()


def _count_progress(
    db: Session, conversation: Conversation, results: tuple[ToolResult, ...]
) -> None:
    """The no-progress cap (§6): progress resets the count; otherwise each Guardian message this
    turn answers adds one, and crossing the cap flags "Bot didn't understand" once."""
    previous = conversation.no_progress_count
    if any(result.progress for result in results):
        count = 0
    else:
        count = previous + _guardian_messages_answered(db, conversation)

    if previous < NO_PROGRESS_CAP <= count:
        conversation_service.flag(db, conversation=conversation, reason=FlagReason.DIDNT_UNDERSTAND)
    conversation.no_progress_count = count
    db.flush()


def _guardian_messages_answered(db: Session, conversation: Conversation) -> int:
    """Guardian messages since the last bot reply, keywords aside: STOP and START are answered
    by code and never start a turn."""
    last_bot_reply_at = db.scalar(
        select(Message.created_at)
        .where(
            Message.conversation_id == conversation.id,
            Message.author_kind == MessageAuthor.BOT,
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    query = select(Message.body).where(
        Message.conversation_id == conversation.id, Message.author_kind == MessageAuthor.CLIENT
    )
    if last_bot_reply_at is not None:
        query = query.where(Message.created_at > last_bot_reply_at)

    return sum(
        1
        for body in db.scalars(query)
        if not (bot_messages.is_stop_keyword(body) or bot_messages.is_start_keyword(body))
    )


def _record_outage(db: Session, *, conversation_id: uuid.UUID, deps: TurnDeps) -> TurnOutcome:
    """In a fresh transaction: flag "Bot got stuck" and, once per outage stretch, record the
    fixed apology. A chat taken over meanwhile gets no apology: the office is talking."""
    conversation = conversation_service.lock(db, conversation_id=conversation_id)
    conversation_service.flag(db, conversation=conversation, reason=FlagReason.STUCK)

    is_first_failure = conversation.outage_apology_sent_at is None
    is_with_bot = conversation.status is ConversationStatus.BOT
    if is_first_failure and is_with_bot:
        apology = message_service.record_bot_reply(
            db,
            conversation=conversation,
            body=bot_messages.render("OUTAGE_APOLOGY", _current_language(conversation).value),
        )
        conversation.outage_apology_sent_at = deps.clock()
        outcome = TurnOutcome(kind="outage", sent_message_ids=(apology.id,))
    else:
        outcome = TurnOutcome(kind="silent_outage", sent_message_ids=())

    db.commit()
    return outcome


# --- sending -----------------------------------------------------------------------------------


def _send(
    db: Session, *, conversation_id: uuid.UUID, message_ids: tuple[uuid.UUID, ...], deps: TurnDeps
) -> bool:
    """Send the committed `queued` messages in order; whether all went out. The first that
    fails twice is marked failed with Twilio's code and flags "Bot got stuck". The rest are
    marked failed unsent, since they'd arrive without what came before them."""
    phone_number = db.get_one(Conversation, conversation_id).phone_number
    messages = [db.get_one(Message, message_id) for message_id in message_ids]

    is_delivered = True
    for index, message in enumerate(messages):
        twilio_sid, error_code = _send_with_retry(phone_number, message, deps)
        if twilio_sid is not None:
            message_service.attach_twilio_sid(db, message=message, twilio_sid=twilio_sid)
            db.commit()
            continue

        is_delivered = False
        conversation = conversation_service.lock(db, conversation_id=conversation_id)
        message_service.mark_failed(db, message=message, error_code=error_code)
        for unsent in messages[index + 1 :]:
            message_service.mark_failed(db, message=unsent, error_code=None)
        conversation_service.flag(db, conversation=conversation, reason=FlagReason.STUCK)
        db.commit()
        break
    return is_delivered


def _send_with_retry(
    phone_number: str, message: Message, deps: TurnDeps
) -> tuple[str | None, str | None]:
    """`(sid, None)` once Twilio accepts, or `(None, code)` after the retry also fails."""
    twilio_sid: str | None = None
    error_code: str | None = None
    for attempt in range(SEND_ATTEMPTS):
        if attempt:
            deps.sleep(SEND_RETRY_DELAY_SECONDS)
        try:
            twilio_sid = send_whatsapp_message(to=phone_number, body=message.body)
        except TwilioServiceError as exc:
            error_code = exc.code if isinstance(exc, TwilioSendFailed) else None
            # No traceback: the chained Twilio error quotes the Guardian's number.
            logger.warning(
                "bot message %s on conversation %s was not sent (attempt %s): %s (code %s)",
                message.id,
                message.conversation_id,
                attempt + 1,
                exc,
                error_code,
            )
        else:
            error_code = None
            break

    if twilio_sid is None:
        logger.error("bot message %s failed twice; flagging the chat", message.id)
    return twilio_sid, error_code


# --- typing indicator --------------------------------------------------------------------------


def _latest_inbound_sid(db: Session, conversation: Conversation) -> str | None:
    return db.scalar(
        select(Message.twilio_sid)
        .where(
            Message.conversation_id == conversation.id,
            Message.author_kind == MessageAuthor.CLIENT,
            Message.twilio_sid.is_not(None),
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )


@contextmanager
def _typing_indicator(message_sid: str | None, conversation_id: uuid.UUID) -> Iterator[None]:
    """Show the typing indicator now and renew it every `TYPING_RENEW_SECONDS` until the block
    ends. A failure is logged and ignored: it is cosmetic."""
    if message_sid is None:
        yield
        return

    def show() -> None:
        try:
            send_typing_indicator(message_sid=message_sid)
        except TwilioServiceError as exc:
            logger.warning(
                "typing indicator on conversation %s was not shown: %s", conversation_id, exc
            )

    stopped = threading.Event()

    def renew() -> None:
        while not stopped.wait(TYPING_RENEW_SECONDS):
            show()

    show()
    renewer = threading.Thread(target=renew, daemon=True)
    renewer.start()
    try:
        yield
    finally:
        stopped.set()
        renewer.join()
