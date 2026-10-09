"""`POST /api/settings/email-templates/preview` over the wire: the email an unsaved draft would
produce, with sample values, sending and writing nothing."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.dependencies import ADMIN_REQUIRED_ERROR, CREDENTIALS_ERROR
from app.models.enums import UserRole
from app.models.password_link import PasswordLink
from app.models.system_setting import SystemSetting
from app.models.user import User
from app.security import create_access_token, hash_password
from tests.fake_mail import FakeMail

PREVIEW_URL = "/api/settings/email-templates/preview"
SETTINGS_URL = "/api/settings"
BRAND_COLOR_ERROR = "Enter a colour like #74C8C9."
PASSWORD = "correct horse battery staple"
SAMPLE_LINK = "http://testserver/set-password?token=example"
FALLBACK_LINK = "https://example.com/set-password?token=example"


def test_a_valid_draft_is_rendered_with_sample_values_and_the_branded_layout(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)

    response = api.post(
        PREVIEW_URL,
        headers=_auth(admin),
        json=_draft(
            "invite",
            "For {name} from {actor_name}",
            "Hi {name}, {actor_name} invited you.\n\n{link}",
            brand_color="#ffe066",
        ),
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"subject", "html"}
    assert payload["subject"] == "For Alex Smith from Your Admin"
    assert "Alex Smith" in payload["html"]
    assert "Your Admin" in payload["html"]
    assert f'<a href="{SAMPLE_LINK}"' in payload["html"]
    assert "background:#FFE066;" in payload["html"]
    assert "Sent by TutorLink" in payload["html"]
    assert fake_mail.sent == []


def test_a_password_reset_draft_is_rendered_too(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        PREVIEW_URL,
        headers=_auth(admin),
        json=_draft("password_reset", "For {name}", "Reset here: {link}"),
    )

    assert response.status_code == 200
    assert response.json()["subject"] == "For Alex Smith"
    assert SAMPLE_LINK in response.json()["html"]


def test_the_saved_brand_colour_is_used_when_none_is_given(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    saved = api.patch(
        SETTINGS_URL,
        headers=_auth(admin),
        json={"updates": [{"key": "email_brand_color", "value": "#0B6E4F"}]},
    )
    assert saved.status_code == 200

    response = api.post(PREVIEW_URL, headers=_auth(admin), json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 200
    assert "background:#0B6E4F;" in response.json()["html"]
    assert "#74C8C9" not in response.json()["html"]


@pytest.mark.parametrize(
    ("template", "subject", "body", "detail"),
    [
        ("invite", "  ", "{link}", "The subject can't be empty."),
        ("invite", "Hi", "no link here", "The body must include {link}."),
        (
            "password_reset",
            "Hi {actor_name}",
            "{link}",
            "Unknown placeholder {actor_name}. Use {name} or {link}.",
        ),
    ],
)
def test_a_draft_breaking_a_rule_is_a_400_with_its_message(
    api: TestClient, db: Session, template: str, subject: str, body: str, detail: str
) -> None:
    admin = _make_user(db)

    response = api.post(PREVIEW_URL, headers=_auth(admin), json=_draft(template, subject, body))

    assert response.status_code == 400
    assert response.json() == {"detail": detail}


@pytest.mark.parametrize("brand_color", ["red", "#FFF", "", "#74C8C9 "])
def test_an_invalid_brand_colour_is_a_400(api: TestClient, db: Session, brand_color: str) -> None:
    admin = _make_user(db)

    response = api.post(
        PREVIEW_URL,
        headers=_auth(admin),
        json=_draft("invite", "Hi", "{link}", brand_color=brand_color),
    )

    assert response.status_code == 400
    assert response.json() == {"detail": BRAND_COLOR_ERROR}


def test_the_template_rules_are_checked_before_the_colour(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        PREVIEW_URL, headers=_auth(admin), json=_draft("invite", "", "{link}", brand_color="red")
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "The subject can't be empty."}


def test_without_a_public_base_url_the_example_link_is_used(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = _make_user(db)
    monkeypatch.setenv("PUBLIC_BASE_URL", "")
    get_settings.cache_clear()
    try:
        response = api.post(
            PREVIEW_URL, headers=_auth(admin), json=_draft("invite", "Hi", "{link}")
        )
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()

    assert response.status_code == 200
    assert f'<a href="{FALLBACK_LINK}"' in response.json()["html"]


def test_a_tutor_is_refused(api: TestClient, db: Session) -> None:
    tutor = _make_user(db, role=UserRole.TUTOR)

    response = api.post(PREVIEW_URL, headers=_auth(tutor), json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 403
    assert response.json() == {"detail": ADMIN_REQUIRED_ERROR}


def test_no_token_is_401(api: TestClient) -> None:
    response = api.post(PREVIEW_URL, json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 401
    assert response.json() == {"detail": CREDENTIALS_ERROR}


def test_nothing_is_sent_or_written(api: TestClient, db: Session, fake_mail: FakeMail) -> None:
    admin = _make_user(db)
    links_before = db.scalar(select(func.count()).select_from(PasswordLink))
    settings_before = _settings_snapshot(db)

    response = api.post(PREVIEW_URL, headers=_auth(admin), json=_draft("invite", "Hi", "{link}"))

    assert response.status_code == 200
    assert fake_mail.sent == []
    assert db.scalar(select(func.count()).select_from(PasswordLink)) == links_before
    assert _settings_snapshot(db) == settings_before


def _settings_snapshot(db: Session) -> list[tuple[str, str]]:
    rows = db.scalars(select(SystemSetting).order_by(SystemSetting.key)).all()

    return [(row.key, row.value) for row in rows]


def _draft(
    template: str, subject: str, body: str, *, brand_color: str | None = None
) -> dict[str, Any]:
    draft: dict[str, Any] = {"template": template, "subject": subject, "body": body}
    if brand_color is not None:
        draft["brand_color"] = brand_color
    return draft


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=role,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=None)

    return {"Authorization": f"Bearer {token}"}
