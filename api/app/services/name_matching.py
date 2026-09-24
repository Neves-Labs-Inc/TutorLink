"""The name-matching rule for reactivation offers — REQ-132.2, REQ-132.9, the user's OQ-77 answer
(2026-09-23, changed from an earlier no-typo rule).

A name matches a child exactly (the normalised full name), by one whole word of it, or by a
one-edit typo (Levenshtein distance <= 1) against the full name or one of its words, unless the
input or the target is shorter than `TYPO_MIN_LENGTH` (OQ-81). Tier 3 (typo) runs only when tiers
1-2 (exact) find nothing (`named_children`'s precedence) — an exact or whole-word hit always wins,
even against a shorter distance-0 typo hit elsewhere.

`edit_distance` is written locally because the standard library has no edit distance (`difflib`
computes similarity ratios, not this rule) and no package in `api/uv.lock` provides one; the input
is bounded by `NAME_LIMIT = 255` characters and a guardian has a handful of children, so the plain
two-row dynamic-programming loop needs no bound or short-circuit.

This module decides nothing about offers, pending requests or ambiguity — `bot_service` (REQ-132)
reads its results and applies that policy.
"""

from collections.abc import Sequence

from app.models.child import Child

TYPO_MAX_EDITS = 1
TYPO_MIN_LENGTH = 4


def normalize_name(raw: str) -> str:
    return " ".join(raw.casefold().split())


def edit_distance(a: str, b: str) -> int:
    previous_row = list(range(len(b) + 1))

    for i, char_a in enumerate(a, start=1):
        current_row = [i]

        for j, char_b in enumerate(b, start=1):
            if char_a == char_b:
                cost = 0
            else:
                cost = 1

            current_row.append(
                min(
                    previous_row[j] + 1,
                    current_row[j - 1] + 1,
                    previous_row[j - 1] + cost,
                )
            )

        previous_row = current_row

    return previous_row[-1]


def exact_matches(children: Sequence[Child], raw: str) -> list[Child]:
    normalized = normalize_name(raw)
    by_full_name = [child for child in children if normalize_name(child.name) == normalized]

    if by_full_name:
        result = by_full_name
    else:
        result = [
            child
            for child in children
            if normalized in normalize_name(child.name).split(" ") and normalized != ""
        ]

    return result


def typo_matches(children: Sequence[Child], raw: str) -> list[Child]:
    normalized = normalize_name(raw)
    result = []

    if len(normalized) >= TYPO_MIN_LENGTH:
        for child in children:
            child_name = normalize_name(child.name)
            targets = [child_name, *child_name.split(" ")]
            is_match = any(
                len(target) >= TYPO_MIN_LENGTH
                and edit_distance(normalized, target) <= TYPO_MAX_EDITS
                for target in targets
            )

            if is_match:
                result.append(child)

    return result


def named_children(children: Sequence[Child], raw: str) -> list[Child]:
    exact = exact_matches(children, raw)

    if exact:
        result = exact
    else:
        result = typo_matches(children, raw)

    return result
