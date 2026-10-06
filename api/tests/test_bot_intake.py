"""The end of Intake: the Overall grade step, the evaluation notice and the reminder question.

Two seams. `reply_for` (with the parser scripted) for the step cases: grade answers, re-prompts
and resume. The webhook route, with the real bot behind it and `fake_twilio` signing each
inbound message, for full Intakes in English and Spanish and for the consent rows, which only
the webhook writes because only it has the inbound message's id. **No test here calls
Anthropic** (P7-I): the parser is scripted for every test in this module.
"""

import datetime
from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.main import app
from app.models.child import Child
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.enums import ConsentAction, ConsentSource
from app.schemas.bot import (
    AnswerKind,
    BotIntent,
    BotTurn,
    ConsentInstruction,
    GuardianLanguage,
    ParsedIntent,
)
from app.services import bot_service, client_service, parser_service, reminder_consent_service
from app.services.bot_messages import render
from app.services.bot_state import FlowState, load_state, save_state
from tests.fake_twilio import FakeTwilio
from tests.test_bot_language import WhatsApp
from tests.test_bot_service import (
    CANONICAL_NUMBER,
    DATE_OF_BIRTH,
    NOW,
    Chat,
    ClientWorld,
    ScriptedParser,
    _answer_up_to_the_grade,
    _make_client,
)

CHILD_NAME = "Sam"


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


def _only_child(db: Session) -> Child:
    return db.execute(select(Child)).scalar_one()


# --- the Overall grade step (reply_for) ---------------------------------------------------------


def test_the_school_answer_is_followed_by_the_grade_question_naming_the_child(
    chat: Chat,
) -> None:
    _answer_up_to_the_grade(chat)

    assert chat.replies[-1].reply == render("ASK_CHILD_GRADE", "en", name=CHILD_NAME)
    assert chat.step == bot_service.STEP_CHILD_GRADE


@pytest.mark.parametrize(
    ("body", "canonical", "stored"),
    [("5", "5", 5), ("quinto grado", "5", 5), ("K", "0", 0), ("kínder", "0", 0)],
)
def test_a_grade_the_parser_read_as_k_to_12_is_stored_on_the_child(
    chat: Chat, db: Session, body: str, canonical: str, stored: int
) -> None:
    _answer_up_to_the_grade(chat)

    notes_question = chat.say(body, value=canonical)
    chat.say(value="none")

    assert notes_question.reply == render("ASK_CHILD_NOTES", "en")
    assert _only_child(db).grade_level == stored


@pytest.mark.parametrize("canonical", ["13", "college"])
def test_a_grade_outside_k_to_12_is_told_the_range_and_asked_again(
    chat: Chat, canonical: str
) -> None:
    _answer_up_to_the_grade(chat)

    turn = chat.say(canonical, value=canonical)

    assert turn.reply == (
        f"{render('GRADE_OUT_OF_RANGE', 'en')} {render('NUDGE_child_grade', 'en', name=CHILD_NAME)}"
    )
    assert chat.step == bot_service.STEP_CHILD_GRADE
    assert chat.state.misses == 1


def test_three_unclear_grades_move_on_to_the_notes_with_no_grade_and_no_flag(
    chat: Chat, db: Session
) -> None:
    _answer_up_to_the_grade(chat)

    turns = [chat.say("not sure"), chat.say("hmm", confidence_is_low=True), chat.say("?")]
    chat.say(value="none")

    nudge = render("NUDGE_child_grade", "en", name=CHILD_NAME)
    assert [turn.reply for turn in turns] == [nudge, nudge, render("ASK_CHILD_NOTES", "en")]
    assert all(turn.flag_reason is None for turn in turns)
    assert chat.step == bot_service.STEP_CHILD_MORE
    assert _only_child(db).grade_level is None


def test_the_parser_is_told_the_grade_is_a_number_with_kindergarten_as_zero(
    chat: Chat,
) -> None:
    _answer_up_to_the_grade(chat)

    chat.say("K", value="0")

    call = chat.parser.calls[-1]
    assert call["answer_kind"] is AnswerKind.NUMBER
    assert "(K, Kindergarten or kínder = 0)" in str(call["question"])


