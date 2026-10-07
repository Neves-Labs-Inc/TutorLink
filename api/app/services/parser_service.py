"""Turning one inbound WhatsApp message into a `ParsedIntent` via the Anthropic API (REQ-077).

One message, one API call, one classification. No agent loop, no tool use, no tool runner and no
fallback model — #27 refuses all four, because this is extraction at a known step of a known
flow. `bot_service` owns every decision that follows from the result; this module owns none of
them and knows nothing about FastAPI.

**#27's standing warning, which outlives this implementation.** Claude Haiku 4.5 is the weakest
of the candidate models on exactly the input free text exists to serve — "the tuesday one but
later if she can" — and a misparse books the wrong child into the wrong slot. Two things follow
from that. `confidence_is_low` is the model's own signal, passed through untouched, so the flow
machine can re-prompt rather than act on a guess; and the flag queue is the escape hatch for
what still gets through. The model choice is meant to be revisited once there is real traffic to
measure, so the whole vendor call sits behind `_call_model` and the request is built in one
place: swapping the model is a one-function change, not an archaeology exercise.

**The timeout and the retry count are module constants, not `system_settings` rows (OQ-30).**
This project's convention is the opposite — a tuning number belongs in a row an admin can edit
without a deploy — and it is deliberately not applied here, so a reviewer does not have to ask.
The SDK's own defaults are a ten-minute request timeout with `max_retries=2`, and a timed-out
request is itself retried, so inheriting them means half an hour of hanging inside a webhook
Twilio abandoned after fifteen seconds and has already redelivered. A wrong value in a
`system_settings` row is that same outage with no error, no log line naming the setting, and
nothing an admin could diagnose it from — which is the opposite of what the runtime-settings
convention exists for. `REQUEST_TIMEOUT_SECONDS * (MAX_RETRIES + 1)` is the worst-case wall
clock and is chosen to leave the surrounding database work room inside the Twilio budget.

**Three parameters the request deliberately does not carry, all verified against the
`claude-api` skill rather than recalled.** The reasoning-depth knob inside `output_config`
errors outright on this model. Haiku 4.5 is still on the older extended-reasoning shape, and a
single-call classifier wants none of it, so that parameter is omitted entirely rather than sent
disabled. And this model's prompt-cache floor is 4096 tokens — a prompt this size is nowhere
near it, so a cache breakpoint would silently do nothing, and no cost assumption is built on
one.

**The wire shape is `_ModelOutput`, not `ParsedIntent`, and that is not a preference.**
Structured outputs accept `additionalProperties` only as `false`, and the SDK rewrites any
other value to `false` before the request goes out. `ParsedIntent.fields` is a `dict[str, str]`,
so `output_format=ParsedIntent` would send a schema permitting **no** keys in `fields` and the
model would be grammar-constrained to return `{}` — every extracted slot dropped, with no error
anywhere. `_ModelOutput` carries the same information as a list of name/value pairs, which is a
closed schema, and `parse_intent` folds it back into the `ParsedIntent` its caller expects.

**The answer slot and field names (P7-V).** The parent's answer to the question in the bot's
last message comes back in `ParsedIntent.answer`, a slot whose name never changes, and is `None`
when the message does not answer it. It used to be returned under the step's own name in
`fields`, and the model did not reliably use that name (`parent_name` for `intake_name` 3 times
in 9, with high confidence), so every such answer read as a miss. The question itself reaches
the model as its own labelled section of the prompt. `fields` carries any other values the
message supplies, keyed in `lower_snake_case`; the list-to-dict fold is total — `_fold_fields`
decides, and states, what a repeated name and a nameless pair do. A child the parent names is
also returned under `child_name` (SA-28, Phase 7D), whatever the step; the bot resolves the name
against the guardian's own children. `bot_service` resolves every value against the database;
nothing here validates one.

**English and Spanish, one prompt, one call** (#104). The prompt's bilingual paragraph is the
one the Spanish parser trial measured; answers stay in the English forms above whatever language
the parent writes in, and two more nullable slots come back: `language` (null for anything too
neutral to tell, so a name or "ok" never flips a Guardian's language) and `reminders` (a stop or
start request for the weekly reminders). `scripts/parser_eval.py` is the hand-run check of the
whole prompt against the live model; run it after changing either.

**Every vendor failure becomes `ParseFailed`.** CONSTITUTION §6 keeps HTTP out of anything below
`app/routers/`, and #27 assigns all of them one behaviour anyway: flag `parse_error` at once and
do **not** burn one of the parent's two re-prompts, because a parser outage is not the parent
failing to be understood.
"""

import datetime
import logging

import anthropic
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.schemas.bot import (
    AnswerKind,
    BotIntent,
    GuardianLanguage,
    ParsedIntent,
    RemindersRequest,
)

MODEL = "claude-haiku-4-5"

# Extraction, not generation: the whole reply is one small JSON object. A low ceiling also
# bounds the worst case when the model ignores the schema and starts narrating.
MAX_TOKENS = 256

