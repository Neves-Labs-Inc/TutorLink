"""Constraints added for levels, Evaluated, language, reminders and system messages, and the
round trip of migrations 0021-0025, against a real PostgreSQL.

Each rejection runs inside its own `begin_nested()`, for the reason
`test_conversation_models.py` gives: a failed statement aborts the surrounding transaction.
"""

import datetime
import os
import pathlib
import uuid
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, make_url, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.booking_reminder import BookingReminder
from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    Language,
    MessageAuthor,
    MessageStatus,
    ReminderSkipReason,
    ReminderStatus,
    SystemMessageKind,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.security import hash_password

ALEMBIC_DIRECTORY = pathlib.Path(__file__).resolve().parents[1] / "alembic"

GRADE_RANGE_CONSTRAINT = "ck_children_grade_level_range"
EVALUATED_PAIR_CONSTRAINT = "ck_children_evaluated_pair"
LEVEL_RANGE_CONSTRAINT = "ck_child_subject_levels_level_range"
CHILD_SUBJECT_UNIQUE = "uq_child_subject_levels_child_subject"
MAX_GRADE_RANGE_CONSTRAINT = "ck_tutor_subjects_max_grade_level_range"
SKIP_PAIR_CONSTRAINT = "ck_booking_reminders_skip_pair"
LANGUAGE_CONSTRAINT = "ck_conversations_language"
GUARDIAN_WEEK_UNIQUE = "uq_booking_reminders_guardian_week"
AUTHOR_USER_CONSTRAINT = "ck_messages_admin_author_pair"
SYSTEM_KIND_PAIR_CONSTRAINT = "ck_messages_system_kind_pair"

LOWEST_GRADE = 0
HIGHEST_GRADE = 12
OUT_OF_RANGE_GRADES = (-1, 13)
IN_RANGE_GRADES = (LOWEST_GRADE, HIGHEST_GRADE)

EVALUATED_AT = datetime.datetime(2026, 10, 5, 15, 0, tzinfo=datetime.UTC)
WEEK_START = datetime.date(2026, 10, 12)

NEW_SETTINGS = {
    "reminder_weekday": ("7", "integer", False),
    "reminder_hour": ("18", "integer", False),
    "business_timezone": ("America/New_York", "string", False),
    "reminder_template_sid_en": ("", "string", True),
    "reminder_template_sid_es": ("", "string", True),
}
GENERIC_TAKEOVER_SETTINGS = {
    "takeover_generic_template_sid_en": ("", "string", True),
    "takeover_generic_template_sid_es": ("", "string", True),
}
# Seeded by 0021 and 0025, deleted by 0027 once Takeover was confined to the window.
TAKEOVER_TEMPLATE_SETTINGS = {
    "takeover_template_sid_en": ("", "string", True),
    "takeover_template_sid_es": ("", "string", True),
    **GENERIC_TAKEOVER_SETTINGS,
}


@pytest.mark.parametrize("grade", OUT_OF_RANGE_GRADES)
def test_an_overall_grade_outside_k_to_12_is_rejected(db: Session, grade: int) -> None:
    with pytest.raises(IntegrityError, match=GRADE_RANGE_CONSTRAINT), db.begin_nested():
        db.add(_child(grade_level=grade))
        db.flush()


@pytest.mark.parametrize("grade", IN_RANGE_GRADES)
def test_an_overall_grade_of_k_or_12_is_accepted(db: Session, grade: int) -> None:
    child = _child(grade_level=grade)
    db.add(child)
    db.flush()

    assert child.grade_level == grade


@pytest.mark.parametrize("has_when", [True, False])
def test_half_an_evaluation_is_rejected(db: Session, has_when: bool) -> None:
    """Evaluated is one fact with two halves: who and when. Either alone is incoherent."""
    staff = _make_user(db)
    child = _child(
        evaluated_at=EVALUATED_AT if has_when else None,
        evaluated_by_user_id=None if has_when else staff.id,
    )

    with pytest.raises(IntegrityError, match=EVALUATED_PAIR_CONSTRAINT), db.begin_nested():
        db.add(child)
        db.flush()


def test_a_complete_evaluation_is_accepted(db: Session) -> None:
    staff = _make_user(db)
    child = _child(evaluated_at=EVALUATED_AT, evaluated_by_user_id=staff.id)
    db.add(child)
    db.flush()

    assert child.evaluated_by_user_id == staff.id


