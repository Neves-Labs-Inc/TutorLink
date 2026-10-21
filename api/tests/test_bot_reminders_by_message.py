"""Stopping and restarting the weekly Booking reminders by message (spec §3 "Reminder replies").

One seam: the webhook route, with `fake_twilio` signing each inbound message and standing in
for the REST send the fixed confirmation goes out on. STOP/BAJA/PARAR and START/ALTA are
answered by code, from the webhook, whoever holds the chat, and start no bot turn. A free-text
phrase is the agent's to read in a bot chat, or Staff's under Takeover.
"""

import datetime

import pytest

from app.models.enums import (
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    Language,
    MessageAuthor,
    MessageStatus,
)
from app.models.reminder_consent import ReminderConsent
from app.services.bot_messages import render
from app.services.reminder_consent_service import reminder_status
from tests.fake_twilio import CODE_UNDELIVERABLE
from tests.whatsapp_chat import WhatsAppChat

# Written out rather than read from the catalogue, so the tests do not share its list.
SPANISH_ONLY_KEYWORDS = frozenset({"baja", "parar", "alta"})
STATUSES = [ConversationStatus.BOT, ConversationStatus.HUMAN]


def _replies_in(body: str, stored: Language | None) -> str | None:
    """The language a keyword is answered in: Spanish for a Spanish-only one, else the stored."""
    is_spanish = body.strip(" .!").lower() in SPANISH_ONLY_KEYWORDS
    return "es" if is_spanish else (None if stored is None else stored.value)


def _known_guardian(
    chat: WhatsAppChat, status: ConversationStatus, *, language: Language | None = None
) -> None:
    chat.open(guardian=chat.add_guardian(), language=language)
    if status is ConversationStatus.HUMAN:
        chat.take_over()


@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("language", [Language.EN, Language.ES])
@pytest.mark.parametrize("body", ["STOP", "baja", "PARAR", " Stop! "])
def test_a_stop_keyword_opts_out_and_sends_the_fixed_confirmation_without_a_turn(
    whatsapp_chat: WhatsAppChat, status: ConversationStatus, language: Language, body: str
) -> None:
    _known_guardian(whatsapp_chat, status, language=language)

    whatsapp_chat.say(body)

    consent = whatsapp_chat.consents()[-1]
    notice = whatsapp_chat.notices()[0]
    expected = render("OPTED_OUT", _replies_in(body, language))
    assert (consent.action, consent.source, consent.message_id) == (
        ConsentAction.OPT_OUT,
        ConsentSource.MESSAGE,
        whatsapp_chat.last_inbound().id,
    )
    assert [(sent.to, sent.body) for sent in whatsapp_chat.fake.sent] == [
        (whatsapp_chat.phone_number, expected)
    ]
    assert (notice.author_kind, notice.author_user_id, notice.body, notice.twilio_sid) == (
        MessageAuthor.SYSTEM,
        None,
        expected,
        whatsapp_chat.fake.sent[0].sid,
    )
    assert notice.status is MessageStatus.QUEUED
    assert whatsapp_chat.conversation().turn_due_at is None
    assert whatsapp_chat.conversation().status is status


@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("body", ["START", "alta", "Alta."])
def test_a_start_keyword_opts_in_and_confirms_without_a_turn(
    whatsapp_chat: WhatsAppChat, status: ConversationStatus, body: str
) -> None:
    _known_guardian(whatsapp_chat, status, language=Language.EN)

    whatsapp_chat.say(body)

    consent = whatsapp_chat.consents()[-1]
    assert (consent.action, consent.source, consent.message_id) == (
        ConsentAction.OPT_IN,
        ConsentSource.MESSAGE,
        whatsapp_chat.last_inbound().id,
    )
    assert [sent.body for sent in whatsapp_chat.fake.sent] == [
        render("OPTED_IN", _replies_in(body, Language.EN))
    ]
    assert whatsapp_chat.conversation().turn_due_at is None


@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("stored", [Language.EN, None])
@pytest.mark.parametrize(
    ("body", "confirmation"), [("BAJA", "OPTED_OUT"), ("parar", "OPTED_OUT"), ("Alta", "OPTED_IN")]
)
def test_a_spanish_only_keyword_switches_the_chat_to_spanish(
    whatsapp_chat: WhatsAppChat,
    status: ConversationStatus,
    stored: Language | None,
    body: str,
    confirmation: str,
) -> None:
    _known_guardian(whatsapp_chat, status, language=stored)

    whatsapp_chat.say(body)

    assert [sent.body for sent in whatsapp_chat.fake.sent] == [render(confirmation, "es")]
    assert whatsapp_chat.conversation().language is Language.ES


@pytest.mark.parametrize("stored", [Language.EN, Language.ES, None])
@pytest.mark.parametrize(("body", "confirmation"), [("STOP", "OPTED_OUT"), ("start", "OPTED_IN")])
def test_a_neutral_keyword_keeps_the_stored_language(
    whatsapp_chat: WhatsAppChat, stored: Language | None, body: str, confirmation: str
) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.BOT, language=stored)

    whatsapp_chat.say(body)

    expected = render(confirmation, None if stored is None else stored.value)
    assert [sent.body for sent in whatsapp_chat.fake.sent] == [expected]
    assert whatsapp_chat.conversation().language is stored


