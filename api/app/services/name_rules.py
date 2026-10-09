"""The one rule for a usable `users.name`, shared by every write path.

Users create and update, `PATCH /api/me`, the CLI seeds and the Tutors page all write the same
column, so one place decides what a usable name is: trimmed, whitespace runs collapsed, no
control or invisible characters (#109), non-blank and within the column. Kept apart from
`user_service` because `tutor_service` needs it too and `user_service` imports that.
"""

from app.services.text_rules import HiddenCharacters, clean_single_line

# The `users.name` column width.
MAX_NAME_LENGTH = 255
NAME_LENGTH_ERROR = "name must be 1 to 255 characters and not blank"
NAME_CHARACTERS_ERROR = (
    "name must not contain control or invisible characters "
    "(line breaks, tabs, zero-width or text-direction characters)"
)


class InvalidName(Exception):
    """A Display name that is blank, too long, or carries a hidden character. The message is
    safe to show the caller and says which."""


def normalize_name(name: str) -> str:
    """The Display name as stored, or `InvalidName`."""
    try:
        cleaned = clean_single_line(name)
    except HiddenCharacters as exc:
        raise InvalidName(NAME_CHARACTERS_ERROR) from exc

    if not cleaned or len(cleaned) > MAX_NAME_LENGTH:
        raise InvalidName(NAME_LENGTH_ERROR)

    return cleaned