@pytest.mark.parametrize("level", OUT_OF_RANGE_GRADES)
def test_a_subject_level_outside_k_to_12_is_rejected(db: Session, level: int) -> None:
    child, subject, staff = _make_child(db), _make_subject(db), _make_user(db)

    with pytest.raises(IntegrityError, match=LEVEL_RANGE_CONSTRAINT), db.begin_nested():
        db.add(_level(child, subject, staff, level=level))
        db.flush()


@pytest.mark.parametrize("level", IN_RANGE_GRADES)
def test_a_subject_level_of_k_or_12_is_accepted(db: Session, level: int) -> None:
    child, subject, staff = _make_child(db), _make_subject(db), _make_user(db)
    row = _level(child, subject, staff, level=level)
    db.add(row)
    db.flush()

    assert row.level == level


def test_a_child_has_one_level_per_subject(db: Session) -> None:
    child, subject, staff = _make_child(db), _make_subject(db), _make_user(db)
    db.add(_level(child, subject, staff, level=3))
    db.flush()

    with pytest.raises(IntegrityError, match=CHILD_SUBJECT_UNIQUE), db.begin_nested():
        db.add(_level(child, subject, staff, level=4))
        db.flush()


def test_deleting_a_child_deletes_its_subject_levels(db: Session) -> None:
    child, subject, staff = _make_child(db), _make_subject(db), _make_user(db)
    db.add(_level(child, subject, staff, level=3))
    db.flush()

    db.delete(child)
    db.flush()

    remaining = db.scalar(
        select(func.count())
        .select_from(ChildSubjectLevel)
        .where(ChildSubjectLevel.child_id == child.id)
    )
    assert remaining == 0


@pytest.mark.parametrize("ceiling", OUT_OF_RANGE_GRADES)
def test_a_tutor_ceiling_outside_k_to_12_is_rejected(db: Session, ceiling: int) -> None:
    tutor, subject = _make_tutor(db), _make_subject(db)

    with pytest.raises(IntegrityError, match=MAX_GRADE_RANGE_CONSTRAINT), db.begin_nested():
        db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=ceiling))
        db.flush()


@pytest.mark.parametrize("ceiling", IN_RANGE_GRADES)
def test_a_tutor_ceiling_of_k_or_12_is_accepted(db: Session, ceiling: int) -> None:
    tutor, subject = _make_tutor(db), _make_subject(db)
    row = TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=ceiling)
    db.add(row)
    db.flush()

    assert row.max_grade_level == ceiling


def test_a_conversation_language_other_than_en_or_es_is_rejected(db: Session) -> None:
    """Written as raw SQL: the ORM type refuses the value before PostgreSQL could."""
    with pytest.raises(IntegrityError, match=LANGUAGE_CONSTRAINT), db.begin_nested():
        db.execute(
            text("INSERT INTO conversations (phone_number, language) VALUES (:phone, 'fr')"),
            {"phone": _phone_number()},
        )


@pytest.mark.parametrize("language", [Language.EN, Language.ES, None])
def test_a_conversation_language_may_be_en_es_or_undetected(
    db: Session, language: Language | None
) -> None:
    conversation = Conversation(phone_number=_phone_number(), language=language)
    db.add(conversation)
    db.flush()
    db.expire(conversation)

    assert conversation.language == language


def test_a_guardian_gets_one_reminder_per_week(db: Session) -> None:
    guardian = _make_guardian(db)
    db.add(_reminder(guardian))
    db.flush()

    with pytest.raises(IntegrityError, match=GUARDIAN_WEEK_UNIQUE), db.begin_nested():
        db.add(_reminder(guardian))
        db.flush()


def test_a_reminder_records_the_children_it_named(db: Session) -> None:
    guardian = _make_guardian(db)
    children = [_make_child(db), _make_child(db)]
    reminder = _reminder(guardian, child_ids=[child.id for child in children])
    db.add(reminder)
    db.flush()
    db.expire(reminder)

    assert reminder.child_ids == [child.id for child in children]
    assert reminder.status is ReminderStatus.SENT


