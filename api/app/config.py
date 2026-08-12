"""Typed application configuration, sourced exclusively from the environment."""

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MINIMUM_SECRET_KEY_BYTES = 32
PLACEHOLDER_SECRET_KEY = "change-me-generate-with-openssl-rand-hex-32"
SECRET_KEY_REMEDY = "generate one with `openssl rand -hex 32`"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(hide_input_in_errors=True)

    database_url: str
    redis_url: str
    secret_key: str
    debug: bool = False

    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_whatsapp_number: str | None = None

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
