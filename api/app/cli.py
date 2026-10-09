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

`purge-prelaunch-data` is a one-off for go-live: run it once, by hand, then delete the command
and its tests after launch.
"""

import argparse
import datetime
import getpass
import os
import sys
from dataclasses import dataclass

import psycopg.errors
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.db import SessionLocal
from app.models.booking import Booking
from app.models.booking_reminder import BookingReminder
from app.models.booking_reminder_run import BookingReminderRun
from app.models.bot_flow_state import BotFlowState
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import Language, UserRole
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.user import User
from app.security import MIN_PASSWORD_LENGTH, hash_password, password_is_encodable
from app.services import clock
from app.services.phone_service import (
    InvalidPhoneNumber,
    PhoneNumberError,
    normalize_phone_number,
)
from app.services.reminder_service import TemplateNotApproved, send_sample
from app.services.retention_scheduler import run_guarded_purge
from app.services.twilio_service import TwilioSendFailed, TwilioServiceError
from app.services.name_rules import InvalidName, normalize_name

# Bounds the wait for the table locks, so an idle-in-transaction session cannot make the purge
# (and the bot's writes queued behind it) wait forever.
PRELAUNCH_LOCK_TIMEOUT = "10s"

# FK-safe: every table is deleted before the tables it references. The link tables and
# bot_flow_state have no creation timestamp, so they are not checked against the cutoff; they
# go with the rows they belong to.
PRELAUNCH_DELETE_ORDER: tuple[type, ...] = (
    ReminderConsent,
    BookingReminder,
    # No FKs. A test week's run marker would otherwise make that week read as already run.
    BookingReminderRun,
    Booking,
    ChildSubjectLevel,
    Message,
    Conversation,
    GuardianHome,
    ChildHome,
    ChildGuardian,
    Home,
    Child,
    Guardian,
    BotFlowState,
)


def seed_admin(db: Session, *, email: str, password: str, name: str) -> str:
    """Create the first admin, or confirm one already exists. Never resets a password.

    Raises `InvalidName` for a blank or over-long name, before anything is written.
    """
    normalized_email = email.strip().lower()
    name = normalize_name(name)
    existing = db.scalars(select(User).where(User.email == normalized_email)).first()

    if existing is not None:
        outcome = "exists"
    else:
        user = User(
            email=normalized_email,
            name=name,
            name_is_default=False,
            hashed_password=hash_password(password),
            role=UserRole.ADMIN,
            is_active=True,
        )
        db.add(user)
        db.commit()
        outcome = "created"

    return outcome


def seed_developer(db: Session, *, email: str, password: str, name: str) -> str:
    """Create the first developer, or leave an existing account alone.

    Three outcomes rather than two. `conflict` is the one that matters: an email already held
    by an admin or a tutor is **not** promoted. Silently upgrading an existing account would
    make this command a way around #13's rule that nobody reaches `developer` by promotion,
    and would hand the holder of that mailbox more access than whoever ran the command
    intended.

    Raises `InvalidName` for a blank or over-long name, before anything is written.
    """
    normalized_email = email.strip().lower()
    name = normalize_name(name)
    existing = db.scalars(select(User).where(User.email == normalized_email)).first()

    if existing is None:
        user = User(
            email=normalized_email,
            name=name,
            name_is_default=False,
            hashed_password=hash_password(password),
            role=UserRole.DEVELOPER,
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


class PurgeLockTimeoutError(Exception):
    """The purged tables could not be locked within `PRELAUNCH_LOCK_TIMEOUT`."""


@dataclass(frozen=True, slots=True)
class PrelaunchPurge:
    """`newer_tables` non-empty means nothing was deleted and `deleted` is empty."""

    deleted: dict[str, int]
    newer_tables: tuple[str, ...]


def purge_prelaunch_data(db: Session, *, cutoff: datetime.datetime) -> PrelaunchPurge:
    """Delete the test data written before launch. Does not commit: the caller owns the
    transaction, so the whole purge lands or none of it does."""
    # Blocks concurrent writes (reads stay open) until this transaction ends, so a row cannot
    # arrive between the cutoff check and the DELETEs. Taken in delete order, always.
    try:
        db.execute(text(f"SET LOCAL lock_timeout = '{PRELAUNCH_LOCK_TIMEOUT}'"))
        for model in PRELAUNCH_DELETE_ORDER:
            db.execute(text(f"LOCK TABLE {model.__tablename__} IN SHARE ROW EXCLUSIVE MODE"))
    except OperationalError as error:
        if not isinstance(error.orig, psycopg.errors.LockNotAvailable):
            raise
        raise PurgeLockTimeoutError from error
    newer_tables = tuple(
        model.__tablename__
        for model in PRELAUNCH_DELETE_ORDER
        if (created := _creation_time(model)) is not None
        and db.scalar(select(func.count()).select_from(model).where(created > cutoff))
    )
    deleted: dict[str, int] = {}

    if not newer_tables:
        for model in PRELAUNCH_DELETE_ORDER:
            deleted[model.__tablename__] = db.execute(delete(model)).rowcount

    return PrelaunchPurge(deleted=deleted, newer_tables=newer_tables)


def _creation_time(model: type) -> InstrumentedAttribute[datetime.datetime] | None:
    """The column a table's rows are checked against the cutoff by: `created_at`, or a run
    marker's `ran_at` (when the run wrote it). `None`: the table has no such timestamp."""
    if model is BookingReminderRun:
        column: InstrumentedAttribute[datetime.datetime] | None = BookingReminderRun.ran_at
    else:
        column = getattr(model, "created_at", None)

    return column


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
    seed_admin_parser = subparsers.add_parser(
        "seed-admin", help="Create the first admin account, idempotently."
    )
    # The flag keeps its name; the field it writes is `users.name`.
    seed_admin_parser.add_argument(
        "--display-name", dest="name", help="Else TUTORLINK_ADMIN_DISPLAY_NAME."
    )
    create_developer_parser = subparsers.add_parser(
        "create-developer", help="Create a developer account. Never promotes an existing user."
    )
    create_developer_parser.add_argument(
        "--display-name", dest="name", help="Else TUTORLINK_DEVELOPER_DISPLAY_NAME."
    )
    subparsers.add_parser(
        "purge-messages", help="Delete messages past chat_retention_days, and empty threads."
    )
    send_test_reminder = subparsers.add_parser(
        "send-test-reminder",
        help="Send the real Booking reminder template to one phone. Writes nothing.",
    )
    send_test_reminder.add_argument("--to", required=True, help="The phone to send it to.")
    send_test_reminder.add_argument(
        "--language", required=True, choices=[language.value for language in Language]
    )
    purge_prelaunch = subparsers.add_parser(
        "purge-prelaunch-data",
        help="One-off: delete test Guardians, Children, bookings and chats written before launch.",
    )
    purge_prelaunch.add_argument("--confirm", action="store_true")
    purge_prelaunch.add_argument("--cutoff", help="ISO 8601 datetime with an offset.")

    args = parser.parse_args(argv)

    if args.command == "seed-admin":
        status = _run_seed_admin(name=args.name)
    elif args.command == "create-developer":
        status = _run_create_developer(name=args.name)
    elif args.command == "purge-messages":
        status = _run_purge_messages()
    elif args.command == "send-test-reminder":
        status = _run_send_test_reminder(to=args.to, language=Language(args.language))
    elif args.command == "purge-prelaunch-data":
        status = _run_purge_prelaunch_data(confirm=args.confirm, cutoff_text=args.cutoff)
    else:
        parser.error(f"unknown command: {args.command}")
        status = 2

    return status