@pytest.mark.parametrize(
    ("status", "skip_reason"),
    [
        (ReminderStatus.SKIPPED, None),
        (ReminderStatus.SENT, ReminderSkipReason.TAKEOVER),
    ],
)
def test_a_skip_reason_goes_with_a_skip_and_only_a_skip(
    db: Session, status: ReminderStatus, skip_reason: ReminderSkipReason | None
) -> None:
    guardian = _make_guardian(db)

    with pytest.raises(IntegrityError, match=SKIP_PAIR_CONSTRAINT), db.begin_nested():
        db.add(_reminder(guardian, status=status, skip_reason=skip_reason))
        db.flush()


def test_a_skipped_reminder_with_its_reason_is_accepted(db: Session) -> None:
    guardian = _make_guardian(db)
    reminder = _reminder(
        guardian,
        status=ReminderStatus.SKIPPED,
        skip_reason=ReminderSkipReason.TEMPLATE_NOT_APPROVED,
    )
    db.add(reminder)
    db.flush()

    assert reminder.skip_reason is ReminderSkipReason.TEMPLATE_NOT_APPROVED


def test_consent_rows_append_with_their_source(db: Session) -> None:
    guardian = _make_guardian(db)
    staff = _make_user(db)
    db.add(
        ReminderConsent(
            guardian_id=guardian.id,
            action=ConsentAction.OPT_IN,
            source=ConsentSource.INTAKE,
            phone_number=guardian.phone_number,
        )
    )
    db.add(
        ReminderConsent(
            guardian_id=guardian.id,
            action=ConsentAction.OPT_OUT,
            source=ConsentSource.STAFF,
            set_by_user_id=staff.id,
        )
    )
    db.flush()

    actions = db.scalars(
        select(ReminderConsent.action).where(ReminderConsent.guardian_id == guardian.id)
    ).all()
    assert sorted(actions) == [ConsentAction.OPT_IN, ConsentAction.OPT_OUT]


@pytest.mark.parametrize("has_user", [True, False])
def test_a_system_message_may_carry_the_staff_member_who_caused_it(
    db: Session, has_user: bool
) -> None:
    conversation = _make_conversation(db)
    staff = _make_user(db)
    message = _message(
        conversation,
        author_kind=MessageAuthor.SYSTEM,
        author_user_id=staff.id if has_user else None,
        system_kind=SystemMessageKind.TAKEOVER_NOTICE,
    )
    db.add(message)
    db.flush()

    assert message.system_kind is SystemMessageKind.TAKEOVER_NOTICE


def test_a_bot_message_carrying_a_user_is_still_rejected(db: Session) -> None:
    conversation = _make_conversation(db)
    staff = _make_user(db)

    with pytest.raises(IntegrityError, match=AUTHOR_USER_CONSTRAINT), db.begin_nested():
        db.add(_message(conversation, author_kind=MessageAuthor.BOT, author_user_id=staff.id))
        db.flush()


def test_a_system_message_without_a_kind_is_rejected(db: Session) -> None:
    conversation = _make_conversation(db)

    with pytest.raises(IntegrityError, match=SYSTEM_KIND_PAIR_CONSTRAINT), db.begin_nested():
        db.add(_message(conversation, author_kind=MessageAuthor.SYSTEM))
        db.flush()


def test_a_non_system_message_with_a_kind_is_rejected(db: Session) -> None:
    conversation = _make_conversation(db)

    with pytest.raises(IntegrityError, match=SYSTEM_KIND_PAIR_CONSTRAINT), db.begin_nested():
        db.add(
            _message(
                conversation,
                author_kind=MessageAuthor.BOT,
                system_kind=SystemMessageKind.BOOKING_REMINDER,
            )
        )
        db.flush()


def test_a_manager_user_can_be_stored(db: Session) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    db.expire(manager)

    assert manager.role is UserRole.MANAGER


