import ipaddress
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MINIMUM_SECRET_KEY_BYTES = 32
PLACEHOLDER_SECRET_KEY = "change-me-generate-with-openssl-rand-hex-32"
SECRET_KEY_REMEDY = "generate one with `openssl rand -hex 32`"

TRUSTED_PROXIES_WILDCARD = "*"
TRUSTED_PROXIES_REMEDY = "give the proxy's own IP address or a CIDR block, e.g. 172.20.0.0/16"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(hide_input_in_errors=True)

    database_url: str
    redis_url: str
    secret_key: str
    cookie_secure: bool = True

    # Empty is fail-closed on purpose: with nothing configured no proxy-header middleware is
    # mounted at all, so development, CI, and any deployment that forgets the variable behave
    # exactly as they do today.
    trusted_proxies: str = ""

    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_whatsapp_number: str | None = None
    twilio_status_callback_url: str | None = None

    # Nullable and defaulted for the same reason as the `twilio_*` block above: the app must
    # still boot in a development or test environment with no credentials. The bot refuses to
    # run without this rather than failing lazily at request time. Read from the environment
    # only — never from a file, so Phase 8 can supply it from Secret Manager as an env var.
    anthropic_api_key: str | None = None

    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    @field_validator("secret_key")
    @classmethod
    def _reject_weak_secret_key(cls, value: str) -> str:
        if value == PLACEHOLDER_SECRET_KEY:
            raise ValueError(
                f"SECRET_KEY is still the .env.example placeholder; {SECRET_KEY_REMEDY}"
            )
        if len(value.encode("utf-8")) < MINIMUM_SECRET_KEY_BYTES:
            raise ValueError(
                f"SECRET_KEY must be at least {MINIMUM_SECRET_KEY_BYTES} bytes; {SECRET_KEY_REMEDY}"
            )

        return value

    @property
    def trusted_proxy_hosts(self) -> list[str]:
        """The validated entries, or `[]` when nothing is configured."""
        return _split_trusted_proxies(self.trusted_proxies)

    @field_validator("trusted_proxies")
    @classmethod
    def _reject_unusable_trusted_proxies(cls, value: str) -> str:
        """Refuse any value uvicorn would keep but never match.

        uvicorn's `_TrustedHosts` stores an entry it cannot parse as an address or a network as a
        literal string and compares it verbatim against the peer address, and its own source
        concedes the operator has no way to tell that happened. `TRUSTED_PROXIES=caddy` therefore
        trusts nothing while looking configured, and the symptom is not an error but every caller
        sharing one per-IP rate-limit bucket. Validating with the same `ipaddress.ip_network` call
        uvicorn makes turns that silent misconfiguration into a refusal to boot.

        A hostname cannot be made to work: trust is decided against the ASGI peer address and
        nothing resolves a name. Whoever deploys has to pin the proxy's address or the block it
        sits in.

        `*` and a zero-length prefix — `0.0.0.0/0`, `::/0` — are refused rather than discouraged
        because they believe the forwarded headers of every peer, which restores the full
        spoofability of the per-IP login limit that issue #3 closed with `--no-proxy-headers`.
        That is worse than trusting nothing, because it looks like it is working.
        """
        # These messages name the offending entry deliberately, unlike `_reject_weak_secret_key`:
        # a proxy address is operator-supplied configuration rather than a credential, and an
        # operator debugging a typo has to be told which entry failed.
        for entry in _split_trusted_proxies(value):
            if entry == TRUSTED_PROXIES_WILDCARD:
                raise ValueError(
                    f"TRUSTED_PROXIES entry {entry!r} trusts the forwarded headers of every peer; "
                    f"{TRUSTED_PROXIES_REMEDY}"
                )

            try:
                network = ipaddress.ip_network(entry)
            except ValueError as error:
                raise ValueError(
                    f"TRUSTED_PROXIES entry {entry!r} is not an IP address or CIDR block, so "
                    f"uvicorn would compare it verbatim against the peer and never match; "
                    f"{TRUSTED_PROXIES_REMEDY}"
                ) from error

            if network.prefixlen == 0:
                raise ValueError(
                    f"TRUSTED_PROXIES entry {entry!r} covers every address, which trusts the "
                    f"forwarded headers of every peer; {TRUSTED_PROXIES_REMEDY}"
                )

        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


def _split_trusted_proxies(value: str) -> list[str]:
    return [stripped for entry in value.split(",") if (stripped := entry.strip())]
