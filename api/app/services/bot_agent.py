"""The production wiring of the bot agent (docs/specs/whatsapp-bot-agent.md §2, §7): which model,
tools, prompt and context builder a turn runs with.

`bot_turn.take_turn` takes all of them in `TurnDeps`, so tests build their own with a scripted
model. This module is the one place the real ones are put together, for `main.py`'s worker.

**A missing `ANTHROPIC_API_KEY` doesn't stop the API.** Development and CI run without one. The
worker still starts, and every turn is an outage: the chat is flagged "Bot got stuck" and the
Guardian gets the fixed apology once, so the office sees the problem in the inbox, not only in
the logs.

**The worker warms the model up** when it starts (`start_warm_up`): one request with the real
tools and system prompt, on a background thread, so the first Guardian after a deploy doesn't
wait on the API compiling a changed tool schema. It never blocks or fails start-up, and is
skipped without an API key.
"""

import logging
import threading
import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.services import bot_context, bot_prompt, bot_tools_booking, bot_tools_profile, bot_turn
from app.services.bot_model import (
    ModelClient,
    ModelNotConfigured,
    ModelResponse,
    ModelUnavailable,
    build_model_client,
)
from app.services.bot_turn import TurnDeps, TurnOutcome

logger = logging.getLogger(__name__)


class UnconfiguredModel:
    """The model when no API key is set: every call is unavailable, so every turn is an
    outage."""

    def create(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        timeout_s: float,
    ) -> ModelResponse:
        raise ModelUnavailable("anthropic_api_key is unset")

    def warm_up(self, *, system: str, tools: list[dict[str, Any]]) -> float | None:
        logger.info("bot model warm-up skipped: ANTHROPIC_API_KEY is unset")
        return None


def default_deps() -> TurnDeps:
    """The real model, every agent tool, the cached system prompt and the per-turn context."""
    return TurnDeps(
        model=_model(get_settings()),
        tools=bot_tools_profile.TOOLS + bot_tools_booking.TOOLS,
        system_prompt=bot_prompt.system_prompt,
        build_context=bot_context.build_turn_context,
    )


def turn_runner(deps: TurnDeps) -> Callable[[Session, uuid.UUID], TurnOutcome]:
    """`take_turn` bound to `deps`, in the shape `bot_worker` calls it."""

    def run(db: Session, conversation_id: uuid.UUID) -> TurnOutcome:
        return bot_turn.take_turn(db, conversation_id=conversation_id, deps=deps)

    return run


def warm_up(deps: TurnDeps) -> float | None:
    """Send `deps.model` one request with the tools and system prompt a turn sends. Returns the
    seconds it took, or None when it was skipped or failed; never raises."""
    seconds = None
    try:
        seconds = deps.model.warm_up(
            system=deps.system_prompt(), tools=bot_turn.tool_definitions(deps.tools)
        )
    except Exception:
        # A bug, not an outage: logged so it's seen, and start-up goes on.
        logger.exception("bot model warm-up crashed")

    return seconds


def start_warm_up(deps: TurnDeps) -> threading.Thread:
    """`warm_up` on a daemon thread, so start-up doesn't wait for it and shutdown doesn't
    either."""
    thread = threading.Thread(target=warm_up, args=(deps,), name="bot-model-warm-up", daemon=True)
    thread.start()
    return thread


def _model(settings: Settings) -> ModelClient:
    try:
        model: ModelClient = build_model_client(settings)
    except ModelNotConfigured:
        logger.error("ANTHROPIC_API_KEY is unset: every bot turn will be an outage until it is")
        model = UnconfiguredModel()

    return model