# Twilio abandons a messaging webhook at ~15s and redelivers it. 4.0 * (1 + 1) = 8s worst case
# leaves the surrounding database work the rest of the budget. One retry, not the SDK's two:
# a second retry buys little against a model that answers in under two seconds when it is up,
# and costs four more seconds of a budget that is not ours to spend.
REQUEST_TIMEOUT_SECONDS = 4.0
MAX_RETRIES = 1

SYSTEM_PROMPT = """You read one WhatsApp message sent by a parent to a tutoring service and \
report what it means. You never reply to the parent and you never take an action.

Return:
- `intent`: what the parent is asking for. `book` to arrange a session, `cancel` to call one \
off, `reschedule` to move one, `link_guardian` to be added to a child who is already \
registered with someone else, `chit_chat` for a greeting, thanks or pleasantry that asks for \
nothing (for example "thanks!", "hi again", "ok great"), `question` for a question about the \
service that none of the others covers, such as prices, policies or a tutor's details (for \
example "how much is a session?"), and `unknown` when the message is unreadable or does not \
fit any of the others.
- `answer`: the parent's answer to the question in the bot's last message, in the form the \
prompt's expected answer kind requires. Null when the message does not answer that question. \
The kinds:
  - `text`: the value alone (for example `Franklin Neves`, not `My name is Franklin Neves`).
  - `yes_no`: exactly `yes` or `no`. Agreement such as "yes please", "go ahead" or "sounds \
good" is `yes`; a refusal such as "no thanks" or "not now" is `no`. A hedge such as "not \
sure", "maybe" or "I'll check" is neither: give null.
  - `number`: digits only, for example `3`.
  - `date`: ISO `YYYY-MM-DD`, resolving words such as "tomorrow", "next Tuesday" or "14th Oct" \
against today's date, which the prompt gives. "next <weekday>" is the soonest such day after \
today. A day and month with no year is the next such date from today, except a date of birth, \
which is in the past.
  - `choice`: the number of the chosen option in the numbered options listed in the collected \
context, as digits. "The second one" is `2`; "the 4pm one" is the number of the option at 4pm. \
When the parent names something that is not among the options, give what they named as written. \
When their description fits more than one option, give null and set `confidence_is_low`.
- `fields`: any other values the message supplies, as `name`/`value` pairs. Names are \
lower_snake_case. When the parent names one of their children, also give that name under \
`child_name`, whatever the current step. Add a pair only for a value the parent actually gave; \
never invent one and never repeat a value already listed in the collected context.
- `confidence_is_low`: true when the message is ambiguous, contradicts the context, or could \
reasonably mean more than one thing. Set it rather than guessing — a wrong guess books the \
wrong child into the wrong slot, and a true here only costs the parent one clarifying \
question. Set it to false only when one reading is clearly right.

The parent may write in English, Spanish, or a mix of both. Whatever language they use, \
`answer` and every field value follow the forms above exactly: a yes/no answer is always the \
English word `yes` or `no` ("sí", "claro", "dale", "de acuerdo" are `yes`; "no gracias", \
"ahora no" are `no`); dates are ISO, resolving Spanish words such as "mañana", "el martes que \
viene" or "el 14 de octubre"; numbers are digits ("quinto" is `5`, "kínder" or "kinder" is `0`); \
names stay exactly as written.

Also return:
- `language`: `es` when the message is clearly written in Spanish, `en` when clearly in \
English, and null when it is too short or neutral to tell: a name, an address, a school name, \
a number, a date, a single neutral word such as "ok" or "STOP", or an emoji. For a mix, the \
language most of the words are in.
- `reminders`: `stop` when the parent asks to stop receiving the weekly reminders or messages \
from us in any words or language ("STOP", "para", "ya no me escriban", "no more reminders"), \
`start` when they ask to receive them again ("START", "quiero recibirlos otra vez"), \
otherwise null. Asking to cancel a session is not `stop`."""

logger = logging.getLogger(__name__)


class ParseFailed(Exception):
    """The parse call did not complete — a timeout, an API error, or an outage."""


class _ExtractedField(BaseModel):
    """One `name`/`value` pair out of `ParsedIntent.fields`.

    A list of these rather than an object keyed by name: see the module docstring — an
    open-ended map is not expressible in a structured-output schema.
    """

    name: str
    value: str


class _ModelOutput(BaseModel):
    """The wire shape of one parse. Folded into `ParsedIntent` before it leaves this module."""

    intent: BotIntent
    # Required but nullable: the model always states it, and null is how it says the message
    # does not answer the question.
    answer: str | None
    fields: list[_ExtractedField]
    confidence_is_low: bool
    # Required but nullable, like `answer`: null is "too neutral to tell" and "no request".
    language: GuardianLanguage | None
    reminders: RemindersRequest | None


# One client for the process, built here rather than per call: it holds a connection pool, and a
# fresh one per inbound message would open a fresh TLS connection inside the Twilio budget. The
# key may be absent in development and in tests; the SDK constructs happily either way and fails
# at request time, which no test reaches because no test calls out.
_client = anthropic.Anthropic(
    api_key=get_settings().anthropic_api_key,
    timeout=REQUEST_TIMEOUT_SECONDS,
    max_retries=MAX_RETRIES,
)


