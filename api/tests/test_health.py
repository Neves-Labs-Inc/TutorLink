"""Health probe behaviour. No live PostgreSQL or Redis is required."""

import pytest
from fastapi.testclient import TestClient

from app.routers import health


@pytest.fixture
def dependencies_up(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(health, "check_database", lambda: True)
    monkeypatch.setattr(health, "check_redis", lambda: True)


def test_liveness_is_ok_without_touching_dependencies(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail() -> bool:
        raise AssertionError("liveness must not touch dependencies")

    monkeypatch.setattr(health, "check_database", fail)
    monkeypatch.setattr(health, "check_redis", fail)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.usefixtures("dependencies_up")
def test_readiness_is_ok_when_both_dependencies_answer(client: TestClient) -> None:
    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"database": "ok", "redis": "ok"}


def test_readiness_is_503_when_redis_is_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "check_database", lambda: True)
    monkeypatch.setattr(health, "check_redis", lambda: False)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"database": "ok", "redis": "error"}


def test_readiness_is_503_when_database_is_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "check_database", lambda: False)
    monkeypatch.setattr(health, "check_redis", lambda: True)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"database": "error", "redis": "ok"}
