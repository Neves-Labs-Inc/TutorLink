"""`POST /api/settings/email-templates/test` over the wire: an unsaved draft emailed to the
signed-in user, with the `fake_mail` fixture capturing the send."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.enums import UserRole
from app.models.password_link import PasswordLink
from app.models.system_setting import SystemSetting
from app.models.user import User
from app.security import create_access_token, hash_password
from tests.fake_mail import FakeMail

TEST_URL = "/api/settings/email-templates/test"
PASSWORD = "correct horse battery staple"
SEND_FAILED_ERROR = "The test email couldn't be sent. Check the mail settings and try again."
DUMMY_LINK = "http://testserver/set-password?token=example"


@pytest.mark.parametrize(
    ("template", "subject", "body", "expected_subject", "expected_text"),
    [
        (
            "invite",
            "For {name} from {actor_name}",
            "Hi {name}, {actor_name} invited you: {link}",
            "[Test] For Ada <Lovelace> from Ada <Lovelace>",
            f"Hi Ada <Lovelace>, Ada <Lovelace> invited you: {DUMMY_LINK}",
        ),
        (
            "password_reset",
            "For {name}",
            "Hi {name}, reset here: {link}",
            "[Test] For Ada <Lovelace>",
            f"Hi Ada <Lovelace>, reset here: {DUMMY_LINK}",
        ),
    ],
)
def test_a_valid_draft_is_emailed_to_the_admin_with_the_dummy_link(
    api: TestClient,
    db: Session,
    fake_mail: FakeMail,
    template: str,
    subject: str,
    body: str,
    expected_subject: str,
    expected_text: str,
) -> None:
    admin = _make_user(db, name="Ada <Lovelace>")

    response = api.post(TEST_URL, headers=_auth(admin), json=_draft(template, subject, body))

    assert response.status_code == 204
    assert response.content == b""
    [email] = fake_mail.sent
    assert email.to == admin.email
    assert email.subject == expected_subject
    assert email.text == expected_text
    assert email.html is not None
    assert "Ada &lt;Lovelace&gt;" in email.html
    assert f'<a href="{DUMMY_LINK}"' in email.html
    assert f">{DUMMY_LINK}</a>" in email.html
    assert "TutorLink</p>" in email.html
    assert "Sent by TutorLink" in email.html
    assert "#2F4A9E" in email.html


@pytest.mark.parametrize(
    ("template", "subject", "body", "detail"),
    [
        ("invite", "  ", "{link}", "The subject can't be empty."),
        ("invite", "a\nb", "{link}", "The subject must be a single line."),
        ("invite", "a" * 201, "{link}", "The subject can be at most 200 characters."),
        ("invite", "Hi", " ", "The body can't be empty."),
        ("invite", "Hi", "{link}" + "a" * 5000, "The body can be at most 5000 characters."),
        (
            "invite",
            "Hi {nmae}",
            "{link}",
            "Unknown placeholder {nmae}. Use {name}, {actor_name} or {link}.",
        ),
        (
            "password_reset",
            "Hi {actor_name}",
            "{link}",
            "Unknown placeholder {actor_name}. Use {name} or {link}.",
        ),
        ("invite", "Hi", "no link here", "The body must include {link}."),
    ],
)
def test_a_draft_breaking_a_rule_is_a_400_with_its_message_and_sends_nothing(
    api: TestClient,
    db: Session,
    fake_mail: FakeMail,
    template: str,
    subject: str,
    body: str,
    detail: str,
) -> None:
    admin = _make_user(db)

    response = api.post(TEST_URL, headers=_auth(admin), json=_draft(template, subject, body))

    assert response.status_code == 400
    assert response.json() == {"detail": detail}
    assert fake_mail.sent == []


def test_an_unknown_template_is_the_framework_validation_error(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)

    response = api.post(TEST_URL, headers=_auth(admin), json=_draft("welcome", "Hi", "{link}"))

    # The app's handler turns every request-validation failure into a 400.
    assert response.status_code == 400


def test_a_tutor_is_refused_and_nothing_is_sent(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    tutor = _make_user(db, role=UserRole.TUTOR)

    response = api.post(TEST_URL, headers=_auth(tutor), json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 403
    assert response.json() == {"detail": ADMIN_REQUIRED_ERROR}
    assert fake_mail.sent == []


def test_no_token_is_401(api: TestClient) -> None:
    response = api.post(TEST_URL, json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 401
    assert response.json() == {"detail": CREDENTIALS_ERROR}


def test_a_mail_failure_is_a_502_with_the_fixed_detail(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    fake_mail.fail_next()

    response = api.post(TEST_URL, headers=_auth(admin), json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 502
    assert response.json() == {"detail": SEND_FAILED_ERROR}


def test_nothing_is_written_to_the_database(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    links_before = db.scalar(select(func.count()).select_from(PasswordLink))
    settings_before = _settings_snapshot(db)

    response = api.post(TEST_URL, headers=_auth(admin), json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 204
    assert db.scalar(select(func.count()).select_from(PasswordLink)) == links_before
    assert _settings_snapshot(db) == settings_before


def _settings_snapshot(db: Session) -> list[tuple[str, str]]:
    rows = db.scalars(select(SystemSetting).order_by(SystemSetting.key)).all()

    return [(row.key, row.value) for row in rows]


def _draft(template: str, subject: str, body: str) -> dict[str, Any]:
    return {"template": template, "subject": subject, "body": body}


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN, name: str = "Test User") -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name=name,
        hashed_password=hash_password(PASSWORD),
        role=role,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=None)

    return {"Authorization": f"Bearer {token}"}