# What `answer` must look like for each kind, stated in the prompt beside the question. The
# bot accepts exactly these forms, so a reply in any other shape costs the parent a re-prompt.
_ANSWER_FORMS: dict[AnswerKind, str] = {
    AnswerKind.TEXT: "the value alone",
    AnswerKind.YES_NO: "exactly `yes` or `no`; null for a hedge such as not sure or maybe",
    AnswerKind.NUMBER: "digits only",
    AnswerKind.DATE: "an ISO date, YYYY-MM-DD, resolved relative to today",
    AnswerKind.CHOICE: "the chosen option's number, as digits",
}


def _build_prompt(
    *,
    step: str,
    question: str,
    body: str,
    context: dict[str, str],
    answer_kind: AnswerKind,
    today: datetime.date,
) -> str:
    collected = "\n".join(f"- {name}: {value}" for name, value in context.items()) or "- nothing"

    return (
        f"Current step: {step}\n"
        f"Today is {today.isoformat()} ({today:%A}).\n"
        f"The bot's last message, which the parent is replying to:\n{question}\n"
        f"Expected answer: {answer_kind.value} — {_ANSWER_FORMS[answer_kind]}\n"
        f"Collected so far:\n{collected}\n"
        f"The parent just sent:\n{body}"
    )


def _call_model(prompt: str) -> _ModelOutput | None:
    """The only place in the codebase that calls a model. Replace this to replace the model."""
    response = _client.messages.parse(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        output_format=_ModelOutput,
    )

    return response.parsed_output


def _fold_fields(fields: list[_ExtractedField]) -> dict[str, str]:
    """Collapse the wire's name/value pairs into `ParsedIntent.fields` (P7-U).

    A list can say two things a dict cannot, and both are decided here rather than left to
    whatever `dict()` happens to do. A fold that quietly loses a pair would be the same class
    of bug the fold exists to fix, and invisible in the same way: a well-formed `ParsedIntent`
    missing the child's name, with nothing raised and nothing logged.

    **A repeated name is last-wins.** The pairs arrive in the order the model emitted them, so
    a second pair under a name is the model correcting itself further into its own answer, and
    the later value is the one it settled on. It is also what a JSON object would have done
    with a repeated key, which keeps this fold from being a place where behaviour diverges
    from the shape it stands in for.

    **A pair whose name is blank is dropped, and the drop is logged.** A value with no name
    fills no slot — `bot_service` resolves by name, so there is nothing it could do with it —
    and keeping it would put an unresolvable `""` key in `fields` that reads like a real one.
    Dropping it costs the parent at most one clarifying re-prompt, which is what the re-prompt
    budget is for; raising would flag the conversation and discard an otherwise good parse
    over one unusable pair. Names are stripped first, so a name that is merely padded is kept
    rather than becoming a near-miss key nothing matches.
    """
    folded: dict[str, str] = {}

    for field in fields:
        name = field.name.strip()
        if not name:
            logger.warning("dropped an unnamed field from a %s parse", MODEL)
            continue

        folded[name] = field.value

    return folded


def parse_intent(
    *,
    step: str,
    question: str,
    body: str,
    context: dict[str, str],
    answer_kind: AnswerKind,
    today: datetime.date,
) -> ParsedIntent:
    """`today` is the caller's clock, so a turn reads the time once and the parser resolves
    "next Tuesday" against the same day the bot's window checks use."""
    prompt = _build_prompt(
        step=step,
        question=question,
        body=body,
        context=context,
        answer_kind=answer_kind,
        today=today,
    )

    # Most specific first, and the order is load-bearing: `APITimeoutError` is a subclass of
    # `APIConnectionError` and `RateLimitError` is a subclass of `APIStatusError`, so either
    # pair the wrong way round makes the specific clause unreachable. One broad `except` is
    # refused — it would swallow a programming error in this module as a parser outage.
    try:
        output = _call_model(prompt)
    except anthropic.APITimeoutError as exc:
        raise ParseFailed(f"the model did not answer within {REQUEST_TIMEOUT_SECONDS}s") from exc
    except anthropic.RateLimitError as exc:
        raise ParseFailed("the Anthropic API rate-limited the request") from exc
    except anthropic.APIStatusError as exc:
        raise ParseFailed(f"the Anthropic API returned {exc.status_code}") from exc
    except anthropic.APIConnectionError as exc:
        raise ParseFailed("the Anthropic API could not be reached") from exc
    except ValidationError as exc:
        # The model answered, and the answer is not a `_ModelOutput` — a reply truncated at
        # `MAX_TOKENS` is the realistic cause. Indistinguishable from an outage to the caller,
        # and #27 gives it the same treatment.
        raise ParseFailed("the model's answer did not match the expected shape") from exc

    if output is None:
        # No text block came back at all, which is what a safety refusal looks like here.
        raise ParseFailed("the model returned no parsable content")

    return ParsedIntent(
        intent=output.intent,
        answer=output.answer,
        fields=_fold_fields(output.fields),
        confidence_is_low=output.confidence_is_low,
        language=output.language,
        reminders=output.reminders,
    )
