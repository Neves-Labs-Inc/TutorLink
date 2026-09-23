import pytest
from pydantic import ValidationError

from app.config import MINIMUM_SECRET_KEY_BYTES, PLACEHOLDER_SECRET_KEY, Settings

VALID_SECRET_KEY = "a" * MINIMUM_SECRET_KEY_BYTES


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


def test_settings_trusts_no_proxy_when_env_var_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TRUSTED_PROXIES", raising=False)

    assert Settings(secret_key=VALID_SECRET_KEY).trusted_proxy_hosts == []


@pytest.mark.parametrize(
    ("trusted_proxies", "expected"),
    [
        pytest.param("", [], id="empty-string"),
        pytest.param("   ", [], id="whitespace-only"),
        pytest.param(",,", [], id="separators-only"),
        pytest.param("10.1.2.3", ["10.1.2.3"], id="bare-ipv4-address"),
        pytest.param("172.20.0.0/16", ["172.20.0.0/16"], id="ipv4-block"),
        pytest.param(
            " 10.1.2.3 , 10.4.5.6 ",
            ["10.1.2.3", "10.4.5.6"],
            id="two-entries-padded-with-whitespace",
        ),
        pytest.param("::1", ["::1"], id="bare-ipv6-address"),
        pytest.param("2001:db8::/32", ["2001:db8::/32"], id="ipv6-block"),
    ],
)
def test_settings_splits_accepted_trusted_proxies(
    trusted_proxies: str, expected: list[str]
) -> None:
    settings = Settings(secret_key=VALID_SECRET_KEY, trusted_proxies=trusted_proxies)

    assert settings.trusted_proxy_hosts == expected


@pytest.mark.parametrize(
    "trusted_proxies",
    [
        pytest.param("*", id="wildcard-alone"),
        pytest.param("10.1.2.3, *", id="wildcard-alongside-a-valid-entry"),
        pytest.param("0.0.0.0/0", id="ipv4-zero-length-prefix"),
        pytest.param("::/0", id="ipv6-zero-length-prefix"),
        pytest.param("caddy", id="hostname"),
        pytest.param("10.1.0.5/24", id="block-with-host-bits-set"),
        pytest.param("10.1.2.999", id="octet-out-of-range"),
        pytest.param("not an ip", id="free-text"),
    ],
)
def test_settings_rejects_a_trusted_proxy_uvicorn_would_not_match(trusted_proxies: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        Settings(secret_key=VALID_SECRET_KEY, trusted_proxies=trusted_proxies)

    errors = excinfo.value.errors()

    assert len(errors) == 1
    assert errors[0]["loc"] == ("trusted_proxies",)
    assert errors[0]["type"] == "value_error"


@pytest.mark.parametrize(
    ("trusted_proxies", "offender"),
    [
        pytest.param("10.1.2.3, caddy", "caddy", id="hostname-after-a-valid-entry"),
        pytest.param("10.1.2.3, *", "*", id="wildcard-after-a-valid-entry"),
        pytest.param("10.1.0.5/24", "10.1.0.5/24", id="block-with-host-bits-set"),
    ],
)
def test_settings_error_names_the_rejected_trusted_proxy(
    trusted_proxies: str, offender: str
) -> None:
    with pytest.raises(ValidationError) as excinfo:
        Settings(secret_key=VALID_SECRET_KEY, trusted_proxies=trusted_proxies)

    assert offender in str(excinfo.value)


def test_settings_defaults_anthropic_api_key_to_none_when_env_var_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    assert Settings(secret_key=VALID_SECRET_KEY).anthropic_api_key is None


def test_settings_reads_anthropic_api_key_when_env_var_is_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    assert Settings(secret_key=VALID_SECRET_KEY).anthropic_api_key == "sk-ant-test"


def test_settings_defaults_twilio_status_callback_url_to_none_when_env_var_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TWILIO_STATUS_CALLBACK_URL", raising=False)

    assert Settings(secret_key=VALID_SECRET_KEY).twilio_status_callback_url is None


def test_settings_reads_twilio_status_callback_url_when_env_var_is_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TWILIO_STATUS_CALLBACK_URL", "https://example.com/webhook/whatsapp/status")

    settings = Settings(secret_key=VALID_SECRET_KEY)

    assert settings.twilio_status_callback_url == "https://example.com/webhook/whatsapp/status"
