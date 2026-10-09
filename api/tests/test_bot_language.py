"""The Guardian language: detected by the parser, stored by the webhook, used for every reply.

Two seams. `reply_for` (with the parser scripted) for the switch rule, the opener, subject names
and the Spanish skip/none words. The webhook route, with the real bot behind it and `fake_twilio`
signing each inbound message, for one Spanish fixture conversation per flow: every reply equals
`render(..., "es", ...)` and the rows written match the English flow. **No test here calls
Anthropic** (P7-I): the parser is scripted for every test in this module.
"""

import datetime
import uuid
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable, Generator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import BookingStatus, FlagReason, Language, UserRole
from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.schemas.bot import BotIntent, GuardianLanguage
from app.security import create_access_token
from app.services import bot_service, parser_service
from app.services.bot_messages import (
    format_date,
    format_session_line,
    format_slot_label,
    format_time_range,
    render,
)
from tests.fake_twilio import FakeTwilio
from tests.test_bot_service import (
    CANONICAL_NUMBER,
    CHILD_LEVEL,
    DATE,
    NOW,
    Chat,
    ClientWorld,
    ScriptedParser,
    _answer_up_to_the_notes,
    _evaluate,
    _make_client,
    _open_intake,
)

SPANISH_SUBJECT = "Matemáticas"
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
FOUR_PM = datetime.time(16, 0)
FIVE_PM = datetime.time(17, 0)
GUARDIAN_NAME = "Ada Guardian"
CHILD_NAME = "Sam Guardian"


@pytest.fixture(autouse=True)
def parser(monkeypatch: pytest.MonkeyPatch) -> ScriptedParser:
    scripted = ScriptedParser()
    monkeypatch.setattr(parser_service, "parse_intent", scripted)

    return scripted


