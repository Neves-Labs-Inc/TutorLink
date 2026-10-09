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
_BRAND_COLOR_PATTERN = re.compile(r"#[0-9A-Fa-f]{6}")

BRAND_COLOR_ERROR = "Enter a colour like #74C8C9."
WORDMARK = "TutorLink"
FOOTER_TEXT = "Sent by TutorLink"
LINK_FALLBACK_TEXT = "Or paste this link into your browser:"
LIGHT_LABEL_COLOR = "#FFFFFF"
DARK_LABEL_COLOR = "#111827"
MIN_TEXT_CONTRAST = 4.5
_CHANNEL_MAX = 255
_MUTED_COLOR = "#6B7280"
_TEXT_COLOR = "#111827"
_PAGE_BACKGROUND = "#F3F4F6"
_FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


class TemplateKind(enum.Enum):
    INVITE = "invite"
    PASSWORD_RESET = "password_reset"


# Ordered as the refusal message lists them.
_KNOWN_PLACEHOLDERS = {
    TemplateKind.INVITE: (NAME_PLACEHOLDER, ACTOR_NAME_PLACEHOLDER, LINK_PLACEHOLDER),
    TemplateKind.PASSWORD_RESET: (NAME_PLACEHOLDER, LINK_PLACEHOLDER),
}


_BUTTON_LABELS = {
    TemplateKind.INVITE: "Set your password",
    TemplateKind.PASSWORD_RESET: "Reset password",
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


def validate_brand_color(value: str) -> str:
    """`value` uppercased when it is a `#RRGGBB` colour, else raise `EmailTemplateInvalid`."""
    if not _BRAND_COLOR_PATTERN.fullmatch(value):
        raise EmailTemplateInvalid(BRAND_COLOR_ERROR)

    return value.upper()


def render_email(
    kind: TemplateKind,
    *,
    subject: str,
    body: str,
    values: Mapping[str, str],
    brand_color: str,
) -> RenderedEmail:
    """The email `subject` and `body` produce with `values` substituted.

    Only `kind`'s placeholders are substituted; anything else stays as written. In the HTML part
    the body is escaped, blank lines become paragraphs, single newlines `<br>`, and `{link}` an
    anchor, or a button when it is alone in its paragraph. The whole sits in a branded card
    coloured with `brand_color`, which must be a `#RRGGBB` hex (`EmailTemplateInvalid` if not).
    """
    color = validate_brand_color(brand_color)
    text_color = _text_shade(color)
    known = _KNOWN_PLACEHOLDERS[kind]
    normalised_body = body.replace("\r\n", "\n")
    paragraphs = [
        _html_paragraph(paragraph, kind=kind, values=values, color=color, text_color=text_color)
        for paragraph in _PARAGRAPH_BREAK.split(normalised_body)
        if paragraph.strip()
    ]

    return RenderedEmail(
        subject=_substitute(subject, known=known, values=values),
        text=_substitute(normalised_body, known=known, values=values),
        html=_document("".join(paragraphs), text_color=text_color),
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


def _html_paragraph(
    paragraph: str, *, kind: TemplateKind, values: Mapping[str, str], color: str, text_color: str
) -> str:
    known = _KNOWN_PLACEHOLDERS[kind]

    if paragraph.strip() == _placeholder(LINK_PLACEHOLDER):
        return _button(
            _BUTTON_LABELS[kind], url=values[LINK_PLACEHOLDER], color=color, text_color=text_color
        )

    # Escaping leaves `{`, `}`, letters and `_` alone, so placeholders survive it intact.
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)

        if name not in known:
            return match.group(0)

        value = values[name]
        if name == LINK_PLACEHOLDER:
            return _anchor(value, style=f"color:{text_color};")
        return html.escape(value, quote=False)

    # Element text, not an attribute: quotes need no escaping, so "didn't" stays readable.
    escaped_paragraph = html.escape(paragraph.strip("\n"), quote=False).replace("\n", "<br>")
    text = _PLACEHOLDER_PATTERN.sub(replace, escaped_paragraph)

    return f'<p style="margin:0 0 16px;font-size:16px;line-height:24px;">{text}</p>'


def _anchor(url: str, *, style: str) -> str:
    return f'<a href="{html.escape(url, quote=True)}" style="{style}">{html.escape(url, quote=False)}</a>'


def _button(label: str, *, url: str, color: str, text_color: str) -> str:
    label_color = _label_color(color)
    button_style = (
        f"display:block;padding:12px 24px;border-radius:6px;background:{color};"
        f"color:{label_color};font-size:16px;font-weight:bold;text-align:center;"
        "text-decoration:none;"
    )
    href = html.escape(url, quote=True)
    # The anchor is the clickable block and the cell carries the colour, so Outlook shows it too.
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="margin:8px 0 16px;"><tr>'
        f'<td style="border-radius:6px;background:{color};">'
        f'<a href="{href}" style="{button_style}">{html.escape(label, quote=False)}</a>'
        "</td></tr></table>"
        f'<p style="margin:0 0 16px;font-size:13px;line-height:20px;color:{_MUTED_COLOR};">'
        f"{LINK_FALLBACK_TEXT}<br>{_anchor(url, style=f'color:{text_color};word-break:break-all;')}</p>"
    )


