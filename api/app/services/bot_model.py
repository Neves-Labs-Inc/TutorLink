"""The model seam for the bot agent: what a turn asks of a model, and the Anthropic adapter.

`bot_turn` talks only to `ModelClient`, so tests drive it with a scripted fake and CI never calls
the API. `AnthropicModelClient` is the one real adapter (docs/specs/whatsapp-bot-agent.md §2):

- **Prompt caching:** one breakpoint on the system prompt. The API renders `tools`, then
  `system`, then `messages`, so the breakpoint caches the tool definitions and the system prompt
  together, and the per-turn snapshot and transcript (the first user message) come after it.
- **Strict tools** with `tool_choice: auto`.
- **Timeout and retry:** `timeout_s` is the whole budget for the call, retry included, so the
  turn's 60 s cap holds. A turn's first call (its `messages` hold only the turn input) gives its
  first attempt up to `FIRST_ATTEMPT_TIMEOUT_SECONDS`: the first request after a deploy that
  changed a tool schema waits while the API compiles the schema. Every other attempt gets at
  most `ATTEMPT_TIMEOUT_SECONDS`, and a timeout, connection error, 429 or 5xx is retried once
  while budget is left. The retry is done here rather than by the SDK (`max_retries=0`), because
  the SDK's own retry knows nothing of the budget. Whatever is left after the retry is a `ModelUnavailable`, which the turn treats
  as an outage.
- **Warm-up:** `warm_up` sends one request shaped like a turn's (same tools, system prompt and
  settings, a one-token cap) when the worker starts, so the schema compile and the prompt cache
  write happen before the first Guardian waits on them.
- **Refusals:** server-side fallback (`fallbacks: "default"`) re-runs a declined request on a
  fallback model inside the same call. Haiku models have no server-side fallback, so their
  requests leave it out. A request still declined, or cut off at `max_tokens`, is a
  `ModelUnavailable` too: there is no usable reply to send.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import logging

import anthropic
from anthropic.types.beta import BetaMessage

from app.config import Settings

# One retry (the spec), done by this adapter: the SDK's own retries are off.
MODEL_ATTEMPTS = 2
SDK_RETRIES = 0
# 10-15 s per call (the spec).
ATTEMPT_TIMEOUT_SECONDS = 12.0
# A new strict tool schema's compile can take longer than an attempt (24 s of timeouts on a
# real cold start); a turn's first call waits this long before its retry.
FIRST_ATTEMPT_TIMEOUT_SECONDS = 40.0
# The warm-up runs off the Guardian's clock, so it can wait out a slow compile.
WARM_UP_TIMEOUT_SECONDS = 90.0
# Enough to start sampling, which is when the API needs the compiled schema; a 0-token request
# only runs prefill. The output is never read.
WARM_UP_MAX_TOKENS = 1
# Any text: the cache breakpoint sits on the system prompt, before it.
WARM_UP_MESSAGES = [{"role": "user", "content": "warm-up"}]
# Below this, an attempt can't finish; the budget counts as spent.
MIN_ATTEMPT_SECONDS = 1.0
# 408, 409, 429 and 5xx: what the SDK itself would retry.
RETRYABLE_STATUSES = frozenset({408, 409, 429})
SERVER_ERROR = 500
# A WhatsApp reply plus low-effort thinking stays far below this; the cap only stops a runaway.
MAX_TOKENS = 8192
FALLBACK_BETA = "server-side-fallback-2026-07-01"
SERVER_SIDE_FALLBACK = {"betas": [FALLBACK_BETA], "fallbacks": "default"}
# Haiku 5.5 has no server-side fallback: a declined request stays declined (claude-api skill,
# Migrating to Claude Haiku 5.5, Safeguards).
NO_FALLBACK_MODEL_PREFIX = "claude-haiku-"
CACHE_BREAKPOINT = {"type": "ephemeral"}
TOOL_CHOICE_AUTO = {"type": "auto"}
# The stop reasons that leave a reply or a tool call to act on.
USABLE_STOP_REASONS = frozenset({"end_turn", "tool_use"})

logger = logging.getLogger(__name__)

Effort = Literal["low", "medium", "high", "xhigh", "max"]


class ModelUnavailable(Exception):
    """The model call gave nothing usable: a timeout or API error after the retry, a refusal,
    or a reply cut off at `max_tokens`."""


class ModelNotConfigured(Exception):
    """`anthropic_api_key` is unset."""


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    # Free JSON, validated against the tool's strict schema by the API.
    input: dict[str, Any]


@dataclass(frozen=True)
class ModelUsage:
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    cache_creation_input_tokens: int


@dataclass(frozen=True)
class ModelResponse:
    # The text blocks, joined.
    text: str
    tool_calls: tuple[ToolCall, ...]
    stop_reason: str
    usage: ModelUsage
    # The assistant turn as returned, sent back unchanged on the next call (thinking blocks
    # included: the API rejects an edited history).
    assistant_content: tuple[dict[str, Any], ...]


class ModelClient(Protocol):
    def create(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        timeout_s: float,
    ) -> ModelResponse:
        """One model call. `timeout_s` bounds the whole call, its retry included. Raises
        `ModelUnavailable` when nothing usable came back."""
        ...

    def warm_up(self, *, system: str, tools: list[dict[str, Any]]) -> float | None:
        """One request shaped like a turn's, so the next real call finds the tool schemas
        compiled and the prompt cached. Returns the seconds it took, or None when it was
        skipped or failed. Never raises an API error."""
        ...


class AnthropicModelClient:
    def __init__(
        self,
        *,
        client: anthropic.Anthropic,
        model: str,
        effort: Effort,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client = client
        self._model = model
        self._effort = effort
        self._monotonic = monotonic

    def create(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        timeout_s: float,
    ) -> ModelResponse:
        """One Messages API call within `timeout_s`, retry included. Raises `ModelUnavailable`
        when there is nothing to act on."""
        request = self._request(
            system=system, tools=tools, messages=messages, max_tokens=MAX_TOKENS
        )
        # Only the turn input: the turn's first call, the one a schema compile can slow down.
        is_turn_start = len(messages) == 1
        deadline = self._monotonic() + timeout_s
        message: BetaMessage | None = None
        failure = "the turn had no time left for a model call"
        is_retryable = True
        attempts = 0
        while message is None and is_retryable and attempts < MODEL_ATTEMPTS:
            seconds_left = deadline - self._monotonic()
            if seconds_left < MIN_ATTEMPT_SECONDS:
                break
            attempt_cap = (
                FIRST_ATTEMPT_TIMEOUT_SECONDS
                if is_turn_start and attempts == 0
                else ATTEMPT_TIMEOUT_SECONDS
            )
            attempts += 1
            message, failure, is_retryable = self._attempt(
                request, timeout_s=min(attempt_cap, seconds_left)
            )
            if message is None:
                logger.warning("bot model attempt %s failed: %s", attempts, failure)

        if message is None:
            raise ModelUnavailable(failure)
        if message.stop_reason not in USABLE_STOP_REASONS:
            raise ModelUnavailable(f"the model stopped with {message.stop_reason}")

        return _to_response(message)

    def warm_up(self, *, system: str, tools: list[dict[str, Any]]) -> float | None:
        """One request with a turn's tools, system prompt and settings, so the API compiles the
        strict tool schemas and writes the prompt cache before a Guardian waits on either.
        Returns the seconds it took, or None when it failed; one attempt, logged, never
        raises an API error. The reply is never read, so a cut-off reply is a success."""
        request = self._request(
            system=system, tools=tools, messages=WARM_UP_MESSAGES, max_tokens=WARM_UP_MAX_TOKENS
        )
        started = self._monotonic()
        message, failure, _ = self._attempt(request, timeout_s=WARM_UP_TIMEOUT_SECONDS)
        seconds = self._monotonic() - started
        if message is None:
            logger.warning(
                "bot model warm-up of %s failed after %.1f s: %s", self._model, seconds, failure
            )
        else:
            logger.info(
                "bot model warm-up of %s took %.1f s: cache write %s, cache read %s",
                self._model,
                seconds,
                message.usage.cache_creation_input_tokens or 0,
                message.usage.cache_read_input_tokens or 0,
            )
        return None if message is None else seconds

    def _request(
        self,
        *,
        system: str,
        tools: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
    ) -> dict[str, Any]:
        """The Messages API request; a turn and the warm-up share it, so the warm-up hits the
        same compiled schemas and cache entry."""
        return {
            "model": self._model,
            "max_tokens": max_tokens,
            "system": [{"type": "text", "text": system, "cache_control": CACHE_BREAKPOINT}],
            "tools": [{**definition, "strict": True} for definition in tools],
            "tool_choice": TOOL_CHOICE_AUTO,
            "messages": messages,
            "output_config": {"effort": self._effort},
            **({} if self._model.startswith(NO_FALLBACK_MODEL_PREFIX) else SERVER_SIDE_FALLBACK),
        }

    def _attempt(
        self, request: dict[str, Any], *, timeout_s: float
    ) -> tuple[BetaMessage | None, str, bool]:
        """One API request: `(message, "", False)`, or `(None, why, is_retryable)`."""
        message = None
        failure = ""
        is_retryable = False
        try:
            message = self._client.with_options(timeout=timeout_s).beta.messages.create(**request)
        except anthropic.APITimeoutError:
            failure, is_retryable = "the Anthropic API timed out", True
        except anthropic.APIStatusError as exc:
            failure = f"the Anthropic API returned {exc.status_code}"
            is_retryable = _is_retryable(exc.status_code)
        except anthropic.APIConnectionError:
            failure, is_retryable = "the Anthropic API could not be reached", True

        return message, failure, is_retryable


def _is_retryable(status_code: int) -> bool:
    return status_code in RETRYABLE_STATUSES or status_code >= SERVER_ERROR


def build_model_client(settings: Settings) -> AnthropicModelClient:
    """The adapter from settings. Refuses to build without an API key, so the bot fails at
    start-up rather than on the first Guardian message."""
    if not settings.anthropic_api_key:
        raise ModelNotConfigured("anthropic_api_key is unset")

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=SDK_RETRIES)
    return AnthropicModelClient(client=client, model=settings.bot_model, effort=settings.bot_effort)


def _to_response(message: BetaMessage) -> ModelResponse:
    text = "".join(block.text for block in message.content if block.type == "text")
    tool_calls = tuple(
        ToolCall(id=block.id, name=block.name, input=dict(block.input))
        for block in message.content
        if block.type == "tool_use"
    )
    usage = message.usage
    return ModelResponse(
        text=text,
        tool_calls=tool_calls,
        stop_reason=str(message.stop_reason),
        usage=ModelUsage(
            input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens,
            cache_read_input_tokens=usage.cache_read_input_tokens or 0,
            cache_creation_input_tokens=usage.cache_creation_input_tokens or 0,
        ),
        assistant_content=tuple(
            block.to_dict(mode="json", exclude_none=True) for block in message.content
        ),
    )
