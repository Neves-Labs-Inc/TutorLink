import pytest
from pydantic import ValidationError

from app.config import MINIMUM_SECRET_KEY_BYTES, PLACEHOLDER_SECRET_KEY, Settings


@pytest.mark.parametrize(
    "secret_key",
    [
        pytest.param("", id="empty"),
        pytest.param("x", id="single-character"),
        pytest.param("a" * (MINIMUM_SECRET_KEY_BYTES - 1), id="one-byte-short"),
        pytest.param("é" * 15, id="thirty-bytes-of-multibyte"),
        pytest.param(PLACEHOLDER_SECRET_KEY, id="env-example-placeholder"),
    ],
)
def test_settings_rejects_a_weak_secret_key(secret_key: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        Settings(secret_key=secret_key)

    errors = excinfo.value.errors()

    assert len(errors) == 1
    assert errors[0]["loc"] == ("secret_key",)
    assert errors[0]["type"] == "value_error"


@pytest.mark.parametrize(
    "secret_key",
    [
        pytest.param("a" * MINIMUM_SECRET_KEY_BYTES, id="exactly-thirty-two-bytes"),
        pytest.param("é" * 16, id="thirty-two-bytes-of-multibyte"),
        pytest.param("0123456789abcdef" * 4, id="sixty-four-hex-characters"),
    ],
)
def test_settings_accepts_a_secret_key_of_at_least_thirty_two_bytes(secret_key: str) -> None:
    assert Settings(secret_key=secret_key).secret_key == secret_key


def test_settings_defaults_cookie_secure_to_true_when_env_var_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("COOKIE_SECURE", raising=False)

    assert Settings(secret_key="a" * MINIMUM_SECRET_KEY_BYTES).cookie_secure is True


def test_settings_honours_an_explicit_false_cookie_secure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("COOKIE_SECURE", "false")

    assert Settings(secret_key="a" * MINIMUM_SECRET_KEY_BYTES).cookie_secure is False


def test_settings_error_never_repeats_the_rejected_secret_key() -> None:
    secret_key = "sekrit"

    with pytest.raises(ValidationError) as excinfo:
        Settings(secret_key=secret_key)

    rendered = [
        str(excinfo.value),
        repr(excinfo.value),
        excinfo.value.json(include_input=False),
        *(str(error) for error in excinfo.value.errors(include_input=False)),
    ]

    assert all(secret_key not in text for text in rendered)
