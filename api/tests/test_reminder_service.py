"""The weekly Booking reminder, through its interface: `due_guardians`, `run_week`, and the
signed delivery callbacks that move a reminder row.

`fake_twilio` stands in for every send. The run takes the business-local `now` it is handed, so
no clock is frozen here; the scheduler's own tests freeze it. Every Guardian is made with a
fresh number, and assertions only look at the Guardians a test made, so a row committed by
another module's test can never be mistaken for one of these.

Expected copy is written out ("Ana y Luis", "12 de octubre") rather than rebuilt with the
catalogue's formatters, so a formatter change is caught here.
"""

import datetime
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.booking_reminder import BookingReminder
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    BookingKind,
    BookingLocation,
    BookingStatus,
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    Language,
    MessageAuthor,
    MessageStatus,
    ReminderSkipReason,
    ReminderStatus,
    SystemMessageKind,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import Home
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.subject import Subject
from app.models.system_setting import SystemSetting
from app.models.tutor import Tutor
from app.models.user import User
from app.services.reminder_service import (
    ReminderCandidate,
    due_guardians,
    run_week,
    week_start_after,
)
from app.services.retention_service import purge_expired_messages
from tests.fake_twilio import CODE_UNDELIVERABLE, FakeTwilio, SentMessage

NEW_YORK_OFFSET = datetime.timedelta(hours=4)  # EDT, in force on every date below
# Sunday 2026-10-11, 6 PM: the default send time. The week reminded is Monday 2026-10-12.
NOW = datetime.datetime(2026, 10, 11, 18, 0)
WEEK_START = datetime.date(2026, 10, 12)
EN_SID = "HXenglish000000000000000000000000"
ES_SID = "HXspanish000000000000000000000000"


# --- the world -------------------------------------------------------------------------------