def test_a_flow_saved_at_the_notes_without_a_grade_creates_the_child_with_none(
    chat: Chat, db: Session, client: ClientWorld
) -> None:
    save_state(
        db,
        phone_number=chat.phone_number,
        state=FlowState(
            step=bot_service.STEP_CHILD_NOTES,
            collected_data={
                "child_name": "Robin",
                "child_date_of_birth": DATE_OF_BIRTH.isoformat(),
                "child_school": "Test School",
            },
        ),
    )

    turn = chat.say(value="none")

    robin = db.execute(select(Child).where(Child.name == "Robin")).scalar_one()
    assert turn.reply.startswith(render("CHILD_ADDED", "en", name="Robin"))
    assert robin.grade_level is None


def test_a_second_child_does_not_inherit_the_first_childs_grade(chat: Chat, db: Session) -> None:
    _answer_up_to_the_grade(chat)
    chat.say(value="7")
    chat.say(value="none")
    chat.say(value="yes")
    chat.say(value="no")
    chat.say(value="Robin")
    chat.say(value="2017-09-01")
    chat.say(value="Test School")
    chat.say("?")
    chat.say("?")
    chat.say("?")
    chat.say(value="none")

    grades = dict(db.execute(select(Child.name, Child.grade_level)).tuples().all())
    assert grades == {CHILD_NAME: 7, "Robin": None}


# --- the end of Intake (reply_for) ----------------------------------------------------------------


def _finish_the_child(chat: Chat) -> BotTurn:
    """From the school answer to "no more children", for the one Child named `CHILD_NAME`."""
    chat.say(value="5")
    chat.say(value="none")

    return chat.say(value="no")


def _reach_the_reminder_question(chat: Chat) -> BotTurn:
    _answer_up_to_the_grade(chat)

    return _finish_the_child(chat)


def _ready(language: str = "en") -> str:
    return f"{render('CLIENT_READY', language)} {render('ASK_MENU', language)}"


def test_no_more_children_gives_the_evaluation_notice_and_asks_about_reminders(
    chat: Chat,
) -> None:
    turn = _reach_the_reminder_question(chat)

    assert turn.reply == f"{render('EVALUATION_NOTICE', 'en')} {render('ASK_REMINDERS', 'en')}"
    assert chat.step == bot_service.STEP_REMINDERS_OPT_IN
    assert turn.consent is None


# The last column is the reply language on an English thread: BAJA and PARAR are Spanish words.
@pytest.mark.parametrize(
    ("body", "value", "action", "lead", "language"),
    [
        ("yes", "yes", ConsentAction.OPT_IN, "REMINDERS_ON", "en"),
        ("no thanks", "no", ConsentAction.OPT_OUT, "REMINDERS_DECLINED", "en"),
        ("STOP", None, ConsentAction.OPT_OUT, "REMINDERS_DECLINED", "en"),
        ("¡Baja!", None, ConsentAction.OPT_OUT, "REMINDERS_DECLINED", "es"),
        ("parar", "no", ConsentAction.OPT_OUT, "REMINDERS_DECLINED", "es"),
    ],
)
def test_the_reminder_answer_is_returned_as_an_intake_consent_and_ends_at_the_menu(
    chat: Chat, body: str, value: str | None, action: ConsentAction, lead: str, language: str
) -> None:
    _reach_the_reminder_question(chat)

    turn = chat.say(body, value=value)

    assert turn.reply == f"{render(lead, language)} {_ready(language)}"
    assert turn.consent == ConsentInstruction(action=action, source=ConsentSource.INTAKE)
    assert turn.flag_reason is None
    assert chat.step == bot_service.STEP_MENU


def test_stop_at_the_reminder_question_is_a_no_even_when_the_parse_is_unsure(
    chat: Chat,
) -> None:
    _reach_the_reminder_question(chat)

    turn = chat.say("STOP", confidence_is_low=True)

    assert turn.consent == ConsentInstruction(
        action=ConsentAction.OPT_OUT, source=ConsentSource.INTAKE
    )


def test_the_parsers_reminders_field_is_ignored_at_the_reminder_question(
    chat: Chat,
) -> None:
    _reach_the_reminder_question(chat)
    chat.parser.script(
        ParsedIntent(
            intent=BotIntent.UNKNOWN,
            answer="yes",
            fields={},
            confidence_is_low=False,
            reminders="stop",
        )
    )

    turn = bot_service.reply_for(
        chat.db, phone_number=chat.phone_number, body="sure, but stop the spam", guardian_id=None
    )

    assert turn.consent == ConsentInstruction(
        action=ConsentAction.OPT_IN, source=ConsentSource.INTAKE
    )


