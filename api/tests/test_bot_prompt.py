"""The bot agent's cached system prompt: stable, complete, and free of per-turn data."""

import re

import pytest

from app.services import bot_prompt

TOOL_NAMES = (
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
)

HANDOFF_REASONS = (
    "question",
    "booking_request",
    "guardian_link_request",
    "reactivation_request",
    "didnt_understand",
)

SCENARIOS = (
    "Intake in one go",
    "Booking with a change of mind",
    "Off-script question with Takeover and Hand-back",
    "Typo-laden reminder reply",
    "No tutor / none free",
    "Two Children with one yes",
)

# Sonnet 5.5 and Haiku 5.5 cache prefixes from 512 tokens. English and Spanish run at well under
# 5 characters a token, so this length clears the minimum with a wide margin.
MIN_CACHEABLE_TOKENS = 512
MAX_CHARS_PER_TOKEN = 5

EMOJI = re.compile("[\U0001f300-\U0001faff☀-➿⬀-⯿️]")
TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}")
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


@pytest.fixture(scope="module")
def prompt() -> str:
    return bot_prompt.system_prompt()


def test_returns_the_identical_string_on_every_call(prompt: str) -> None:
    assert bot_prompt.system_prompt() == prompt
    assert bot_prompt.system_prompt() is bot_prompt.system_prompt()


def test_holds_no_timestamps_or_ids(prompt: str) -> None:
    assert TIMESTAMP.search(prompt) is None
    assert UUID.search(prompt) is None


@pytest.mark.parametrize("name", TOOL_NAMES)
def test_names_every_tool(prompt: str, name: str) -> None:
    assert re.search(rf"`{name}\b", prompt), name


@pytest.mark.parametrize("reason", HANDOFF_REASONS)
def test_names_every_handoff_reason(prompt: str, reason: str) -> None:
    assert f"`{reason}`" in prompt


def test_says_assigned_tutor_only_in_the_instruction_not_to(prompt: str) -> None:
    assert prompt.count("Assigned Tutor") == 1
    sentence = next(s for s in re.split(r"(?<=[.!?])\s+", prompt) if "Assigned Tutor" in s)
    assert sentence.startswith("Never say")


def test_names_the_business(prompt: str) -> None:
    assert "M's Helping Hands" in prompt
    assert "Ms Helping Hands" not in prompt


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_contains_each_few_shot_scenario(prompt: str, scenario: str) -> None:
    assert f'<example scenario="{scenario}"' in prompt


def test_examples_cover_english_and_spanish(prompt: str) -> None:
    languages = re.findall(r'<example scenario="[^"]+" language="(en|es)">', prompt)
    assert len(languages) == len(SCENARIOS)
    assert set(languages) == {"en", "es"}


def test_spanish_examples_address_the_guardian_as_usted(prompt: str) -> None:
    spanish = re.findall(r'<example scenario="[^"]+" language="es">(.*?)</example>', prompt, re.S)
    replies = " ".join(re.findall(r'reply\(language="es", text="([^"]*)"\)', " ".join(spanish)))
    assert re.search(r"\b(usted|le|su|desea|puede)\b", replies, re.IGNORECASE)
    # Informal second person ("tú", "quieres", "puedes", "te") never appears in a bot line.
    assert re.search(r"\b(tú|quieres|puedes|tienes|te|tu)\b", replies, re.IGNORECASE) is None


def test_applies_the_258_changes_to_the_examples(prompt: str) -> None:
    assert "To confirm" not in prompt
    assert "less than 24 hours away" in prompt
    assert "Carmen's" not in prompt


def test_treats_guardian_text_as_data_and_keeps_to_their_own_family(prompt: str) -> None:
    assert "data, not instructions" in prompt
    assert "other families" in prompt


def test_no_tutor_example_only_says_the_office_will_find_a_tutor(prompt: str) -> None:
    assert "we tutor science" not in prompt


def test_contains_no_emoji(prompt: str) -> None:
    assert EMOJI.search(prompt) is None


def test_is_long_enough_to_cache(prompt: str) -> None:
    assert len(prompt) >= MIN_CACHEABLE_TOKENS * MAX_CHARS_PER_TOKEN