def _label_color(color: str) -> str:
    """White or near-black, whichever contrasts more with the `#RRGGBB` background `color`."""
    background = _relative_luminance(color)
    light_contrast = _contrast(_relative_luminance(LIGHT_LABEL_COLOR), background)
    dark_contrast = _contrast(_relative_luminance(DARK_LABEL_COLOR), background)

    return LIGHT_LABEL_COLOR if light_contrast >= dark_contrast else DARK_LABEL_COLOR


def _text_shade(color: str) -> str:
    """`color` itself when it reads on white, else its lightest same-hue darkening that does.

    The brand colours are light, so as text they need darkening; the factor steps down in
    1/255 increments from `color` itself, scaling all three channels to keep the hue.
    """
    white_luminance = _relative_luminance(LIGHT_LABEL_COLOR)
    channels = [int(color[i : i + 2], 16) for i in (1, 3, 5)]
    shade = color

    for step in range(_CHANNEL_MAX, -1, -1):
        shade = "#" + "".join(f"{round(channel * step / _CHANNEL_MAX):02X}" for channel in channels)
        if _contrast(white_luminance, _relative_luminance(shade)) >= MIN_TEXT_CONTRAST:
            break

    return shade


def _relative_luminance(color: str) -> float:
    """WCAG 2 relative luminance of a `#RRGGBB` colour."""
    red, green, blue = (_linear_channel(int(color[i : i + 2], 16)) for i in (1, 3, 5))

    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _linear_channel(value: int) -> float:
    srgb = value / 255

    return srgb / 12.92 if srgb <= 0.03928 else ((srgb + 0.055) / 1.055) ** 2.4


def _contrast(first: float, second: float) -> float:
    lighter, darker = max(first, second), min(first, second)

    return (lighter + 0.05) / (darker + 0.05)


def _document(body: str, *, text_color: str) -> str:
    # Fluid card: 100% wide up to 560px, so a ~311px preview or phone never scrolls sideways.
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        f'<body style="margin:0;padding:0;background:{_PAGE_BACKGROUND};font-family:{_FONT_STACK};'
        f'color:{_TEXT_COLOR};">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="width:100%;background:{_PAGE_BACKGROUND};"><tr>'
        '<td align="center" style="padding:24px 12px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;max-width:560px;margin:0 auto;">'
        '<tr><td style="background:#FFFFFF;border-radius:12px;padding:24px 20px;">'
        f'<p style="margin:0 0 24px;font-size:22px;font-weight:bold;color:{text_color};">{WORDMARK}</p>'
        f"{body}"
        "</td></tr>"
        f'<tr><td align="center" style="padding:16px 0 0;font-size:12px;line-height:18px;'
        f'color:{_MUTED_COLOR};text-align:center;">{FOOTER_TEXT}</td></tr>'
        "</table></td></tr></table></body></html>"
    )
