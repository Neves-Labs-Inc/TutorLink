"""Stopping and restarting the weekly Booking reminders by message, at any point in the chat.

One seam: the webhook route, with the real bot behind it and `fake_twilio` signing each inbound
message and standing in for the REST send a Takeover confirmation goes out on. The consent rows
are only written by the webhook (only it has the inbound message's id), so every case is
asserted there. **No test here calls Anthropic** (P7-I): the parser is scripted, and a case that
must not reach it leaves it unscripted, so a parse there fails the test.
"""

import datetime
import xml.etree.ElementTree as ElementTree
from collections.abc import Callable, Generator
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    Language,
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
)
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.schemas.bot import BotIntent, GuardianLanguage, ParsedIntent, RemindersRequest
from app.services import bot_service, parser_service
from app.services.bot_messages import render
from app.services.bot_state import FlowState, load_state
from tests.fake_twilio import CODE_UNDELIVERABLE, FakeTwilio
from tests.test_bot_intake import _child_turns
from tests.test_bot_language import SPANISH_SUBJECT, _make_world
from tests.test_bot_service import (
    CANONICAL_NUMBER,
    CHILD_LEVEL,
    NOW,
    ClientWorld,
    ScriptedParser,
    _evaluate,
    _make_client,
    _make_staff,
)

GUARDIAN_NAME = "Ada Guardian"
# Written out rather than read from the catalogue, so the tests do not share its list.
SPANISH_ONLY_KEYWORDS = frozenset({"baja", "parar", "alta"})


@pytest.fixture(autouse=True)
def parser(monkeypatch: pytest.MonkeyPatch) -> ScriptedParser:
    scripted = ScriptedParser()
    monkeypatch.setattr(parser_service, "parse_intent", scripted)

    return scripted


@pytest.fixture(autouse=True)
def frozen_clock(freeze_business_clock: Callable[[datetime.datetime], None]) -> None:
    freeze_business_clock(NOW)


@dataclass
class Thread:
    """One Guardian's WhatsApp thread, posted to the real webhook route."""

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
        reminders: RemindersRequest | None = None,
        confidence_is_low: bool = False,
    ) -> str:
        """Post `body` with the parser scripted to read it as given; return the TwiML reply."""
        self.parser.script(
            ParsedIntent(
                intent=intent,
                answer=value,
                fields={},
                confidence_is_low=confidence_is_low,
                language=language,
                reminders=reminders,
            )
        )

        return self.say_unparsed(body)

    def say_during_outage(self, body: str) -> str:
        self.parser.script(parser_service.ParseFailed("scripted outage"))

        return self.say_unparsed(body)

    def say_unparsed(self, body: str) -> str:
        """Post `body` with whatever the parser was last scripted to do, and return the reply
        (empty when the bot stayed silent)."""
        self.sent += 1
        response = self.fake.post_inbound(
            self.api, from_number=CANONICAL_NUMBER, body=body, sid=self.last_sid
        )
        assert response.status_code == 200
        message = ElementTree.fromstring(response.text).find("Message")

        return "" if message is None or message.text is None else message.text

    @property
    def last_sid(self) -> str:
        # Not `SM` + digits: that is the shape `fake_twilio` gives the SIDs of its sends.
        return f"SMin{self.sent:030d}"

    def last_inbound(self) -> Message:
        return self.db.scalars(select(Message).where(Message.twilio_sid == self.last_sid)).one()

    def conversation(self) -> Conversation:
        return self.db.scalars(
            select(Conversation).where(Conversation.phone_number == CANONICAL_NUMBER)
        ).one()

    def state(self) -> FlowState | None:
        return load_state(self.db, phone_number=CANONICAL_NUMBER)

    def consents(self) -> list[ReminderConsent]:
        return list(
            self.db.scalars(select(ReminderConsent).order_by(ReminderConsent.created_at)).all()
        )


@pytest.fixture
def thread(
    db: Session, fake_twilio: FakeTwilio, parser: ScriptedParser
) -> Generator[Thread, None, None]:
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield Thread(api=TestClient(app), fake=fake_twilio, parser=parser, db=db)
    finally:
        del app.dependency_overrides[get_db]