def _run_seed_admin(name: str | None = None) -> int:
    status = 2
    email = _resolve_email(env_var="TUTORLINK_ADMIN_EMAIL", prompt="Admin email: ")
    name = _resolve_name(
        given=name, env_var="TUTORLINK_ADMIN_DISPLAY_NAME", prompt="Admin display name: "
    )

    if email is not None and name is not None:
        password = _resolve_password(env_var="TUTORLINK_ADMIN_PASSWORD", prompt="Admin password: ")

        if password is not None:
            error = _validate(email, password, name)

            if error is not None:
                print(error, file=sys.stderr)
            else:
                normalized_email = email.strip().lower()
                db = SessionLocal()
                try:
                    result = seed_admin(db, email=normalized_email, password=password, name=name)
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


def _run_send_test_reminder(*, to: str, language: Language) -> int:
    """Send one reminder template with sample Children and next Monday; print its SID.

    No row, no chat copy, no eligibility check: it tests the template, not the run. Non-zero
    when the template's ContentSid is blank, the number cannot be read, or Twilio refuses.
    """
    status = 1
    db = SessionLocal()
    try:
        phone_number = normalize_phone_number(db, raw=to)
        twilio_sid = send_sample(db, to=phone_number, language=language, now=clock.business_now())
    except InvalidPhoneNumber:
        print(f"not a phone number: {to}", file=sys.stderr)
    except PhoneNumberError as exc:
        # A deploy problem, e.g. `default_phone_country_code` maps to no region.
        print(f"cannot read the phone number: {exc}", file=sys.stderr)
    except TemplateNotApproved as exc:
        print(f"{exc}; set it before sending a test reminder", file=sys.stderr)
    except TwilioServiceError as exc:
        code = exc.code if isinstance(exc, TwilioSendFailed) else None
        print(f"the send failed: {exc} (code {code})", file=sys.stderr)
    else:
        print(f"sent {language.value} test reminder: {twilio_sid}")
        status = 0
    finally:
        db.close()

    return status


