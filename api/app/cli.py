"""Command-line entry points. Invoked as `python -m app.cli <subcommand>`.

No public setup endpoint exists, or ever will (D-018): the first admin account is created
here, from the environment or an interactive prompt, never over HTTP.

`create-developer` exists for a second reason. An admin may not create a `developer` and may
not promote anyone to it, so the system cannot bootstrap its own super-user over the API — the
first one has to come from here.

Neither command ever resets a password or changes an existing account's role. An email that is
already taken is reported and left alone. Recovering from a lockout means running the command
again with a *fresh* email, which is why it is repeatable; it does not mean overwriting the
credentials of an account someone may still be using.
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
from app.services.retention_scheduler import run_guarded_purge
from app.services.user_service import resolve_display_name

MIN_PASSWORD_LENGTH = 8


def seed_admin(db: Session, *, email: str, password: str, display_name: str | None = None) -> str:
    """Create the first admin, or confirm one already exists. Never resets a password."""
    normalized_email = email.strip().lower()
    existing = db.scalars(select(User).where(User.email == normalized_email)).first()

    if existing is not None:
        outcome = "exists"
    else:
        name = resolve_display_name(
            display_name=display_name, email=normalized_email, tutor_name=None
        )
        user = User(
            email=normalized_email,
            display_name=name.value,
            display_name_is_default=name.is_default,
            hashed_password=hash_password(password),
            role=UserRole.ADMIN,
            tutor_id=None,
            is_active=True,
        )
        db.add(user)
        db.commit()
        outcome = "created"

    return outcome


def seed_developer(
    db: Session, *, email: str, password: str, display_name: str | None = None
) -> str:
    """Create the first developer, or leave an existing account alone.

    Three outcomes rather than two. `conflict` is the one that matters: an email already held
    by an admin or a tutor is **not** promoted. Silently upgrading an existing account would
    make this command a way around #13's rule that nobody reaches `developer` by promotion,
    and would hand the holder of that mailbox more access than whoever ran the command
    intended.
    """
    normalized_email = email.strip().lower()
    existing = db.scalars(select(User).where(User.email == normalized_email)).first()

    if existing is None:
        name = resolve_display_name(
            display_name=display_name, email=normalized_email, tutor_name=None
        )
        user = User(
            email=normalized_email,
            display_name=name.value,
            display_name_is_default=name.is_default,
            hashed_password=hash_password(password),
            role=UserRole.DEVELOPER,
            tutor_id=None,
            is_active=True,
        )
        db.add(user)
        db.commit()
        outcome = "created"
    elif existing.role is UserRole.DEVELOPER:
        outcome = "exists"
    else:
        outcome = "conflict"

    return outcome


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("seed-admin", help="Create the first admin account, idempotently.")
    subparsers.add_parser(
        "create-developer", help="Create a developer account. Never promotes an existing user."
    )
    subparsers.add_parser(
        "purge-messages", help="Delete messages past chat_retention_days, and empty threads."
    )

    args = parser.parse_args(argv)

    if args.command == "seed-admin":
        status = _run_seed_admin()
    elif args.command == "create-developer":
        status = _run_create_developer()
    elif args.command == "purge-messages":
        status = _run_purge_messages()
    else:
        parser.error(f"unknown command: {args.command}")
        status = 2

    return status


def _run_seed_admin() -> int:
    status = 2
    email = _resolve_email(env_var="TUTORLINK_ADMIN_EMAIL", prompt="Admin email: ")

    if email is not None:
        password = _resolve_password(env_var="TUTORLINK_ADMIN_PASSWORD", prompt="Admin password: ")

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


def _run_purge_messages() -> int:
    run = run_guarded_purge(SessionLocal)

    if run.purge is None:
        # Non-zero: the operator asked for a purge and this invocation did not perform one.
        print("skipped: another instance holds the lock", file=sys.stderr)
        status = 1
    else:
        if not run.purge.ran:
            print("chat_retention_days is 0; purge disabled, nothing deleted")
        else:
            print(
                f"purged {run.purge.messages_deleted} message(s) and "
                f"{run.purge.conversations_deleted} conversation(s)"
            )
        print(
            f"reaped {run.flow_states_deleted} expired flow state(s) and "
            f"{run.login_attempts_deleted} expired login attempt(s)"
        )
        status = 0

    return status


def _run_create_developer() -> int:
    status = 2
    email = _resolve_email(env_var="TUTORLINK_DEVELOPER_EMAIL", prompt="Developer email: ")

    if email is not None:
        password = _resolve_password(
            env_var="TUTORLINK_DEVELOPER_PASSWORD", prompt="Developer password: "
        )

        if password is not None:
            error = _validate(email, password)

            if error is not None:
                print(error, file=sys.stderr)
            else:
                normalized_email = email.strip().lower()
                db = SessionLocal()
                try:
                    result = seed_developer(db, email=normalized_email, password=password)
                    existing_role = (
                        db.scalars(select(User).where(User.email == normalized_email)).one().role
                    )
                finally:
                    db.close()

                if result == "conflict":
                    # Non-zero: the operator asked for a developer and did not get one.
                    print(
                        f"{normalized_email} already exists with role "
                        f"{existing_role.value}; not promoted",
                        file=sys.stderr,
                    )
                else:
                    if result == "exists":
                        print(f"developer already exists: {normalized_email} (no change)")
                    else:
                        print(f"created developer: {normalized_email}")
                    status = 0

    return status


def _resolve_email(*, env_var: str, prompt: str) -> str | None:
    value = os.environ.get(env_var)

    if value is not None:
        email = value
    elif not sys.stdin.isatty():
        print(f"missing {env_var} and stdin is not a TTY", file=sys.stderr)
        email = None
    else:
        email = input(prompt)

    return email


def _resolve_password(*, env_var: str, prompt: str) -> str | None:
    value = os.environ.get(env_var)

    if value is not None:
        password = value
    elif not sys.stdin.isatty():
        print(f"missing {env_var} and stdin is not a TTY", file=sys.stderr)
        password = None
    else:
        first = getpass.getpass(prompt)
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
