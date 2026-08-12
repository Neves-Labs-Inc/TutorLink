"""Tests for the idempotent first-admin seed command."""

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.cli as cli_module
from app.cli import _run_seed_admin, _validate, seed_admin
from app.models.user import User
from app.security import verify_password


def test_creates_exactly_one_admin_whose_password_verifies(db: Session) -> None:
    result = seed_admin(db, email="admin@tutorlink.test", password="change-me-please")

    assert result == "created"
    users = db.scalars(select(User)).all()
    assert len(users) == 1
    admin = users[0]
    assert admin.email == "admin@tutorlink.test"
    assert admin.role.value == "admin"
    assert admin.tutor_id is None
    assert admin.is_active is True
    assert verify_password("change-me-please", admin.hashed_password)


def test_second_call_creates_nothing_and_returns_exists(db: Session) -> None:
    seed_admin(db, email="admin@tutorlink.test", password="change-me-please")

    result = seed_admin(db, email="admin@tutorlink.test", password="change-me-please")

    assert result == "exists"
    users = db.scalars(select(User)).all()
    assert len(users) == 1


def test_second_call_with_different_password_leaves_hash_untouched(db: Session) -> None:
    seed_admin(db, email="admin@tutorlink.test", password="change-me-please")
    original = db.scalars(select(User)).one()
    original_hash = original.hashed_password

    seed_admin(db, email="admin@tutorlink.test", password="totally-different")

    admin = db.scalars(select(User)).one()
    assert admin.hashed_password == original_hash
    assert verify_password("change-me-please", admin.hashed_password)
    assert not verify_password("totally-different", admin.hashed_password)


def test_email_is_normalised(db: Session) -> None:
    seed_admin(db, email="  ADMIN@X.COM ", password="change-me-please")

    result = seed_admin(db, email="admin@x.com", password="something-else")

    assert result == "exists"
    users = db.scalars(select(User)).all()
    assert len(users) == 1
    assert users[0].email == "admin@x.com"


def test_short_password_is_rejected() -> None:
    error = _validate("admin@tutorlink.test", "short")

    assert error is not None


def test_over_72_byte_password_is_rejected() -> None:
    error = _validate("admin@tutorlink.test", "x" * 73)

    assert error is not None


def test_no_secret_appears_in_stdout_or_stderr(db: Session, capsys, monkeypatch) -> None:
    monkeypatch.setenv("TUTORLINK_ADMIN_EMAIL", "admin@tutorlink.test")
    monkeypatch.setenv("TUTORLINK_ADMIN_PASSWORD", "change-me-please")
    # Reuse the rolled-back fixture session instead of opening a real one against `tutorlink`.
    monkeypatch.setattr(cli_module, "SessionLocal", lambda: db)

    exit_code = _run_seed_admin()

    assert exit_code == 0

    captured = capsys.readouterr()
    admin = db.scalars(select(User)).one()

    assert "change-me-please" not in captured.out
    assert "change-me-please" not in captured.err
    assert admin.hashed_password not in captured.out
    assert admin.hashed_password not in captured.err
