"""The Invite and Password reset email templates: stored in `system_settings`, edited through
`/api/settings`, and rendered by the invite and forgot-password routes.

Expected copy and messages are literals from the spec, never rebuilt the way the renderer
builds them.
"""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.user import User
from app.security import create_access_token, hash_password
from app.services.mail_templates import _text_shade
from tests.fake_mail import FakeMail, SentEmail, token_from

SETTINGS_URL = "/api/settings"
FORGOT_URL = "/auth/password/forgot"
PASSWORD = "correct horse battery staple"
LINK_PREFIX = "http://testserver/set-password?token="

INVITE_SUBJECT = "email_invite_subject"
INVITE_BODY = "email_invite_body"
RESET_SUBJECT = "email_reset_subject"
RESET_BODY = "email_reset_body"
INVITE_COLOR = "email_invite_brand_color"
RESET_COLOR = "email_reset_brand_color"
COLOR_KEYS = [INVITE_COLOR, RESET_COLOR]

BRAND_COLOR_ERROR = "Enter a colour like #74C8C9."
WHITE_LABEL = "color:#FFFFFF;"
DARK_LABEL = "color:#111827;"

DEFAULT_INVITE_BODY = (
    "Hi {name},\n"
    "\n"
    "{actor_name} has added you to TutorLink. To get started, choose your password using the"
    " link below:\n"
    "\n"
    "{link}\n"
    "\n"
    "This link works once and expires in 7 days. If it expires, ask {actor_name} to send you a"
    " new invite.\n"
    "\n"
    "See you soon,\n"
    "The TutorLink team"
)
DEFAULT_RESET_BODY = (
    "Hi {name},\n"
    "\n"
    "We received a request to reset your TutorLink password. Choose a new one using the link"
    " below:\n"
    "\n"
    "{link}\n"
    "\n"
    "This link works once and expires in 48 hours. If you didn't ask for this, you can safely"
    " ignore this email and your password won't change.\n"
    "\n"
    "The TutorLink team"
)

# Names an Admin typed, with markup in them, so the HTML part has something to escape.
ACTOR_NAME = "Rita <b>Admin</b> & Co"
ACTOR_NAME_ESCAPED = "Rita &lt;b&gt;Admin&lt;/b&gt; &amp; Co"
RECIPIENT_NAME = 'Ann "<i>" Lee'
RECIPIENT_NAME_ESCAPED = 'Ann "&lt;i&gt;" Lee'

INVITE_UNKNOWN = "Unknown placeholder {nmae}. Use {name}, {actor_name} or {link}."
RESET_UNKNOWN = "Unknown placeholder {actor_name}. Use {name} or {link}."


# --- reading and saving through /api/settings -------------------------------------------------


def test_an_admin_reads_the_four_template_rows_with_the_default_copy(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)

    body = api.get(SETTINGS_URL, headers=_auth(admin)).json()

    values = {item["key"]: item["value"] for item in body["items"]}
    assert values[INVITE_SUBJECT] == "{actor_name} invited you to TutorLink"
    assert values[INVITE_BODY] == DEFAULT_INVITE_BODY
    assert values[RESET_SUBJECT] == "Reset your TutorLink password"
    assert values[RESET_BODY] == DEFAULT_RESET_BODY
    template_items = [item for item in body["items"] if item["key"].startswith("email_")]
    assert {item["value_type"] for item in template_items} == {"string"}


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        pytest.param({INVITE_SUBJECT: "   "}, "The subject can't be empty.", id="empty-subject"),
        pytest.param(
            {INVITE_SUBJECT: "Hello\nthere"}, "The subject must be a single line.", id="newline"
        ),
        pytest.param(
            {RESET_SUBJECT: "Hello\rthere"},
            "The subject must be a single line.",
            id="carriage-return",
        ),
        pytest.param(
            {INVITE_SUBJECT: "x" * 201},
            "The subject can be at most 200 characters.",
            id="long-subject",
        ),
        pytest.param({INVITE_BODY: " \n\t"}, "The body can't be empty.", id="empty-body"),
        pytest.param(
            {RESET_BODY: "{link}" + "x" * 4995},
            "The body can be at most 5000 characters.",
            id="long-body",
        ),
        pytest.param({INVITE_BODY: "Hi {nmae}, {link}"}, INVITE_UNKNOWN, id="invite-unknown"),
        pytest.param(
            {INVITE_SUBJECT: "Welcome {nmae}"}, INVITE_UNKNOWN, id="invite-unknown-in-subject"
        ),
        pytest.param({RESET_BODY: "{actor_name} {link}"}, RESET_UNKNOWN, id="reset-unknown"),
        pytest.param(
            {INVITE_BODY: "Hi {name}, no link here"}, "The body must include {link}.", id="no-link"
        ),
        # First failure wins: the subject rules run before the body rules.
        pytest.param(
            {INVITE_SUBJECT: "", INVITE_BODY: ""}, "The subject can't be empty.", id="order"
        ),
        pytest.param(
            {RESET_SUBJECT: "Hi {bad}", RESET_BODY: "no link"},
            "Unknown placeholder {bad}. Use {name} or {link}.",
            id="unknown-before-missing-link",
        ),
    ],
)
def test_an_invalid_template_is_refused_with_its_message(
    api: TestClient, db: Session, updates: dict[str, str], message: str
) -> None:
    admin = _make_user(db)

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=_payload(updates))

    assert response.status_code == 400
    assert response.json() == {"detail": message}


