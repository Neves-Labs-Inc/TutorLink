"""Every tool schema the agent sends must pass the API's strict tool mode (`strict: true`).

The API rejects a bad schema with a 400 on every turn, and nothing else in the suite sends the
schemas anywhere, so the rules from the Claude API structured-outputs docs are checked here:
objects close with `additionalProperties: false`, a node's `enum` matches its declared type (and a
list of types is not allowed beside an `enum`), the keywords strict mode drops are absent, and the
union-typed parameters across all tools stay under the API's cap. Optional properties are left out
of `required` rather than made nullable, which is what keeps that count at zero.
"""

from collections.abc import Iterator
from typing import Any

import pytest

from app.services import bot_tools_booking, bot_tools_profile
from app.services.bot_turn import REPLY_TOOL

SCHEMAS: dict[str, dict[str, Any]] = {
    **{spec.name: spec.input_schema for spec in bot_tools_profile.TOOLS},
    **{spec.name: spec.input_schema for spec in bot_tools_booking.TOOLS},
    REPLY_TOOL["name"]: REPLY_TOOL["input_schema"],
}

# Strict mode does not support these; the SDKs strip them, but our schemas go out raw.
UNSUPPORTED_KEYWORDS = (
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "maxItems",
)
# The API compiles every tool schema of a request together and rejects more than 16 parameters
# typed as a union (a type array or an anyOf). We use none: optional means not required.
MAX_UNION_PARAMETERS = 16
# Only 0 and 1 are supported for `minItems`.
MAX_MIN_ITEMS = 1
PYTHON_TYPES: dict[str, tuple[type, ...]] = {
    "string": (str,),
    "integer": (int,),
    "number": (int, float),
    "boolean": (bool,),
    "null": (type(None),),
}


def _nodes(schema: Any, path: str) -> Iterator[tuple[str, dict[str, Any]]]:
    """Every schema node below `schema`, with a readable path."""
    if not isinstance(schema, dict):
        return

    yield path, schema
    for name, child in schema.get("properties", {}).items():
        yield from _nodes(child, f"{path}.{name}")
    yield from _nodes(schema.get("items"), f"{path}[]")
    for index, branch in enumerate(schema.get("anyOf", [])):
        yield from _nodes(branch, f"{path}|{index}")


def _all_nodes() -> list[tuple[str, dict[str, Any]]]:
    return [node for name, schema in SCHEMAS.items() for node in _nodes(schema, name)]


def test_covers_all_thirteen_agent_tools() -> None:
    assert len(SCHEMAS) == 13


@pytest.mark.parametrize(("path", "node"), _all_nodes())
def test_an_enum_is_never_beside_a_list_of_types(path: str, node: dict[str, Any]) -> None:
    assert not ("enum" in node and isinstance(node.get("type"), list)), (
        f"{path}: use anyOf with one enum branch per type"
    )


@pytest.mark.parametrize(("path", "node"), _all_nodes())
def test_every_enum_value_matches_the_declared_type(path: str, node: dict[str, Any]) -> None:
    # A list of types beside an enum is the other test's failure.
    if "enum" not in node or isinstance(node["type"], list):
        return

    allowed = PYTHON_TYPES[node["type"]]
    assert all(isinstance(value, allowed) for value in node["enum"]), path


@pytest.mark.parametrize(("path", "node"), _all_nodes())
def test_objects_are_closed(path: str, node: dict[str, Any]) -> None:
    if node.get("type") != "object":
        return

    assert node.get("additionalProperties") is False, path
    assert set(node.get("required", [])) <= set(node.get("properties", {})), path


@pytest.mark.parametrize(("path", "node"), _all_nodes())
def test_no_keyword_strict_mode_drops(path: str, node: dict[str, Any]) -> None:
    assert not [keyword for keyword in UNSUPPORTED_KEYWORDS if keyword in node], path
    assert node.get("minItems", 0) <= MAX_MIN_ITEMS, path


def _union_parameters() -> list[str]:
    return [
        path for path, node in _all_nodes() if isinstance(node.get("type"), list) or "anyOf" in node
    ]


def test_union_typed_parameters_stay_under_the_apis_cap() -> None:
    assert len(_union_parameters()) <= MAX_UNION_PARAMETERS, _union_parameters()


def test_no_parameter_is_a_union() -> None:
    # Stricter than the cap on purpose: headroom for the next tool.
    assert _union_parameters() == []
