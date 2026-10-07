"""The weekly reminder's quick-reply buttons, tapped in WhatsApp.

One seam: the webhook route, with the real bot behind it. Twilio sends a tap as an inbound
message whose `Body` is the button's text and whose `ButtonPayload` is its id; `fake_twilio`
signs it. No test here calls Anthropic: a tap needs no parse, so the parser is left unscripted
and a parse fails the test.

The clock is frozen on a Wednesday, so "the week" is the Monday after it, 2026-10-19.
"""

import datetime
import uuid
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable, Generator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models.booking import Booking
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    BookingStatus,
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    Language,
    MessageStatus,
    SystemMessageKind,
)
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.subject import Subject
from app.schemas.bot import BotIntent, GuardianLanguage, ParsedIntent
from app.services import bot_service, parser_service
from app.services.bot_messages import render
from app.services.bot_state import FlowState, load_state, save_state
from tests.fake_twilio import FakeTwilio
from tests.test_bot_language import _make_world, _World
from tests.test_bot_service import (
    CANONICAL_NUMBER,
    CHILD_LEVEL,
    ClientWorld,
    ScriptedParser,
    _add_child,
    _evaluate,
    _make_client,
    _make_staff,
)

WEDNESDAY_NOON = datetime.datetime(2026, 10, 14, 12, 0)
WEEK_START = datetime.date(2026, 10, 19)
MONDAY_NOON = datetime.datetime(2026, 10, 19, 12, 0)
BOOK = "book_session"
STOP = "stop_reminders"
BUTTON_TEXT = {
    (BOOK, "en"): "Book a session",
    (BOOK, "es"): "Reservar una sesión",
    (STOP, "en"): "Stop reminders",
    (STOP, "es"): "No más recordatorios",
}


@pytest.fixture(autouse=True)
def parser(monkeypatch: pytest.MonkeyPatch) -> ScriptedParser:
    scripted = ScriptedParser()
    monkeypatch.setattr(parser_service, "parse_intent", scripted)

    return scripted