def test_repeating_stop_confirms_again_and_appends_another_row(
    whatsapp_chat: WhatsAppChat,
) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.BOT)

    whatsapp_chat.say("STOP")
    whatsapp_chat.say("STOP")

    assert [sent.body for sent in whatsapp_chat.fake.sent] == [render("OPTED_OUT", None)] * 2
    assert [consent.action for consent in whatsapp_chat.consents()] == [ConsentAction.OPT_OUT] * 2


def test_stop_from_a_known_number_with_no_chat_yet_opts_the_guardian_out(
    whatsapp_chat: WhatsAppChat,
) -> None:
    guardian = whatsapp_chat.add_guardian()

    whatsapp_chat.say("STOP")

    assert whatsapp_chat.consents()[0].action is ConsentAction.OPT_OUT
    assert whatsapp_chat.conversation().guardian_id == guardian.id
    assert whatsapp_chat.conversation().turn_due_at is None


def test_start_by_message_turns_reminders_back_on_after_whatsapp_reported_a_block(
    whatsapp_chat: WhatsAppChat,
) -> None:
    """Staff may not undo a `system` opt-out (#18); the Guardian's own START still does."""
    guardian = whatsapp_chat.add_guardian()
    whatsapp_chat.open(guardian=guardian)
    whatsapp_chat.db.add(
        ReminderConsent(
            guardian_id=guardian.id,
            action=ConsentAction.OPT_OUT,
            source=ConsentSource.SYSTEM,
            phone_number=whatsapp_chat.phone_number,
            created_at=datetime.datetime(2026, 1, 1, tzinfo=datetime.UTC),
        )
    )
    whatsapp_chat.db.flush()
    before = reminder_status(whatsapp_chat.db, guardian_id=guardian.id)

    whatsapp_chat.say("START")

    after = reminder_status(whatsapp_chat.db, guardian_id=guardian.id)
    assert before.is_blocked_by_whatsapp is True
    assert after.is_blocked_by_whatsapp is False


def test_a_stop_phrase_in_a_bot_chat_is_the_agents_to_read(whatsapp_chat: WhatsAppChat) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.BOT)

    whatsapp_chat.say("please stop the reminders")

    assert whatsapp_chat.consents() == []
    assert whatsapp_chat.fake.sent == []
    assert whatsapp_chat.conversation().turn_due_at is not None


def test_a_stop_phrase_under_takeover_is_left_to_staff(whatsapp_chat: WhatsAppChat) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.HUMAN)

    whatsapp_chat.say("please stop")

    assert whatsapp_chat.consents() == []
    assert whatsapp_chat.fake.sent == []
    assert whatsapp_chat.notices() == []
    assert whatsapp_chat.conversation().turn_due_at is None


def test_stop_in_a_bot_chat_with_no_guardian_is_an_ordinary_message_for_the_agent(
    whatsapp_chat: WhatsAppChat,
) -> None:
    """Nothing to record against, so the message gets a normal turn (it may answer Intake)."""
    whatsapp_chat.open()

    whatsapp_chat.say("STOP")

    assert whatsapp_chat.consents() == []
    assert whatsapp_chat.fake.sent == []
    assert whatsapp_chat.conversation().turn_due_at is not None


def test_stop_under_takeover_with_no_guardian_records_the_message_and_nothing_else(
    whatsapp_chat: WhatsAppChat,
) -> None:
    whatsapp_chat.open()
    whatsapp_chat.take_over()

    whatsapp_chat.say("STOP")

    assert whatsapp_chat.last_inbound().body == "STOP"
    assert whatsapp_chat.consents() == []
    assert whatsapp_chat.fake.sent == []
    assert whatsapp_chat.conversation().turn_due_at is None


def test_a_refused_confirmation_is_marked_failed_with_the_code(
    whatsapp_chat: WhatsAppChat,
) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.BOT)
    whatsapp_chat.fake.fail_next(code=CODE_UNDELIVERABLE)

    whatsapp_chat.say("STOP")

    notice = whatsapp_chat.notices()[0]
    assert (notice.status, notice.error_code, notice.twilio_sid) == (
        MessageStatus.FAILED,
        CODE_UNDELIVERABLE,
        None,
    )
    assert whatsapp_chat.consents()[0].action is ConsentAction.OPT_OUT


def test_a_spanish_guardian_stops_then_restarts_reminders_by_message(
    whatsapp_chat: WhatsAppChat,
) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.BOT, language=Language.ES)

    whatsapp_chat.say("BAJA")
    whatsapp_chat.say("ALTA")

    assert [sent.body for sent in whatsapp_chat.fake.sent] == [
        render("OPTED_OUT", "es"),
        render("OPTED_IN", "es"),
    ]
    assert [consent.action for consent in whatsapp_chat.consents()] == [
        ConsentAction.OPT_OUT,
        ConsentAction.OPT_IN,
    ]
    assert whatsapp_chat.bot_replies() == []
