"""The weekly reminder's quick-reply buttons, tapped in WhatsApp (spec §3 "Reminder replies").

Two seams. The webhook route, with `fake_twilio` signing each tap: Twilio sends a tap as an
inbound message whose `Body` is the button's text and whose `ButtonPayload` is its id. And
`take_turn` with a scripted model, for what the agent is given to read after a "Book a session"
tap. "Stop reminders" is answered by code like STOP; "Book a session" is a plain message.
"""

import pytest
from sqlalchemy.orm import Session

from app.models.enums import ConsentAction, ConsentSource, ConversationStatus, Language
from app.services import bot_context
from app.services.bot_messages import render
from app.services.bot_turn import TurnDeps, take_turn
from tests.test_bot_turn import SYSTEM_PROMPT, FakeModel, reply
from tests.whatsapp_chat import WhatsAppChat

BOOK = "book_session"
STOP = "stop_reminders"
BUTTON_TEXT = {
    (BOOK, Language.EN): "Book a session",
    (BOOK, Language.ES): "Reservar una sesión",
    (STOP, Language.EN): "Stop reminders",
    (STOP, Language.ES): "No más recordatorios",
}
STATUSES = [ConversationStatus.BOT, ConversationStatus.HUMAN]


def _tap(chat: WhatsAppChat, button: str, language: Language) -> None:
    chat.say(BUTTON_TEXT[(button, language)], button_payload=button)


def _known_guardian(chat: WhatsAppChat, status: ConversationStatus, language: Language) -> None:
    chat.open(guardian=chat.add_guardian(), language=language)
    if status is ConversationStatus.HUMAN:
        chat.take_over()


@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("language", [Language.EN, Language.ES])
def test_stop_reminders_opts_out_and_sends_the_fixed_confirmation_without_a_turn(
    whatsapp_chat: WhatsAppChat, status: ConversationStatus, language: Language
) -> None:
    _known_guardian(whatsapp_chat, status, language)

    _tap(whatsapp_chat, STOP, language)

    consent = whatsapp_chat.consents()[-1]
    assert (consent.action, consent.source, consent.message_id) == (
        ConsentAction.OPT_OUT,
        ConsentSource.MESSAGE,
        whatsapp_chat.last_inbound().id,
    )
    assert [(sent.to, sent.body) for sent in whatsapp_chat.fake.sent] == [
        (whatsapp_chat.phone_number, render("OPTED_OUT", language.value))
    ]
    assert whatsapp_chat.notices()[0].body == render("OPTED_OUT", language.value)
    assert whatsapp_chat.conversation().turn_due_at is None


@pytest.mark.parametrize("language", [Language.EN, Language.ES])
def test_book_a_session_is_a_plain_message_that_schedules_the_agents_turn(
    whatsapp_chat: WhatsAppChat, language: Language
) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.BOT, language)

    _tap(whatsapp_chat, BOOK, language)

    assert whatsapp_chat.last_inbound().body == BUTTON_TEXT[(BOOK, language)]
    assert whatsapp_chat.conversation().turn_due_at is not None
    assert whatsapp_chat.consents() == []
    assert whatsapp_chat.fake.sent == []


def test_book_a_session_under_takeover_is_recorded_for_staff_and_starts_no_turn(
    whatsapp_chat: WhatsAppChat,
) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.HUMAN, Language.EN)

    _tap(whatsapp_chat, BOOK, Language.EN)

    assert whatsapp_chat.last_inbound().body == "Book a session"
    assert whatsapp_chat.conversation().turn_due_at is None
    assert whatsapp_chat.fake.sent == []


def test_the_agent_reads_a_book_a_session_tap_as_the_guardians_message(
    whatsapp_chat: WhatsAppChat, db: Session
) -> None:
    _known_guardian(whatsapp_chat, ConversationStatus.BOT, Language.EN)
    _tap(whatsapp_chat, BOOK, Language.EN)
    model = FakeModel(script=[reply("Which child is this for?")])

    take_turn(
        db,
        conversation_id=whatsapp_chat.conversation().id,
        deps=TurnDeps(
            model=model,
            tools=(),
            system_prompt=lambda: SYSTEM_PROMPT,
            build_context=bot_context.build_turn_context,
            sleep=lambda seconds: None,
        ),
    )

    assert "Guardian: Book a session" in model.requests[0]["messages"][0]["content"]
    assert [sent.body for sent in whatsapp_chat.fake.sent] == ["Which child is this for?"]
