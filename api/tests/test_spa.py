"""The catch-all `app/spa.py` registers, driven end to end through `create_app()`.

Follows `test_trusted_proxies.py`'s pattern: a fresh app is built per test through `create_app()`
with `DASHBOARD_DIST_DIR` (and, where relevant, `API_DOCS_ENABLED`) set through `monkeypatch`, and
`get_settings.cache_clear()` runs on the way in and on the way out so a rewritten value never
reaches a later test's module-level `app`.
"""

from collections.abc import Callable, Generator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.main import create_app
from app.redis_client import get_redis
from tests.conftest import FakeRedis

DASHBOARD_DIST_DIR_ENV = "DASHBOARD_DIST_DIR"
API_DOCS_ENABLED_ENV = "API_DOCS_ENABLED"

INDEX_BODY = "<html><body>dashboard</body></html>"
BUNDLE_BODY = "console.log('bundle');"
FAVICON_BODY = "<svg></svg>"

BuildApp = Callable[..., FastAPI]


def test_a_client_side_route_and_the_root_serve_the_index(dashboard_app: FastAPI) -> None:
    client = TestClient(dashboard_app)

    for path in ("/children/123", "/"):
        response = client.get(path)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert response.text == INDEX_BODY
        assert response.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize(
    ("path", "body"),
    [
        pytest.param("/assets/app-abc.js", BUNDLE_BODY, id="hashed-bundle"),
        pytest.param("/favicon.svg", FAVICON_BODY, id="top-level-favicon"),
    ],
)
def test_assets_and_top_level_files_are_served(
    dashboard_app: FastAPI, path: str, body: str
) -> None:
    client = TestClient(dashboard_app)

    response = client.get(path)

    assert response.status_code == 200
    assert response.text == body


@pytest.mark.parametrize(
    "path",
    ["/api/does-not-exist", "/auth/nope", "/webhook/nope", "/api"],
)
def test_reserved_prefixes_never_fall_through_to_the_index(
    dashboard_app: FastAPI, path: str
) -> None:
    client = TestClient(dashboard_app)

    response = client.get(path)

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_health_is_not_shadowed_by_the_catch_all(dashboard_app: FastAPI) -> None:
    client = TestClient(dashboard_app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_auth_token_still_reaches_the_auth_route(dashboard_app: FastAPI) -> None:
    client = TestClient(dashboard_app)

    response = client.post(
        "/auth/token",
        data={"username": "nobody@example.com", "password": "not the password"},
    )

    assert response.status_code in (400, 401, 429)
    assert response.headers["content-type"].startswith("application/json")


def test_docs_are_served_when_enabled(dashboard_app: FastAPI) -> None:
    client = TestClient(dashboard_app)

    response = client.get("/docs")

    assert response.status_code == 200
    assert "swagger" in response.text.lower()


@pytest.mark.parametrize(
    "path",
    [
        pytest.param("/..%2f..%2fetc%2fpasswd", id="encoded-parent-segments"),
        pytest.param("/assets/../index.html", id="dot-segment-through-assets"),
    ],
)
def test_traversal_attempts_never_escape_the_dist_directory(
    dashboard_app: FastAPI, path: str
) -> None:
    client = TestClient(dashboard_app)

    response = client.get(path)

    assert response.status_code == 200
    assert response.text == INDEX_BODY


def test_children_is_a_404_json_without_a_dashboard_dist_dir(
    build_dashboard_app: BuildApp,
) -> None:
    built = build_dashboard_app(dist_dir=None)
    client = TestClient(built)

    response = client.get("/children")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_create_app_refuses_a_dist_dir_without_an_index_html(
    build_dashboard_app: BuildApp, tmp_path: Path
) -> None:
    empty_dist = tmp_path / "empty"
    empty_dist.mkdir()

    with pytest.raises(RuntimeError):
        build_dashboard_app(dist_dir=empty_dist)


@pytest.mark.parametrize("url", ["/docs", "/redoc", "/openapi.json"])
def test_docs_disabled_with_the_spa_mounted_falls_through_to_the_index(
    build_dashboard_app: BuildApp, dist_dir: Path, url: str
) -> None:
    built = build_dashboard_app(dist_dir=dist_dir, docs_enabled=False)
    client = TestClient(built)

    response = client.get(url)

    assert response.status_code == 200
    assert response.text == INDEX_BODY


@pytest.mark.parametrize("url", ["/docs", "/redoc", "/openapi.json"])
def test_docs_disabled_without_the_spa_is_a_404(build_dashboard_app: BuildApp, url: str) -> None:
    built = build_dashboard_app(dist_dir=None, docs_enabled=False)
    client = TestClient(built)

    response = client.get(url)

    assert response.status_code == 404


def test_the_websocket_route_still_accepts_a_connection_when_the_spa_is_mounted(
    dashboard_app: FastAPI,
) -> None:
    client = TestClient(dashboard_app)

    with client.websocket_connect("/api/conversations/stream"):
        pass


@pytest.fixture
def dist_dir(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX_BODY)
    (dist / "favicon.svg").write_text(FAVICON_BODY)
    (dist / "assets" / "app-abc.js").write_text(BUNDLE_BODY)

    return dist


@pytest.fixture
def build_dashboard_app(
    monkeypatch: pytest.MonkeyPatch, db: Session
) -> Generator[BuildApp, None, None]:
    def build(*, dist_dir: Path | None, docs_enabled: bool | None = None) -> FastAPI:
        if dist_dir is None:
            monkeypatch.delenv(DASHBOARD_DIST_DIR_ENV, raising=False)
        else:
            monkeypatch.setenv(DASHBOARD_DIST_DIR_ENV, str(dist_dir))

        if docs_enabled is None:
            monkeypatch.delenv(API_DOCS_ENABLED_ENV, raising=False)
        else:
            monkeypatch.setenv(API_DOCS_ENABLED_ENV, "true" if docs_enabled else "false")

        get_settings.cache_clear()
        built = create_app()
        built.dependency_overrides[get_db] = lambda: db
        built.dependency_overrides[get_redis] = lambda: FakeRedis()

        return built

    try:
        yield build
    finally:
        get_settings.cache_clear()


@pytest.fixture
def dashboard_app(build_dashboard_app: BuildApp, dist_dir: Path) -> FastAPI:
    return build_dashboard_app(dist_dir=dist_dir)
