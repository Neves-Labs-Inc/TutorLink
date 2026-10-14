"""The rules for short, single-line text that Staff type: `clean_single_line` for what the
Guardian later reads on WhatsApp (Display names in Takeover notices, Spanish Subject names in
bot replies), and `normalize_single_line` for names that must only look like one line.

Pure: no database and no framework, so a service and a request schema can both apply it.
"""

import unicodedata

# Unicode control (Cc: NUL, newline, tab...), format (Cf: zero-width, bidi overrides and
# isolates) and line/paragraph separator (Zl, Zp: U+2028, U+2029) categories. NUL cannot be
# stored, a line break or tab makes WhatsApp refuse a template parameter and breaks a numbered
# reply, and the invisible ones let text look blank or read backwards.
HIDDEN_CHARACTER_CATEGORIES = frozenset({"Cc", "Cf", "Zl", "Zp"})


class HiddenCharacters(ValueError):
    """The text carries a control, invisible or line-separator character."""


def clean_single_line(raw: str) -> str:
    """`raw` trimmed, with each internal whitespace run collapsed to one space.

    Hidden characters are refused, never stripped: they are checked on the raw input, so a
    trailing newline is an error rather than silently dropped. Runs are collapsed because
    WhatsApp refuses a template parameter with more than four consecutive spaces. The result
    may be empty; whether blank is allowed is the caller's rule.
    """
    if any(unicodedata.category(char) in HIDDEN_CHARACTER_CATEGORIES for char in raw):
        raise HiddenCharacters

    return " ".join(raw.split())


def _is_dropped(char: str) -> bool:
    # Whitespace among the hidden characters (newline, tab, U+2028...) is left for `split()` to
    # turn into a space; the rest (zero-width, bidi, NUL) would otherwise glue onto a word.
    return unicodedata.category(char) in HIDDEN_CHARACTER_CATEGORIES and not char.isspace()


def normalize_single_line(raw: str) -> str:
    """`raw` with hidden characters silently removed, trimmed, and each whitespace run
    (line breaks included) collapsed to one space.

    The lenient sibling of `clean_single_line`: nothing is refused, so "Bio\\nlogy" becomes
    "Bio logy" and a zero-width space inside a word disappears. The result may be empty;
    whether blank is allowed is the caller's rule.
    """
    visible = "".join(char for char in raw if not _is_dropped(char))

    return " ".join(visible.split())
