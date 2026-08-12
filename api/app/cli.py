"""Command-line entry points. Invoked as `python -m app.cli <subcommand>`.

No public setup endpoint exists, or ever will (D-018): the first admin account is created
here, from the environment or an interactive prompt, never over HTTP.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models.enums import UserRole
from app.models.user import User
from app.security import hash_password, password_is_encodable

MIN_PASSWORD_LENGTH = 8


def seed_admin(db: Session, *, email: str, password: str) -> str:
    """Create the first admin, or confirm one already exists. Never resets a password."""
    normalized_email = email.strip().lower()

    existing = db.scalars(select(User).where(User.email == normalized_email)).first()
    if existing is not None:
        return "exists"

    user = User(
        email=normalized_email,
        hashed_password=hash_password(password),
        role=UserRole.ADMIN,
        tutor_id=None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    return "created"


def _validate(email: str, password: str) -> str | None:
    normalized_email = email.strip().lower()
    if not normalized_email or "@" not in normalized_email:
        return "invalid email"
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"password must be at least {MIN_PASSWORD_LENGTH} characters"
    if not password_is_encodable(password):
        return "password is too long"
    return None


def _resolve_email() -> str | None:
    value = os.environ.get("TUTORLINK_ADMIN_EMAIL")
    if value is not None:
        return value
    if not sys.stdin.isatty():
        print("missing TUTORLINK_ADMIN_EMAIL and stdin is not a TTY", file=sys.stderr)
        return None
    return input("Admin email: ")


def _resolve_password() -> str | None:
    value = os.environ.get("TUTORLINK_ADMIN_PASSWORD")
    if value is not None:
        return value
    if not sys.stdin.isatty():
        print("missing TUTORLINK_ADMIN_PASSWORD and stdin is not a TTY", file=sys.stderr)
        return None
    first = getpass.getpass("Admin password: ")
    second = getpass.getpass("Confirm password: ")
    if first != second:
        print("passwords do not match", file=sys.stderr)
        return None
    return first


def _run_seed_admin() -> int:
    email = _resolve_email()
    if email is None:
        return 2

    password = _resolve_password()
    if password is None:
        return 2

    error = _validate(email, password)
    if error is not None:
        print(error, file=sys.stderr)
        return 2

    normalized_email = email.strip().lower()

    db = SessionLocal()
    try:
        result = seed_admin(db, email=normalized_email, password=password)
    finally:
        db.close()

    if result == "exists":
        print(f"admin already exists: {normalized_email} (no change)")
    else:
        print(f"created admin: {normalized_email}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("seed-admin", help="Create the first admin account, idempotently.")

    args = parser.parse_args(argv)

    if args.command == "seed-admin":
        return _run_seed_admin()

    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