def test_migrations_0021_to_0024_backfill_display_names_and_round_trip(
    _migration_engine: Engine,
) -> None:
    """Upgrade to 0020, write the rows the backfill reads, then upgrade to head.

    Rows are committed on their own connection: `env.py` runs a whole command in one
    transaction, and rows written through it would test nothing. The downgrade then runs
    against a manager and a system message carrying a user, the two rows that make the enum
    rebuilds fail if the downgrade forgets them.
    """
    config = _alembic_config()
    command.upgrade(config, "0020")

    with _migration_engine.begin() as connection:
        tutor_id = connection.execute(
            text(
                "INSERT INTO tutors (name, phone_number, email)"
                " VALUES ('Maria Lopez', '+15550000001', 'maria@x.com') RETURNING id"
            )
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO users (email, hashed_password, role, tutor_id) VALUES"
                " ('maria.l@x.com', 'h', 'tutor', :tutor_id),"
                " ('jane@x.com', 'h', 'admin', NULL)"
            ),
            {"tutor_id": tutor_id},
        )

    command.upgrade(config, "head")

    with _migration_engine.begin() as connection:
        display_names = dict(
            connection.execute(text("SELECT email, display_name FROM users")).all()
        )
        settings = {
            row.key: (row.value, row.value_type, row.is_developer_only)
            for row in connection.execute(
                text(
                    "SELECT key, value, value_type, is_developer_only FROM system_settings"
                    " WHERE key = ANY(:keys)"
                ),
                {"keys": list(NEW_SETTINGS)},
            )
        }
        connection.execute(text("UPDATE users SET role = 'manager' WHERE email = 'jane@x.com'"))
        conversation_id = connection.execute(
            text("INSERT INTO conversations (phone_number) VALUES ('+15550000002') RETURNING id")
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO messages"
                " (conversation_id, author_kind, author_user_id, body, status, system_kind)"
                " SELECT :conversation_id, 'system', id, 'Taken over', 'sent', 'takeover_notice'"
                " FROM users WHERE email = 'jane@x.com'"
            ),
            {"conversation_id": conversation_id},
        )

    assert display_names == {"maria.l@x.com": "Maria Lopez", "jane@x.com": "jane"}
    assert settings == NEW_SETTINGS

    command.downgrade(config, "0020")

    with _migration_engine.connect() as connection:
        role = connection.execute(
            text("SELECT role FROM users WHERE email = 'jane@x.com'")
        ).scalar_one()
        author_kind, author_user_id = connection.execute(
            text("SELECT author_kind, author_user_id FROM messages")
        ).one()
        roles = connection.execute(text("SELECT enum_range(NULL::user_role)::text[]")).scalar_one()
        authors = connection.execute(
            text("SELECT enum_range(NULL::message_author)::text[]")
        ).scalar_one()
        leftover_settings = connection.execute(
            text("SELECT count(*) FROM system_settings WHERE key = ANY(:keys)"),
            {"keys": list(NEW_SETTINGS)},
        ).scalar_one()
    assert role == "admin"
    assert (author_kind, author_user_id) == ("bot", None)
    assert roles == ["admin", "tutor", "developer"]
    assert authors == ["client", "bot", "admin"]
    assert leftover_settings == 0

    command.upgrade(config, "head")


def test_migration_0025_flags_display_names_taken_from_the_email_and_round_trips(
    _migration_engine: Engine,
) -> None:
    """Only a non-tutor whose Display name is still its email's local part (0021's backfill) is
    flagged: no email-derived name may reach a Guardian (#109)."""
    config = _alembic_config()
    command.upgrade(config, "0024")

    with _migration_engine.begin() as connection:
        tutor_id = connection.execute(
            text(
                "INSERT INTO tutors (name, phone_number, email)"
                " VALUES ('maria', '+15550000001', 'maria@x.com') RETURNING id"
            )
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO users (email, display_name, hashed_password, role, tutor_id) VALUES"
                " ('maria@x.com', 'maria', 'h', 'tutor', :tutor_id),"
                " ('jane@x.com', 'jane', 'h', 'admin', NULL),"
                " ('ops@x.com', 'Olga Pérez', 'h', 'admin', NULL)"
            ),
            {"tutor_id": tutor_id},
        )

    command.upgrade(config, "0025")

    with _migration_engine.connect() as connection:
        flags = dict(
            connection.execute(text("SELECT email, display_name_is_default FROM users")).all()
        )
        settings = {
            row.key: (row.value, row.value_type, row.is_developer_only)
            for row in connection.execute(
                text(
                    "SELECT key, value, value_type, is_developer_only FROM system_settings"
                    " WHERE key LIKE 'takeover_generic_%'"
                )
            )
        }
    assert flags == {"maria@x.com": False, "jane@x.com": True, "ops@x.com": False}
    assert settings == GENERIC_TAKEOVER_SETTINGS

    command.downgrade(config, "0024")

    with _migration_engine.connect() as connection:
        columns = connection.execute(
            text(
                "SELECT column_name FROM information_schema.columns"
                " WHERE table_name = 'users' AND column_name = 'display_name_is_default'"
            )
        ).all()
        leftover_settings = connection.execute(
            text("SELECT count(*) FROM system_settings WHERE key LIKE 'takeover_generic_%'")
        ).scalar_one()
    assert columns == []
    assert leftover_settings == 0

    command.upgrade(config, "head")