@dataclass
class World:
    """Builders for Guardians, Children, bookings and threads, on the rolled-back `db`."""

    db: Session
    _home: Home | None = None
    _tutor: Tutor | None = None
    _subject: Subject | None = None
    _availability: TutorAvailability | None = None
    _staff: User | None = None

    def guardian(
        self,
        *,
        consent: ConsentAction | None = ConsentAction.OPT_IN,
        is_active: bool = True,
        name: str = "Guardian",
    ) -> Guardian:
        guardian = Guardian(
            name=name, phone_number=f"+1{uuid.uuid4().int % 10**10:010d}", is_active=is_active
        )
        self.db.add(guardian)
        self.db.flush()
        if consent is not None:
            self.consent(guardian, consent)

        return guardian

    def consent(self, guardian: Guardian, action: ConsentAction, *, minutes_ago: int = 60) -> None:
        # An explicit, distinct `created_at`: inside one transaction `now()` would tie them.
        self.db.add(
            ReminderConsent(
                guardian_id=guardian.id,
                action=action,
                source=ConsentSource.STAFF,
                created_at=datetime.datetime.now(datetime.UTC)
                - datetime.timedelta(minutes=minutes_ago),
            )
        )
        self.db.flush()

    def child(
        self,
        *guardians: Guardian,
        name: str = "Ana",
        is_evaluated: bool = True,
        is_active: bool = True,
    ) -> Child:
        child = Child(name=name, grade_level=5, school_name="Test School", is_active=is_active)
        if is_evaluated:
            child.evaluated_at = datetime.datetime(2026, 9, 1, tzinfo=datetime.UTC)
            child.evaluated_by_user_id = self.staff().id
        self.db.add(child)
        self.db.flush()
        self.db.add_all(ChildGuardian(child_id=child.id, guardian_id=g.id) for g in guardians)
        self.db.flush()

        return child

    def booking(self, child: Child, *, on: datetime.date, status: BookingStatus) -> None:
        self._ensure_booking_world()
        assert self._tutor and self._subject and self._availability and self._home
        start = datetime.time(16, 0)
        self.db.add(
            Booking(
                child_id=child.id,
                user_id=self._tutor.user_id,
                kind=BookingKind.REGULAR,
                location=BookingLocation.HOME,
                subject_id=self._subject.id,
                availability_id=self._availability.id,
                home_id=self._home.id,
                scheduled_date=on,
                start_time=start,
                end_time=datetime.time(17, 0),
                status=status,
            )
        )
        self.db.flush()

    def conversation(
        self,
        guardian: Guardian,
        *,
        language: Language | None = None,
        last_message_at: datetime.datetime | None = None,
        phone_number: str | None = None,
        status: ConversationStatus = ConversationStatus.BOT,
    ) -> Conversation:
        is_human = status is ConversationStatus.HUMAN
        conversation = Conversation(
            phone_number=phone_number or guardian.phone_number,
            guardian_id=guardian.id,
            language=language,
            last_message_at=last_message_at or datetime.datetime.now(datetime.UTC),
            status=status,
            taken_over_by_user_id=self.staff().id if is_human else None,
            taken_over_at=datetime.datetime.now(datetime.UTC) if is_human else None,
        )
        self.db.add(conversation)
        self.db.flush()

        return conversation

    def message(
        self, conversation: Conversation, *, author: MessageAuthor, at: datetime.datetime
    ) -> None:
        """A message at business-local wall-clock `at`."""
        self.db.add(
            Message(
                conversation_id=conversation.id,
                author_kind=author,
                author_user_id=self.staff().id if author is MessageAuthor.ADMIN else None,
                body="hello",
                status=MessageStatus.SENT,
                created_at=(at + NEW_YORK_OFFSET).replace(tzinfo=datetime.UTC),
                system_kind=(
                    SystemMessageKind.CONSENT_NOTICE if author is MessageAuthor.SYSTEM else None
                ),
            )
        )
        self.db.flush()

    def staff(self) -> User:
        if self._staff is None:
            self._staff = User(
                email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
                name="Test Staff",
                hashed_password="not-a-hash",
                role=UserRole.ADMIN,
            )
            self.db.add(self._staff)
            self.db.flush()

        return self._staff

    def _ensure_booking_world(self) -> None:
        if self._tutor is not None:
            return
        suffix = uuid.uuid4().hex[:12]
        self._home = Home(label="Home", address="1 Test Street", access_code="1234")
        self._tutor = Tutor(
            user=User(email=f"t-{suffix}@x.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
            phone_number=f"+1{suffix[:10]}",
        )
        self._subject = Subject(name=f"Subject {suffix}")
        self.db.add_all([self._home, self._tutor, self._subject])
        self.db.flush()
        self._availability = TutorAvailability(
            tutor_id=self._tutor.id,
            day_of_week=0,
            start_time=datetime.time(9, 0),
            end_time=datetime.time(20, 0),
        )
        self.db.add(self._availability)
        self.db.flush()


@pytest.fixture
def world(db: Session) -> World:
    return World(db=db)


@pytest.fixture
def approved(db: Session) -> Iterator[None]:
    """Both reminder templates approved."""
    set_template_sid(db, Language.EN, EN_SID)
    set_template_sid(db, Language.ES, ES_SID)
    yield


def set_template_sid(db: Session, language: Language, value: str) -> None:
    db.execute(
        update(SystemSetting)
        .where(SystemSetting.key == f"reminder_template_sid_{language.value}")
        .values(value=value)
    )
    db.flush()


def candidate_for(
    db: Session, guardian: Guardian, *, now: datetime.datetime = NOW
) -> ReminderCandidate | None:
    found = [c for c in due_guardians(db, now=now) if c.guardian_id == guardian.id]

    return found[0] if found else None


def reminder_for(db: Session, guardian: Guardian) -> BookingReminder | None:
    return db.scalars(
        select(BookingReminder).where(BookingReminder.guardian_id == guardian.id)
    ).first()


def sends_to(fake: FakeTwilio, guardian: Guardian) -> list[SentMessage]:
    return [sent for sent in fake.sent if sent.to == guardian.phone_number]


# --- week_start ------------------------------------------------------------------------------


def test_a_sunday_run_reminds_about_the_week_starting_tomorrow() -> None:
    assert week_start_after(datetime.date(2026, 10, 11)) == datetime.date(2026, 10, 12)


def test_a_monday_run_reminds_about_the_next_monday_not_today() -> None:
    assert week_start_after(datetime.date(2026, 10, 12)) == datetime.date(2026, 10, 19)


# --- eligibility -----------------------------------------------------------------------------


def test_an_opted_in_guardian_of_an_evaluated_child_with_nothing_booked_is_due(
    world: World, db: Session
) -> None:
    guardian = world.guardian(name="Maria")
    child = world.child(guardian, name="Ana")

    candidate = candidate_for(db, guardian)

    assert candidate == ReminderCandidate(
        guardian_id=guardian.id,
        guardian_name="Maria",
        phone_number=guardian.phone_number,
        language=Language.EN,
        child_ids=(child.id,),
        child_names=("Ana",),
        skip_reason=ReminderSkipReason.TEMPLATE_NOT_APPROVED,
    )


def test_an_inactive_guardian_is_not_due(world: World, db: Session) -> None:
    guardian = world.guardian(is_active=False)
    world.child(guardian)

    assert candidate_for(db, guardian) is None


def test_a_guardian_whose_latest_consent_is_an_opt_out_is_not_due(
    world: World, db: Session
) -> None:
    guardian = world.guardian(consent=None)
    world.consent(guardian, ConsentAction.OPT_IN, minutes_ago=120)
    world.consent(guardian, ConsentAction.OPT_OUT, minutes_ago=60)
    world.child(guardian)

    assert candidate_for(db, guardian) is None


def test_a_guardian_who_opted_back_in_is_due(world: World, db: Session) -> None:
    guardian = world.guardian(consent=None)
    world.consent(guardian, ConsentAction.OPT_OUT, minutes_ago=120)
    world.consent(guardian, ConsentAction.OPT_IN, minutes_ago=60)
    world.child(guardian)

    assert candidate_for(db, guardian) is not None


def test_a_guardian_never_asked_is_not_due(world: World, db: Session) -> None:
    guardian = world.guardian(consent=None)
    world.child(guardian)

    assert candidate_for(db, guardian) is None


def test_a_child_not_evaluated_makes_no_guardian_due(world: World, db: Session) -> None:
    guardian = world.guardian()
    world.child(guardian, is_evaluated=False)

    assert candidate_for(db, guardian) is None


def test_an_inactive_child_makes_no_guardian_due(world: World, db: Session) -> None:
    guardian = world.guardian()
    world.child(guardian, is_active=False)

    assert candidate_for(db, guardian) is None


@pytest.mark.parametrize("status", [BookingStatus.PENDING, BookingStatus.CONFIRMED])
@pytest.mark.parametrize("offset", [0, 3, 6], ids=["monday", "thursday", "sunday"])
def test_a_live_booking_that_week_makes_the_child_ineligible(
    world: World, db: Session, status: BookingStatus, offset: int
) -> None:
    guardian = world.guardian()
    child = world.child(guardian)
    world.booking(child, on=WEEK_START + datetime.timedelta(days=offset), status=status)

    assert candidate_for(db, guardian) is None


def test_a_live_evaluation_that_week_makes_the_child_ineligible(world: World, db: Session) -> None:
    """An Evaluation is a booked session like any other: the reminder is for a Child with
    nothing booked, and one already coming in for an Evaluation has something."""
    guardian = world.guardian()
    child = world.child(guardian)
    db.add(
        Booking(
            child_id=child.id,
            user_id=world.staff().id,
            kind=BookingKind.EVALUATION,
            location=BookingLocation.IN_OFFICE,
            scheduled_date=WEEK_START,
            start_time=datetime.time(16, 0),
            end_time=datetime.time(17, 0),
            status=BookingStatus.CONFIRMED,
        )
    )
    db.flush()

    assert candidate_for(db, guardian) is None


@pytest.mark.parametrize("status", [BookingStatus.CANCELLED, BookingStatus.COMPLETED])
def test_a_cancelled_or_completed_booking_that_week_does_not_count(
    world: World, db: Session, status: BookingStatus
) -> None:
    guardian = world.guardian()
    child = world.child(guardian)
    world.booking(child, on=WEEK_START, status=status)

    assert candidate_for(db, guardian) is not None


@pytest.mark.parametrize("offset", [-1, 7], ids=["the-sunday-before", "the-next-monday"])
def test_a_booking_outside_the_week_does_not_count(world: World, db: Session, offset: int) -> None:
    guardian = world.guardian()
    child = world.child(guardian)
    world.booking(
        child, on=WEEK_START + datetime.timedelta(days=offset), status=BookingStatus.CONFIRMED
    )

    assert candidate_for(db, guardian) is not None


def test_only_the_eligible_children_are_named(world: World, db: Session) -> None:
    guardian = world.guardian()
    luis = world.child(guardian, name="Luis")
    booked = world.child(guardian, name="Bea")
    world.child(guardian, name="Cleo", is_evaluated=False)
    ana = world.child(guardian, name="Ana")
    world.booking(booked, on=WEEK_START, status=BookingStatus.CONFIRMED)

    candidate = candidate_for(db, guardian)

    assert candidate is not None
    assert (candidate.child_names, candidate.child_ids) == (("Ana", "Luis"), (ana.id, luis.id))


def test_both_guardians_of_one_child_are_due(world: World, db: Session) -> None:
    first = world.guardian()
    second = world.guardian()
    world.child(first, second)

    assert candidate_for(db, first) is not None
    assert candidate_for(db, second) is not None


# --- language --------------------------------------------------------------------------------


def test_the_most_recently_active_conversation_decides_the_language(
    world: World, db: Session
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    an_hour_ago = datetime.datetime.now(datetime.UTC) - datetime.timedelta(hours=1)
    world.conversation(
        guardian,
        language=Language.EN,
        last_message_at=an_hour_ago - datetime.timedelta(days=9),
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
    )
    world.conversation(guardian, language=Language.ES, last_message_at=an_hour_ago)

    candidate = candidate_for(db, guardian)

    assert candidate is not None and candidate.language is Language.ES


def test_two_conversations_active_at_the_same_instant_are_decided_by_the_higher_id(
    world: World, db: Session
) -> None:
    """The same tie-break the Guardian screen uses, so the run speaks the language Staff see."""
    guardian = world.guardian()
    world.child(guardian)
    at = datetime.datetime.now(datetime.UTC) - datetime.timedelta(hours=1)
    lower_id, higher_id = sorted([uuid.uuid4(), uuid.uuid4()])
    # The lower id is written first: without the tie-break the sort keeps insertion order.
    for conversation_id, language in [(lower_id, None), (higher_id, Language.ES)]:
        conversation = world.conversation(
            guardian,
            language=language,
            last_message_at=at,
            phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
        )
        conversation.id = conversation_id
        db.flush()

    candidate = candidate_for(db, guardian)

    assert candidate is not None and candidate.language is Language.ES


def test_a_latest_conversation_with_no_language_means_english(world: World, db: Session) -> None:
    guardian = world.guardian()
    world.child(guardian)
    an_hour_ago = datetime.datetime.now(datetime.UTC) - datetime.timedelta(hours=1)
    world.conversation(
        guardian,
        language=Language.ES,
        last_message_at=an_hour_ago - datetime.timedelta(days=9),
        phone_number=f"+1{uuid.uuid4().int % 10**10:010d}",
    )
    world.conversation(guardian, language=None, last_message_at=an_hour_ago)

    candidate = candidate_for(db, guardian)

    assert candidate is not None and candidate.language is Language.EN


def test_a_guardian_with_no_conversation_is_reminded_in_english(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian, name="Ana")

    run_week(db, now=NOW)

    [sent] = sends_to(fake_twilio, guardian)
    assert sent.content_sid == EN_SID
    assert sent.content_variables == {"1": "Ana", "2": "October 12"}


def test_a_spanish_guardian_gets_the_spanish_template_and_variables(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian, name="Luis")
    world.child(guardian, name="Ana")
    world.conversation(guardian, language=Language.ES)

    run_week(db, now=NOW)

    [sent] = sends_to(fake_twilio, guardian)
    assert sent.content_sid == ES_SID
    assert sent.content_variables == {"1": "Ana y Luis", "2": "12 de octubre"}
    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.language, reminder.template_name) == (Language.ES, "booking_reminder_es")


# --- skips -----------------------------------------------------------------------------------


def _taken_over(world: World, guardian: Guardian) -> Conversation:
    return world.conversation(guardian, status=ConversationStatus.HUMAN)


def test_a_takeover_where_staff_wrote_last_today_is_skipped(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = _taken_over(world, guardian)
    world.message(conversation, author=MessageAuthor.CLIENT, at=NOW.replace(hour=9))
    world.message(conversation, author=MessageAuthor.ADMIN, at=NOW.replace(hour=10))

    result = run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.skip_reason) == (
        ReminderStatus.SKIPPED,
        ReminderSkipReason.TAKEOVER,
    )
    assert sends_to(fake_twilio, guardian) == []
    assert result.skipped >= 1


def test_a_takeover_skip_writes_no_chat_copy(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = _taken_over(world, guardian)
    world.message(conversation, author=MessageAuthor.ADMIN, at=NOW.replace(hour=10))

    run_week(db, now=NOW)

    kinds = db.scalars(
        select(Message.system_kind).where(Message.conversation_id == conversation.id)
    ).all()
    assert SystemMessageKind.BOOKING_REMINDER not in kinds


@pytest.mark.parametrize(
    "last_messages",
    [
        [(MessageAuthor.ADMIN, 10), (MessageAuthor.CLIENT, 11)],
        # A Takeover notice is a system line, even though Staff caused it: not Staff writing.
        [(MessageAuthor.CLIENT, 9), (MessageAuthor.SYSTEM, 11)],
        [],
    ],
    ids=["guardian-wrote-last", "system-line-last", "nobody-wrote-today"],
)
def test_a_takeover_where_staff_did_not_write_last_today_sends(
    world: World,
    db: Session,
    fake_twilio: FakeTwilio,
    approved: None,
    last_messages: list[tuple[MessageAuthor, int]],
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = _taken_over(world, guardian)
    for author, hour in last_messages:
        world.message(conversation, author=author, at=NOW.replace(hour=hour))

    run_week(db, now=NOW)

    assert len(sends_to(fake_twilio, guardian)) == 1


def test_a_takeover_where_staff_wrote_yesterday_sends(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = _taken_over(world, guardian)
    # 23:30 the night before: still yesterday in New York, though already today in UTC.
    world.message(
        conversation, author=MessageAuthor.ADMIN, at=NOW - datetime.timedelta(hours=18, minutes=30)
    )

    run_week(db, now=NOW)

    assert len(sends_to(fake_twilio, guardian)) == 1


def test_staff_writing_last_today_on_a_bot_thread_sends(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = world.conversation(guardian)
    world.message(conversation, author=MessageAuthor.ADMIN, at=NOW.replace(hour=10))

    run_week(db, now=NOW)

    assert len(sends_to(fake_twilio, guardian)) == 1


def test_a_blank_template_for_the_guardians_language_is_skipped_with_no_fallback(
    world: World, db: Session, fake_twilio: FakeTwilio
) -> None:
    set_template_sid(db, Language.EN, EN_SID)
    set_template_sid(db, Language.ES, "")
    guardian = world.guardian()
    world.child(guardian)
    world.conversation(guardian, language=Language.ES)

    run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.skip_reason) == (
        ReminderStatus.SKIPPED,
        ReminderSkipReason.TEMPLATE_NOT_APPROVED,
    )
    assert sends_to(fake_twilio, guardian) == []


def test_both_templates_blank_sends_nothing(
    world: World, db: Session, fake_twilio: FakeTwilio
) -> None:
    set_template_sid(db, Language.EN, "")
    set_template_sid(db, Language.ES, "")
    english = world.guardian()
    world.child(english)
    spanish = world.guardian()
    world.child(spanish)
    world.conversation(spanish, language=Language.ES)

    run_week(db, now=NOW)

    assert fake_twilio.sent == []
    for guardian in (english, spanish):
        reminder = reminder_for(db, guardian)
        assert reminder is not None
        assert reminder.skip_reason is ReminderSkipReason.TEMPLATE_NOT_APPROVED


# --- sending ---------------------------------------------------------------------------------


def test_a_sent_reminder_records_its_sid_and_time(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    child = world.child(guardian)

    result = run_week(db, now=NOW)

    [sent] = sends_to(fake_twilio, guardian)
    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert reminder.status is ReminderStatus.SENT
    assert reminder.twilio_sid == sent.sid
    assert reminder.sent_at is not None
    assert reminder.week_start == WEEK_START
    assert reminder.child_ids == [child.id]
    assert reminder.template_name == "booking_reminder_en"
    assert result.week_start == WEEK_START and result.sent >= 1


def test_the_chat_copy_is_a_system_line_on_the_guardians_thread(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian, name="Ana")
    conversation = world.conversation(guardian)

    run_week(db, now=NOW)

    [sent] = sends_to(fake_twilio, guardian)
    copy = db.scalars(
        select(Message).where(
            Message.conversation_id == conversation.id,
            Message.system_kind == SystemMessageKind.BOOKING_REMINDER,
        )
    ).one()
    assert copy.author_kind is MessageAuthor.SYSTEM
    assert copy.author_user_id is None
    assert copy.twilio_sid == sent.sid
    assert copy.status is MessageStatus.QUEUED
    assert copy.body == (
        "Hello, this is your weekly reminder from Ms Helping Hands, as you asked. There is no"
        " tutoring session booked yet for Ana in the week of October 12. Tap Book a session to"
        " choose a time, or reply STOP to end these reminders."
    )


def test_a_guardian_with_no_thread_gets_one_opened_and_linked(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)

    run_week(db, now=NOW)

    conversation = db.scalars(
        select(Conversation).where(Conversation.phone_number == guardian.phone_number)
    ).one()
    assert conversation.guardian_id == guardian.id
    assert conversation.status is ConversationStatus.BOT
    copy = db.scalars(select(Message).where(Message.conversation_id == conversation.id)).one()
    assert copy.system_kind is SystemMessageKind.BOOKING_REMINDER


def test_a_server_error_is_retried_once_and_the_retry_is_recorded(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    fake_twilio.fail_next_with_server_error()

    run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None and reminder.status is ReminderStatus.SENT
    assert len(sends_to(fake_twilio, guardian)) == 1


def test_a_refused_connection_is_retried_once(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    fake_twilio.fail_next_with_network_error()

    run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None and reminder.status is ReminderStatus.SENT


def test_two_server_errors_leave_the_reminder_failed_with_the_code(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = world.conversation(guardian)
    fake_twilio.fail_next_with_server_error(times=2)

    result = run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.error_code, reminder.twilio_sid) == (
        ReminderStatus.FAILED,
        "20500",
        None,
    )
    copy = db.scalars(
        select(Message).where(
            Message.conversation_id == conversation.id,
            Message.system_kind == SystemMessageKind.BOOKING_REMINDER,
        )
    ).one()
    assert (copy.status, copy.error_code) == (MessageStatus.FAILED, "20500")
    assert result.failed >= 1


def test_a_refusal_that_cannot_be_retried_fails_at_once_with_the_code(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    fake_twilio.fail_next(code="63016")

    run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.error_code) == (ReminderStatus.FAILED, "63016")
    # The fake was armed for one failure only, so a retry would have gone through.
    assert sends_to(fake_twilio, guardian) == []


def test_63049_at_send_time_is_undeliverable(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    fake_twilio.fail_next(code=CODE_UNDELIVERABLE)

    result = run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None and reminder.status is ReminderStatus.UNDELIVERABLE
    assert result.undeliverable >= 1


def test_a_guardian_with_a_row_for_the_week_is_never_sent_again(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    sent = world.guardian()
    world.child(sent)
    failed = world.guardian()
    world.child(failed)
    db.add(
        BookingReminder(
            guardian_id=failed.id,
            week_start=WEEK_START,
            language=Language.EN,
            child_ids=[],
            status=ReminderStatus.FAILED,
            error_code="20500",
        )
    )
    db.flush()

    run_week(db, now=NOW)
    run_week(db, now=NOW + datetime.timedelta(hours=1))

    assert len(sends_to(fake_twilio, sent)) == 1
    assert sends_to(fake_twilio, failed) == []


@pytest.mark.parametrize("code", ["63050", "63033"])
def test_an_opt_out_code_at_send_time_fails_the_reminder_and_opts_the_guardian_out(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None, code: str
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    fake_twilio.fail_next(code=code)

    run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.error_code) == (ReminderStatus.FAILED, code)
    assert _consents(db, guardian.id) == [
        (ConsentAction.OPT_IN, ConsentSource.STAFF),
        (ConsentAction.OPT_OUT, ConsentSource.SYSTEM),
    ]


def test_a_run_that_dies_mid_send_leaves_an_interrupted_reminder_the_next_run_settles(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = world.conversation(guardian)

    def die(sid: str) -> None:
        raise SystemExit("the process was killed before the outcome was written")

    fake_twilio.during_next_send(die)
    with pytest.raises(SystemExit):
        run_week(db, now=NOW)
    db.rollback()

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.error_code, reminder.twilio_sid) == (
        ReminderStatus.FAILED,
        "interrupted",
        None,
    )
    copy_before = _reminder_copy(db, conversation)
    assert copy_before.status is MessageStatus.QUEUED

    run_week(db, now=NOW + datetime.timedelta(hours=1))

    copy = _reminder_copy(db, conversation)
    assert (copy.status, copy.error_code) == (MessageStatus.FAILED, "interrupted")
    assert len(sends_to(fake_twilio, guardian)) == 1


def test_a_send_that_timed_out_is_recorded_as_delivery_unknown_and_not_retried(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    guardian = world.guardian()
    world.child(guardian)
    conversation = world.conversation(guardian)
    fake_twilio.fail_next_with_timeout()

    run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.error_code, reminder.twilio_sid) == (
        ReminderStatus.FAILED,
        "delivery_unknown",
        None,
    )
    copy = _reminder_copy(db, conversation)
    assert (copy.status, copy.error_code) == (MessageStatus.FAILED, "delivery_unknown")
    # The fake was armed for one failure only, so a retry would have gone through.
    assert sends_to(fake_twilio, guardian) == []


def test_an_unconfigured_twilio_is_told_apart_from_an_interrupted_send(
    world: World, db: Session, approved: None
) -> None:
    # No `fake_twilio`: the send reaches `twilio_service`, which has no credentials here.
    guardian = world.guardian()
    world.child(guardian)

    run_week(db, now=NOW)

    reminder = reminder_for(db, guardian)
    assert reminder is not None
    assert (reminder.status, reminder.error_code) == (ReminderStatus.FAILED, None)


def test_the_reminder_lands_in_the_thread_at_the_guardians_number_and_takes_it_from_a_former_one(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> None:
    current = world.guardian()
    world.child(current, name="Ana")
    former = world.guardian()
    # The thread opened when the number was the former Guardian's; they have since moved on.
    thread = world.conversation(former, phone_number=current.phone_number)

    run_week(db, now=NOW)

    [sent] = sends_to(fake_twilio, current)
    copy = _reminder_copy(db, thread)
    assert copy.twilio_sid == sent.sid
    assert "Ana" in copy.body
    db.refresh(thread)
    assert thread.guardian_id == current.id


def _reminder_copy(db: Session, conversation: Conversation) -> Message:
    db.expire_all()
    return db.scalars(
        select(Message).where(
            Message.conversation_id == conversation.id,
            Message.system_kind == SystemMessageKind.BOOKING_REMINDER,
        )
    ).one()


# --- delivery callbacks ----------------------------------------------------------------------


@pytest.fixture
def sent_reminder(
    world: World, db: Session, fake_twilio: FakeTwilio, approved: None
) -> BookingReminder:
    guardian = world.guardian()
    world.child(guardian, name="Ana")
    world.child(guardian, name="Luis")
    run_week(db, now=NOW)
    reminder = reminder_for(db, guardian)
    assert reminder is not None and reminder.twilio_sid is not None

    return reminder


def _post(
    api: TestClient, fake: FakeTwilio, sid: str, status: str, code: str | None = None
) -> None:
    response = fake.post_status(api, sid=sid, status=status, error_code=code)
    assert response.status_code == 204


def test_callbacks_move_a_reminder_forward_to_read(
    api: TestClient, fake_twilio: FakeTwilio, db: Session, sent_reminder: BookingReminder
) -> None:
    sid = sent_reminder.twilio_sid
    assert sid is not None

    _post(api, fake_twilio, sid, "delivered")
    db.refresh(sent_reminder)
    delivered = sent_reminder.status
    _post(api, fake_twilio, sid, "read")
    db.refresh(sent_reminder)

    assert (delivered, sent_reminder.status) == (ReminderStatus.DELIVERED, ReminderStatus.READ)


@pytest.mark.parametrize("late", ["sent", "delivered", "queued"])
def test_a_late_callback_never_moves_a_read_reminder_back(
    api: TestClient,
    fake_twilio: FakeTwilio,
    db: Session,
    sent_reminder: BookingReminder,
    late: str,
) -> None:
    sid = sent_reminder.twilio_sid
    assert sid is not None
    _post(api, fake_twilio, sid, "read")

    _post(api, fake_twilio, sid, late)
    db.refresh(sent_reminder)

    assert sent_reminder.status is ReminderStatus.READ


def test_an_undelivered_63049_callback_makes_the_reminder_undeliverable(
    api: TestClient, fake_twilio: FakeTwilio, db: Session, sent_reminder: BookingReminder
) -> None:
    sid = sent_reminder.twilio_sid
    assert sid is not None

    _post(api, fake_twilio, sid, "undelivered", "63049")
    db.refresh(sent_reminder)

    assert sent_reminder.status is ReminderStatus.UNDELIVERABLE
    assert _consents(db, sent_reminder.guardian_id) == [(ConsentAction.OPT_IN, ConsentSource.STAFF)]


@pytest.mark.parametrize("code", ["63050", "63033"])
@pytest.mark.parametrize("status", ["failed", "undelivered"])
def test_an_opt_out_code_fails_the_reminder_and_opts_the_guardian_out(
    api: TestClient,
    fake_twilio: FakeTwilio,
    db: Session,
    sent_reminder: BookingReminder,
    code: str,
    status: str,
) -> None:
    sid = sent_reminder.twilio_sid
    assert sid is not None

    _post(api, fake_twilio, sid, status, code)
    db.refresh(sent_reminder)

    assert (sent_reminder.status, sent_reminder.error_code) == (ReminderStatus.FAILED, code)
    assert _consents(db, sent_reminder.guardian_id)[-1] == (
        ConsentAction.OPT_OUT,
        ConsentSource.SYSTEM,
    )


def test_another_failure_code_fails_the_reminder_with_that_code(
    api: TestClient, fake_twilio: FakeTwilio, db: Session, sent_reminder: BookingReminder
) -> None:
    sid = sent_reminder.twilio_sid
    assert sid is not None

    _post(api, fake_twilio, sid, "failed", "30008")
    db.refresh(sent_reminder)

    assert (sent_reminder.status, sent_reminder.error_code) == (ReminderStatus.FAILED, "30008")
    assert len(_consents(db, sent_reminder.guardian_id)) == 1


def test_a_callback_also_moves_the_chat_copy_which_still_names_the_children(
    api: TestClient, fake_twilio: FakeTwilio, db: Session, sent_reminder: BookingReminder
) -> None:
    from app.services.message_service import get_thread_message

    sid = sent_reminder.twilio_sid
    assert sid is not None

    _post(api, fake_twilio, sid, "delivered")

    copy = db.scalars(select(Message).where(Message.twilio_sid == sid)).one()
    row = get_thread_message(db, message_id=copy.id)
    assert row is not None
    assert row.message.status is MessageStatus.DELIVERED
    assert row.reminder_child_names == ["Ana", "Luis"]


def _consents(db: Session, guardian_id: uuid.UUID) -> list[tuple[ConsentAction, ConsentSource]]:
    rows = db.execute(
        select(ReminderConsent.action, ReminderConsent.source)
        .where(ReminderConsent.guardian_id == guardian_id)
        .order_by(ReminderConsent.created_at)
    ).all()

    return [(action, source) for action, source in rows]


# --- retention -------------------------------------------------------------------------------


def test_the_retention_purge_leaves_booking_reminders_untouched(
    db: Session, sent_reminder: BookingReminder
) -> None:
    # Age the chat copy past any retention, so the purge empties the reminder's thread too.
    db.execute(
        update(Message)
        .where(Message.twilio_sid == sent_reminder.twilio_sid)
        .values(created_at=datetime.datetime.now(datetime.UTC) - datetime.timedelta(days=4000))
    )
    db.flush()

    result = purge_expired_messages(db)

    assert result.messages_deleted >= 1
    assert (
        db.scalars(select(Message).where(Message.twilio_sid == sent_reminder.twilio_sid)).first()
        is None
    )
    db.expire_all()
    kept = db.get(BookingReminder, sent_reminder.id)
    assert kept is not None and kept.status is ReminderStatus.SENT