@pytest.fixture
def client(db: Session) -> ClientWorld:
    """A Guardian on `CANONICAL_NUMBER` with one Evaluated Child, and one Subject to book."""
    client = _make_client(db)
    world = _make_world(db, name_es=SPANISH_SUBJECT)
    _evaluate(db, client.child_id, levels={world.subject.id: CHILD_LEVEL})

    return client


def _start_conversation(db: Session, client: ClientWorld, *, language: Language | None) -> None:
    db.add(
        Conversation(
            phone_number=CANONICAL_NUMBER,
            guardian_id=client.guardian_id,
            language=language,
            last_message_at=datetime.datetime.now(tz=datetime.UTC),
        )
    )
    db.flush()


def _at_menu(thread: Thread, client: ClientWorld, language: GuardianLanguage) -> None:
    _start_conversation(thread.db, client, language=Language(language))
    thread.say("hi")
    assert thread.state() is not None


def _replies_in(body: str, stored: GuardianLanguage) -> GuardianLanguage:
    """The language a keyword is answered in: Spanish for a Spanish-only one, else the stored."""
    return "es" if body.strip(" .!").lower() in SPANISH_ONLY_KEYWORDS else stored


def _snapshot(state: FlowState | None) -> tuple[object, ...]:
    assert state is not None

    return (state.step, dict(state.collected_data), state.misses, state.prompt)


def _take_over(db: Session, conversation: Conversation) -> None:
    staff = _make_staff(db)
    conversation.status = ConversationStatus.HUMAN
    conversation.taken_over_by_user_id = staff.id
    conversation.taken_over_at = datetime.datetime.now(tz=datetime.UTC)
    db.flush()


def _consent_notices(db: Session) -> list[Message]:
    return list(
        db.scalars(
            select(Message).where(Message.system_kind == SystemMessageKind.CONSENT_NOTICE)
        ).all()
    )


# --- the keyword fast path ------------------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "es"])
@pytest.mark.parametrize("body", ["STOP", "baja", "PARAR", " Stop! "])
def test_a_stop_keyword_at_the_menu_opts_out_and_leaves_the_flow_where_it_was(
    thread: Thread, client: ClientWorld, language: GuardianLanguage, body: str
) -> None:
    _at_menu(thread, client, language)
    before = _snapshot(thread.state())
    parses = len(thread.parser.calls)

    reply = thread.say_unparsed(body)

    consent = thread.consents()[-1]
    assert reply == render("OPTED_OUT", _replies_in(body, language))
    assert (consent.guardian_id, consent.action, consent.source, consent.message_id) == (
        client.guardian_id,
        ConsentAction.OPT_OUT,
        ConsentSource.MESSAGE,
        thread.last_inbound().id,
    )
    assert _snapshot(thread.state()) == before
    assert len(thread.parser.calls) == parses


@pytest.mark.parametrize("language", ["en", "es"])
@pytest.mark.parametrize("body", ["START", "alta", "Alta."])
def test_a_start_keyword_opts_in_and_confirms(
    thread: Thread, client: ClientWorld, language: GuardianLanguage, body: str
) -> None:
    _at_menu(thread, client, language)

    reply = thread.say_unparsed(body)

    consent = thread.consents()[-1]
    assert reply == render("OPTED_IN", _replies_in(body, language))
    assert (consent.action, consent.source, consent.message_id) == (
        ConsentAction.OPT_IN,
        ConsentSource.MESSAGE,
        thread.last_inbound().id,
    )


@pytest.mark.parametrize("language", ["en", "es"])
@pytest.mark.parametrize("body", ["STOP", "baja", "PARAR"])
def test_stop_mid_booking_keeps_the_step_answers_and_misses_and_the_next_answer_continues(
    thread: Thread, client: ClientWorld, language: GuardianLanguage, body: str
) -> None:
    _at_menu(thread, client, language)
    thread.say("book a session", intent=BotIntent.BOOK)
    thread.say("hmm")
    before = _snapshot(thread.state())
    assert before[0] == bot_service.STEP_BOOK_SUBJECT
    assert before[2] == 1

    stopped = thread.say_unparsed(body)
    after = _snapshot(thread.state())
    next_reply = thread.say("1", value="1")

    replies_in = _replies_in(body, language)
    assert stopped == render("OPTED_OUT", replies_in)
    assert thread.consents()[-1].action is ConsentAction.OPT_OUT
    assert after == before
    assert next_reply.startswith(render("ASK_TUTOR", replies_in))