def test_a_subject_of_exactly_200_characters_and_a_body_of_5000_are_accepted(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    body = "{link}" + "x" * 4994

    response = api.patch(
        SETTINGS_URL,
        headers=_auth(admin),
        json=_payload({INVITE_SUBJECT: "x" * 200, INVITE_BODY: body}),
    )

    assert response.status_code == 200


def test_a_valid_edit_saves_and_literal_braces_are_text(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    body = "Hi {name}, {Not a placeholder} {}\n{link}"

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=_payload({RESET_BODY: body}))

    assert response.status_code == 200
    values = {item["key"]: item["value"] for item in response.json()["items"]}
    assert values[RESET_BODY] == body


def test_a_subject_only_edit_is_checked_on_its_own(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.patch(
        SETTINGS_URL, headers=_auth(admin), json=_payload({INVITE_SUBJECT: "Welcome, {name}"})
    )

    assert response.status_code == 200
    values = {item["key"]: item["value"] for item in response.json()["items"]}
    assert values[INVITE_SUBJECT] == "Welcome, {name}"


# --- the brand colour ----------------------------------------------------------------------------


@pytest.mark.parametrize("key", COLOR_KEYS)
def test_an_admin_reads_each_emails_colour_with_its_default(
    api: TestClient, db: Session, key: str
) -> None:
    admin = _make_user(db)

    body = api.get(SETTINGS_URL, headers=_auth(admin)).json()

    [item] = [item for item in body["items"] if item["key"] == key]
    assert item == {
        "key": key,
        "value": "#74C8C9",
        "value_type": "string",
        "is_developer_only": False,
    }


def test_the_shared_brand_colour_is_gone(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    body = api.get(SETTINGS_URL, headers=_auth(admin)).json()

    assert "email_brand_color" not in {item["key"] for item in body["items"]}


@pytest.mark.parametrize("key", COLOR_KEYS)
def test_a_colour_is_saved_uppercase_on_that_email_only(
    api: TestClient, db: Session, key: str
) -> None:
    admin = _make_user(db)
    [other_key] = [color_key for color_key in COLOR_KEYS if color_key != key]

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=_payload({key: "#ffe066"}))

    assert response.status_code == 200
    values = {item["key"]: item["value"] for item in response.json()["items"]}
    assert values[key] == "#FFE066"
    assert values[other_key] == "#74C8C9"


@pytest.mark.parametrize("key", COLOR_KEYS)
@pytest.mark.parametrize("value", ["red", "#FFF", "#GGGGGG", "", "#74C8C9 "])
def test_an_invalid_colour_is_refused_with_the_colour_message(
    api: TestClient, db: Session, key: str, value: str
) -> None:
    admin = _make_user(db)

    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=_payload({key: value}))

    assert response.status_code == 400
    assert response.json() == {"detail": BRAND_COLOR_ERROR}
    values = {
        item["key"]: item["value"]
        for item in api.get(SETTINGS_URL, headers=_auth(admin)).json()["items"]
    }
    assert values[key] == "#74C8C9"


def test_the_invite_uses_its_own_saved_colour(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    invitee = _make_user(db, password=None)
    _save(api, admin, {INVITE_COLOR: "#ffe066", RESET_COLOR: "#0B6E4F"})

    api.post(f"/api/users/{invitee.id}/invite", headers=_auth(admin))

    (email,) = fake_mail.sent
    assert email.html is not None
    # The button keeps the exact colour; wordmark and links use a darker shade that reads on white.
    assert "background:#FFE066;" in email.html
    assert 'font-weight:bold;color:#FFE066;">TutorLink</p>' not in email.html
    assert 'style="color:#FFE066;word-break:break-all;"' not in email.html
    shade = _text_shade("#FFE066")
    assert shade != "#FFE066"
    assert f'font-weight:bold;color:{shade};">TutorLink</p>' in email.html
    assert f'style="color:{shade};word-break:break-all;"' in email.html
    assert "#74C8C9" not in email.html
    assert "#0B6E4F" not in email.html
    # A light colour gets the dark label.
    assert f"{DARK_LABEL}font-size:16px;font-weight:bold;" in email.html
    assert f"{WHITE_LABEL}font-size:16px;font-weight:bold;" not in email.html


def test_the_reset_email_uses_its_own_saved_colour(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    user = _make_user(db)
    _save(
        api,
        admin,
        {INVITE_COLOR: "#ffe066", RESET_COLOR: "#0B6E4F", RESET_BODY: "{link}\n\nOr open {link}"},
    )

    api.post(FORGOT_URL, json={"email": user.email})

    (email,) = fake_mail.sent
    assert email.html is not None
    assert 'font-weight:bold;color:#0B6E4F;">TutorLink</p>' in email.html
    assert "background:#0B6E4F;" in email.html
    assert 'style="color:#0B6E4F;word-break:break-all;"' in email.html
    assert 'style="color:#0B6E4F;">' in email.html
    assert "#74C8C9" not in email.html
    assert "#FFE066" not in email.html
    # A dark colour gets the white label.
    assert f"{WHITE_LABEL}font-size:16px;font-weight:bold;" in email.html


BRAND_COLOR_PRESETS = {
    "Turquoise": "#74C8C9",
    "Lavender": "#CB9BC3",
    "Beige/Gold": "#D6B990",
    "Olive": "#C4BD82",
}
PRESET_COLORS = list(BRAND_COLOR_PRESETS.values())


@pytest.mark.parametrize("preset", PRESET_COLORS)
def test_the_invite_applies_each_brand_preset_and_its_text_shade(
    api: TestClient, db: Session, fake_mail: FakeMail, preset: str
) -> None:
    admin = _make_user(db)
    invitee = _make_user(db, password=None)
    _save(api, admin, {INVITE_COLOR: preset})

    api.post(f"/api/users/{invitee.id}/invite", headers=_auth(admin))

    (email,) = fake_mail.sent
    assert email.html is not None
    _assert_preset_and_shade(email.html, preset)


@pytest.mark.parametrize("preset", PRESET_COLORS)
def test_the_reset_email_applies_each_brand_preset_and_its_text_shade(
    api: TestClient, db: Session, fake_mail: FakeMail, preset: str
) -> None:
    admin = _make_user(db)
    user = _make_user(db)
    _save(api, admin, {RESET_COLOR: preset, RESET_BODY: "{link}\n\nOr open {link}"})

    api.post(FORGOT_URL, json={"email": user.email})

    (email,) = fake_mail.sent
    assert email.html is not None
    _assert_preset_and_shade(email.html, preset)
    assert f'style="color:{_text_shade(preset)};">' in email.html


def test_the_default_brand_colour_gets_the_dark_label(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    user = _make_user(db)

    api.post(FORGOT_URL, json={"email": user.email})

    (email,) = fake_mail.sent
    assert email.html is not None
    assert "background:#74C8C9;" in email.html
    # The default turquoise is light.
    assert f"{DARK_LABEL}font-size:16px;font-weight:bold;" in email.html
    assert f"{WHITE_LABEL}font-size:16px;font-weight:bold;" not in email.html


# --- the invite route ----------------------------------------------------------------------------


def test_the_invite_renders_the_saved_template(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db, name=ACTOR_NAME)
    invitee = _make_user(db, name=RECIPIENT_NAME, password=None)
    _save(
        api,
        admin,
        {
            INVITE_SUBJECT: "{name}, join {actor_name}",
            INVITE_BODY: "Hello {name},\n\n{actor_name} says hi.\nOpen {link} today.",
        },
    )

    response = api.post(f"/api/users/{invitee.id}/invite", headers=_auth(admin))

    assert response.status_code == 200
    (email,) = fake_mail.sent
    link = _link_in(email)
    assert email.subject == f"{RECIPIENT_NAME}, join {ACTOR_NAME}"
    assert email.text == f"Hello {RECIPIENT_NAME},\n\n{ACTOR_NAME} says hi.\nOpen {link} today."
    assert email.html is not None
    assert f">Hello {RECIPIENT_NAME_ESCAPED},</p>" in email.html
    assert f'>{ACTOR_NAME_ESCAPED} says hi.<br>Open <a href="{link}"' in email.html
    assert f">{link}</a> today.</p>" in email.html
    assert "Set your password" not in email.html
    assert "<b>" not in email.html


def test_the_invite_carries_the_default_copy(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db, name="Rita Admin")
    invitee = _make_user(db, name="Ann Lee", password=None)

    api.post(f"/api/users/{invitee.id}/invite", headers=_auth(admin))

    (email,) = fake_mail.sent
    link = _link_in(email)
    assert email.subject == "Rita Admin invited you to TutorLink"
    assert email.text == (
        "Hi Ann Lee,\n"
        "\n"
        "Rita Admin has added you to TutorLink. To get started, choose your password using the"
        " link below:\n"
        "\n"
        f"{link}\n"
        "\n"
        "This link works once and expires in 7 days. If it expires, ask Rita Admin to send you"
        " a new invite.\n"
        "\n"
        "See you soon,\n"
        "The TutorLink team"
    )
    assert email.html is not None
    assert ">See you soon,<br>The TutorLink team</p>" in email.html
    assert "TutorLink</p>" in email.html
    assert "Sent by TutorLink" in email.html
    assert "#74C8C9" in email.html
    assert f'href="{link}"' in email.html
    assert ">Set your password</a>" in email.html
    assert "Or paste this link into your browser:" in email.html
    assert f">{link}</a>" in email.html
    assert "width:100%;max-width:560px" in email.html


# --- the forgot-password route --------------------------------------------------------------------


def test_the_reset_email_renders_the_saved_template(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    admin = _make_user(db)
    user = _make_user(db, name=RECIPIENT_NAME)
    _save(
        api,
        admin,
        {
            RESET_SUBJECT: "Reset for {name}",
            RESET_BODY: "Hey {name}\n\nGo to {link}\n\nBye",
        },
    )

    response = api.post(FORGOT_URL, json={"email": user.email})

    assert response.status_code == 202
    (email,) = fake_mail.sent
    link = _link_in(email)
    assert email.subject == f"Reset for {RECIPIENT_NAME}"
    assert email.text == f"Hey {RECIPIENT_NAME}\n\nGo to {link}\n\nBye"
    assert email.html is not None
    assert f">Hey {RECIPIENT_NAME_ESCAPED}</p>" in email.html
    assert f'>Go to <a href="{link}"' in email.html
    assert f">{link}</a></p>" in email.html
    assert "Reset password" not in email.html


def test_the_reset_email_carries_the_default_copy(
    api: TestClient, db: Session, fake_mail: FakeMail
) -> None:
    user = _make_user(db, name="Ann Lee")

    api.post(FORGOT_URL, json={"email": user.email})

    (email,) = fake_mail.sent
    link = _link_in(email)
    assert email.subject == "Reset your TutorLink password"
    assert email.text == (
        "Hi Ann Lee,\n"
        "\n"
        "We received a request to reset your TutorLink password. Choose a new one using the link"
        " below:\n"
        "\n"
        f"{link}\n"
        "\n"
        "This link works once and expires in 48 hours. If you didn't ask for this, you can"
        " safely ignore this email and your password won't change.\n"
        "\n"
        "The TutorLink team"
    )
    assert email.html is not None
    assert ">Reset password</a>" in email.html
    assert f'href="{link}"' in email.html
    assert "Or paste this link into your browser:" in email.html
    assert "Sent by TutorLink" in email.html


# --- helpers ------------------------------------------------------------------------------------


def _make_user(db: Session, *, name: str = "Test User", password: str | None = PASSWORD) -> User:
    user = User(
        email=f"user-{uuid.uuid4().hex[:12]}@example.com",
        name=name,
        hashed_password=None if password is None else hash_password(password),
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()

    return user


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.profile_id)

    return {"Authorization": f"Bearer {token}"}


def _payload(updates: dict[str, str]) -> dict[str, Any]:
    return {"updates": [{"key": key, "value": value} for key, value in updates.items()]}


def _save(api: TestClient, admin: User, updates: dict[str, str]) -> None:
    response = api.patch(SETTINGS_URL, headers=_auth(admin), json=_payload(updates))
    assert response.status_code == 200, response.json()


def _assert_preset_and_shade(html: str, preset: str) -> None:
    shade = _text_shade(preset)

    assert f"background:{preset};" in html
    assert f'font-weight:bold;color:{shade};">TutorLink</p>' in html
    assert f'style="color:{shade};word-break:break-all;"' in html
    # The raw preset is too light to read as text, so it must not colour any.
    assert shade != preset
    assert f"color:{preset};" not in html


def _link_in(email: SentEmail) -> str:
    return f"{LINK_PREFIX}{token_from(email)}"