@pytest.fixture(autouse=True)
def frozen_clock(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(NOW)


@pytest.fixture
def chat(db: Session, parser: ScriptedParser) -> Chat:
    return Chat(db=db, parser=parser)


@pytest.fixture
def client(db: Session) -> ClientWorld:
    return _make_client(db)


@pytest.fixture
def cutoff(set_cutoff: Callable[[int], None]) -> None:
    set_cutoff(24)


@pytest.fixture
def set_cutoff(db: Session) -> Callable[[int], None]:
    """`cancellation_cutoff_hours`, which the harness does not seed (see `test_bot_service`)."""
    from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting

    def write(hours: int) -> None:
        db.merge(
            SystemSetting(
                key=bot_service.CANCELLATION_CUTOFF_SETTING,
                value=str(hours),
                value_type=SETTING_VALUE_TYPE_INTEGER,
                is_developer_only=False,
            )
        )
        db.flush()

    return write


# --- the switch rule (reply_for) ----------------------------------------------------------------


def test_a_clear_spanish_message_with_nothing_stored_is_adopted_and_answered_in_spanish(
    chat: Chat, client: ClientWorld
) -> None:
    chat.say("hi")

    turn = chat.say("gracias!", intent=BotIntent.CHIT_CHAT, language="es")

    assert turn.language == "es"
    assert turn.reply == f"{render('SMALL_TALK_REPLY', 'es')} {render('ASK_MENU', 'es')}"


def test_a_neutral_message_keeps_the_stored_spanish_and_stores_nothing(
    chat: Chat, client: ClientWorld
) -> None:
    chat.language = "es"
    chat.say("hi")

    turn = chat.say("ok", intent=BotIntent.CHIT_CHAT, language=None)

    assert turn.language is None
    assert turn.reply == f"{render('SMALL_TALK_REPLY', 'es')} {render('ASK_MENU', 'es')}"


def test_a_clear_english_message_switches_a_spanish_guardian_to_english(
    chat: Chat, client: ClientWorld
) -> None:
    chat.language = "es"
    chat.say("hi")

    turn = chat.say("thanks!", intent=BotIntent.CHIT_CHAT, language="en")

    assert turn.language == "en"
    assert turn.reply == f"{render('SMALL_TALK_REPLY', 'en')} {render('ASK_MENU', 'en')}"


def test_spanish_detected_again_for_a_spanish_guardian_stores_nothing_new(
    chat: Chat, client: ClientWorld
) -> None:
    chat.language = "es"
    chat.say("hola")

    turn = chat.say("gracias!", intent=BotIntent.CHIT_CHAT, language="es")

    assert turn.language is None
    assert turn.reply == f"{render('SMALL_TALK_REPLY', 'es')} {render('ASK_MENU', 'es')}"


def test_a_parser_outage_mid_flow_apologises_in_the_stored_language(
    chat: Chat, client: ClientWorld
) -> None:
    chat.language = "es"
    chat.say("hola")

    turn = chat.say("¿?", fails=True)

    assert turn.reply == render("PARSER_UNAVAILABLE", "es")
    assert turn.language is None


# --- the opener (reply_for) ---------------------------------------------------------------------


def test_hola_from_an_unknown_number_greets_in_spanish_and_stores_spanish(chat: Chat) -> None:
    turn = chat.say("Hola", language="es")

    assert turn.reply == f"{render('GREETING_NEW', 'es')} {render('ASK_GUARDIAN_NAME', 'es')}"
    assert turn.language == "es"
    assert chat.step == bot_service.STEP_INTAKE_NAME


def test_hola_from_a_known_number_greets_by_name_in_spanish(
    chat: Chat, client: ClientWorld
) -> None:
    turn = chat.say("Hola", language="es")

    assert turn.reply == (
        f"{render('GREETING_RETURNING', 'es', name=GUARDIAN_NAME)} {render('ASK_MENU', 'es')}"
    )
    assert turn.language == "es"


@pytest.mark.parametrize(
    ("stored", "expected"), [(None, "en"), ("es", "es"), ("en", "en")], ids=str
)
@pytest.mark.parametrize("body", ["hi", "Franklin Neves"])
def test_an_opener_with_no_clear_language_greets_in_the_stored_one(
    chat: Chat, body: str, stored: GuardianLanguage | None, expected: str
) -> None:
    chat.language = stored

    turn = chat.say(body, language=None)

    assert turn.reply == (
        f"{render('GREETING_NEW', expected)} {render('ASK_GUARDIAN_NAME', expected)}"
    )
    assert turn.language is None


def test_the_opener_is_never_consumed_as_an_answer(chat: Chat) -> None:
    """Parsed for its language only: a name in the first message is not the intake answer."""
    chat.say("Franklin Neves", value="Franklin Neves", language="en")

    assert chat.step == bot_service.STEP_INTAKE_NAME
    assert chat.state.collected_data == {}
    assert chat.state.misses == 0


@pytest.mark.parametrize(("stored", "expected"), [(None, "en"), ("es", "es")], ids=str)
def test_a_parser_outage_at_the_opener_still_greets_in_the_stored_language_without_a_flag(
    chat: Chat, client: ClientWorld, stored: GuardianLanguage | None, expected: str
) -> None:
    chat.language = stored

    turn = chat.say("Hola", fails=True)

    assert turn.reply == (
        f"{render('GREETING_RETURNING', expected, name=GUARDIAN_NAME)} "
        f"{render('ASK_MENU', expected)}"
    )
    assert turn.flag_reason is None
    assert turn.language is None
    assert chat.step == bot_service.STEP_MENU


# --- subject names (reply_for) ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name_es", "language", "shown"),
    [
        (SPANISH_SUBJECT, "es", SPANISH_SUBJECT),
        (None, "es", "english"),
        ("  ", "es", "english"),
        (SPANISH_SUBJECT, "en", "english"),
    ],
    ids=["spanish name", "no spanish name", "blank spanish name", "english guardian"],
)
def test_the_subject_list_names_a_subject_in_spanish_only_when_it_has_a_spanish_name(
    chat: Chat,
    db: Session,
    client: ClientWorld,
    name_es: str | None,
    language: GuardianLanguage,
    shown: str,
) -> None:
    world = _make_world(db, name_es=name_es)
    chat.language = language
    chat.say("hi")

    turn = chat.say("book", intent=BotIntent.BOOK)

    label = world.subject_name if shown == "english" else shown
    assert turn.reply == f"{render('ASK_SUBJECT', language)}\n1. {label}"