@pytest.mark.parametrize("stored", [Language.EN, None])
@pytest.mark.parametrize(
    ("body", "confirmation"), [("BAJA", "OPTED_OUT"), ("parar", "OPTED_OUT"), ("Alta", "OPTED_IN")]
)
def test_a_spanish_only_keyword_switches_the_thread_to_spanish(
    thread: Thread, client: ClientWorld, stored: Language | None, body: str, confirmation: str
) -> None:
    _start_conversation(thread.db, client, language=stored)

    reply = thread.say_unparsed(body)

    assert reply == render(confirmation, "es")
    assert thread.conversation().language is Language.ES
    assert thread.parser.calls == []


@pytest.mark.parametrize("stored", [Language.EN, Language.ES, None])
@pytest.mark.parametrize(("body", "confirmation"), [("STOP", "OPTED_OUT"), ("start", "OPTED_IN")])
def test_a_neutral_keyword_keeps_the_stored_language(
    thread: Thread, client: ClientWorld, stored: Language | None, body: str, confirmation: str
) -> None:
    _start_conversation(thread.db, client, language=stored)

    reply = thread.say_unparsed(body)

    assert reply == render(confirmation, None if stored is None else stored.value)
    assert thread.conversation().language is stored


def test_repeating_stop_confirms_again_and_appends_another_row(
    thread: Thread, client: ClientWorld
) -> None:
    _at_menu(thread, client, "en")

    replies = [thread.say_unparsed("STOP"), thread.say_unparsed("STOP")]

    assert replies == [render("OPTED_OUT", "en")] * 2
    assert [consent.action for consent in thread.consents()] == [ConsentAction.OPT_OUT] * 2


def test_stop_with_no_flow_in_progress_opts_a_known_guardian_out_without_greeting(
    thread: Thread, client: ClientWorld
) -> None:
    reply = thread.say_unparsed("STOP")

    assert reply == render("OPTED_OUT", "en")
    assert thread.consents()[0].action is ConsentAction.OPT_OUT
    assert thread.conversation().guardian_id == client.guardian_id
    assert thread.state() is None


def test_stop_during_a_parser_outage_still_opts_out_without_a_flag(
    thread: Thread, client: ClientWorld
) -> None:
    _at_menu(thread, client, "en")

    reply = thread.say_during_outage("STOP")

    assert reply == render("OPTED_OUT", "en")
    assert thread.consents()[0].action is ConsentAction.OPT_OUT
    assert thread.conversation().flag_reason is None


def test_stop_before_a_guardian_exists_is_a_plain_answer_to_the_intake_question(
    thread: Thread,
) -> None:
    thread.say("Hello")

    reply = thread.say("STOP", value="STOP")

    assert reply == render("ASK_ADDRESS", "en")
    assert thread.consents() == []


# --- the parser path --------------------------------------------------------------------------


def test_a_stop_phrase_the_parser_reads_as_stop_opts_out_and_leaves_the_flow(
    thread: Thread, client: ClientWorld
) -> None:
    _at_menu(thread, client, "en")
    before = _snapshot(thread.state())

    reply = thread.say("please stop sending me reminders", reminders="stop")

    consent = thread.consents()[0]
    assert reply == render("OPTED_OUT", "en")
    assert (consent.action, consent.source, consent.message_id) == (
        ConsentAction.OPT_OUT,
        ConsentSource.MESSAGE,
        thread.last_inbound().id,
    )
    assert _snapshot(thread.state()) == before


def test_a_spanish_stop_phrase_switches_an_english_thread_to_spanish(
    thread: Thread, client: ClientWorld
) -> None:
    _at_menu(thread, client, "en")

    reply = thread.say("no más recordatorios", reminders="stop", language="es")

    assert reply == render("OPTED_OUT", "es")
    assert thread.conversation().language is Language.ES


