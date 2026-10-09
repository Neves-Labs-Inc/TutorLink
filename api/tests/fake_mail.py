"""`fake_mail`: the stand-in for `mail_service.send_email`, installed on every test.

Autouse, unlike `fake_twilio`: nothing may ever reach a real SMTP server, and the forgot-password
route sends from a background task, where a forgotten fixture would be invisible. The fake
replaces `send_email` on `mail_service` itself and on every module in `SEND_CALLERS`, at the
name that module imported, because a `from` import binds the function at import time and
patching `mail_service` alone would not be seen. A ticket that adds a caller adds its dotted
path to `SEND_CALLERS`.

As a backstop, the fixture also replaces `smtplib.SMTP` with a class whose constructor fails the
test, so a send from a module missing from `SEND_CALLERS` fails instead of opening a socket.

Registered for every test by the import in `tests/conftest.py`.
"""

import importlib
import re
import smtplib
from dataclasses import dataclass
from urllib.parse import parse_qs

import pytest

from app.services import mail_service
from app.services.mail_service import MailSendFailed

SEND_CALLERS: tuple[str, ...] = (
    "app.services.user_service",
    "app.services.password_link_service",
)
SEND_FUNCTION_NAME = "send_email"

SET_PASSWORD_PATH = "/set-password"
_SET_PASSWORD_QUERY = re.compile(re.escape(SET_PASSWORD_PATH) + r"\?([^\s\"'<>]+)")
# A template may end the link's sentence with punctuation; `token_urlsafe` never emits these.
_SENTENCE_PUNCTUATION = ".,)"


@dataclass(frozen=True)
class SentEmail:
    to: str
    subject: str
    text: str
    html: str | None


class FakeMail:
    def __init__(self) -> None:
        self.sent: list[SentEmail] = []
        self._failures_left = 0

    def send_email(self, *, to: str, subject: str, text: str, html: str | None = None) -> None:
        if self._failures_left > 0:
            self._failures_left -= 1
            raise MailSendFailed("fake SMTP refused the send")

        self.sent.append(SentEmail(to=to, subject=subject, text=text, html=html))

    def fail_next(self, *, times: int = 1) -> None:
        """Refuse the next `times` sends with `MailSendFailed`."""
        self._failures_left += times


def token_from(email: SentEmail) -> str:
    """The `token` query value of the first `/set-password?token=…` link in `email.text`."""
    match = _SET_PASSWORD_QUERY.search(email.text)
    assert match, f"the email carries no {SET_PASSWORD_PATH} link"
    tokens = parse_qs(match.group(1).rstrip(_SENTENCE_PUNCTUATION)).get("token")
    assert tokens, f"the {SET_PASSWORD_PATH} link carries no token"

    return tokens[0]


def install(monkeypatch: pytest.MonkeyPatch, fake: FakeMail, callers: tuple[str, ...]) -> None:
    """Point each caller's imported `send_email` at `fake`."""
    for dotted_path in callers:
        module = importlib.import_module(dotted_path)
        # A listed caller that does not import the send is a stale entry, and would hide a real send.
        assert hasattr(module, SEND_FUNCTION_NAME), f"{dotted_path} imports no send_email"
        monkeypatch.setattr(module, SEND_FUNCTION_NAME, fake.send_email)


class _RefusedSMTP:
    def __init__(self, *args: object, **kwargs: object) -> None:
        raise AssertionError(
            "a test reached the real SMTP client; add the calling module to SEND_CALLERS"
        )


@pytest.fixture(autouse=True)
def fake_mail(monkeypatch: pytest.MonkeyPatch) -> FakeMail:
    """A `FakeMail` installed on `mail_service` and every caller, with real SMTP refused."""
    fake = FakeMail()
    monkeypatch.setattr(mail_service, SEND_FUNCTION_NAME, fake.send_email)
    install(monkeypatch, fake, SEND_CALLERS)
    monkeypatch.setattr(smtplib, "SMTP", _RefusedSMTP)

    return fake