def test_a_spanish_name_staff_set_through_the_api_is_the_one_the_bot_shows(
    api: TestClient, chat: Chat, db: Session, client: ClientWorld
) -> None:
    world = _make_world(db, name_es=None)
    manager = User(
        email=f"manager-{uuid.uuid4().hex[:12]}@example.com",
        name="Mia Manager",
        hashed_password="unused",
        role=UserRole.MANAGER,
        is_active=True,
    )
    db.add(manager)
    db.flush()
    token = create_access_token(user_id=manager.id, role=manager.role, tutor_id=None)
    api.patch(
        f"/api/subjects/{world.subject.id}",
        headers={"Authorization": f"Bearer {token}"},
        json={"name_es": f" {SPANISH_SUBJECT} "},
    )
    chat.language = "es"
    chat.say("hola")

    turn = chat.say("quiero reservar", intent=BotIntent.BOOK)

    assert turn.reply == f"{render('ASK_SUBJECT', 'es')}\n1. {SPANISH_SUBJECT}"


# --- the Office handoff in Spanish (reply_for) ---------------------------------------------------


def test_a_child_not_evaluated_is_handed_to_the_office_in_spanish(
    chat: Chat, db: Session, client: ClientWorld
) -> None:
    _make_world(db, name_es=SPANISH_SUBJECT)
    chat.language = "es"
    chat.say("hola")
    chat.say("quiero reservar", intent=BotIntent.BOOK)
    day_question = chat.say(value=SPANISH_SUBJECT)

    turn = chat.say(value=DATE.isoformat())

    assert day_question.reply == render("ASK_DATE", "es")
    assert turn.reply == render("FIRST_SESSION_HANDOFF", "es", name=CHILD_NAME)
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST


def test_a_subject_with_no_level_is_handed_to_the_office_by_its_spanish_name(
    chat: Chat, db: Session, client: ClientWorld
) -> None:
    levelled = _make_world(db, name_es=None)
    science = _make_world(db, name_es="Ciencias")
    _evaluate(db, client.child_id, levels={levelled.subject.id: CHILD_LEVEL})
    chat.language = "es"
    chat.say("hola")
    chat.say("quiero reservar", intent=BotIntent.BOOK)
    chat.say(value="Ciencias")

    turn = chat.say(value=DATE.isoformat())

    assert turn.reply == (
        "Gracias. Nuestra oficina coordinará las sesiones de Ciencias de Sam Guardian "
        "y se pondrá en contacto con usted pronto."
    )
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST
    assert science.subject.name not in turn.reply


def test_a_reschedule_handed_to_the_office_names_the_session_in_spanish(
    chat: Chat, db: Session, client: ClientWorld, cutoff: None
) -> None:
    world = _make_world(db, name_es=SPANISH_SUBJECT)
    spanish = SpanishWorld(
        subject=world.subject,
        tutor=world.tutor,
        availability_id=world.availability_id,
        client=client,
    )
    original = _make_booking(db, spanish, start=FOUR_PM)
    chat.language = "es"
    chat.say("hola")
    chat.say("necesito cambiar una sesión", intent=BotIntent.RESCHEDULE)
    chat.say(value="1")

    turn = chat.say(value=DATE.isoformat())

    date = format_date(DATE, "es")
    assert turn.reply == (
        f"Gracias. Nuestra oficina le ayudará a cambiar la sesión de {SPANISH_SUBJECT} de "
        f"{CHILD_NAME} del {date}, {format_time_range(FOUR_PM, FIVE_PM, 'es')} al {date}, y se "
        "pondrá en contacto con usted pronto. La sesión sigue reservada hasta entonces."
    )
    assert turn.flag_reason is FlagReason.BOOKING_REQUEST
    assert db.get_one(Booking, original.id).status is BookingStatus.CONFIRMED


