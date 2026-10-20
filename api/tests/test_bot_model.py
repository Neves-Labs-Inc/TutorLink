"""The Anthropic adapter's request and response handling, with the SDK client faked."""

from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.types.beta import BetaMessage

from app.config import Settings
from app.services.bot_model import (
    SDK_RETRIES,
    AnthropicModelClient,
    ModelNotConfigured,
    ModelUnavailable,
    ToolCall,
    build_model_client,
)

SYSTEM = "You are the WhatsApp assistant."
TOOLS = [
    {
        "name": "reply",
        "description": "Reply.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_subjects",
        "description": "Subjects.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
    },
]
TURN_INPUT = [{"role": "user", "content": "## Guardian snapshot\n...\n\n## Chat history\n..."}]


def _message(content: list[dict[str, Any]], stop_reason: str = "tool_use") -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": "claude-sonnet-5-5",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {
                "input_tokens": 120,
                "output_tokens": 30,
                "cache_read_input_tokens": 4000,
                "cache_creation_input_tokens": 0,
            },
        }
    )


class FakeSdk:
    """Stands in for `anthropic.Anthropic`: records each request and gives the next scripted
    answer. A timeout error spends its attempt's whole timeout on the fake clock."""

    def __init__(self, *answers: BetaMessage | Exception) -> None:
        self.answers = list(answers)
        self.requests: list[dict[str, Any]] = []
        self.timeouts: list[float] = []
        self.now = 0.0
        self.beta = self
        self.messages = self

    def monotonic(self) -> float:
        return self.now

    def with_options(self, *, timeout: float) -> "FakeSdk":
        self.timeouts.append(timeout)
        return self

    def create(self, **request: Any) -> BetaMessage:
        self.requests.append(request)
        answer = self.answers.pop(0)
        if isinstance(answer, anthropic.APITimeoutError):
            self.now += self.timeouts[-1]
        if isinstance(answer, Exception):
            raise answer
        return answer


def _create(sdk: FakeSdk, timeout_s: float = 30.0, model: str = "claude-sonnet-5-5") -> Any:
    client = AnthropicModelClient(
        client=sdk,  # type: ignore[arg-type]
        model=model,
        effort="low",
        monotonic=sdk.monotonic,
    )
    return client.create(system=SYSTEM, tools=TOOLS, messages=TURN_INPUT, timeout_s=timeout_s)


def _reply_message() -> BetaMessage:
    return _message(
        [
            {"type": "thinking", "thinking": "", "signature": "sig"},
            {"type": "text", "text": "One moment."},
            {"type": "tool_use", "id": "toolu_1", "name": "reply", "input": {"text": "Hi"}},
        ]
    )


