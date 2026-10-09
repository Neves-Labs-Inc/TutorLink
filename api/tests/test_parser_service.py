"""`parser_service.parse_intent` (REQ-077) — the request it builds, and every way it fails.

**No test here calls Anthropic (P7-I).** The module's one vendor call sits behind `_client`,
which every test replaces with a double. A test that spent money would be a failure, not a
slow test, so the double is also the thing the argument assertions read: it records what
`parse_intent` asked for and the tests assert against the recording.

The double validates the way the SDK validates — `messages.parse` runs the model's text through
`TypeAdapter(output_format).validate_json` — so a truncated answer raises the same
`ValidationError` here that it would in production, rather than a canned stand-in for one.
"""

import datetime
import inspect
import logging

import httpx2
import pytest
from anthropic import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    RateLimitError,
)
from anthropic.lib._parse._transform import transform_schema
from pydantic import ValidationError

from app.schemas.bot import AnswerKind, BotIntent, ParsedIntent
from app.services import bot_service, parser_service
from app.services.parser_service import (
    MAX_RETRIES,
    MAX_TOKENS,
    MODEL,
    REQUEST_TIMEOUT_SECONDS,
    SYSTEM_PROMPT,
    ParseFailed,
    _ModelOutput,
    parse_intent,
)

# The SDK's own defaults, recorded here so the assertion below says what it is guarding against.
# Ten minutes with two retries is thirty minutes of worst-case wall clock inside a webhook
# Twilio abandons after about fifteen seconds.
SDK_DEFAULT_TIMEOUT_SECONDS = 600.0
SDK_DEFAULT_MAX_RETRIES = 2

TWILIO_WEBHOOK_BUDGET_SECONDS = 15.0

STEP = "which_day"
QUESTION = "Which day works best for the session?"
BODY = "tuesday after school for Amelia"
CONTEXT = {"child_name": "Amelia", "subject": "Maths"}
REQUEST = {
    "step": STEP,
    "question": QUESTION,
    "body": BODY,
    "context": CONTEXT,
    "answer_kind": AnswerKind.DATE,
    "today": datetime.date(2026, 10, 1),
}

WELL_FORMED = (
    '{"intent": "book", "answer": "tuesday",'
    ' "fields": [{"name": "which_day", "value": "tuesday"},'
    ' {"name": "preferred_time", "value": "after school"}],'
    ' "confidence_is_low": false,'
    ' "language": null, "reminders": null}'
)

_REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


class _StubRefusalDetails:
    def __init__(self, *, category: str | None, explanation: str | None = None) -> None:
        self.category = category
        self.explanation = explanation


class _StubResponse:
    def __init__(
        self,
        parsed_output: _ModelOutput | None,
        *,
        stop_reason: str = "end_turn",
        stop_details: _StubRefusalDetails | None = None,
    ) -> None:
        self.parsed_output = parsed_output
        self.stop_reason = stop_reason
        self.stop_details = stop_details


class _StubMessages:
    def __init__(
        self,
        *,
        text: str | None,
        error: Exception | None,
        refusal: _StubResponse | None,
    ) -> None:
        self._text = text
        self._error = error
        self._refusal = refusal
        self.calls: list[dict[str, object]] = []

    def parse(self, **kwargs: object) -> _StubResponse:
        self.calls.append(kwargs)

        if self._error is not None:
            raise self._error
        if self._refusal is not None:
            return self._refusal
        if self._text is None:
            return _StubResponse(None)

        output_format = kwargs["output_format"]
        assert isinstance(output_format, type)

        return _StubResponse(output_format.model_validate_json(self._text))


class _StubClient:
    def __init__(
        self,
        *,
        text: str | None = None,
        error: Exception | None = None,
        refusal: _StubResponse | None = None,
    ) -> None:
        self.messages = _StubMessages(text=text, error=error, refusal=refusal)