# --- Spanish skip and none words (reply_for) ----------------------------------------------------


@pytest.mark.parametrize("word", ["omitir", "saltar", "Omitir."])
def test_a_spanish_skip_word_leaves_the_address_unnamed(chat: Chat, word: str) -> None:
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")
    chat.say(value="1234")

    chat.say(value=word)

    assert "home_label" not in chat.state.collected_data
    assert chat.step == bot_service.STEP_CHILD_REGISTERED


@pytest.mark.parametrize("word", ["ninguno", "ninguna", "nada", "no hay", "¡Nada!"])
def test_a_spanish_none_word_stores_no_notes(chat: Chat, db: Session, word: str) -> None:
    _answer_up_to_the_notes(chat)

    chat.say(value=word)

    assert db.execute(select(Child)).scalar_one().notes is None


@pytest.mark.parametrize("word", ["ninguno", "nada", "No hay."])
def test_a_spanish_none_word_is_recorded_as_no_access_code(chat: Chat, word: str) -> None:
    """`homes.access_code` is NOT NULL, and "none" is what an English Guardian's "no code"
    has always been stored as, so Staff and tutors read the same thing in both languages."""
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")

    chat.say(value=word)

    assert chat.state.collected_data["access_code"] == bot_service.NO_ACCESS_CODE == "none"
    assert chat.step == bot_service.STEP_INTAKE_LABEL


def test_an_access_code_is_otherwise_kept_as_written(chat: Chat) -> None:
    _open_intake(chat)
    chat.say(value="Ada Guardian")
    chat.say(value="1 Test Street")

    chat.say(value="Nada 4521")

    assert chat.state.collected_data["access_code"] == "Nada 4521"


# --- Spanish fixture conversations (the webhook) ------------------------------------------------


@dataclass(frozen=True, slots=True)
class SpanishWorld:
    subject: Subject
    tutor: Tutor
    availability_id: uuid.UUID
    client: ClientWorld


@dataclass
class WhatsApp:
    """One Guardian's thread, posted to the real webhook route with the real bot behind it."""

    api: TestClient
    fake: FakeTwilio
    parser: ScriptedParser
    db: Session
    sent: int = 0

    def say(
        self,
        body: str,
        *,
        value: str | None = None,
        intent: BotIntent = BotIntent.UNKNOWN,
        language: GuardianLanguage | None = None,
    ) -> str:
        """Post `body` with the parser scripted to read it as given; return the TwiML reply."""
        from app.schemas.bot import ParsedIntent

        self.parser.script(
            ParsedIntent(
                intent=intent,
                answer=value,
                fields={},
                confidence_is_low=False,
                language=language,
            )
        )
        self.sent += 1
        response = self.fake.post_inbound(
            self.api,
            from_number=CANONICAL_NUMBER,
            body=body,
            sid=f"SM{self.sent:032d}",
        )
        assert response.status_code == 200
        message = ElementTree.fromstring(response.text).find("Message")
        assert message is not None and message.text is not None

        return message.text

    def conversation(self) -> Conversation:
        return self.db.scalars(
            select(Conversation).where(Conversation.phone_number == CANONICAL_NUMBER)
        ).one()


@pytest.fixture
def whatsapp(
    db: Session, fake_twilio: FakeTwilio, parser: ScriptedParser
) -> Generator[WhatsApp, None, None]:
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield WhatsApp(api=TestClient(app), fake=fake_twilio, parser=parser, db=db)
    finally:
        del app.dependency_overrides[get_db]


