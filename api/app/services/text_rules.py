"""The one rule for short, single-line text that Staff type and the Guardian later reads on
WhatsApp: Display names (in Takeover notices) and Spanish Subject names (in bot replies).

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