def _install(monkeypatch: pytest.MonkeyPatch, client: _StubClient) -> _StubMessages:
    monkeypatch.setattr(parser_service, "_client", client)

    return client.messages


def test_a_well_formed_answer_becomes_a_validated_parsed_intent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch, _StubClient(text=WELL_FORMED))

    parsed = parse_intent(**REQUEST)

    assert parsed.intent is BotIntent.BOOK
    assert parsed.answer == "tuesday"
    assert parsed.fields == {"which_day": "tuesday", "preferred_time": "after school"}
    assert parsed.confidence_is_low is False


def test_a_null_answer_means_the_message_did_not_answer_the_question(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(
        monkeypatch,
        _StubClient(
            text='{"intent": "unknown", "answer": null, "fields": [], "confidence_is_low": false,'
            ' "language": null, "reminders": null}'
        ),
    )

    assert parse_intent(**REQUEST).answer is None


def test_a_repeated_field_name_folds_to_the_value_the_model_settled_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Last-wins, decided rather than inherited from `dict()` (P7-U). The pairs arrive in the
    order the model emitted them, so the second is it correcting itself further into its own
    answer — and it is what a JSON object would have done with a repeated key."""
    _install(
        monkeypatch,
        _StubClient(
            text=(
                '{"intent": "book", "answer": null,'
                ' "fields": [{"name": "which_day", "value": "tuesday"},'
                ' {"name": "which_day", "value": "wednesday"}],'
                ' "confidence_is_low": false,'
                ' "language": null, "reminders": null}'
            )
        ),
    )

    parsed = parse_intent(**REQUEST)

    assert parsed.fields == {"which_day": "wednesday"}


def test_an_unnamed_field_is_dropped_loudly_and_its_siblings_survive(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A value with no name fills no slot — `bot_service` resolves by name — and a `""` key
    would read like a real one. It is dropped, but not silently: an unremarked drop is the
    same invisible failure the fold exists to prevent. The parent pays at most one clarifying
    re-prompt, which is cheaper than flagging the conversation over one unusable pair.
    """
    _install(
        monkeypatch,
        _StubClient(
            text=(
                '{"intent": "book", "answer": null,'
                ' "fields": [{"name": "  ", "value": "tuesday"},'
                ' {"name": "child_name", "value": "Amelia"}],'
                ' "confidence_is_low": false,'
                ' "language": null, "reminders": null}'
            )
        ),
    )

    with caplog.at_level(logging.WARNING, logger=parser_service.__name__):
        parsed = parse_intent(**REQUEST)

    assert parsed.fields == {"child_name": "Amelia"}
    assert "dropped an unnamed field" in caplog.text


def test_a_padded_field_name_is_stripped_rather_than_left_as_a_near_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`" which_day"` is a name, not a nameless pair. Keeping the padding would put a key in
    `fields` that nothing in `bot_service` matches, which loses the value just as completely
    as dropping it would."""
    _install(
        monkeypatch,
        _StubClient(
            text=(
                '{"intent": "book", "answer": null,'
                ' "fields": [{"name": " which_day ", "value": "tuesday"}],'
                ' "confidence_is_low": false,'
                ' "language": null, "reminders": null}'
            )
        ),
    )

    assert parse_intent(**REQUEST).fields == {"which_day": "tuesday"}


def test_the_prompt_pins_child_name_as_the_key_for_a_named_child() -> None:
    """The contract test: fails if either side of SA-28's agreement is renamed."""
    assert "`child_name`" in SYSTEM_PROMPT
    assert bot_service.STEP_CHILD_NAME == "child_name"


def test_the_prompt_no_longer_keys_the_answer_by_the_step_name() -> None:
    """The model named that key whatever it liked (`parent_name` 3 times in 9), so the answer
    now has a fixed `answer` slot and the step-name rule must not come back."""
    assert "under that step's own name" not in SYSTEM_PROMPT
    assert "`answer`" in SYSTEM_PROMPT


def test_a_named_child_folds_under_child_name(monkeypatch: pytest.MonkeyPatch) -> None:
    _install(
        monkeypatch,
        _StubClient(
            text=(
                '{"intent": "book", "answer": null,'
                ' "fields": [{"name": "child_name", "value": "Sam"},'
                ' {"name": "menu", "value": "book"}],'
                ' "confidence_is_low": false,'
                ' "language": null, "reminders": null}'
            )
        ),
    )

    parsed = parse_intent(**REQUEST)

    assert parsed.fields == {"child_name": "Sam", "menu": "book"}


def test_the_language_and_a_reminders_request_fold_into_the_parsed_intent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(
        monkeypatch,
        _StubClient(
            text='{"intent": "unknown", "answer": null, "fields": [], "confidence_is_low": false,'
            ' "language": "es", "reminders": "stop"}'
        ),
    )

    parsed = parse_intent(**REQUEST)

    assert parsed.language == "es"
    assert parsed.reminders == "stop"


def test_a_message_too_neutral_to_tell_carries_no_language_and_no_reminders_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install(monkeypatch, _StubClient(text=WELL_FORMED))

    parsed = parse_intent(**REQUEST)

    assert parsed.language is None
    assert parsed.reminders is None


def test_a_parsed_intent_built_without_a_language_has_none() -> None:
    parsed = ParsedIntent(intent=BotIntent.BOOK, fields={}, confidence_is_low=False)

    assert parsed.language is None
    assert parsed.reminders is None


def test_the_prompt_tells_the_parser_how_to_read_spanish_and_when_language_is_null() -> None:
    assert "`language`" in SYSTEM_PROMPT
    assert "`reminders`" in SYSTEM_PROMPT
    assert "mañana" in SYSTEM_PROMPT
    for neutral in ("name", "address", "school", "number", "date", '"ok"', '"STOP"'):
        assert neutral in SYSTEM_PROMPT


def test_the_prompt_reads_next_weekday_as_the_soonest_one() -> None:
    assert '"next <weekday>"' in SYSTEM_PROMPT
    assert "soonest" in SYSTEM_PROMPT


def test_the_models_own_low_confidence_signal_is_passed_through_untouched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The one thing standing between an ambiguous message and the wrong child in the wrong
    slot (#27). It is the model's signal, not a threshold this module re-derives."""
    _install(
        monkeypatch,
        _StubClient(
            text='{"intent": "book", "answer": null, "fields": [], "confidence_is_low": true,'
            ' "language": null, "reminders": null}'
        ),
    )

    assert parse_intent(**REQUEST).confidence_is_low is True


def test_the_request_names_the_model_as_a_literal(monkeypatch: pytest.MonkeyPatch) -> None:
    """Asserted as a literal rather than against `MODEL`, so renaming the constant to a model
    that was never chosen fails here instead of shipping."""
    messages = _install(monkeypatch, _StubClient(text=WELL_FORMED))

    parse_intent(**REQUEST)

    assert MODEL == "claude-haiku-5-5"
    assert messages.calls[0]["model"] == "claude-haiku-5-5"


def test_the_request_disables_thinking_and_pins_effort_without_unsupported_parameters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The Haiku 5.5 constraints, asserted against the recorded call.

    Thinking is on by default and would eat the token cap and the timeout; disabled thinking is
    only valid at effort low, medium or high. Sampling parameters, `fallbacks` and prefill
    return 400, and a cache breakpoint on a prompt far under the 512-token floor would do
    nothing.
    """
    messages = _install(monkeypatch, _StubClient(text=WELL_FORMED))

    parse_intent(**REQUEST)

    call = messages.calls[0]
    assert call["thinking"] == {"type": "disabled"}
    assert call["output_config"] == {"effort": "medium"}
    assert call["output_format"] is parser_service._ModelOutput
    for absent in ("temperature", "top_p", "top_k", "fallbacks", "tools"):
        assert absent not in call
    assert "cache_control" not in repr(call)


def test_the_request_is_one_call_with_a_small_extraction_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    messages = _install(monkeypatch, _StubClient(text=WELL_FORMED))

    parse_intent(**REQUEST)

    assert len(messages.calls) == 1
    assert messages.calls[0]["max_tokens"] == MAX_TOKENS
    assert MAX_TOKENS <= 256


def test_the_prompt_carries_the_step_the_message_and_the_collected_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    messages = _install(monkeypatch, _StubClient(text=WELL_FORMED))

    parse_intent(**REQUEST)

    prompt = messages.calls[0]["messages"][0]["content"]
    assert STEP in prompt
    assert BODY in prompt
    for name, value in CONTEXT.items():
        assert name in prompt
        assert value in prompt


def test_the_prompt_shows_the_question_being_answered_once_outside_the_collected_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    messages = _install(monkeypatch, _StubClient(text=WELL_FORMED))

    parse_intent(**REQUEST)

    prompt = messages.calls[0]["messages"][0]["content"]
    collected = prompt.split("Collected so far:", 1)[1]
    assert prompt.count(QUESTION) == 1
    assert QUESTION not in collected


def test_the_client_overrides_both_sdk_defaults_and_fits_the_twilio_budget() -> None:
    """The trap this module exists to avoid: the SDK retries a timeout, so the worst case is
    `timeout * (max_retries + 1)` and the inherited default is half an hour."""
    assert parser_service._client.timeout == REQUEST_TIMEOUT_SECONDS
    assert parser_service._client.max_retries == MAX_RETRIES
    assert REQUEST_TIMEOUT_SECONDS != SDK_DEFAULT_TIMEOUT_SECONDS
    assert MAX_RETRIES != SDK_DEFAULT_MAX_RETRIES
    assert REQUEST_TIMEOUT_SECONDS * (MAX_RETRIES + 1) < TWILIO_WEBHOOK_BUDGET_SECONDS


@pytest.mark.parametrize(
    "error",
    [
        APITimeoutError(request=_REQUEST),
        RateLimitError("slow down", response=httpx2.Response(429, request=_REQUEST), body=None),
        APIStatusError("boom", response=httpx2.Response(500, request=_REQUEST), body=None),
        APIConnectionError(request=_REQUEST),
    ],
    ids=["timeout", "rate_limit", "status", "connection"],
)
def test_every_sdk_failure_becomes_parse_failed_with_the_original_chained(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    """None of the four escapes as itself: CONSTITUTION §6 keeps HTTP below `app/routers/`, and
    #27 gives all four the same treatment — `parse_error`, flagged at once, no re-prompt burnt.
    The original is chained because the reason still has to reach a log."""
    _install(monkeypatch, _StubClient(error=error))

    with pytest.raises(ParseFailed) as raised:
        parse_intent(**REQUEST)

    assert raised.value.__cause__ is error


def test_a_timeout_is_caught_before_its_connection_error_base(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`APITimeoutError` subclasses `APIConnectionError` and `RateLimitError` subclasses
    `APIStatusError`, so the chain's order is load-bearing rather than stylistic. This pins the
    message a timeout produces; reorder the clauses and it becomes the generic one."""
    _install(monkeypatch, _StubClient(error=APITimeoutError(request=_REQUEST)))

    with pytest.raises(ParseFailed, match="did not answer within"):
        parse_intent(**REQUEST)


def test_an_answer_truncated_at_max_tokens_becomes_parse_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The realistic non-outage failure: the model answered, and the answer stopped mid-JSON.
    Indistinguishable from an outage to the caller, and it gets the same treatment."""
    _install(monkeypatch, _StubClient(text='{"intent": "book", "fields": [{"name": "whi'))

    with pytest.raises(ParseFailed) as raised:
        parse_intent(**REQUEST)

    assert isinstance(raised.value.__cause__, ValidationError)


def test_a_response_with_no_parsable_content_becomes_parse_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`parsed_output` is optional on the SDK's side and is `None` when nothing in the response
    parsed. Returning `None` up the stack would hand
    `bot_service` a `ParsedIntent | None` its signature does not admit."""
    _install(monkeypatch, _StubClient(text=None))

    with pytest.raises(ParseFailed):
        parse_intent(**REQUEST)


def test_a_refusal_becomes_parse_failed_naming_its_category(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    refusal = _StubResponse(
        None,
        stop_reason="refusal",
        stop_details=_StubRefusalDetails(category="general_harms", explanation="secret detail"),
    )
    _install(monkeypatch, _StubClient(refusal=refusal))

    with pytest.raises(ParseFailed) as raised:
        parse_intent(**REQUEST)

    assert str(raised.value) == "the model declined the request (general_harms)"


@pytest.mark.parametrize(
    "stop_details",
    [None, _StubRefusalDetails(category=None, explanation="secret detail")],
)
def test_a_refusal_without_a_category_gets_the_fallback_wording(
    monkeypatch: pytest.MonkeyPatch, stop_details: _StubRefusalDetails | None
) -> None:
    refusal = _StubResponse(None, stop_reason="refusal", stop_details=stop_details)
    _install(monkeypatch, _StubClient(refusal=refusal))

    with pytest.raises(ParseFailed) as raised:
        parse_intent(**REQUEST)

    assert str(raised.value) == "the model declined the request (unknown)"


def test_the_schema_sent_to_the_api_can_still_carry_extracted_fields() -> None:
    """The regression this module's wire shape exists for.

    Structured outputs accept `additionalProperties` only as `false`, and the SDK rewrites any
    other value to `false` before sending. `ParsedIntent.fields` is a `dict[str, str]`, so
    handing `ParsedIntent` to `output_format` would send a schema permitting no keys at all in
    `fields` — the model would be grammar-constrained to return `{}`, every extracted value
    would vanish, and nothing would raise. This reads the SDK's own transform, because that is
    the code that would do the collapsing.
    """
    schema = transform_schema(_ModelOutput.model_json_schema())
    fields = schema["properties"]["fields"]
    pair = schema["$defs"][fields["items"]["$ref"].rsplit("/", 1)[-1]]

    assert fields["type"] == "array"
    assert set(pair["properties"]) == {"name", "value"}

    collapsed = transform_schema(ParsedIntent.model_json_schema())["properties"]["fields"]

    assert collapsed["properties"] == {}
    assert collapsed["additionalProperties"] is False


def test_the_schema_sent_to_the_api_requires_a_nullable_answer() -> None:
    """Required so the model always states it; nullable so "this message does not answer the
    question" has a way to be said other than an invented value."""
    schema = transform_schema(_ModelOutput.model_json_schema())
    answer_types = {option.get("type") for option in schema["properties"]["answer"]["anyOf"]}

    assert "answer" in schema["required"]
    assert answer_types == {"string", "null"}


@pytest.mark.parametrize(
    ("name", "values"), [("language", {"en", "es"}), ("reminders", {"stop", "start"})]
)
def test_the_schema_sent_to_the_api_requires_a_nullable_language_and_reminders(
    name: str, values: set[str]
) -> None:
    """Required for the same reason as `answer`: the model always states it, and null is how
    it says the message does not tell."""
    schema = transform_schema(_ModelOutput.model_json_schema())
    options = schema["properties"][name]["anyOf"]
    allowed = {value for option in options for value in option.get("enum", [])}

    assert name in schema["required"]
    assert allowed == values
    assert {"type": "null"} in options


def test_nothing_in_this_module_reaches_the_http_layer() -> None:
    """CONSTITUTION §6 and §7: a service raises domain exceptions and knows nothing about
    FastAPI. Cheap to assert and the one criterion no behavioural test would surface."""
    source = inspect.getsource(parser_service)

    assert "fastapi" not in source
    assert "HTTPException" not in source