@pytest.fixture
def frozen(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(WEDNESDAY_NOON)


@dataclass
class Family:
    """A Guardian on `CANONICAL_NUMBER` with one Evaluated Child, "Sam Guardian"."""

    db: Session
    client: ClientWorld
    world: _World

    def evaluated_child(self, name: str) -> Child:
        child = _add_child(self.db, self.client, name=name)
        _evaluate(self.db, child.id, levels={self.world.subject.id: CHILD_LEVEL})

        return child

    def book(self, child_id: uuid.UUID, *, on: datetime.date) -> None:
        self.db.add(
            Booking(
                child_id=child_id,
                tutor_id=self.world.tutor.id,
                subject_id=self.world.subject.id,
                availability_id=self.world.availability_id,
                home_id=self.client.home_id,
                scheduled_date=on,
                start_time=datetime.time(9, 0),
                end_time=datetime.time(10, 0),
                status=BookingStatus.CONFIRMED,
            )
        )
        self.db.flush()

    def thread(self, language: Language | None) -> Conversation:
        conversation = Conversation(
            phone_number=CANONICAL_NUMBER,
            guardian_id=self.client.guardian_id,
            language=language,
            last_message_at=datetime.datetime.now(tz=datetime.UTC),
        )
        self.db.add(conversation)
        self.db.flush()

        return conversation


@pytest.fixture
def family(db: Session) -> Family:
    client = _make_client(db)
    world = _make_world(db, name_es=None)
    _evaluate(db, client.child_id, levels={world.subject.id: CHILD_LEVEL})

    return Family(db=db, client=client, world=world)


@dataclass
class Phone:
    api: TestClient
    fake: FakeTwilio
    db: Session
    sent: int = 0

    def tap(self, payload: str, language: GuardianLanguage) -> str:
        """Tap a reminder button; return the bot's reply (empty when it stayed silent)."""
        return self._post(BUTTON_TEXT[(payload, language)], button_payload=payload)

    def say(self, body: str) -> str:
        return self._post(body, button_payload=None)

    def _post(self, body: str, *, button_payload: str | None) -> str:
        self.sent += 1
        response = self.fake.post_inbound(
            self.api,
            from_number=CANONICAL_NUMBER,
            body=body,
            sid=self.last_sid,
            button_payload=button_payload,
        )
        assert response.status_code == 200
        message = ElementTree.fromstring(response.text).find("Message")

        return "" if message is None or message.text is None else message.text

    @property
    def last_sid(self) -> str:
        return f"SMin{self.sent:030d}"

    def state(self) -> FlowState | None:
        return load_state(self.db, phone_number=CANONICAL_NUMBER)

    def consents(self) -> list[ReminderConsent]:
        return list(
            self.db.scalars(select(ReminderConsent).order_by(ReminderConsent.created_at)).all()
        )

    def last_inbound(self) -> Message:
        return self.db.scalars(select(Message).where(Message.twilio_sid == self.last_sid)).one()


@pytest.fixture
def phone(db: Session, fake_twilio: FakeTwilio, frozen: None) -> Generator[Phone, None, None]:
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield Phone(api=TestClient(app), fake=fake_twilio, db=db)
    finally:
        del app.dependency_overrides[get_db]


def _take_over(db: Session, conversation: Conversation) -> None:
    staff = _make_staff(db)
    conversation.status = ConversationStatus.HUMAN
    conversation.taken_over_by_user_id = staff.id
    conversation.taken_over_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()


# --- Book a session ---------------------------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "es"])
def test_book_with_every_child_booked_says_so_and_returns_to_the_menu(
    phone: Phone, family: Family, language: GuardianLanguage
) -> None:
    family.thread(Language(language))
    family.book(family.client.child_id, on=WEEK_START + datetime.timedelta(days=2))

    reply = phone.tap(BOOK, language)

    state = phone.state()
    assert reply == f"{render('REMINDER_ALL_BOOKED', language)} {render('ASK_MENU', language)}"
    assert state is not None and state.step == bot_service.STEP_MENU


@pytest.mark.parametrize("language", ["en", "es"])
def test_book_with_one_unbooked_child_goes_straight_to_the_subject_question(
    phone: Phone, family: Family, language: GuardianLanguage
) -> None:
    family.thread(Language(language))
    booked = family.evaluated_child("Ana")
    family.book(booked.id, on=WEEK_START)

    reply = phone.tap(BOOK, language)

    state = phone.state()
    lead = render("REMINDER_BOOK_ONE", language, name="Sam Guardian")
    assert reply.startswith(f"{lead} {render('ASK_SUBJECT', language)}\n")
    assert state is not None and state.step == bot_service.STEP_BOOK_SUBJECT
    assert state.collected_data["book_child_id"] == str(family.client.child_id)


@pytest.mark.parametrize("language", ["en", "es"])
def test_book_with_several_unbooked_children_lists_only_those(
    phone: Phone, family: Family, language: GuardianLanguage
) -> None:
    family.thread(Language(language))
    family.evaluated_child("Ana")
    booked = family.evaluated_child("Bea")
    family.book(booked.id, on=WEEK_START + datetime.timedelta(days=6))
    # Neither is eligible: one was never Evaluated, the other is inactive.
    _add_child(family.db, family.client, name="Cal")
    _add_child(family.db, family.client, name="Dee", is_active=False)

    reply = phone.tap(BOOK, language)

    state = phone.state()
    assert reply == f"{render('ASK_WHICH_CHILD', language)}\n1. Ana\n2. Sam Guardian"
    assert state is not None and state.step == bot_service.STEP_BOOK_CHILD


def test_picking_a_listed_child_after_the_tap_continues_the_booking_flow(
    phone: Phone, family: Family, parser: ScriptedParser
) -> None:
    family.thread(Language.EN)
    family.evaluated_child("Ana")
    phone.tap(BOOK, "en")
    parser.script(
        ParsedIntent(
            intent=BotIntent.UNKNOWN,
            answer="2",
            fields={},
            confidence_is_low=False,
            language=None,
            reminders=None,
        )
    )

    reply = phone.say("2")

    state = phone.state()
    assert reply.startswith(render("ASK_SUBJECT", "en"))
    assert state is not None
    assert state.collected_data["book_child_id"] == str(family.client.child_id)


def test_book_with_one_child_and_no_active_subject_only_says_it_cannot_continue(
    phone: Phone, family: Family
) -> None:
    family.thread(Language.EN)
    phone.db.execute(update(Subject).values(is_active=False))
    phone.db.flush()

    reply = phone.tap(BOOK, "en")

    assert reply == render("CANNOT_CONTINUE", "en")


def test_book_discards_a_flow_in_progress(phone: Phone, family: Family) -> None:
    family.thread(Language.EN)
    save_state(
        phone.db,
        phone_number=CANONICAL_NUMBER,
        state=FlowState(
            step=bot_service.STEP_CANCEL_CONFIRM,
            collected_data={"cancel_booking_id": str(uuid.uuid4())},
            misses=1,
            prompt="Cancel it?",
        ),
    )

    phone.tap(BOOK, "en")

    state = phone.state()
    assert state is not None
    assert (state.step, state.misses) == (bot_service.STEP_BOOK_SUBJECT, 0)
    assert "cancel_booking_id" not in state.collected_data


def test_book_on_a_monday_targets_the_following_monday(
    phone: Phone, family: Family, freeze_business_clock: Callable[[datetime.datetime], None]
) -> None:
    freeze_business_clock(MONDAY_NOON)
    family.thread(Language.EN)
    ana = family.evaluated_child("Ana")
    # Booked this week, which has begun: still due a session the week after.
    family.book(family.client.child_id, on=MONDAY_NOON.date() + datetime.timedelta(days=1))
    # Booked the following week: not listed.
    family.book(ana.id, on=datetime.date(2026, 10, 26))

    reply = phone.tap(BOOK, "en")

    assert reply.startswith(render("REMINDER_BOOK_ONE", "en", name="Sam Guardian"))


def test_book_under_takeover_is_left_to_staff(phone: Phone, family: Family, db: Session) -> None:
    _take_over(db, family.thread(Language.EN))

    reply = phone.tap(BOOK, "en")

    assert reply == ""
    assert phone.state() is None
    assert phone.fake.sent == []


# --- Stop reminders ---------------------------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "es"])
def test_stop_opts_out_and_confirms(
    phone: Phone, family: Family, language: GuardianLanguage
) -> None:
    family.thread(Language(language))

    reply = phone.tap(STOP, language)

    consent = phone.consents()[-1]
    assert reply == render("OPTED_OUT", language)
    assert (consent.guardian_id, consent.action, consent.source, consent.message_id) == (
        family.client.guardian_id,
        ConsentAction.OPT_OUT,
        ConsentSource.MESSAGE,
        phone.last_inbound().id,
    )


def test_stop_mid_flow_leaves_the_flow_where_it_was(phone: Phone, family: Family) -> None:
    family.thread(Language.EN)
    phone.tap(BOOK, "en")
    before = phone.state()
    assert before is not None

    phone.tap(STOP, "en")

    after = phone.state()
    assert after is not None
    assert (after.step, after.collected_data) == (before.step, before.collected_data)


@pytest.mark.parametrize("language", ["en", "es"])
def test_stop_under_takeover_opts_out_and_sends_the_confirmation_as_a_notice(
    phone: Phone, family: Family, db: Session, language: GuardianLanguage
) -> None:
    _take_over(db, family.thread(Language(language)))

    reply = phone.tap(STOP, language)

    consent = phone.consents()[-1]
    notice = db.scalars(
        select(Message).where(Message.system_kind == SystemMessageKind.CONSENT_NOTICE)
    ).one()
    assert reply == ""
    assert (consent.action, consent.source, consent.message_id) == (
        ConsentAction.OPT_OUT,
        ConsentSource.MESSAGE,
        phone.last_inbound().id,
    )
    assert [(sent.to, sent.body) for sent in phone.fake.sent] == [
        (CANONICAL_NUMBER, render("OPTED_OUT", language))
    ]
    assert (notice.body, notice.status) == (render("OPTED_OUT", language), MessageStatus.QUEUED)