def test_the_cache_breakpoint_sits_on_the_system_prompt_after_the_tools() -> None:
    sdk = FakeSdk(_reply_message())

    _create(sdk)

    [request] = sdk.requests
    assert request["system"] == [
        {"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}
    ]
    # The per-turn content comes after the breakpoint and carries none of its own.
    assert request["messages"] == TURN_INPUT
    assert all("cache_control" not in tool for tool in request["tools"])
    assert "cache_control" not in request


def test_tools_are_strict_with_auto_choice_and_the_configured_model_and_effort() -> None:
    sdk = FakeSdk(_reply_message())

    _create(sdk)

    [request] = sdk.requests
    assert [tool["name"] for tool in request["tools"]] == ["reply", "list_subjects"]
    assert all(tool["strict"] is True for tool in request["tools"])
    assert request["tool_choice"] == {"type": "auto"}
    assert request["model"] == "claude-sonnet-5-5"
    assert request["output_config"] == {"effort": "low"}
    assert "thinking" not in request
    assert sdk.timeouts == [12.0]
    assert request["betas"] == ["server-side-fallback-2026-07-01"]
    assert request["fallbacks"] == "default"


def test_a_haiku_request_asks_for_no_server_side_fallback() -> None:
    """Haiku 5.5 has none: a declined request stays declined, and a fallback list is a 400."""
    sdk = FakeSdk(_reply_message())

    _create(sdk, model="claude-haiku-5-5")

    [request] = sdk.requests
    assert request["model"] == "claude-haiku-5-5"
    assert "fallbacks" not in request
    assert "betas" not in request


def test_the_response_carries_text_tool_calls_usage_and_the_turn_to_send_back() -> None:
    response = _create(FakeSdk(_reply_message()))

    assert response.text == "One moment."
    assert response.tool_calls == (ToolCall(id="toolu_1", name="reply", input={"text": "Hi"}),)
    assert response.usage.cache_read_input_tokens == 4000
    assert [block["type"] for block in response.assistant_content] == [
        "thinking",
        "text",
        "tool_use",
    ]
    assert response.assistant_content[0]["signature"] == "sig"


def _request() -> httpx2.Request:
    return httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _timeout() -> anthropic.APITimeoutError:
    return anthropic.APITimeoutError(request=_request())


def _status(code: int) -> anthropic.APIStatusError:
    return anthropic.APIStatusError(
        "failed", response=httpx2.Response(code, request=_request()), body=None
    )


@pytest.mark.parametrize(
    "error",
    [
        _timeout(),
        anthropic.APIConnectionError(request=_request()),
        _status(529),
        _status(429),
    ],
)
def test_a_retryable_failure_is_retried_once_and_a_second_is_model_unavailable(
    error: Exception,
) -> None:
    sdk = FakeSdk(error, error)

    with pytest.raises(ModelUnavailable):
        _create(sdk)

    assert len(sdk.requests) == 2


def test_a_failure_then_a_success_returns_the_success() -> None:
    sdk = FakeSdk(_timeout(), _reply_message())

    response = _create(sdk)

    assert response.text == "One moment."
    assert len(sdk.requests) == 2


def test_a_bad_request_is_not_retried() -> None:
    sdk = FakeSdk(_status(400))

    with pytest.raises(ModelUnavailable):
        _create(sdk)

    assert len(sdk.requests) == 1


def test_the_retry_only_gets_what_is_left_of_the_budget() -> None:
    sdk = FakeSdk(_timeout(), _timeout())

    with pytest.raises(ModelUnavailable):
        _create(sdk, timeout_s=15.0)

    assert sdk.timeouts == [12.0, 3.0]
    assert sdk.now == 15.0


def test_no_retry_once_the_budget_is_spent() -> None:
    sdk = FakeSdk(_timeout(), _reply_message())

    with pytest.raises(ModelUnavailable):
        _create(sdk, timeout_s=12.5)

    assert len(sdk.requests) == 1


def test_no_call_without_budget() -> None:
    sdk = FakeSdk(_reply_message())

    with pytest.raises(ModelUnavailable):
        _create(sdk, timeout_s=0.5)

    assert sdk.requests == []


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
def test_a_refusal_or_a_cut_off_reply_is_model_unavailable(stop_reason: str) -> None:
    with pytest.raises(ModelUnavailable):
        _create(FakeSdk(_message([{"type": "text", "text": "..."}], stop_reason=stop_reason)))


def _settings(**overrides: Any) -> Settings:
    return Settings(
        database_url="postgresql+psycopg://x:y@localhost/z",
        secret_key="k" * 32,
        **overrides,
    )


def test_the_client_is_built_from_settings_with_the_sdk_retry_off() -> None:
    client = build_model_client(_settings(anthropic_api_key="sk-test"))

    # The adapter retries itself, inside the turn's budget.
    assert client._client.max_retries == SDK_RETRIES == 0  # noqa: SLF001


def test_the_bot_defaults_to_sonnet_at_low_effort() -> None:
    settings = _settings()

    assert (settings.bot_model, settings.bot_effort) == ("claude-sonnet-5-5", "low")


def test_no_api_key_refuses_to_build_the_client() -> None:
    with pytest.raises(ModelNotConfigured):
        build_model_client(_settings(anthropic_api_key=None))
