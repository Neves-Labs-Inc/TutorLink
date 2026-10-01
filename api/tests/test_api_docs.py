"""`API_DOCS_ENABLED`, driven end to end through `create_app()`.

Follows `test_trusted_proxies.py`'s pattern: a fresh app is built per test through `create_app()`
with `API_DOCS_ENABLED` set through `monkeypatch`, and `get_settings.cache_clear()` runs on the
way in and on the way out so a rewritten value never reaches a later test's module-level `app`.
"""

from collections.abc import Callable, Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app

API_DOCS_ENABLED_ENV = "API_DOCS_ENABLED"

BuildApp = Callable[[bool], FastAPI]


def test_docs_are_served_when_enabled(build_app: BuildApp) -> None:
    client = TestClient(build_app(True))

    response = client.get("/docs")

    assert response.status_code == 200
    assert "swagger" in response.text.lower()


@pytest.mark.parametrize("url", ["/docs", "/redoc", "/openapi.json"])
def test_docs_are_a_404_when_disabled(build_app: BuildApp, url: str) -> None:
    client = TestClient(build_app(False))

    response = client.get(url)

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


@pytest.fixture
def build_app(monkeypatch: pytest.MonkeyPatch) -> Generator[BuildApp, None, None]:
    def build(docs_enabled: bool) -> FastAPI:
        monkeypatch.setenv(API_DOCS_ENABLED_ENV, "true" if docs_enabled else "false")
        get_settings.cache_clear()

        return create_app()

    try:
        yield build
    finally:
        get_settings.cache_clear()
