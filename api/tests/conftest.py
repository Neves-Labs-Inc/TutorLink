"""Shared fixtures. Populates the environment `Settings` requires before the app is imported."""

import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key")


@pytest.fixture
def client() -> TestClient:
    # Imported lazily: app.db builds the engine at import time and needs the environment above.
    from app.main import app

    return TestClient(app)
