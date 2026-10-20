"""Shapes the WhatsApp webhook reads from Twilio's inbound requests."""

import enum


class ReminderButton(str, enum.Enum):
    """The weekly reminder template's quick-reply buttons, by the id Twilio sends as
    `ButtonPayload`. Fixed: the templates were submitted with exactly these ids."""

    BOOK_SESSION = "book_session"
    STOP_REMINDERS = "stop_reminders"
