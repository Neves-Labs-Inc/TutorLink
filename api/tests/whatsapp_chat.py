"""`whatsapp_chat`: one WhatsApp number posting to the real webhook route, signed like Twilio.

The webhook answers every inbound message with empty TwiML and leaves the reply to the bot's
worker (docs/specs/whatsapp-bot-agent.md §7), so `say` returns nothing to read. What a test
asserts is what the webhook wrote: the inbound row, the turn marker, a consent and its notice.
Requests share the test's rolled-back `db` session.

The `whatsapp_chat` fixture is in `tests/conftest.py`.
"""

import datetime
import uuid
from collections.abc import Generator
from dataclasses import dataclass

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    Language,
    MessageAuthor,
    SystemMessageKind,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.user import User
from tests.fake_twilio import FakeTwilio

CHAT_NUMBER = "+12025550123"
EMPTY_TWIML = "<Response></Response>"


@dataclass
class WhatsAppChat:
    api: TestClient
    fake: FakeTwilio
    db: Session
    phone_number: str = CHAT_NUMBER
    sent: int = 0

    def say(self, body: str, *, button_payload: str | None = None) -> None:
        """Post `body` from this number as a new delivery; the webhook answers empty TwiML."""
        self.sent += 1
        response = self.fake.post_inbound(
            self.api,
            from_number=self.phone_number,
            body=body,
            sid=self.last_sid,
            button_payload=button_payload,
        )
        assert response.status_code == 200
        assert response.text == EMPTY_TWIML

    def redeliver(self) -> None:
        """Post the last delivery again, as a Twilio retry does."""
        response = self.fake.post_inbound(
            self.api,
            from_number=self.phone_number,
            body=self.last_inbound().body,
            sid=self.last_sid,
        )
        assert response.status_code == 200
        assert response.text == EMPTY_TWIML

    @property
    def last_sid(self) -> str:
        # Not `SM` + digits: that is the shape `fake_twilio` gives the SIDs of its sends.
        return f"SMin{self.sent:030d}"

    def last_inbound(self) -> Message:
        return self.db.scalars(select(Message).where(Message.twilio_sid == self.last_sid)).one()

    def conversation(self) -> Conversation:
        conversation = self.db.scalars(
            select(Conversation).where(Conversation.phone_number == self.phone_number)
        ).one()
        self.db.refresh(conversation)
        return conversation

    def consents(self) -> list[ReminderConsent]:
        return list(
            self.db.scalars(select(ReminderConsent).order_by(ReminderConsent.created_at)).all()
        )

    def notices(self) -> list[Message]:
        return list(
            self.db.scalars(
                select(Message)
                .where(Message.system_kind == SystemMessageKind.CONSENT_NOTICE)
                .order_by(Message.created_at)
            ).all()
        )

    def bot_replies(self) -> list[Message]:
        return list(
            self.db.scalars(select(Message).where(Message.author_kind == MessageAuthor.BOT)).all()
        )

    def add_guardian(self, *, name: str = "Ada Guardian") -> Guardian:
        guardian = Guardian(name=name, phone_number=self.phone_number)
        self.db.add(guardian)
        self.db.flush()
        return guardian

    def open(
        self, *, guardian: Guardian | None = None, language: Language | None = None
    ) -> Conversation:
        """The chat's row, with the bot, before any message."""
        conversation = Conversation(
            phone_number=self.phone_number,
            guardian_id=None if guardian is None else guardian.id,
            language=language,
            last_message_at=datetime.datetime.now(tz=datetime.UTC),
        )
        self.db.add(conversation)
        self.db.flush()
        return conversation

    def take_over(self) -> User:
        staff = User(
            email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
            name="Laura",
            # Never logged in with, so no real hash is needed.
            hashed_password="not-a-hash",
            role=UserRole.ADMIN,
        )
        self.db.add(staff)
        self.db.flush()
        conversation = self.conversation()
        conversation.status = ConversationStatus.HUMAN
        conversation.taken_over_by_user_id = staff.id
        conversation.taken_over_at = datetime.datetime.now(tz=datetime.UTC)
        self.db.flush()
        return staff


def open_whatsapp_chat(db: Session, fake: FakeTwilio) -> Generator[WhatsAppChat, None, None]:
    """The `whatsapp_chat` fixture's body: the app wired to `db` for one test."""
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield WhatsAppChat(api=TestClient(app), fake=fake, db=db)
    finally:
        del app.dependency_overrides[get_db]
