"""The bot message catalogue: completeness, rendering, formatters and keyword lists."""

import datetime
import re

import pytest

from app.models.enums import BookingLocation
from app.services import bot_messages
from app.services.bot_messages import MESSAGES, render

EXPECTED_IDS = {
    "GREETING_NEW",
    "ASK_CHILD_GRADE",
    "NUDGE_child_grade",
    "GRADE_OUT_OF_RANGE",
    "CHILD_ADDED",
    "EVALUATION_NOTICE",
    "ASK_REMINDERS",
    "REMINDERS_ON",
    "REMINDERS_DECLINED",
    "NUDGE_reminders",
    "REMINDERS_LEFT_OFF",
    "CLIENT_READY",
    "TEMPLATE_booking_reminder",
    "BUTTON_book_a_session",
    "BUTTON_stop_reminders",
    "REMINDER_ALL_BOOKED",
    "REMINDER_BOOK_ONE",
    "ASK_WHICH_CHILD",
    "OPTED_OUT",
    "OPTED_IN",
    "TAKEOVER_NOTICE",
    "HANDBACK_NOTICE",
    "FIRST_SESSION_HANDOFF",
    "SUBJECT_NEEDS_OFFICE",
    "GREETING_RETURNING",
    "ASK_GUARDIAN_NAME",
    "ASK_ADDRESS",
    "ASK_ACCESS_CODE",
    "ASK_HOME_LABEL",
    "ASK_CHILD_REGISTERED",
    "ASK_CHILD_NAME",
    "ASK_CHILD_DOB",
    "ASK_CHILD_SCHOOL",
    "ASK_CHILD_NOTES",
    "ASK_MORE_CHILDREN",
    "ASK_MENU",
    "SMALL_TALK_REPLY",
    "QUESTION_PASSED_ON",
    "NO_CHILDREN_YET",
    "NO_ACTIVE_CHILDREN",
    "ASK_SUBJECT",
    "ASK_TUTOR",
    "ANY_TUTOR_LABEL",
    "ASK_DATE",
    "ASK_WHERE",
    "OFFICE_OPTION",
    "AT_OFFICE",
    "AT_HOME_LABELLED",
    "AT_HOME",
    "SESSION_CHANGED_MEANWHILE",
    "ASK_SLOT",
    "SHOWING_SOME",
    "CONFIRM_SLOT",
    "CONFIRM_RESCHEDULE",
    "BOOKING_CONFIRMED",
    "BOOKING_MOVED",
    "NO_SLOTS",
    "DATE_NOT_BOOKABLE",
    "SLOT_JUST_TAKEN",
    "ASK_WHICH_TO_CANCEL",
    "CONFIRM_CANCEL",
    "CANCEL_KEPT",
    "CANCELLED",
    "ASK_WHICH_TO_MOVE",
    "ASK_NEW_DATE",
    "NO_UPCOMING",
    "NUDGE_intake_name",
    "NUDGE_intake_address",
    "NUDGE_intake_access_code",
    "NUDGE_intake_label",
    "NUDGE_child_registered",
    "NUDGE_child_name",
    "NUDGE_child_date_of_birth",
    "NUDGE_child_school",
    "NUDGE_child_notes",
    "NUDGE_child_more",
    "NUDGE_menu",
    "NUDGE_book_child",
    "NUDGE_book_subject",
    "NUDGE_first_session_subject",
    "NUDGE_book_tutor",
    "NUDGE_book_date",
    "NUDGE_book_home",
    "NUDGE_book_slot",
    "NUDGE_book_confirm",
    "NUDGE_first_session_date",
    "NUDGE_cancel_pick",
    "NUDGE_cancel_confirm",
    "NUDGE_reschedule_pick",
    "NUDGE_reactivation_confirm",
    "IMPLAUSIBLE_BIRTH_DATE",
    "UNREADABLE_DATE",
    "OPTION_OUT_OF_RANGE",
    "AMBIGUOUS_NAME",
    "AMBIGUOUS_CHILD",
    "CUTOFF_DECLINED",
    "GUARDIAN_LINK_REPLY",
    "BAILED_OUT",
    "PARSER_UNAVAILABLE",
    "CANNOT_CONTINUE",
    "REACTIVATION_OFFER",
    "REACTIVATION_REQUESTED",
    "REACTIVATION_NOT_NEEDED",
    "REACTIVATION_PENDING",
    "TAKEOVER_NOTICE_GENERIC",
    "RESCHEDULE_NEEDS_OFFICE",
}
GENERIC_IDS = {"TAKEOVER_NOTICE_GENERIC"}


def _placeholders(text: str) -> set[str]:
    return set(re.findall(r"{(\w+)}", text))


