"""The bot's fixed Guardian-facing messages, in English and formal Spanish, by ID. The agent
writes everything else it says.

The wording is copied from the reviewed doc `.scratch/spanish-eval-reminders-manager/
bot-messages.md`. `render` is the one way to turn an ID into text; the formatters below build
the values (dates, time ranges, name lists) that fill the `{placeholders}`. Staff-facing English
(the booking note, dashboard lines) is deliberately not here.

WhatsApp template bodies write the doc's `{{1}}`/`{{2}}` as named placeholders so the same text
can be rendered into the chat when the template is not needed.
"""

import datetime
import unicodedata
import uuid
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.enums import BookingLocation
from app.services.home_set import homes_by_child
from app.services.settings_service import read_office_address

DEFAULT_LANGUAGE = "en"
SPANISH = "es"
NOON_HOUR = 12

# `TAKEOVER_NOTICE_GENERIC` is not in the doc (Maye approved it separately). It is the nameless
# notice for Staff without a real Display name.
MESSAGES: dict[str, dict[str, str]] = {
    # COPY: pending Franklin sign-off (respelled "M's Helping Hands")
    "TEMPLATE_booking_reminder": {
        "en": "Hello, this is your weekly reminder from M's Helping Hands, as you asked. There is no tutoring session booked yet for {names} in the week of {week}. Tap Book a session to choose a time, or reply STOP to end these reminders.",
        "es": "Hola, este es su recordatorio semanal de M's Helping Hands, como lo solicitó. Aún no hay ninguna sesión de tutoría reservada para {names} en la semana del {week}. Toque Reservar una sesión para elegir un horario, o responda STOP para dejar de recibir estos recordatorios.",
    },
    "BUTTON_book_a_session": {
        "en": "Book a session",
        "es": "Reservar una sesión",
    },
    "BUTTON_stop_reminders": {
        "en": "Stop reminders",
        "es": "No más recordatorios",
    },
    "OPTED_OUT": {
        "en": "Done, you won't get weekly reminders anymore. Reply START at any time to turn them back on.",
        "es": "Listo, ya no recibirá recordatorios semanales. Responda START en cualquier momento para volver a activarlos.",
    },
    "OPTED_IN": {
        "en": "Done, you'll get a booking reminder each week. Reply STOP at any time to end them.",
        "es": "Listo, recibirá un recordatorio semanal para reservar. Responda STOP en cualquier momento para dejar de recibirlos.",
    },
    # COPY: pending Franklin sign-off (respelled "M's Helping Hands")
    "TAKEOVER_NOTICE": {
        "en": "{staff} from M's Helping Hands has joined this chat and will reply to you here.",
        "es": "{staff}, de M's Helping Hands, se ha unido a este chat y le responderá aquí.",
    },
    # COPY: pending Franklin sign-off (respelled "M's Helping Hands")
    "HANDBACK_NOTICE": {
        "en": "You're back with the M's Helping Hands booking assistant. I can book, cancel or move a session for you.",
        "es": "Ahora está de nuevo con el asistente de reservas de M's Helping Hands. Puedo reservar, cancelar o cambiar una sesión por usted.",
    },
    # COPY: pending Franklin sign-off (outage apology)
    "OUTAGE_APOLOGY": {
        "en": "Sorry, I'm having trouble right now. Please try again in a little while, or call our office and we'll help you.",
        "es": "Lo sentimos, estamos teniendo un problema en este momento. Por favor, inténtelo de nuevo en un rato o llame a nuestra oficina y con gusto le ayudaremos.",
    },
    "COMMIT_BOOKED_ONE": {"en": "Your session is booked:", "es": "Su sesión está reservada:"},
    "COMMIT_BOOKED_BOTH": {
        "en": "Both sessions are booked:",
        "es": "Las dos sesiones están reservadas:",
    },
    # COPY: pending Franklin sign-off (placeholder lead-ins: three or more books, cancel,
    # reschedule, mixed commit)
    "COMMIT_BOOKED_MANY": {
        "en": "Your sessions are booked:",
        "es": "Sus sesiones están reservadas:",
    },
    "COMMIT_CANCELLED": {"en": "Your cancellation is done:", "es": "Su cancelación está hecha:"},
    "COMMIT_RESCHEDULED": {"en": "Your session is moved:", "es": "Su sesión se ha cambiado:"},
    "COMMIT_MIXED": {"en": "All done:", "es": "Todo listo:"},
    "AT_OFFICE": {"en": "at the office", "es": "en la oficina"},
    "AT_HOME_LABELLED": {"en": "at {label}", "es": "en {label}"},
    "AT_HOME": {"en": "at home", "es": "en casa"},
    # COPY: pending Franklin sign-off (respelled "M's Helping Hands")
    "TAKEOVER_NOTICE_GENERIC": {
        "en": "A member of the M's Helping Hands team has joined this chat and will reply to you here.",
        "es": "Una persona del equipo de M's Helping Hands se ha unido a este chat y le responderá aquí.",
    },
}