def test_two_unclear_reminder_answers_leave_reminders_off_and_record_nothing(
    chat: Chat,
) -> None:
    _reach_the_reminder_question(chat)

    first = chat.say("maybe")
    second = chat.say("hmm", confidence_is_low=True)

    assert first.reply == render("NUDGE_reminders", "en")
    assert second.reply == f"{render('REMINDERS_LEFT_OFF', 'en')} {_ready()}"
    assert [first.consent, second.consent] == [None, None]
    assert [first.flag_reason, second.flag_reason] == [None, None]
    assert chat.step == bot_service.STEP_MENU


# --- full Intakes and the consent rows (the webhook) ----------------------------------------------


@pytest.fixture
def whatsapp(
    db: Session, fake_twilio: FakeTwilio, parser: ScriptedParser
) -> Generator[WhatsApp, None, None]:
    app.dependency_overrides[get_db] = lambda: db
    try:
        yield WhatsApp(api=TestClient(app), fake=fake_twilio, parser=parser, db=db)
    finally:
        del app.dependency_overrides[get_db]


def _step(db: Session) -> str | None:
    state = load_state(db, phone_number=CANONICAL_NUMBER)

    return None if state is None else state.step


def _consents(db: Session) -> list[ReminderConsent]:
    return list(db.scalars(select(ReminderConsent).order_by(ReminderConsent.created_at)).all())


def _last_inbound(db: Session, whatsapp: WhatsApp) -> Message:
    return db.scalars(select(Message).where(Message.twilio_sid == f"SM{whatsapp.sent:032d}")).one()


def _child_turns(name: str, language: str) -> list[tuple[str, str, str]]:
    """One Child's answers, from its name to its notes: (answer, expected reply, next step)."""
    return [
        (name, render("ASK_CHILD_DOB", language), bot_service.STEP_CHILD_DOB),
        (
            DATE_OF_BIRTH.isoformat(),
            render("ASK_CHILD_SCHOOL", language),
            bot_service.STEP_CHILD_SCHOOL,
        ),
        (
            "Test School",
            render("ASK_CHILD_GRADE", language, name=name),
            bot_service.STEP_CHILD_GRADE,
        ),
        ("5", render("ASK_CHILD_NOTES", language), bot_service.STEP_CHILD_NOTES),
        (
            "none",
            f"{render('CHILD_ADDED', language, name=name)} {render('ASK_MORE_CHILDREN', language)}",
            bot_service.STEP_CHILD_MORE,
        ),
    ]


@pytest.mark.parametrize("language", ["en", "es"])
@pytest.mark.parametrize("children", [["Sam"], ["Sam", "Robin"]])
def test_a_first_intake_ends_with_one_evaluation_notice_and_the_reminder_question(
    whatsapp: WhatsApp, db: Session, language: GuardianLanguage, children: list[str]
) -> None:
    script: list[tuple[str, str, str]] = [
        ("Ada Guardian", render("ASK_ADDRESS", language), bot_service.STEP_INTAKE_ADDRESS),
        ("1 Test Street", render("ASK_ACCESS_CODE", language), bot_service.STEP_INTAKE_ACCESS_CODE),
        ("1234", render("ASK_HOME_LABEL", language), bot_service.STEP_INTAKE_LABEL),
        ("Home", render("ASK_CHILD_REGISTERED", language), bot_service.STEP_CHILD_REGISTERED),
        ("no", render("ASK_CHILD_NAME", language), bot_service.STEP_CHILD_NAME),
    ]
    for index, name in enumerate(children):
        if index > 0:
            script += [
                (
                    "yes",
                    render("ASK_CHILD_REGISTERED", language),
                    bot_service.STEP_CHILD_REGISTERED,
                ),
                ("no", render("ASK_CHILD_NAME", language), bot_service.STEP_CHILD_NAME),
            ]
        script += _child_turns(name, language)
    script += [
        (
            "no",
            f"{render('EVALUATION_NOTICE', language)} {render('ASK_REMINDERS', language)}",
            bot_service.STEP_REMINDERS_OPT_IN,
        ),
        (
            "yes",
            f"{render('REMINDERS_ON', language)} {_ready(language)}",
            bot_service.STEP_MENU,
        ),
    ]

    opening = whatsapp.say("Hola" if language == "es" else "Hello", language=language)
    replies = [opening]
    steps = [_step(db)]
    for answer, _, _ in script:
        replies.append(whatsapp.say(answer, value=answer))
        steps.append(_step(db))

    greeting = f"{render('GREETING_NEW', language)} {render('ASK_GUARDIAN_NAME', language)}"
    assert replies == [greeting] + [reply for _, reply, _ in script]
    assert steps == [bot_service.STEP_INTAKE_NAME] + [step for _, _, step in script]
    assert sum(render("EVALUATION_NOTICE", language) in reply for reply in replies) == 1
    assert sorted(db.scalars(select(Child.name)).all()) == sorted(children)


