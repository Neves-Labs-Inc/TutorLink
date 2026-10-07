"""Every Guardian-facing bot message, in English and formal Spanish, by ID.

The wording is copied from the reviewed doc `.scratch/spanish-eval-reminders-manager/
bot-messages.md`. `render` is the one way to turn an ID into text; the formatters below build
the values (dates, time ranges, name lists) that fill the `{placeholders}`. Staff-facing English
(the booking note, dashboard lines) is deliberately not here.

WhatsApp template bodies write the doc's `{{1}}`/`{{2}}` as named placeholders so the same text
can be rendered into the chat when the template is not needed.
"""

import datetime
import unicodedata

DEFAULT_LANGUAGE = "en"
SPANISH = "es"
NOON_HOUR = 12

# `TAKEOVER_NOTICE_GENERIC` is not in the doc (Maye approved it separately). It is the nameless
# notice for Staff without a real Display name.
# `RESCHEDULE_NEEDS_OFFICE` is not in the doc either; its Spanish is a draft pending Maye's review.
MESSAGES: dict[str, dict[str, str]] = {
    "GREETING_NEW": {
        "en": "Hello, this is the Ms Helping Hands booking assistant. You don't have an account with us yet. Answering a few questions will set one up.",
        "es": "Hola, le saluda el asistente de reservas de Ms Helping Hands. Todavía no tiene una cuenta con nosotros. Si responde unas preguntas, se la crearemos.",
    },
    "ASK_CHILD_GRADE": {
        "en": "What grade is {name} in? For example, Kindergarten, 3rd grade or 10th grade.",
        "es": "¿En qué grado está {name}? Por ejemplo, kinder, 3.er grado o 10.º grado.",
    },
    "NUDGE_child_grade": {
        "en": 'Please send {name}\'s grade, from Kindergarten to 12th grade. For example, "K" or "5".',
        "es": 'Por favor, envíe el grado de {name}, de kinder a 12.º grado. Por ejemplo, "K" o "5".',
    },
    "GRADE_OUT_OF_RANGE": {
        "en": "We tutor from Kindergarten to 12th grade.",
        "es": "Ofrecemos tutorías desde kinder hasta 12.º grado.",
    },
    "CHILD_ADDED": {
        "en": "We have {name}'s details now.",
        "es": "Ya tenemos los datos de {name}.",
    },
    "EVALUATION_NOTICE": {
        "en": "Each child's first session is an evaluation session, so our tutors can see where they are in each subject. Our office will arrange it with you.",
        "es": "La primera sesión de cada niño es una sesión de evaluación, para que nuestros tutores conozcan su nivel en cada materia. Nuestra oficina la coordinará con usted.",
    },
    "ASK_REMINDERS": {
        "en": "Ms Helping Hands can send you a weekly WhatsApp reminder to book your tutoring sessions. You can reply STOP at any time to end them. Is that OK?",
        "es": "Ms Helping Hands puede enviarle un recordatorio semanal por WhatsApp para reservar sus sesiones de tutoría. Puede responder STOP en cualquier momento para dejar de recibirlos. ¿Le parece bien?",
    },
    "REMINDERS_ON": {
        "en": "Great, you'll get a reminder each week.",
        "es": "Perfecto, recibirá un recordatorio cada semana.",
    },
    "REMINDERS_DECLINED": {
        "en": "No problem, I won't send weekly reminders. Reply START at any time if you'd like them.",
        "es": "Entendido, no le enviaré recordatorios semanales. Si los desea, responda START en cualquier momento.",
    },
    "NUDGE_reminders": {
        "en": "Please reply yes if you'd like a weekly booking reminder, or no if not.",
        "es": "Por favor, responda sí si desea un recordatorio semanal para reservar, o no si no lo desea.",
    },
    "REMINDERS_LEFT_OFF": {
        "en": "I'll leave reminders off for now. Reply START at any time if you'd like them.",
        "es": "Por ahora no le enviaré recordatorios. Si los desea, responda START en cualquier momento.",
    },
    "CLIENT_READY": {
        "en": "Your account is set up. Thank you.",
        "es": "Su cuenta está lista. Gracias.",
    },
    "TEMPLATE_booking_reminder": {
        "en": "Hello, this is your weekly reminder from Ms Helping Hands, as you asked. There is no tutoring session booked yet for {names} in the week of {week}. Tap Book a session to choose a time, or reply STOP to end these reminders.",
        "es": "Hola, este es su recordatorio semanal de Ms Helping Hands, como lo solicitó. Aún no hay ninguna sesión de tutoría reservada para {names} en la semana del {week}. Toque Reservar una sesión para elegir un horario, o responda STOP para dejar de recibir estos recordatorios.",
    },
    "BUTTON_book_a_session": {
        "en": "Book a session",
        "es": "Reservar una sesión",
    },
    "BUTTON_stop_reminders": {
        "en": "Stop reminders",
        "es": "No más recordatorios",
    },
    "REMINDER_ALL_BOOKED": {
        "en": "Good news: everyone already has a session booked that week.",
        "es": "Buenas noticias: todos ya tienen una sesión reservada esa semana.",
    },
    "REMINDER_BOOK_ONE": {
        "en": "Let's book a session for {name}.",
        "es": "Vamos a reservar una sesión para {name}.",
    },
    "ASK_WHICH_CHILD": {
        "en": "Which child is this for?",
        "es": "¿Para cuál de sus hijos es?",
    },
    "OPTED_OUT": {
        "en": "Done, you won't get weekly reminders anymore. Reply START at any time to turn them back on.",
        "es": "Listo, ya no recibirá recordatorios semanales. Responda START en cualquier momento para volver a activarlos.",
    },
    "OPTED_IN": {
        "en": "Done, you'll get a booking reminder each week. Reply STOP at any time to end them.",
        "es": "Listo, recibirá un recordatorio semanal para reservar. Responda STOP en cualquier momento para dejar de recibirlos.",
    },
    "TAKEOVER_NOTICE": {
        "en": "{staff} from Ms Helping Hands has joined this chat and will reply to you here.",
        "es": "{staff}, de Ms Helping Hands, se ha unido a este chat y le responderá aquí.",
    },
    "HANDBACK_NOTICE": {
        "en": "You're back with the Ms Helping Hands booking assistant. I can book, cancel or move a session for you.",
        "es": "Ahora está de nuevo con el asistente de reservas de Ms Helping Hands. Puedo reservar, cancelar o cambiar una sesión por usted.",
    },
    "FIRST_SESSION_HANDOFF": {
        "en": "Thank you. {name}'s first session will be an evaluation session. Our office will arrange it and be in touch shortly.",
        "es": "Gracias. La primera sesión de {name} será una sesión de evaluación. Nuestra oficina la coordinará y se pondrá en contacto con usted pronto.",
    },
    "SUBJECT_NEEDS_OFFICE": {
        "en": "Thank you. Our office will arrange {name}'s {subject} sessions and be in touch shortly.",
        "es": "Gracias. Nuestra oficina coordinará las sesiones de {subject} de {name} y se pondrá en contacto con usted pronto.",
    },
    # Draft, pending Maye's review (the Spanish). It names the session being moved, so Staff
    # reading the flagged thread move that one rather than booking a second.
    "RESCHEDULE_NEEDS_OFFICE": {
        "en": "Thank you. Our office will help you move {child}'s {subject} session on {old_date}, {old_time} to {date}, and will be in touch shortly. The session stays booked until then.",
        "es": "Gracias. Nuestra oficina le ayudará a cambiar la sesión de {subject} de {child} del {old_date}, {old_time} al {date}, y se pondrá en contacto con usted pronto. La sesión sigue reservada hasta entonces.",
    },
    "GREETING_RETURNING": {
        "en": "Hello {name}, welcome back.",
        "es": "Hola, {name}. Qué gusto saludarle de nuevo.",
    },
    "ASK_GUARDIAN_NAME": {
        "en": "What is your full name?",
        "es": "¿Cuál es su nombre completo?",
    },
    "ASK_ADDRESS": {
        "en": "Thank you. What is the address where the tutoring will take place?",
        "es": "Gracias. ¿Cuál es la dirección donde se realizará la tutoría?",
    },
    "ASK_ACCESS_CODE": {
        "en": "Is there an access code or entry instruction the tutor will need?",
        "es": "¿Hay algún código de acceso o instrucción de entrada que el tutor necesite?",
    },
    "ASK_HOME_LABEL": {
        "en": 'Would you like to give this address a short name, such as "Mom\'s" or "Dad\'s"? It makes future bookings quicker. You can reply "skip".',
        "es": '¿Desea darle un nombre corto a esta dirección, como "Casa de mamá" o "Casa de papá"? Así sus próximas reservas serán más rápidas. Puede responder "omitir".',
    },
    "ASK_CHILD_REGISTERED": {
        "en": "Is this child already registered with us under another guardian?",
        "es": "¿Este niño ya está inscrito con nosotros por medio de otro tutor legal?",
    },
    "ASK_CHILD_NAME": {
        "en": "What is your child's name?",
        "es": "¿Cómo se llama su hijo o hija?",
    },
    "ASK_CHILD_DOB": {
        "en": "What is their date of birth? For example, April 23, 2016.",
        "es": "¿Cuál es su fecha de nacimiento? Por ejemplo, 23 de abril de 2016.",
    },
    "ASK_CHILD_SCHOOL": {
        "en": "Which school do they go to?",
        "es": "¿A qué escuela asiste?",
    },
    "ASK_CHILD_NOTES": {
        "en": 'Is there anything we should know about them, such as learning needs or allergies? You can reply "none".',
        "es": '¿Hay algo que debamos saber, como necesidades de aprendizaje o alergias? Puede responder "ninguno".',
    },
    "ASK_MORE_CHILDREN": {
        "en": "Would you like to add another child?",
        "es": "¿Desea agregar a otro hijo o hija?",
    },
    "ASK_MENU": {
        "en": "I can book a session, cancel one, or move one to another time. What would you like to do?",
        "es": "Puedo reservar una sesión, cancelarla o cambiarla a otro horario. ¿Qué desea hacer?",
    },
    "SMALL_TALK_REPLY": {
        "en": "Thanks for your message.",
        "es": "Gracias por su mensaje.",
    },
    "QUESTION_PASSED_ON": {
        "en": "I'm not able to answer that here, so I've passed your question to our office and someone will be in touch shortly.",
        "es": "No puedo responder eso por aquí, así que envié su pregunta a nuestra oficina y alguien se comunicará con usted pronto.",
    },
    "NO_CHILDREN_YET": {
        "en": "I don't have any children on file for you yet, so let's add one.",
        "es": "Todavía no tengo ningún niño registrado a su nombre, así que agreguemos uno.",
    },
    "NO_ACTIVE_CHILDREN": {
        "en": "I don't have any children active with us for you at the moment, so let's add one.",
        "es": "En este momento no tiene ningún niño activo con nosotros, así que agreguemos uno.",
    },
    "ASK_SUBJECT": {
        "en": "Which subject?",
        "es": "¿Qué materia?",
    },
    "ASK_TUTOR": {
        "en": "Would you like a particular tutor?",
        "es": "¿Desea algún tutor en particular?",
    },
    "ANY_TUTOR_LABEL": {
        "en": "Any available tutor",
        "es": "Cualquier tutor disponible",
    },
    "ASK_DATE": {
        "en": 'Which day would you like? For example, "Tuesday" or "October 14".',
        "es": '¿Qué día le gustaría? Por ejemplo, "martes" o "14 de octubre".',
    },
    "ASK_WHICH_HOME": {
        "en": "Which address should the tutor come to?",
        "es": "¿A qué dirección debe ir el tutor?",
    },
    "ASK_SLOT": {
        "en": "These times are available on {date}:",
        "es": "Estos horarios están disponibles el {date}:",
    },
    "SHOWING_SOME": {
        "en": "These are the first {shown} of {total} available times. Let me know if none of them suit you.",
        "es": "Estos son los primeros {shown} de {total} horarios disponibles. Avíseme si ninguno le conviene.",
    },
    "CONFIRM_SLOT": {
        "en": "To confirm: {label} on {date}. Should I book it?",
        "es": "Para confirmar: {label} el {date}. ¿Desea que la reserve?",
    },
    "CONFIRM_RESCHEDULE": {
        "en": "To confirm: {label} on {date}, replacing {child}'s session on {old_date}, {old_time}. Should I book it?",
        "es": "Para confirmar: {label} el {date}, en lugar de la sesión de {child} del {old_date}, {old_time}. ¿Desea que la reserve?",
    },
    "BOOKING_CONFIRMED": {
        "en": "Your session is booked: {label} on {date}.",
        "es": "Su sesión está reservada: {label} el {date}.",
    },
    "BOOKING_MOVED": {
        "en": "Your session has been moved to {label} on {date}.",
        "es": "Su sesión se cambió a {label} el {date}.",
    },
    "NO_SLOTS": {
        "en": "There are no available times on {date}.",
        "es": "No hay horarios disponibles el {date}.",
    },
    "DATE_NOT_BOOKABLE": {
        "en": "I can't book that far ahead, or that date has already passed.",
        "es": "No puedo reservar con tanta anticipación, o esa fecha ya pasó.",
    },
    "SLOT_JUST_TAKEN": {
        "en": "I'm sorry, that time was taken while we were talking. These times are still available:",
        "es": "Lo siento, ese horario se ocupó mientras conversábamos. Estos horarios siguen disponibles:",
    },
    "ASK_WHICH_TO_CANCEL": {
        "en": "Which session would you like to cancel?",
        "es": "¿Qué sesión desea cancelar?",
    },
    "CONFIRM_CANCEL": {
        "en": "Cancel {child}'s session on {date}, {time}? Please reply yes or no.",
        "es": "¿Cancelo la sesión de {child} del {date}, {time}? Por favor, responda sí o no.",
    },
    "CANCEL_KEPT": {
        "en": "No problem, I haven't canceled it.",
        "es": "No se preocupe, no la cancelé.",
    },
    "CANCELLED": {
        "en": "Your session has been canceled. Let me know if you would like to book another.",
        "es": "Su sesión fue cancelada. Avíseme si desea reservar otra.",
    },
    "ASK_WHICH_TO_MOVE": {
        "en": "Which session would you like to move?",
        "es": "¿Qué sesión desea cambiar?",
    },
    "ASK_NEW_DATE": {
        "en": "Which day would you like to move it to?",
        "es": "¿A qué día desea cambiarla?",
    },
    "NO_UPCOMING": {
        "en": "You don't have any upcoming sessions with us right now.",
        "es": "En este momento no tiene sesiones próximas con nosotros.",
    },
    "NUDGE_intake_name": {
        "en": "Please send your first and last name, for example Jane Smith.",
        "es": "Por favor, envíe su nombre y apellido, por ejemplo María López.",
    },
    "NUDGE_intake_address": {
        "en": "Please send the street address the tutor should come to, including the city and ZIP code.",
        "es": "Por favor, envíe la dirección a la que debe ir el tutor, con la ciudad y el código postal.",
    },
    "NUDGE_intake_access_code": {
        "en": 'Please send the access code or entry instructions for the tutor, or reply "none".',
        "es": 'Por favor, envíe el código de acceso o las instrucciones de entrada para el tutor, o responda "ninguno".',
    },
    "NUDGE_intake_label": {
        "en": 'Please send a short name for this address, such as "Home", or reply "skip".',
        "es": 'Por favor, envíe un nombre corto para esta dirección, como "Casa", o responda "omitir".',
    },
    "NUDGE_child_registered": {
        "en": "Please reply yes if another guardian has already registered this child with us, or no if not.",
        "es": "Por favor, responda sí si otro tutor legal ya inscribió a este niño con nosotros, o no si no lo hizo.",
    },
    "NUDGE_child_name": {
        "en": "Please send your child's first and last name.",
        "es": "Por favor, envíe el nombre y apellido de su hijo o hija.",
    },
    "NUDGE_child_date_of_birth": {
        "en": "Please send your child's date of birth with the month, day and year, for example April 23, 2016.",
        "es": "Por favor, envíe la fecha de nacimiento de su hijo o hija con día, mes y año, por ejemplo 23 de abril de 2016.",
    },
    "NUDGE_child_school": {
        "en": "Please send the name of your child's school.",
        "es": "Por favor, envíe el nombre de la escuela de su hijo o hija.",
    },
    "NUDGE_child_notes": {
        "en": 'Please send anything we should know about your child, or reply "none" if there is nothing.',
        "es": 'Por favor, envíenos cualquier cosa que debamos saber sobre su hijo o hija, o responda "ninguno" si no hay nada.',
    },
    "NUDGE_child_more": {
        "en": "Please reply yes to add another child, or no if that's everyone.",
        "es": "Por favor, responda sí para agregar a otro hijo o hija, o no si eso es todo.",
    },
    "NUDGE_menu": {
        "en": "Please let me know whether you'd like to book, cancel or move a session.",
        "es": "Por favor, dígame si desea reservar, cancelar o cambiar una sesión.",
    },
    "NUDGE_book_child": {
        "en": "Please reply with the number or name of the child the session is for:",
        "es": "Por favor, responda con el número o el nombre del niño para quien es la sesión:",
    },
    "NUDGE_book_subject": {
        "en": "Please reply with the number or name of the subject:",
        "es": "Por favor, responda con el número o el nombre de la materia:",
    },
    "NUDGE_first_session_subject": {
        "en": "Please reply with the number or name of the subject:",
        "es": "Por favor, responda con el número o el nombre de la materia:",
    },
    "NUDGE_book_tutor": {
        "en": "Please reply with the number or name of the tutor you'd like:",
        "es": "Por favor, responda con el número o el nombre del tutor que desea:",
    },
    "NUDGE_book_date": {
        "en": 'Please send the day you\'d like the session, such as "next Tuesday" or "October 14".',
        "es": 'Por favor, envíe el día que desea la sesión, como "el próximo martes" o "14 de octubre".',
    },
    "NUDGE_book_home": {
        "en": "Please reply with the number or name of the address for the session:",
        "es": "Por favor, responda con el número o el nombre de la dirección para la sesión:",
    },
    "NUDGE_book_slot": {
        "en": "Please reply with the number of the time you'd like:",
        "es": "Por favor, responda con el número del horario que desea:",
    },
    "NUDGE_book_confirm": {
        "en": "Please reply yes to book this session, or no to choose another time.",
        "es": "Por favor, responda sí para reservar esta sesión, o no para elegir otro horario.",
    },
    "NUDGE_first_session_date": {
        "en": 'Please send the day you\'d like the first session, such as "next Tuesday" or "October 14".',
        "es": 'Por favor, envíe el día que desea la primera sesión, como "el próximo martes" o "14 de octubre".',
    },
    "NUDGE_cancel_pick": {
        "en": "Please reply with the number of the session you'd like to cancel:",
        "es": "Por favor, responda con el número de la sesión que desea cancelar:",
    },
    "NUDGE_cancel_confirm": {
        "en": "Please reply yes to cancel this session, or no to keep it.",
        "es": "Por favor, responda sí para cancelar esta sesión, o no para mantenerla.",
    },
    "NUDGE_reschedule_pick": {
        "en": "Please reply with the number of the session you'd like to move:",
        "es": "Por favor, responda con el número de la sesión que desea cambiar:",
    },
    "NUDGE_reactivation_confirm": {
        "en": "Please reply yes if you'd like me to ask the office to reactivate them, or no if not.",
        "es": "Por favor, responda sí si desea que le pida a la oficina que lo reactive, o no si no lo desea.",
    },
    "IMPLAUSIBLE_BIRTH_DATE": {
        "en": "That date of birth doesn't look right.",
        "es": "Esa fecha de nacimiento no parece correcta.",
    },
    "UNREADABLE_DATE": {
        "en": "I couldn't read that as a date.",
        "es": "No pude entender eso como una fecha.",
    },
    "OPTION_OUT_OF_RANGE": {
        "en": "Please reply with a number from 1 to {count}:",
        "es": "Por favor, responda con un número del 1 al {count}:",
    },
    "AMBIGUOUS_NAME": {
        "en": "That matches more than one option. Please reply with the number you mean:",
        "es": "Eso coincide con más de una opción. Por favor, responda con el número que desea:",
    },
    "AMBIGUOUS_CHILD": {
        "en": "More than one of your children has that name, and not all of them are listed here. Please reply with the number of the child this session is for, or their full name:",
        "es": "Más de uno de sus hijos tiene ese nombre, y no todos aparecen en esta lista. Por favor, responda con el número del niño para quien es la sesión, o con su nombre completo:",
    },
    "CUTOFF_DECLINED": {
        "en": "That session is too close to its start time for me to change it. I've let the office know and someone will be in touch shortly.",
        "es": "Esa sesión está demasiado cerca de su hora de inicio para que yo la cambie. Ya le avisé a la oficina y alguien se comunicará con usted pronto.",
    },
    "GUARDIAN_LINK_REPLY": {
        "en": "Because another guardian is already registered for that child, an admin needs to set this up rather than me. I've passed it on and someone will be in touch shortly.",
        "es": "Como otro tutor legal ya está inscrito para ese niño, un administrador debe encargarse de esto en lugar de mí. Ya lo comuniqué y alguien se pondrá en contacto con usted pronto.",
    },
    "BAILED_OUT": {
        "en": "I'm sorry, I'm not following. I've asked one of our team to pick this up and they'll be in touch shortly.",
        "es": "Lo siento, no logro entenderle. Le pedí a alguien de nuestro equipo que se encargue y se comunicará con usted pronto.",
    },
    "PARSER_UNAVAILABLE": {
        "en": "I'm sorry, I'm having trouble right now. I've asked one of our team to pick this up and they'll be in touch shortly.",
        "es": "Lo siento, en este momento tengo problemas técnicos. Le pedí a alguien de nuestro equipo que se encargue y se comunicará con usted pronto.",
    },
    "CANNOT_CONTINUE": {
        "en": "I can't finish that from here. I've asked one of our team to pick this up and they'll be in touch shortly.",
        "es": "No puedo terminar eso desde aquí. Le pedí a alguien de nuestro equipo que se encargue y se comunicará con usted pronto.",
    },
    "REACTIVATION_OFFER": {
        "en": "{name} isn't active with us at the moment. Would you like me to ask the office to reactivate them?",
        "es": "{name} no está activo con nosotros en este momento. ¿Desea que le pida a la oficina que lo reactive?",
    },
    "REACTIVATION_REQUESTED": {
        "en": "I've asked the office to reactivate {name}. They'll be in touch.",
        "es": "Le pedí a la oficina que reactive a {name}. Se comunicarán con usted.",
    },
    "REACTIVATION_NOT_NEEDED": {
        "en": "{name} is active with us again, so there's nothing to ask the office.",
        "es": "{name} ya tiene su cuenta activa de nuevo, así que no hace falta pedirle nada a la oficina.",
    },
    "REACTIVATION_PENDING": {
        "en": "An earlier request is still waiting for our team, so I can't send another one yet. They'll be in touch.",
        "es": "Una solicitud anterior todavía está pendiente con nuestro equipo, así que aún no puedo enviar otra. Se comunicarán con usted.",
    },
    # Draft, pending Maye's review.
    "TAKEOVER_NOTICE_GENERIC": {
        "en": "A member of the Ms Helping Hands team has joined this chat and will reply to you here.",
        "es": "Una persona del equipo de Ms Helping Hands se ha unido a este chat y le responderá aquí.",
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
    "en": "{date}, {time}: {subject} for {child} with {tutor}",
    "es": "{date}, {time}: {subject} para {child} con {tutor}",
}
_SLOT_LABEL = {"en": "{time} with {tutor}", "es": "{time} con {tutor}"}


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


def format_session_line(
    date: str, time: str, subject: str, child: str, tutor: str, language: str | None
) -> str:
    """ "{date}, {time}: {subject} for {child} with {tutor}" from already-formatted parts."""
    return _SESSION_LINE[_code(language)].format(
        date=date, time=time, subject=subject, child=child, tutor=tutor
    )


def format_slot_label(time: str, tutor: str, language: str | None) -> str:
    """ "4:00-5:00 PM with Mr. Lee" from an already-formatted time range, for a slot list."""
    return _SLOT_LABEL[_code(language)].format(time=time, tutor=tutor)


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


# Trailing punctuation and Spanish opening marks are not part of an answer: "Sí.", "¡Sí!" and
# "STOP!" are a yes and a stop. Spaces are in the set so "sí !" trims down too.
EDGE_CHARACTERS = " .!?,¡¿"


def normalize(text: str) -> str:
    """The form every matcher compares: lowercase, no accents, repeated spaces collapsed and
    edge punctuation dropped, so "¡Sí!" and "si" compare equal."""
    decomposed = unicodedata.normalize("NFD", text.lower())
    unaccented = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(unaccented.split()).strip(EDGE_CHARACTERS)


# Words as written in the doc; compare through `matches_word`, which normalizes both sides.
SPANISH_YES_WORDS = frozenset(
    {
        "sí",
        "s",
        "claro",
        "claro que sí",
        "ok",
        "okay",
        "de acuerdo",
        "está bien",
        "por favor",
        "sí por favor",
        "sí gracias",
        "correcto",
        "por supuesto",
        "perfecto",
        "me parece bien",
        "adelante",
        "así es",
        "dale",
        "vale",
    }
)
SPANISH_NO_WORDS = frozenset(
    {
        "no",
        "n",
        "no gracias",
        "ahora no",
        "todavía no",
        "por ahora no",
        "no hace falta",
        "omitir",
        "saltar",
    }
)
SPANISH_SKIP_WORDS = frozenset({"omitir", "saltar", "ninguno", "ninguna", "nada", "no hay"})

STOP_KEYWORDS = frozenset({"stop", "baja", "parar"})
START_KEYWORDS = frozenset({"start", "alta"})
# The keywords that are Spanish words, so they mean Spanish; "stop" and "start" are neutral.
SPANISH_ONLY_KEYWORDS = frozenset({"baja", "parar", "alta"})
STOP_PHRASES = frozenset(
    {
        "no más recordatorios",
        "ya no quiero recordatorios",
        "stop reminders",
        "no more reminders",
    }
)
START_PHRASES = frozenset({"quiero recordatorios", "start reminders", "send me reminders"})
# "cancel"/"cancelar" are deliberately in neither list: they already mean cancelling a session.


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