@pytest.fixture
def spanish(db: Session) -> SpanishWorld:
    """A Guardian with one Evaluated child (levelled in the subject) and one home, a Spanish
    conversation, and one tutor free 9:00-10:00 on `DATE` for a subject with a Spanish name."""
    client = _make_client(db)
    world = _make_world(db, name_es=SPANISH_SUBJECT)
    _evaluate(db, client.child_id, levels={world.subject.id: CHILD_LEVEL})
    db.add(
        Conversation(
            phone_number=CANONICAL_NUMBER,
            guardian_id=client.guardian_id,
            language=Language.ES,
            last_message_at=datetime.datetime.now(tz=datetime.UTC),
        )
    )
    db.flush()

    return SpanishWorld(
        subject=world.subject,
        tutor=world.tutor,
        availability_id=world.availability_id,
        client=client,
    )


def test_hola_at_the_webhook_stores_spanish_on_the_conversation(
    whatsapp: WhatsApp, db: Session
) -> None:
    reply = whatsapp.say("Hola", language="es")

    assert reply == f"{render('GREETING_NEW', 'es')} {render('ASK_GUARDIAN_NAME', 'es')}"
    assert whatsapp.conversation().language is Language.ES


def test_a_spanish_guardian_books_a_session_in_spanish(
    whatsapp: WhatsApp, db: Session, spanish: SpanishWorld
) -> None:
    tutor = spanish.tutor.user.name
    slot = format_slot_label(format_time_range(NINE, TEN, "es"), tutor, "es")
    date = format_date(DATE, "es")

    replies = [
        whatsapp.say("Hola"),
        whatsapp.say("quiero reservar una sesión", intent=BotIntent.BOOK, language="es"),
        whatsapp.say("1", value="1"),
        whatsapp.say("cualquiera", value="2", language="es"),
        whatsapp.say("el miércoles", value=DATE.isoformat(), language="es"),
        whatsapp.say("1", value="1"),
        whatsapp.say("sí", value="yes", language="es"),
    ]

    assert replies == [
        f"{render('GREETING_RETURNING', 'es', name=GUARDIAN_NAME)} {render('ASK_MENU', 'es')}",
        f"{render('ASK_SUBJECT', 'es')}\n1. {SPANISH_SUBJECT}",
        f"{render('ASK_TUTOR', 'es')}\n1. {tutor}\n2. {render('ANY_TUTOR_LABEL', 'es')}",
        render("ASK_DATE", "es"),
        f"{render('ASK_SLOT', 'es', date=date)}\n1. {slot}",
        render("CONFIRM_SLOT", "es", label=slot, date=date),
        render("BOOKING_CONFIRMED", "es", label=slot, date=date),
    ]
    booking = db.execute(select(Booking)).scalar_one()
    assert booking.status is BookingStatus.CONFIRMED
    assert booking.child_id == spanish.client.child_id
    assert booking.home_id == spanish.client.home_id
    assert booking.subject_id == spanish.subject.id
    assert booking.tutor_id == spanish.tutor.id
    assert booking.booked_by_guardian_id == spanish.client.guardian_id
    assert (booking.scheduled_date, booking.start_time) == (DATE, NINE)
    assert whatsapp.conversation().language is Language.ES


def test_a_spanish_guardian_cancels_a_session_in_spanish(
    whatsapp: WhatsApp, db: Session, spanish: SpanishWorld, cutoff: None
) -> None:
    booking = _make_booking(db, spanish, start=FOUR_PM)
    line = _session_line(spanish, start=FOUR_PM, end=FIVE_PM)

    replies = [
        whatsapp.say("Hola"),
        whatsapp.say("quiero cancelar una sesión", intent=BotIntent.CANCEL, language="es"),
        whatsapp.say("1", value="1"),
        whatsapp.say("sí", value="yes", language="es"),
    ]

    assert replies == [
        f"{render('GREETING_RETURNING', 'es', name=GUARDIAN_NAME)} {render('ASK_MENU', 'es')}",
        f"{render('ASK_WHICH_TO_CANCEL', 'es')}\n1. {line}",
        render(
            "CONFIRM_CANCEL",
            "es",
            child=CHILD_NAME,
            date=format_date(DATE, "es"),
            time=format_time_range(FOUR_PM, FIVE_PM, "es"),
        ),
        render("CANCELLED", "es"),
    ]
    assert db.get(Booking, booking.id).status is BookingStatus.CANCELLED