def test_migration_0026_adds_the_reminder_run_marker_and_round_trips(
    _migration_engine: Engine,
) -> None:
    config = _alembic_config()
    command.upgrade(config, "0026")

    with _migration_engine.begin() as connection:
        connection.execute(
            text("INSERT INTO booking_reminder_runs (week_start) VALUES (:week)"),
            {"week": WEEK_START},
        )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    text("INSERT INTO booking_reminder_runs (week_start) VALUES (:week)"),
                    {"week": WEEK_START},
                )
        ran_at = connection.execute(text("SELECT ran_at FROM booking_reminder_runs")).scalar_one()
    assert ran_at is not None

    command.downgrade(config, "0025")

    with _migration_engine.connect() as connection:
        table = connection.execute(text("SELECT to_regclass('booking_reminder_runs')")).scalar()
    assert table is None

    command.upgrade(config, "head")


def test_migration_0027_deletes_the_takeover_template_settings_and_restores_them_blank(
    _migration_engine: Engine,
) -> None:
    """Production holds Marketing template ids here; the downgrade does not bring them back."""
    config = _alembic_config()
    command.upgrade(config, "0026")

    with _migration_engine.begin() as connection:
        connection.execute(
            text("UPDATE system_settings SET value = 'HXmarketing' WHERE key = ANY(:keys)"),
            {"keys": list(TAKEOVER_TEMPLATE_SETTINGS)},
        )

    command.upgrade(config, "0027")

    with _migration_engine.connect() as connection:
        remaining = connection.execute(
            text("SELECT count(*) FROM system_settings WHERE key = ANY(:keys)"),
            {"keys": list(TAKEOVER_TEMPLATE_SETTINGS)},
        ).scalar_one()
        reminder_keys = connection.execute(
            text("SELECT count(*) FROM system_settings WHERE key LIKE 'reminder_template_sid_%'")
        ).scalar_one()
    assert remaining == 0
    assert reminder_keys == 2

    command.downgrade(config, "0026")

    with _migration_engine.connect() as connection:
        settings = {
            row.key: (row.value, row.value_type, row.is_developer_only)
            for row in connection.execute(
                text(
                    "SELECT key, value, value_type, is_developer_only FROM system_settings"
                    " WHERE key = ANY(:keys)"
                ),
                {"keys": list(TAKEOVER_TEMPLATE_SETTINGS)},
            )
        }
    assert settings == TAKEOVER_TEMPLATE_SETTINGS

    command.upgrade(config, "head")


def test_migration_0021_clamps_grades_the_old_api_allowed_past_12(
    _migration_engine: Engine,
) -> None:
    """Before 0021 the API bounded grades from below only. A row past 12 would make the new
    CHECKs abort the whole upgrade, so 0021 clamps a tutor ceiling to 12 (it already meant
    every grade) and unsets a child grade that has no K-12 meaning."""
    config = _alembic_config()
    command.upgrade(config, "0020")

    with _migration_engine.begin() as connection:
        tutor_id = connection.execute(
            text(
                "INSERT INTO tutors (name, phone_number, email)"
                " VALUES ('Maria Lopez', '+15550000001', 'maria@x.com') RETURNING id"
            )
        ).scalar_one()
        subject_id = connection.execute(
            text("INSERT INTO subjects (name) VALUES ('Maths') RETURNING id")
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO tutor_subjects (tutor_id, subject_id, max_grade_level)"
                " VALUES (:tutor_id, :subject_id, 99)"
            ),
            {"tutor_id": tutor_id, "subject_id": subject_id},
        )
        connection.execute(
            text(
                "INSERT INTO children (name, grade_level, school_name) VALUES"
                " ('Past Twelve', 13, 'Elm High'), ('In Range', 7, 'Elm Primary')"
            )
        )

    command.upgrade(config, "0021")

    with _migration_engine.connect() as connection:
        ceiling = connection.execute(
            text("SELECT max_grade_level FROM tutor_subjects")
        ).scalar_one()
        grades = dict(connection.execute(text("SELECT name, grade_level FROM children")).all())
    assert ceiling == HIGHEST_GRADE
    assert grades == {"Past Twelve": None, "In Range": 7}