# --- rendering ---------------------------------------------------------------------------------


def render(message_id: str, language: str | None, **values: str | int) -> str:
    """The message in `language` (`None` is English). An unknown ID or language raises."""
    if message_id not in MESSAGES:
        raise KeyError(f"Unknown bot message ID: {message_id}")

    translations = MESSAGES[message_id]
    code = language or DEFAULT_LANGUAGE
    if code not in translations:
        raise ValueError(f"Unknown bot message language: {language}")

    return translations[code].format(**values)


# --- formatters (US usage in both languages) ---------------------------------------------------

_WEEKDAYS = {
    "en": (
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
    ),
    "es": ("lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"),
}
_MONTHS = {
    "en": (
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ),
    "es": (
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ),
}
_MERIDIEMS = {"en": ("AM", "PM"), "es": ("a. m.", "p. m.")}
_AND = {"en": "and", "es": "y"}
_SESSION_LINE = {
    "en": "{date}, {time}: {subject} for {child} with {tutor} {place}",
    "es": "{date}, {time}: {subject} para {child} con {tutor} {place}",
}
_SUBJECT_FALLBACK = {"en": "Session", "es": "Sesión"}
_COMMIT_KIND_BOOK = "book"
_COMMIT_KIND_CANCEL = "cancel"
_COMMIT_KIND_RESCHEDULE = "reschedule"
_MANY_HOMES = 2
_BOTH_BOOKED = 2


def _code(language: str | None) -> str:
    code = language or DEFAULT_LANGUAGE
    if code not in _MONTHS:
        raise ValueError(f"Unknown bot message language: {language}")
    return code


def format_date(day: datetime.date, language: str | None) -> str:
    """ "Tuesday, October 14" / "martes 14 de octubre". Tables, not `%A`/`%B`, so the output
    does not depend on the process locale."""
    code = _code(language)
    weekday = _WEEKDAYS[code][day.weekday()]
    month = _MONTHS[code][day.month - 1]
    if code == SPANISH:
        return f"{weekday} {day.day} de {month}"
    return f"{weekday}, {month} {day.day}"


def format_week(monday: datetime.date, language: str | None) -> str:
    """ "October 12" / "12 de octubre"."""
    code = _code(language)
    month = _MONTHS[code][monday.month - 1]
    if code == SPANISH:
        return f"{monday.day} de {month}"
    return f"{month} {monday.day}"


def _meridiem(moment: datetime.time, code: str) -> str:
    before_noon, after_noon = _MERIDIEMS[code]
    return before_noon if moment.hour < NOON_HOUR else after_noon


def _clock(moment: datetime.time) -> str:
    return f"{moment.hour % NOON_HOUR or NOON_HOUR}:{moment.minute:02d}"


def format_time_range(start: datetime.time, end: datetime.time, language: str | None) -> str:
    """ "4:00-5:00 PM" when both ends share AM/PM, else "11:30 AM-12:30 PM" (Spanish
    "p. m."/"a. m."). Noon is 12:00 PM and midnight 12:00 AM."""
    code = _code(language)
    start_suffix = _meridiem(start, code)
    end_suffix = _meridiem(end, code)

    if start_suffix == end_suffix:
        result = f"{_clock(start)}-{_clock(end)} {end_suffix}"
    else:
        result = f"{_clock(start)} {start_suffix}-{_clock(end)} {end_suffix}"
    return result


def format_location(location: BookingLocation, home_label: str | None, language: str | None) -> str:
    """ "at the office", "at Dad's" or "at home". Takes a label, never a Home: no address leaks."""
    if location == BookingLocation.IN_OFFICE:
        message_id = "AT_OFFICE"
    elif home_label:
        message_id = "AT_HOME_LABELLED"
    else:
        message_id = "AT_HOME"
    return render(message_id, language, label=home_label or "")


def format_session_line(
    date: str,
    time: str,
    subject: str,
    child: str,
    tutor: str,
    place: str,
    language: str | None,
) -> str:
    """ "{date}, {time}: {subject} for {child} with {tutor} {place}" from already-formatted parts."""
    return _SESSION_LINE[_code(language)].format(
        date=date, time=time, subject=subject, child=child, tutor=tutor, place=place
    )


