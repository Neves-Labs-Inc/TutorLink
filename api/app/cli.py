"""Command-line entry points. Invoked as `python -m app.cli <subcommand>`.

No public setup endpoint exists, or ever will (D-018): the first admin account is created
here, from the environment or an interactive prompt, never over HTTP.
"""

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
        outcome = "exists"
    else:
        user = User(
            email=normalized_email,
            hashed_password=hash_password(password),
            role=UserRole.ADMIN,
            tutor_id=None,
            is_active=True,
        )
        db.add(user)
        db.commit()
        outcome = "created"

    return outcome


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("seed-admin", help="Create the first admin account, idempotently.")

    args = parser.parse_args(argv)

    if args.command == "seed-admin":
        status = _run_seed_admin()
    else:
        parser.error(f"unknown command: {args.command}")
        status = 2

    return status


def _run_seed_admin() -> int:
    status = 2
    email = _resolve_email()

    if email is not None:
        password = _resolve_password()

        if password is not None:
            error = _validate(email, password)

            if error is not None:
                print(error, file=sys.stderr)
            else:
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
                status = 0

    return status


def _resolve_email() -> str | None:
    value = os.environ.get("TUTORLINK_ADMIN_EMAIL")

    if value is not None:
        email = value
    elif not sys.stdin.isatty():
        print("missing TUTORLINK_ADMIN_EMAIL and stdin is not a TTY", file=sys.stderr)
        email = None
    else:
        email = input("Admin email: ")

    return email


def _resolve_password() -> str | None:
    value = os.environ.get("TUTORLINK_ADMIN_PASSWORD")

    if value is not None:
        password = value
    elif not sys.stdin.isatty():
        print("missing TUTORLINK_ADMIN_PASSWORD and stdin is not a TTY", file=sys.stderr)
        password = None
    else:
        first = getpass.getpass("Admin password: ")
        second = getpass.getpass("Confirm password: ")

        if first != second:
            print("passwords do not match", file=sys.stderr)
            password = None
        else:
            password = first

    return password


def _validate(email: str, password: str) -> str | None:
    normalized_email = email.strip().lower()

    if not normalized_email or "@" not in normalized_email:
        error = "invalid email"
    elif len(password) < MIN_PASSWORD_LENGTH:
        error = f"password must be at least {MIN_PASSWORD_LENGTH} characters"
    elif not password_is_encodable(password):
        error = "password is too long"
    else:
        error = None

    return error


if __name__ == "__main__":
    sys.exit(main())