def test_every_id_from_the_doc_is_present() -> None:
    assert EXPECTED_IDS <= set(MESSAGES)
    assert GENERIC_IDS <= set(MESSAGES)
    assert set(MESSAGES) == EXPECTED_IDS


@pytest.mark.parametrize("message_id", sorted(MESSAGES))
def test_message_has_both_languages_with_matching_placeholders(message_id: str) -> None:
    entry = MESSAGES[message_id]

    assert set(entry) == {"en", "es"}
    assert entry["en"].strip()
    assert entry["es"].strip()
    assert _placeholders(entry["en"]) == _placeholders(entry["es"])


@pytest.mark.parametrize("message_id", sorted(GENERIC_IDS))
def test_generic_takeover_messages_have_no_placeholders(message_id: str) -> None:
    assert _placeholders(MESSAGES[message_id]["en"]) == set()


def test_template_bodies_use_named_placeholders() -> None:
    assert _placeholders(MESSAGES["TEMPLATE_booking_reminder"]["en"]) == {"names", "week"}


def test_shared_nudge_row_becomes_two_ids_with_the_same_text() -> None:
    assert MESSAGES["NUDGE_book_subject"] == MESSAGES["NUDGE_first_session_subject"]


def test_render_returns_the_spanish_or_english_line() -> None:
    assert (
        render("ASK_MENU", "es")
        == "Puedo reservar una sesión, cancelarla o cambiarla a otro horario. ¿Qué desea hacer?"
    )
    assert render("ASK_MENU", None) == (
        "I can book a session, cancel one, or move one to another time. What would you like to do?"
    )


def test_render_fills_placeholders() -> None:
    assert render("CHILD_ADDED", "es", name="Ana") == "Ya tenemos los datos de Ana."


def test_render_rejects_unknown_id_and_language() -> None:
    with pytest.raises(KeyError):
        render("NOT_A_MESSAGE", "en")
    with pytest.raises(ValueError):
        render("ASK_MENU", "fr")


@pytest.mark.parametrize(
    ("day", "language", "expected"),
    [
        (datetime.date(2025, 10, 14), "en", "Tuesday, October 14"),
        (datetime.date(2025, 10, 14), "es", "martes 14 de octubre"),
        (datetime.date(2025, 10, 14), None, "Tuesday, October 14"),
        (datetime.date(2026, 12, 6), "es", "domingo 6 de diciembre"),
    ],
)
def test_format_date(day: datetime.date, language: str | None, expected: str) -> None:
    assert bot_messages.format_date(day, language) == expected


@pytest.mark.parametrize(
    ("language", "expected"),
    [("en", "October 12"), ("es", "12 de octubre")],
)
def test_format_week(language: str, expected: str) -> None:
    assert bot_messages.format_week(datetime.date(2026, 10, 12), language) == expected


@pytest.mark.parametrize(
    ("start", "end", "language", "expected"),
    [
        ((16, 0), (17, 0), "en", "4:00-5:00 PM"),
        ((16, 0), (17, 0), "es", "4:00-5:00 p. m."),
        ((11, 30), (12, 30), "en", "11:30 AM-12:30 PM"),
        ((11, 30), (12, 30), "es", "11:30 a. m.-12:30 p. m."),
        ((9, 0), (10, 15), "en", "9:00-10:15 AM"),
        ((12, 0), (13, 0), "en", "12:00-1:00 PM"),
        ((0, 0), (1, 0), "en", "12:00-1:00 AM"),
        ((23, 0), (23, 59), "es", "11:00-11:59 p. m."),
        ((23, 30), (0, 30), "en", "11:30 PM-12:30 AM"),
    ],
)
def test_format_time_range(
    start: tuple[int, int], end: tuple[int, int], language: str, expected: str
) -> None:
    result = bot_messages.format_time_range(datetime.time(*start), datetime.time(*end), language)

    assert result == expected


def test_format_session_line() -> None:
    parts = ("Tuesday, October 14", "4:00-5:00 PM", "Math", "Ana", "Mr. Lee")

    assert bot_messages.format_session_line(*parts, "at the office", "en") == (
        "Tuesday, October 14, 4:00-5:00 PM: Math for Ana with Mr. Lee at the office"
    )
    assert bot_messages.format_session_line(*parts, "en casa", "es") == (
        "Tuesday, October 14, 4:00-5:00 PM: Math para Ana con Mr. Lee en casa"
    )