def test_a_spanish_guardian_moves_a_session_in_spanish(
    whatsapp: WhatsApp, db: Session, spanish: SpanishWorld, cutoff: None
) -> None:
    original = _make_booking(db, spanish, start=FOUR_PM)
    line = _session_line(spanish, start=FOUR_PM, end=FIVE_PM)
    slot = format_slot_label(format_time_range(NINE, TEN, "es"), spanish.tutor.user.name, "es")
    date = format_date(DATE, "es")

    replies = [
        whatsapp.say("Hola"),
        whatsapp.say("necesito cambiar una sesión", intent=BotIntent.RESCHEDULE, language="es"),
        whatsapp.say("1", value="1"),
        whatsapp.say("el miércoles", value=DATE.isoformat(), language="es"),
        whatsapp.say("1", value="1"),
        whatsapp.say("sí", value="yes", language="es"),
    ]

    assert replies == [
        f"{render('GREETING_RETURNING', 'es', name=GUARDIAN_NAME)} {render('ASK_MENU', 'es')}",
        f"{render('ASK_WHICH_TO_MOVE', 'es')}\n1. {line}",
        render("ASK_NEW_DATE", "es"),
        f"{render('ASK_SLOT', 'es', date=date)}\n1. {slot}",
        render(
            "CONFIRM_RESCHEDULE",
            "es",
            label=slot,
            date=date,
            child=CHILD_NAME,
            old_date=date,
            old_time=format_time_range(FOUR_PM, FIVE_PM, "es"),
        ),
        render("BOOKING_MOVED", "es", label=slot, date=date),
    ]
    live = db.scalars(select(Booking).where(Booking.status == BookingStatus.CONFIRMED)).all()
    assert db.get(Booking, original.id).status is BookingStatus.CANCELLED
    assert [(row.scheduled_date, row.start_time) for row in live] == [(DATE, NINE)]


# --- world building -----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _World:
    subject: Subject
    subject_name: str
    tutor: Tutor
    availability_id: uuid.UUID


def _make_world(db: Session, *, name_es: str | None) -> _World:
    """One subject and one tutor teaching it, free 9:00-10:00 on `DATE`: exactly one slot."""
    suffix = uuid.uuid4().hex[:12]
    subject = Subject(name=f"Math {suffix}", name_es=name_es)
    tutor = Tutor(
        user=User(
            email=f"tutor-{suffix}@example.com", name=f"Mr. Lee {suffix[:4]}", role=UserRole.TUTOR
        ),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add_all([subject, tutor])
    db.flush()
    availability = TutorAvailability(
        tutor_id=tutor.id, day_of_week=DATE.weekday(), start_time=NINE, end_time=TEN
    )
    db.add_all(
        [TutorSubject(tutor_id=tutor.id, subject_id=subject.id, max_grade_level=12), availability]
    )
    db.flush()

    return _World(
        subject=subject,
        subject_name=subject.name,
        tutor=tutor,
        availability_id=availability.id,
    )


def _make_booking(db: Session, world: SpanishWorld, *, start: datetime.time) -> Booking:
    end = (datetime.datetime.combine(DATE, start) + datetime.timedelta(hours=1)).time()
    booking = Booking(
        child_id=world.client.child_id,
        tutor_id=world.tutor.id,
        subject_id=world.subject.id,
        availability_id=world.availability_id,
        home_id=world.client.home_id,
        booked_by_guardian_id=world.client.guardian_id,
        scheduled_date=DATE,
        start_time=start,
        end_time=end,
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()

    return booking


def _session_line(world: SpanishWorld, *, start: datetime.time, end: datetime.time) -> str:
    return format_session_line(
        format_date(DATE, "es"),
        format_time_range(start, end, "es"),
        SPANISH_SUBJECT,
        CHILD_NAME,
        world.tutor.user.name,
        "es",
    )