def _parse_cutoff(text: str | None) -> datetime.datetime | None:
    cutoff = None

    if text is not None:
        try:
            parsed = datetime.datetime.fromisoformat(text)
        except ValueError:
            parsed = None
        # A naive cutoff would silently be read in the server's zone; require an offset.
        if parsed is not None and parsed.tzinfo is not None:
            cutoff = parsed

    return cutoff


def _run_purge_prelaunch_data(*, confirm: bool, cutoff_text: str | None) -> int:
    cutoff = _parse_cutoff(cutoff_text)
    status = 1

    if not confirm:
        print("refusing to purge: pass --confirm", file=sys.stderr)
    elif cutoff is None:
        print(
            "refusing to purge: --cutoff is required, an ISO 8601 datetime with an offset",
            file=sys.stderr,
        )
    else:
        db = SessionLocal()
        try:
            # The database's clock, not the host's: row timestamps come from the former.
            database_now = db.scalar(select(func.now()))
            purge: PrelaunchPurge | None = None
            if database_now is not None and cutoff > database_now:
                print("refusing to purge: --cutoff is in the future", file=sys.stderr)
            else:
                try:
                    purge = purge_prelaunch_data(db, cutoff=cutoff)
                except PurgeLockTimeoutError:
                    db.rollback()
                    print("could not lock tables, try again; nothing deleted", file=sys.stderr)
            # Commit either way: it releases the table locks. A refused purge ran no DELETE.
            if purge is not None:
                db.commit()
        finally:
            db.close()

        if purge is not None and purge.newer_tables:
            print(
                "refusing to purge, nothing deleted: rows newer than the cutoff in "
                + ", ".join(purge.newer_tables),
                file=sys.stderr,
            )
        elif purge is not None:
            for table, count in purge.deleted.items():
                print(f"{table}: {count}")
            status = 0

    return status


def _run_create_developer(name: str | None = None) -> int:
    status = 2
    email = _resolve_email(env_var="TUTORLINK_DEVELOPER_EMAIL", prompt="Developer email: ")
    name = _resolve_name(
        given=name,
        env_var="TUTORLINK_DEVELOPER_DISPLAY_NAME",
        prompt="Developer display name: ",
    )

    if email is not None and name is not None:
        password = _resolve_password(
            env_var="TUTORLINK_DEVELOPER_PASSWORD", prompt="Developer password: "
        )

        if password is not None:
            error = _validate(email, password, name)

            if error is not None:
                print(error, file=sys.stderr)
            else:
                normalized_email = email.strip().lower()
                db = SessionLocal()
                try:
                    result = seed_developer(
                        db, email=normalized_email, password=password, name=name
                    )
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


def _resolve_name(*, given: str | None, env_var: str, prompt: str) -> str | None:
    """`--display-name`, else the environment, else a prompt — the email's order, flag first."""
    value = given if given is not None else os.environ.get(env_var)

    if value is not None:
        name = value
    elif not sys.stdin.isatty():
        print(f"missing --display-name or {env_var} and stdin is not a TTY", file=sys.stderr)
        name = None
    else:
        name = input(prompt)

    return name


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


def _validate(email: str, password: str, name: str) -> str | None:
    normalized_email = email.strip().lower()
    name_error = _name_error(name)

    if not normalized_email or "@" not in normalized_email:
        error = "invalid email"
    elif name_error is not None:
        error = name_error
    elif len(password) < MIN_PASSWORD_LENGTH:
        error = f"password must be at least {MIN_PASSWORD_LENGTH} characters"
    elif not password_is_encodable(password):
        error = "password is too long"
    else:
        error = None

    return error


def _name_error(name: str) -> str | None:
    """The shared validator's message for an unusable name, or `None`; never a traceback."""
    try:
        normalize_name(name)
    except InvalidName as exc:
        error: str | None = str(exc)
    else:
        error = None

    return error


if __name__ == "__main__":
    sys.exit(main())