@pytest.mark.parametrize(
    ("location", "label", "language", "expected"),
    [
        (BookingLocation.IN_OFFICE, None, "en", "at the office"),
        (BookingLocation.IN_OFFICE, None, "es", "en la oficina"),
        (BookingLocation.HOME, "Dad's", "en", "at Dad's"),
        (BookingLocation.HOME, "Dad's", "es", "en Dad's"),
        (BookingLocation.HOME, None, "en", "at home"),
        (BookingLocation.HOME, None, "es", "en casa"),
    ],
)
def test_format_location_names_the_place_in_both_languages(
    location: BookingLocation, label: str | None, language: str, expected: str
) -> None:
    assert bot_messages.format_location(location, label, language) == expected


@pytest.mark.parametrize(
    ("names", "language", "expected"),
    [
        (["Ana"], "en", "Ana"),
        (["Ana", "Luis"], "en", "Ana and Luis"),
        (["Ana", "Luis", "Sofia"], "en", "Ana, Luis, and Sofia"),
        (["Ana", "Luis"], "es", "Ana y Luis"),
        (["Ana", "Luis", "Sofía"], "es", "Ana, Luis y Sofía"),
    ],
)
def test_format_names(names: list[str], language: str, expected: str) -> None:
    assert bot_messages.format_names(names, language) == expected


@pytest.mark.parametrize("text", ["stop", " Baja ", "PARAR", "Stop\n"])
def test_stop_keywords_match(text: str) -> None:
    assert bot_messages.is_stop_keyword(text)


@pytest.mark.parametrize("text", ["start", "alta", " ALTA "])
def test_start_keywords_match(text: str) -> None:
    assert bot_messages.is_start_keyword(text)


@pytest.mark.parametrize(
    "text", ["cancelar", "cancel", "stop the session tomorrow", "stop reminders", ""]
)
def test_other_text_is_not_a_stop_keyword(text: str) -> None:
    assert not bot_messages.is_stop_keyword(text)


def test_cancel_words_are_not_stop_words() -> None:
    stop_words = bot_messages.STOP_KEYWORDS | bot_messages.STOP_PHRASES
    assert not {"cancel", "cancelar"} & stop_words


def test_normalize_lowercases_and_strips_accents() -> None:
    assert bot_messages.normalize("SÍ, Perfecto Ñu") == "si, perfecto nu"


def test_spanish_word_lists_ignore_accents_and_case() -> None:
    assert bot_messages.matches_word("SI", bot_messages.SPANISH_YES_WORDS)
    assert bot_messages.matches_word("todavia no", bot_messages.SPANISH_NO_WORDS)
    assert bot_messages.matches_word("Ninguna", bot_messages.SPANISH_SKIP_WORDS)
    assert not bot_messages.matches_word("maybe", bot_messages.SPANISH_YES_WORDS)


def test_slot_label_names_the_tutor_in_both_languages() -> None:
    assert bot_messages.format_slot_label("4:00-5:00 PM", "Mr. Lee", "at the office", "en") == (
        "4:00-5:00 PM with Mr. Lee at the office"
    )
    assert bot_messages.format_slot_label("4:00-5:00 p. m.", "Sr. Lee", "en casa", "es") == (
        "4:00-5:00 p. m. con Sr. Lee en casa"
    )


@pytest.mark.parametrize(
    ("text", "words"),
    [
        ("Sí.", bot_messages.SPANISH_YES_WORDS),
        ("¡Sí!", bot_messages.SPANISH_YES_WORDS),
        ("  claro   que   sí ! ", bot_messages.SPANISH_YES_WORDS),
        ("No, gracias.", bot_messages.SPANISH_NO_WORDS),
        ("¿Omitir?", bot_messages.SPANISH_SKIP_WORDS),
        ("STOP!", bot_messages.STOP_KEYWORDS),
        ("¡BAJA!", bot_messages.STOP_KEYWORDS),
        ("Start.", bot_messages.START_KEYWORDS),
        ("No más   recordatorios...", bot_messages.STOP_PHRASES),
        ("Stop reminders!", bot_messages.STOP_PHRASES),
        ("Send me reminders?", bot_messages.START_PHRASES),
    ],
)
def test_matching_ignores_edge_punctuation_and_repeated_spaces(
    text: str, words: frozenset[str]
) -> None:
    assert bot_messages.matches_word(text, words)


def test_stop_and_start_keywords_ignore_edge_punctuation() -> None:
    assert bot_messages.is_stop_keyword("Parar!")
    assert bot_messages.is_start_keyword("¡Alta!")


def test_punctuation_inside_a_message_still_stops_a_match() -> None:
    assert not bot_messages.matches_word("no, stop", bot_messages.STOP_KEYWORDS)


def test_phrase_lists_hold_the_doc_phrases() -> None:
    assert "no más recordatorios" in bot_messages.STOP_PHRASES
    assert "send me reminders" in bot_messages.START_PHRASES
