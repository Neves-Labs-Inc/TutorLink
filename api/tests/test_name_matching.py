"""`name_matching` — the pure matching rule, tested against the table pinned in
`07D-CONTEXT.md` §4a (RM, REQ-132.2, REQ-132.9). No `db` fixture: every `Child` here is
transient, never added to a session (the pattern of `test_booking_read_routes.py:355`).
"""

from collections.abc import Sequence

import pytest

from app.models.child import Child
from app.services.name_matching import edit_distance, exact_matches, named_children, typo_matches


def _children(*names: str) -> list[Child]:
    return [Child(name=name, grade_level=5, school_name="School") for name in names]


@pytest.mark.parametrize(
    ("case", "candidate_names", "raw", "expected_names"),
    [
        ("M1 exact full name after normalisation", ["Sam Jones"], "  sam   JONES ", ["Sam Jones"]),
        ("M2 whole word", ["Sam Jones", "Ann Lee"], "Jones", ["Sam Jones"]),
        ("M3 whole word, several", ["Sam Jones", "Sam Smith"], "sam", ["Sam Jones", "Sam Smith"]),
        ("M4 one-edit typo on the full name (deletion)", ["Sam Jones"], "Sam Jnes", ["Sam Jones"]),
        ("M5 the missing space is one edit", ["Sam Jones"], "Samjones", ["Sam Jones"]),
        ("M6 one-edit typo on a word: deletion", ["Olivia Brown"], "Olvia", ["Olivia Brown"]),
        ("M6 one-edit typo on a word: substitution", ["Olivia Brown"], "Olivja", ["Olivia Brown"]),
        ("M6 one-edit typo on a word: insertion", ["Olivia Brown"], "Oliviaa", ["Olivia Brown"]),
        ("M7 two edits: no match", ["Olivia Brown"], "Olva", []),
        ("M8 a transposition is two Levenshtein edits", ["John Smith"], "Jhon", []),
        ("M9 no prefix matching, 3 characters exempt", ["Samantha Lee"], "Sam", []),
        ("M10 two letters short is two edits", ["Samantha Lee"], "Samant", []),
        ("M11 one letter short is a one-edit typo", ["Samantha Lee"], "Samanth", ["Samantha Lee"]),
        ("M12 a 3-character input is never typo-matched", ["Ben Cole"], "Bem", []),
        ("M13 the target word is 3 characters, exempt", ["Sam Jones"], "Samm", []),
        ("M14 diacritics are not folded, 3 characters exempt", ["Zoë Hart"], "Zoe", []),
        ("M15 one substitution, both sides 4 characters", ["José Ruiz"], "Jose", ["José Ruiz"]),
        ("M16 tier 2 beats tier 3", ["Mark Lee", "Marc Jones"], "Mark", ["Mark Lee"]),
        (
            "M17 a typo hitting two children returns both",
            ["Mark Lee", "Marc Jones"],
            "Marx",
            ["Mark Lee", "Marc Jones"],
        ),
        ("M18 empty after normalisation", ["Sam Jones"], "   ", []),
        ("M19 punctuation is not a word boundary", ["Mary-Jane Fox"], "Mary", []),
    ],
)
def test_named_children_matches_the_pinned_table(
    case: str, candidate_names: Sequence[str], raw: str, expected_names: list[str]
) -> None:
    candidates = _children(*candidate_names)

    matched = named_children(candidates, raw)

    assert [child.name for child in matched] == expected_names, case


@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        ("", "", 0),
        ("", "abc", 3),
        ("sam", "sam", 0),
        ("kitten", "sitting", 3),
        ("john", "jhon", 2),
        ("flaw", "lawn", 2),
    ],
)
def test_edit_distance_is_plain_levenshtein(a: str, b: str, expected: int) -> None:
    assert edit_distance(a, b) == expected


def test_exact_matches_alone_includes_only_the_whole_word_hit() -> None:
    candidates = _children("Mark Lee", "Marc Jones")

    assert [child.name for child in exact_matches(candidates, "Mark")] == ["Mark Lee"]


def test_typo_matches_alone_includes_the_distance_zero_hit_too() -> None:
    candidates = _children("Mark Lee", "Marc Jones")

    matched = typo_matches(candidates, "Mark")

    assert [child.name for child in matched] == ["Mark Lee", "Marc Jones"]
