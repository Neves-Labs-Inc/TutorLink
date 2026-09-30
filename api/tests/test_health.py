import pytest
from fastapi.testclient import TestClient

from app.routers import health


def test_liveness_is_ok_without_touching_the_database(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail() -> bool:
        raise AssertionError("liveness must not touch the database")

    monkeypatch.setattr(health, "check_database", fail)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_is_ok_when_the_database_answers(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "check_database", lambda: True)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"database": "ok"}


def test_readiness_is_503_when_the_database_is_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "check_database", lambda: False)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"database": "error"}
