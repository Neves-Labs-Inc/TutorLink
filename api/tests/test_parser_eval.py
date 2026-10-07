"""`scripts/parser_eval.py`, the hand-run parser evaluation (seam 6).

Running it calls Anthropic, so no test here runs it: these check that it imports without an API
key, carries the agreed case set, and scores a parse the way its table reports it.
"""

from app.schemas.bot import AnswerKind, BotIntent, ParsedIntent
from scripts import parser_eval

# The Spanish parser trial's 41 case ids (`prototype/spanish-parser-trial`), written out so a
# case dropped from the script fails here.
TRIAL_CASE_IDS = (
    *(f"yn-{n}" for n in range(1, 9)),
    *(f"dt-{n}" for n in range(1, 6)),
    *(f"gr-{n}" for n in range(1, 5)),
    "nm-1",
    "nm-2",
    "bk-1",
    "bk-2",
    "cn-1",
    "cn-2",
    "rs-1",
    "rs-2",
    "cc-1",
    "cc-2",
    "qn-1",
    *(f"st-{n}" for n in range(1, 8)),
    *(f"mx-{n}" for n in range(1, 4)),
    *(f"en-{n}" for n in range(1, 4)),
)


def _parsed(
    *,
    answer: str | None = None,
    intent: BotIntent = BotIntent.UNKNOWN,
    language: str | None = None,
    reminders: str | None = None,
) -> ParsedIntent:
    return ParsedIntent(
        intent=intent,
        answer=answer,
        fields={},
        confidence_is_low=False,
        language=language,
        reminders=reminders,
    )


def _case(case_id: str) -> parser_eval.Case:
    return next(case for case in parser_eval.CASES if case.case_id == case_id)


def test_the_case_set_is_the_trials_41_plus_the_two_grade_edges() -> None:
    ids = [case.case_id for case in parser_eval.CASES]

    assert len(TRIAL_CASE_IDS) == 41
    assert set(TRIAL_CASE_IDS) <= set(ids)
    assert len(ids) == len(set(ids)) == 43


def test_the_grade_edges_ask_for_kindergarten_as_zero_and_keep_thirteen_for_the_range_check() -> (
    None
):
    grades = {
        case.body: case.answer
        for case in parser_eval.CASES
        if case.step == "child_grade" and case.body in {"K", "13"}
    }

    assert grades == {"K": "0", "13": "13"}
    assert all(
        case.answer_kind is AnswerKind.NUMBER
        for case in parser_eval.CASES
        if case.step == "child_grade"
    )


def test_a_parse_matching_every_scored_column_passes() -> None:
    passed, problems = parser_eval.score(
        _case("st-7"), _parsed(intent=BotIntent.CANCEL, language="es")
    )

    assert (passed, problems) == (True, "")


def test_a_reminders_request_where_null_was_expected_fails() -> None:
    """st-7: cancelling a session is not a stop request."""
    passed, problems = parser_eval.score(
        _case("st-7"), _parsed(intent=BotIntent.CANCEL, language="es", reminders="stop")
    )

    assert passed is False
    assert problems == "reminders=stop"


def test_an_unscored_column_is_ignored_and_an_answer_compares_without_case() -> None:
    passed, _ = parser_eval.score(_case("nm-2"), _parsed(answer="josé núñez", language="es"))

    assert passed is True


def test_a_missing_parse_fails() -> None:
    assert parser_eval.score(_case("yn-1"), None) == (False, "no parse")