def test_a_start_phrase_the_parser_reads_as_start_opts_in(
    thread: Thread, client: ClientWorld
) -> None:
    _at_menu(thread, client, "en")

    reply = thread.say("send me reminders again", reminders="start")

    assert reply == render("OPTED_IN", "en")
    assert thread.consents()[0].action is ConsentAction.OPT_IN


def test_an_unsure_reminders_reading_is_not_acted_on(thread: Thread, client: ClientWorld) -> None:
    _at_menu(thread, client, "en")

    reply = thread.say("stop it", reminders="stop", confidence_is_low=True)

    assert reply != render("OPTED_OUT", "en")
    assert thread.consents() == []


def test_cancelling_tomorrows_session_is_a_cancel_not_a_stop(
    thread: Thread, client: ClientWorld
) -> None:
    _at_menu(thread, client, "es")

    reply = thread.say("cancelar la sesión de mañana", intent=BotIntent.CANCEL, language="es")

    assert reply == f"{render('NO_UPCOMING', 'es')} {render('ASK_MENU', 'es')}"
    assert thread.consents() == []


# --- the Intake reminder question stays ticket 07's ------------------------------------------


def _intake_to_the_reminder_question(thread: Thread) -> None:
    thread.say("Hello")
    for answer in [GUARDIAN_NAME, "1 Test Street", "1234", "Home", "no"]:
        thread.say(answer, value=answer)
    for answer, _, _ in _child_turns("Sam", "en"):
        thread.say(answer, value=answer)
    thread.say("no", value="no")
    state = thread.state()
    assert state is not None and state.step == bot_service.STEP_REMINDERS_OPT_IN


@pytest.mark.parametrize("outage", [False, True])
def test_stop_at_the_reminder_question_is_one_intake_no_even_during_an_outage(
    thread: Thread, outage: bool
) -> None:
    _intake_to_the_reminder_question(thread)

    reply = thread.say_during_outage("STOP") if outage else thread.say_unparsed("STOP")

    consents = thread.consents()
    assert reply.startswith(render("REMINDERS_DECLINED", "en"))
    assert [(consent.action, consent.source) for consent in consents] == [
        (ConsentAction.OPT_OUT, ConsentSource.INTAKE)
    ]
    assert consents[0].message_id == thread.last_inbound().id
    assert thread.conversation().flag_reason is None


def test_a_stop_phrase_at_the_reminder_question_is_still_read_as_its_yes_or_no(
    thread: Thread,
) -> None:
    _intake_to_the_reminder_question(thread)

    reply = thread.say("no thanks", value="no", reminders="stop")

    assert reply.startswith(render("REMINDERS_DECLINED", "en"))
    assert [consent.source for consent in thread.consents()] == [ConsentSource.INTAKE]


# --- under Takeover ---------------------------------------------------------------------------


@pytest.mark.parametrize("language", ["en", "es"])
def test_stop_under_takeover_opts_out_and_sends_the_confirmation_as_a_consent_notice(
    thread: Thread, client: ClientWorld, db: Session, language: GuardianLanguage
) -> None:
    _start_conversation(db, client, language=Language(language))
    _take_over(db, thread.conversation())

    reply = thread.say_unparsed("STOP")

    consent = thread.consents()[0]
    notices = _consent_notices(db)
    assert reply == ""
    assert (consent.action, consent.source, consent.message_id) == (
        ConsentAction.OPT_OUT,
        ConsentSource.MESSAGE,
        thread.last_inbound().id,
    )
    assert [(sent.to, sent.body) for sent in thread.fake.sent] == [
        (CANONICAL_NUMBER, render("OPTED_OUT", language))
    ]
    assert len(notices) == 1
    assert (
        notices[0].author_kind,
        notices[0].author_user_id,
        notices[0].body,
        notices[0].twilio_sid,
        notices[0].status,
    ) == (
        MessageAuthor.SYSTEM,
        None,
        render("OPTED_OUT", language),
        thread.fake.sent[0].sid,
        MessageStatus.QUEUED,
    )
    assert thread.conversation().status is ConversationStatus.HUMAN


