"""The emails TutorLink sends, rendered from an admin-edited template into subject, text and a
minimal HTML alternative, and the rules a template must pass before it is saved or sent.

English only (#153). Pure functions: the template and every value come in as arguments, and the
wording lives in `system_settings` (migration 0034), never here. Names are stored values and are
escaped into the HTML part anyway, because a Display name is free text an Admin typed.

A placeholder is `{` + lowercase letters or `_` + `}`; any other brace is literal text. A
template may only use its kind's placeholders, and its body must carry `{link}`, so a saved
template can never send an email without the link it exists to deliver.
"""

import enum
import html
import re
from collections.abc import Mapping
from dataclasses import dataclass

NAME_PLACEHOLDER = "name"
ACTOR_NAME_PLACEHOLDER = "actor_name"
LINK_PLACEHOLDER = "link"

MAX_SUBJECT_LENGTH = 200
MAX_BODY_LENGTH = 5000

_PLACEHOLDER_PATTERN = re.compile(r"\{([a-z_]+)\}")
# A blank line (possibly holding whitespace) ends a paragraph in the HTML part.
_PARAGRAPH_BREAK = re.compile(r"\n[ \t]*\n")


class TemplateKind(enum.Enum):
    INVITE = "invite"
    PASSWORD_RESET = "password_reset"


# Ordered as the refusal message lists them.
_KNOWN_PLACEHOLDERS = {
    TemplateKind.INVITE: (NAME_PLACEHOLDER, ACTOR_NAME_PLACEHOLDER, LINK_PLACEHOLDER),
    TemplateKind.PASSWORD_RESET: (NAME_PLACEHOLDER, LINK_PLACEHOLDER),
}


@dataclass(frozen=True, slots=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


class EmailTemplateInvalid(Exception):
    """A template breaks one of the rules; `message` is safe to show the Admin as-is."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def validate_template(kind: TemplateKind, *, subject: str | None, body: str | None) -> None:
    """Raise `EmailTemplateInvalid` with the first rule `subject` and `body` break.

    Either part may be None to check only the other, for a save that changes one part. The
    rules run in a fixed order (subject shape, body shape, placeholders, `{link}`), so the same
    draft always gets the same message.
    """
    if subject is not None:
        _check_subject(subject)

    if body is not None:
        _check_body(body)

    unknown = _first_unknown_placeholder(kind, [subject or "", body or ""])

    if unknown is not None:
        raise EmailTemplateInvalid(f"Unknown placeholder {unknown}. Use {_placeholder_list(kind)}.")

    if body is not None and _placeholder(LINK_PLACEHOLDER) not in body:
        raise EmailTemplateInvalid(f"The body must include {_placeholder(LINK_PLACEHOLDER)}.")


def render_email(
    kind: TemplateKind, *, subject: str, body: str, values: Mapping[str, str]
) -> RenderedEmail:
    """The email `subject` and `body` produce with `values` substituted.

    Only `kind`'s placeholders are substituted; anything else stays as written. In the HTML part
    the body is escaped, blank lines become paragraphs, single newlines `<br>`, and `{link}` an
    anchor.
    """
    known = _KNOWN_PLACEHOLDERS[kind]
    normalised_body = body.replace("\r\n", "\n")
    paragraphs = [
        _html_paragraph(paragraph, known=known, values=values)
        for paragraph in _PARAGRAPH_BREAK.split(normalised_body)
        if paragraph.strip()
    ]

    return RenderedEmail(
        subject=_substitute(subject, known=known, values=values),
        text=_substitute(normalised_body, known=known, values=values),
        html=_document("".join(paragraphs)),
    )


def _check_subject(subject: str) -> None:
    if not subject.strip():
        raise EmailTemplateInvalid("The subject can't be empty.")

    if "\r" in subject or "\n" in subject:
        raise EmailTemplateInvalid("The subject must be a single line.")

    if len(subject) > MAX_SUBJECT_LENGTH:
        raise EmailTemplateInvalid(f"The subject can be at most {MAX_SUBJECT_LENGTH} characters.")


def _check_body(body: str) -> None:
    if not body.strip():
        raise EmailTemplateInvalid("The body can't be empty.")

    if len(body) > MAX_BODY_LENGTH:
        raise EmailTemplateInvalid(f"The body can be at most {MAX_BODY_LENGTH} characters.")


def _first_unknown_placeholder(kind: TemplateKind, texts: list[str]) -> str | None:
    known = _KNOWN_PLACEHOLDERS[kind]
    unknown = [
        match.group(0)
        for text in texts
        for match in _PLACEHOLDER_PATTERN.finditer(text)
        if match.group(1) not in known
    ]

    return unknown[0] if unknown else None


def _placeholder_list(kind: TemplateKind) -> str:
    names = [_placeholder(name) for name in _KNOWN_PLACEHOLDERS[kind]]

    return f"{', '.join(names[:-1])} or {names[-1]}"


def _placeholder(name: str) -> str:
    return "{" + name + "}"


def _substitute(text: str, *, known: tuple[str, ...], values: Mapping[str, str]) -> str:
    # One pass, so a value that itself reads `{link}` is never substituted again.
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        return values[name] if name in known else match.group(0)

    return _PLACEHOLDER_PATTERN.sub(replace, text)


def _html_paragraph(paragraph: str, *, known: tuple[str, ...], values: Mapping[str, str]) -> str:
    # Escaping leaves `{`, `}`, letters and `_` alone, so placeholders survive it intact.
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)

        if name not in known:
            return match.group(0)

        value = values[name]
        if name == LINK_PLACEHOLDER:
            return (
                f'<a href="{html.escape(value, quote=True)}">{html.escape(value, quote=False)}</a>'
            )
        return html.escape(value, quote=False)

    # Element text, not an attribute: quotes need no escaping, so "didn't" stays readable.
    escaped_paragraph = html.escape(paragraph.strip("\n"), quote=False).replace("\n", "<br>")

    return f"<p>{_PLACEHOLDER_PATTERN.sub(replace, escaped_paragraph)}</p>"


def _document(body: str) -> str:
    return f'<!doctype html><html><body style="font-family:sans-serif">{body}</body></html>'