def _lead_in(kinds: Sequence[str], language: str | None) -> str:
    distinct = set(kinds)
    if distinct == {_COMMIT_KIND_BOOK}:
        message_id = {1: "COMMIT_BOOKED_ONE", _BOTH_BOOKED: "COMMIT_BOOKED_BOTH"}.get(
            len(kinds), "COMMIT_BOOKED_MANY"
        )
    elif distinct == {_COMMIT_KIND_CANCEL}:
        message_id = "COMMIT_CANCELLED"
    elif distinct == {_COMMIT_KIND_RESCHEDULE}:
        message_id = "COMMIT_RESCHEDULED"
    else:
        message_id = "COMMIT_MIXED"
    return render(message_id, language)


def _commit_subject(booking: Booking, language: str | None) -> str:
    """The Spanish Subject name for a Spanish reply when Staff gave one, else the English one."""
    subject = booking.subject
    if subject is None:
        return _SUBJECT_FALLBACK[_code(language)]

    spanish = (subject.name_es or "").strip()
    return spanish if _code(language) == SPANISH and spanish else subject.name


def _commit_place(
    booking: Booking, family_home_count: int, office_address: str | None, language: str | None
) -> str:
    """Office: the `office_address` text as is. Home: "at home" until the family has a second
    Home, then the Home's label."""
    if booking.location == BookingLocation.IN_OFFICE and office_address:
        return office_address

    label = booking.home.label if booking.home and family_home_count >= _MANY_HOMES else None
    return format_location(booking.location, label, language)


def commit_confirmation(
    db: Session, *, committed: Sequence[tuple[str, uuid.UUID]], language: str | None
) -> str:
    """One message for everything a turn committed: a lead-in, then a line per Booking.

    `committed` holds `(kind, booking_id)`, kind being "book", "cancel" or "reschedule". The
    facts come from the saved Bookings, never from what the model said.
    """
    bookings = [db.get_one(Booking, booking_id) for _, booking_id in committed]
    homes = homes_by_child(db, child_ids={b.child_id for b in bookings}, include_archived=False)
    office_address = read_office_address(db)

    lines = [
        format_session_line(
            format_date(booking.scheduled_date, language),
            format_time_range(booking.start_time, booking.end_time, language),
            _commit_subject(booking, language),
            booking.child.name,
            booking.staff.name,
            _commit_place(booking, len(homes[booking.child_id]), office_address, language),
            language,
        )
        for booking in bookings
    ]
    return "\n".join([_lead_in([kind for kind, _ in committed], language), *lines])


def format_names(names: list[str], language: str | None) -> str:
    """ "Ana", "Ana and Luis", "Ana, Luis, and Sofia" (Spanish: "Ana, Luis y Sofía", no
    serial comma)."""
    code = _code(language)
    conjunction = _AND[code]

    if len(names) <= 1:
        result = "".join(names)
    elif len(names) == 2:
        result = f"{names[0]} {conjunction} {names[1]}"
    else:
        serial_comma = "," if code == DEFAULT_LANGUAGE else ""
        result = f"{', '.join(names[:-1])}{serial_comma} {conjunction} {names[-1]}"
    return result


# --- word lists --------------------------------------------------------------------------------


# Trailing punctuation and Spanish opening marks are not part of a keyword: "STOP!" and "¡Baja!"
# are a stop. Spaces are in the set so "stop !" trims down too.
EDGE_CHARACTERS = " .!?,¡¿"


def normalize(text: str) -> str:
    """The form every matcher compares: lowercase, no accents, repeated spaces collapsed and
    edge punctuation dropped, so "¡ALTA!" and "alta" compare equal."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    unaccented = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(unaccented.split()).strip(EDGE_CHARACTERS)


# Keywords as written in the doc; compare through `matches_word`, which normalizes both sides.
STOP_KEYWORDS = frozenset({"stop", "baja", "parar"})
START_KEYWORDS = frozenset({"start", "alta"})
# The keywords that are Spanish words, so they mean Spanish; "stop" and "start" are neutral.
SPANISH_ONLY_KEYWORDS = frozenset({"baja", "parar", "alta"})


def matches_word(text: str, words: frozenset[str]) -> bool:
    """Whole-message match, ignoring case, accents, repeated spaces and edge punctuation."""
    # A comma inside the message ("No, gracias") is a pause, not a different word.
    return normalize(text.replace(",", " ")) in {normalize(word) for word in words}


def is_stop_keyword(text: str) -> bool:
    return matches_word(text, STOP_KEYWORDS)


def is_start_keyword(text: str) -> bool:
    return matches_word(text, START_KEYWORDS)


def is_spanish_keyword(text: str) -> bool:
    return matches_word(text, SPANISH_ONLY_KEYWORDS)


def keyword_language(body: str) -> str | None:
    """Spanish for a Spanish-only stop/start keyword (BAJA, PARAR, ALTA), else `None`: STOP and
    START are neutral and leave the chat's language as it is."""
    return SPANISH if is_spanish_keyword(body) else None