@pytest.mark.parametrize(
    ("body", "value", "action", "language"),
    [
        ("yes", "yes", ConsentAction.OPT_IN, "en"),
        ("no", "no", ConsentAction.OPT_OUT, "en"),
        ("STOP", None, ConsentAction.OPT_OUT, "en"),
        ("BAJA", None, ConsentAction.OPT_OUT, "es"),
    ],
)
def test_the_reminder_answer_is_recorded_with_the_reply_as_its_evidence(
    whatsapp: WhatsApp,
    db: Session,
    body: str,
    value: str | None,
    action: ConsentAction,
    language: str,
) -> None:
    _webhook_intake_to_the_reminder_question(whatsapp)
    guardian = db.scalars(select(Guardian)).one()

    reply = whatsapp.say(body, value=value)

    consent = db.scalars(select(ReminderConsent)).one()
    lead = "REMINDERS_ON" if action is ConsentAction.OPT_IN else "REMINDERS_DECLINED"
    assert reply == f"{render(lead, language)} {_ready(language)}"
    assert (consent.guardian_id, consent.action, consent.source) == (
        guardian.id,
        action,
        ConsentSource.INTAKE,
    )
    assert consent.message_id == _last_inbound(db, whatsapp).id


def test_two_unclear_reminder_answers_at_the_webhook_record_no_consent(
    whatsapp: WhatsApp, db: Session
) -> None:
    _webhook_intake_to_the_reminder_question(whatsapp)

    whatsapp.say("maybe")
    reply = whatsapp.say("hmm")

    assert reply == f"{render('REMINDERS_LEFT_OFF', 'en')} {_ready()}"
    assert _consents(db) == []
    assert whatsapp.conversation().flag_reason is None
    assert _step(db) == bot_service.STEP_MENU


@pytest.mark.parametrize("earlier", [None, ConsentAction.OPT_IN, ConsentAction.OPT_OUT])
def test_an_existing_guardian_adding_a_child_is_asked_about_reminders_only_without_consent(
    whatsapp: WhatsApp, db: Session, earlier: ConsentAction | None
) -> None:
    detail = client_service.create_client(
        db,
        name="Ada Guardian",
        phone_number=CANONICAL_NUMBER,
        home=client_service.HomeInput(label="Home", address="1 Test Street", access_code="1234"),
    )
    if earlier is not None:
        reminder_consent_service.record_consent(
            db,
            guardian_id=detail.client.id,
            action=earlier,
            source=ConsentSource.STAFF,
            message_id=None,
        )
    whatsapp.say("hi")
    whatsapp.say("book", intent=BotIntent.BOOK)
    whatsapp.say("no", value="no")
    for answer, _, _ in _child_turns("Sam", "en"):
        whatsapp.say(answer, value=answer)

    reply = whatsapp.say("no", value="no")

    notice = render("EVALUATION_NOTICE", "en")
    if earlier is None:
        assert reply == f"{notice} {render('ASK_REMINDERS', 'en')}"
        assert _step(db) == bot_service.STEP_REMINDERS_OPT_IN
    else:
        assert reply == f"{notice} {_ready()}"
        assert _step(db) == bot_service.STEP_MENU
    assert len(_consents(db)) == (0 if earlier is None else 1)


def _webhook_intake_to_the_reminder_question(whatsapp: WhatsApp) -> None:
    whatsapp.say("Hello")
    for answer in ["Ada Guardian", "1 Test Street", "1234", "Home", "no"]:
        whatsapp.say(answer, value=answer)
    for answer, _, _ in _child_turns("Sam", "en"):
        whatsapp.say(answer, value=answer)
    whatsapp.say("no", value="no")