def test_start_under_takeover_opts_in_and_confirms(
    thread: Thread, client: ClientWorld, db: Session
) -> None:
    _start_conversation(db, client, language=None)
    _take_over(db, thread.conversation())

    thread.say_unparsed("START")

    assert thread.consents()[0].action is ConsentAction.OPT_IN
    assert [sent.body for sent in thread.fake.sent] == [render("OPTED_IN", "en")]
    assert thread.conversation().language is None


@pytest.mark.parametrize("stored", [Language.EN, None])
def test_a_spanish_only_keyword_under_takeover_confirms_in_spanish_and_switches(
    thread: Thread, client: ClientWorld, db: Session, stored: Language | None
) -> None:
    _start_conversation(db, client, language=stored)
    _take_over(db, thread.conversation())

    thread.say_unparsed("ALTA")

    assert thread.consents()[0].action is ConsentAction.OPT_IN
    assert [sent.body for sent in thread.fake.sent] == [render("OPTED_IN", "es")]
    assert _consent_notices(db)[0].body == render("OPTED_IN", "es")
    assert thread.conversation().language is Language.ES


def test_a_stop_phrase_under_takeover_is_left_to_staff(
    thread: Thread, client: ClientWorld, db: Session
) -> None:
    _start_conversation(db, client, language=None)
    _take_over(db, thread.conversation())

    reply = thread.say_unparsed("please stop")

    assert reply == ""
    assert thread.consents() == []
    assert thread.fake.sent == []
    assert _consent_notices(db) == []
    assert thread.parser.calls == []


def test_a_refused_confirmation_under_takeover_is_marked_failed_with_the_code(
    thread: Thread, client: ClientWorld, db: Session
) -> None:
    _start_conversation(db, client, language=None)
    _take_over(db, thread.conversation())
    thread.fake.fail_next(code=CODE_UNDELIVERABLE)

    thread.say_unparsed("STOP")

    notice = _consent_notices(db)[0]
    assert (notice.status, notice.error_code, notice.twilio_sid) == (
        MessageStatus.FAILED,
        CODE_UNDELIVERABLE,
        None,
    )
    assert thread.consents()[0].action is ConsentAction.OPT_OUT


def test_stop_under_takeover_on_a_thread_with_no_guardian_records_and_sends_nothing(
    thread: Thread, db: Session
) -> None:
    db.add(
        Conversation(
            phone_number=CANONICAL_NUMBER,
            last_message_at=datetime.datetime.now(tz=datetime.UTC),
        )
    )
    db.flush()
    _take_over(db, thread.conversation())

    thread.say_unparsed("STOP")

    assert thread.consents() == []
    assert thread.fake.sent == []


# --- the Spanish fixture conversation ---------------------------------------------------------


def test_a_spanish_guardian_stops_then_restarts_reminders_by_message(
    thread: Thread, client: ClientWorld
) -> None:
    _start_conversation(thread.db, client, language=Language.ES)

    replies = [
        thread.say("Hola", language="es"),
        thread.say_unparsed("BAJA"),
        thread.say("ya no quiero recordatorios", reminders="stop", language="es"),
        thread.say_unparsed("ALTA"),
        thread.say("quiero recordatorios", reminders="start", language="es"),
    ]

    assert replies == [
        f"{render('GREETING_RETURNING', 'es', name=GUARDIAN_NAME)} {render('ASK_MENU', 'es')}",
        render("OPTED_OUT", "es"),
        render("OPTED_OUT", "es"),
        render("OPTED_IN", "es"),
        render("OPTED_IN", "es"),
    ]
    assert [(consent.action, consent.source) for consent in thread.consents()] == [
        (ConsentAction.OPT_OUT, ConsentSource.MESSAGE),
        (ConsentAction.OPT_OUT, ConsentSource.MESSAGE),
        (ConsentAction.OPT_IN, ConsentSource.MESSAGE),
        (ConsentAction.OPT_IN, ConsentSource.MESSAGE),
    ]
