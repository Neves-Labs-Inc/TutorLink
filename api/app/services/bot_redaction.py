"""Where a saved private value appears in a message body (docs/specs/whatsapp-bot-agent.md §5
Redaction). The profile save tools mark the messages holding a value; the history replaces it
inline. Both match through here, so a message marked at write time is found at read time.

**Matching.** Body and value are both normalised: lowercased, every run of characters that are
not letters or digits (spaces, line breaks, punctuation) collapsed to one space, and trimmed.
The value matches wherever its normalised text appears in the normalised body as whole words,
so "12 Oak St\\nApt 4" holds the saved "12 Oak St, Apt 4", but "address" doesn't hold the saved
notes "ADD" and "12 Oak Street" doesn't hold "12 Oak St". A blank value never matches.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Span:
    """A match in the original body: `body[start:end]`."""

    start: int
    end: int


@dataclass(frozen=True, slots=True)
class _Normalised:
    text: str
    # The original body index each character of `text` came from.
    origins: tuple[int, ...]


def find_value(body: str, value: str) -> tuple[Span, ...]:
    """Every match of `value` in `body`, in order, overlapping matches merged."""
    needle = _normalise(value).text

    if not needle:
        return ()

    haystack = _normalise(body)
    spans: list[Span] = []
    start = haystack.text.find(needle)
    while start != -1:
        if not _is_whole_words(haystack.text, start, start + len(needle)):
            start = haystack.text.find(needle, start + 1)
            continue
        # A normalised value starts and ends with a letter or digit, so both ends map back to
        # a character of the body itself, never to a collapsed separator.
        span = Span(
            start=haystack.origins[start],
            end=haystack.origins[start + len(needle) - 1] + 1,
        )
        if spans and span.start < spans[-1].end:
            spans[-1] = Span(start=spans[-1].start, end=max(spans[-1].end, span.end))
        else:
            spans.append(span)
        start = haystack.text.find(needle, start + 1)

    return tuple(spans)


def contains_value(body: str, value: str) -> bool:
    return bool(find_value(body, value))


def _is_whole_words(text: str, start: int, end: int) -> bool:
    """Whether `text[start:end]` neither starts nor ends inside a word: in normalised text a
    word ends only at a space or the edge."""
    is_word_start = start == 0 or text[start - 1] == " "
    is_word_end = end == len(text) or text[end] == " "
    return is_word_start and is_word_end


def _normalise(text: str) -> _Normalised:
    characters: list[str] = []
    origins: list[int] = []
    is_after_separator = False
    for index, character in enumerate(text):
        if not character.isalnum():
            is_after_separator = bool(characters)
            continue
        if is_after_separator:
            characters.append(" ")
            origins.append(index)
            is_after_separator = False
        # One character can lowercase to several ("İ"); each maps back to it.
        for lowered in character.lower():
            characters.append(lowered)
            origins.append(index)

    return _Normalised(text="".join(characters), origins=tuple(origins))