@pytest.fixture
def _migration_engine(monkeypatch: pytest.MonkeyPatch) -> Generator[Engine, None, None]:
    """A throwaway empty database, as in `test_conversation_models.py`, which documents why."""
    from app.config import get_settings

    settings = get_settings()
    url = make_url(settings.database_url)
    migration_url = url.set(database=f"{url.database}_reminder_migrations_{os.getpid()}")
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: settings.model_copy(
            update={"database_url": migration_url.render_as_string(hide_password=False)}
        ),
    )

    admin_engine = create_engine(url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{migration_url.database}"'))
            connection.execute(text(f'CREATE DATABASE "{migration_url.database}"'))

        engine = create_engine(migration_url)
        try:
            yield engine
        finally:
            engine.dispose()

        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{migration_url.database}"'))
    finally:
        admin_engine.dispose()


def _alembic_config() -> Config:
    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIRECTORY))

    return config


def _child(
    *,
    grade_level: int | None = 3,
    evaluated_at: datetime.datetime | None = None,
    evaluated_by_user_id: uuid.UUID | None = None,
) -> Child:
    return Child(
        name="Sam Jones",
        grade_level=grade_level,
        school_name="Elm Primary",
        evaluated_at=evaluated_at,
        evaluated_by_user_id=evaluated_by_user_id,
    )


def _make_child(db: Session) -> Child:
    child = _child()
    db.add(child)
    db.flush()

    return child


def _make_subject(db: Session) -> Subject:
    subject = Subject(name=f"Subject {uuid.uuid4().hex[:12]}")
    db.add(subject)
    db.flush()

    return subject


def _make_tutor(db: Session) -> Tutor:
    tutor = Tutor(
        name="Test Tutor",
        phone_number=_phone_number(),
        email=f"tutor-{uuid.uuid4().hex[:12]}@example.com",
    )
    db.add(tutor)
    db.flush()

    return tutor


def _make_user(db: Session, *, role: UserRole = UserRole.ADMIN) -> User:
    user = User(
        email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test Staff",
        hashed_password=hash_password("reminder-password"),
        role=role,
    )
    db.add(user)
    db.flush()

    return user


def _make_guardian(db: Session) -> Guardian:
    guardian = Guardian(phone_number=_phone_number(), name="Test Guardian")
    db.add(guardian)
    db.flush()

    return guardian


def _make_conversation(db: Session) -> Conversation:
    conversation = Conversation(phone_number=_phone_number())
    db.add(conversation)
    db.flush()

    return conversation


def _level(child: Child, subject: Subject, staff: User, *, level: int) -> ChildSubjectLevel:
    return ChildSubjectLevel(
        child_id=child.id, subject_id=subject.id, level=level, set_by_user_id=staff.id
    )


def _reminder(
    guardian: Guardian,
    *,
    child_ids: list[uuid.UUID] | None = None,
    status: ReminderStatus = ReminderStatus.SENT,
    skip_reason: ReminderSkipReason | None = None,
) -> BookingReminder:
    return BookingReminder(
        guardian_id=guardian.id,
        week_start=WEEK_START,
        language=Language.EN,
        child_ids=child_ids or [],
        status=status,
        skip_reason=skip_reason,
    )


def _message(
    conversation: Conversation,
    *,
    author_kind: MessageAuthor,
    author_user_id: uuid.UUID | None = None,
    system_kind: SystemMessageKind | None = None,
) -> Message:
    return Message(
        conversation_id=conversation.id,
        author_kind=author_kind,
        author_user_id=author_user_id,
        system_kind=system_kind,
        body="Hello",
        status=MessageStatus.SENT,
    )


def _phone_number() -> str:
    return f"+1{uuid.uuid4().int % 10**10:010d}"
