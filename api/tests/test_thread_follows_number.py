"""A Guardian's WhatsApp thread moves with their number (#126, with #119's follow-up).

When Staff change a Guardian's number from N to M, the Guardian's thread at N is re-keyed to M
with all its state, a Staff-only `number_change_note` line records the move, and the bot's
flow at both numbers is reset. N is left with no thread, so whoever writes from N next is
recognised by the number alone. The 24-hour window counts only what the Guardian wrote after
the latest number change.

Seams: the clients PATCH/POST routes, the signed inbound webhook with `fake_twilio`, the
conversation detail, messages and takeover routes, and the reminders route plus
`reminder_service.due_guardians`. **No test here calls Anthropic**: START needs no parse and
the parser raises if reached.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    FlagReason,
    Language,
    SystemMessageKind,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.message import Message
from app.models.system_setting import SystemSetting
from app.schemas.bot import BotIntent, ParsedIntent
from app.services import bot_service, conversation_service, parser_service
from app.services.bot_state import FlowState, load_state, save_state
from tests.fake_twilio import FakeTwilio
from tests.test_whatsapp_block_follows_number import EN_SID, World

NUMBER_CHANGE_NOTE = SystemMessageKind.NUMBER_CHANGE_NOTE.value
STAFF_NAME = "Test Staff"


@pytest.fixture(autouse=True)
def no_parser(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(**kwargs: object) -> object:
        raise AssertionError("a test here reached the parser")

    monkeypatch.setattr(parser_service, "parse_intent", refuse)


@pytest.fixture
def world(db: Session, api: TestClient, fake_twilio: FakeTwilio) -> World:
    db.execute(
        update(SystemSetting)
        .where(SystemSetting.key == f"reminder_template_sid_{Language.EN.value}")
        .values(value=EN_SID)
    )
    db.flush()

    return World(db=db, api=api, fake=fake_twilio)


def _parse_as_greeting(monkeypatch: pytest.MonkeyPatch) -> None:
    """A message from an unknown number is parsed for its language only; read it as English
    with nothing to act on, so the bot greets and opens Intake."""

    def read_hello(**kwargs: object) -> ParsedIntent:
        return ParsedIntent(
            intent=BotIntent.UNKNOWN, answer=None, fields={}, confidence_is_low=False
        )

    monkeypatch.setattr(parser_service, "parse_intent", read_hello)


def _thread_at(world: World, phone_number: str) -> Conversation | None:
    return world.db.scalars(
        select(Conversation).where(Conversation.phone_number == phone_number)
    ).first()


def _detail(world: World, conversation: Conversation) -> dict[str, object]:
    response = world.api.get(f"/api/conversations/{conversation.id}", headers=world.auth())
    assert response.status_code == 200
    detail: dict[str, object] = response.json()

    return detail


def _messages(world: World, conversation: Conversation) -> list[dict[str, object]]:
    response = world.api.get(
        f"/api/conversations/{conversation.id}/messages",
        params={"page_size": 100},
        headers=world.auth(),
    )
    assert response.status_code == 200
    items: list[dict[str, object]] = response.json()["items"]

    return items


def _notes(world: World, conversation: Conversation) -> list[dict[str, object]]:
    return [m for m in _messages(world, conversation) if m["system_kind"] == NUMBER_CHANGE_NOTE]


# --- the thread moves ------------------------------------------------------------------------


def test_the_guardians_thread_moves_to_the_new_number_with_all_its_state(world: World) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    world.say("START", from_number=old_number)
    thread = _thread_at(world, old_number)
    assert thread is not None
    read_at = datetime.datetime(2026, 10, 1, 9, 0, tzinfo=datetime.UTC)
    thread.status = ConversationStatus.HUMAN
    thread.taken_over_by_user_id = world.staff().id
    thread.taken_over_at = read_at
    thread.flag_reason = FlagReason.STUCK
    thread.flagged_at = read_at
    thread.reactivation_child_id = world.db.scalars(
        select(ChildGuardian.child_id).where(ChildGuardian.guardian_id == guardian.id)
    ).one()
    thread.language = Language.ES
    thread.last_read_at = read_at
    world.db.flush()
    before = _messages(world, thread)
    new_number = world.fresh_number()

    world.move(guardian, new_number)

    assert _thread_at(world, old_number) is None
    moved = _thread_at(world, new_number)
    assert moved is not None
    assert moved.id == thread.id
    detail = _detail(world, moved)
    assert detail["phone_number"] == new_number
    assert detail["status"] == "human"
    assert detail["taken_over_by"]["id"] == str(world.staff().id)  # type: ignore[index]
    assert detail["flag_reason"] == "stuck"
    assert detail["language"] == "es"
    assert detail["reactivation_request"] is not None
    assert detail["last_read_at"] is not None
    assert datetime.datetime.fromisoformat(str(detail["last_read_at"])) == read_at
    assert detail["guardian"]["id"] == str(guardian.id)  # type: ignore[index]
    after_ids = {m["id"] for m in _messages(world, moved)}
    assert {m["id"] for m in before} <= after_ids


def test_the_moved_thread_gets_one_staff_only_number_change_line_that_is_never_sent(
    world: World,
) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    world.say("START", from_number=old_number)
    sent_before = len(world.fake.sent)
    new_number = world.fresh_number()

    world.move(guardian, new_number)

    thread = _thread_at(world, new_number)
    assert thread is not None
    [note] = _notes(world, thread)
    assert note["author_kind"] == "system"
    assert note["author"]["id"] == str(world.staff().id)  # type: ignore[index]
    assert note["body"] == f"Number changed from {old_number} to {new_number} by {STAFF_NAME}"
    assert note["status"] == "sent"
    assert world.db.get_one(Message, note["id"]).twilio_sid is None
    assert len(world.fake.sent) == sent_before


def test_the_bot_flow_at_both_numbers_is_reset(world: World) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()
    for number in (old_number, new_number):
        save_state(
            world.db,
            phone_number=number,
            state=FlowState(step=bot_service.STEP_BOOK_CHILD, prompt="Which child?"),
        )

    world.move(guardian, new_number)

    assert load_state(world.db, phone_number=old_number) is None
    assert load_state(world.db, phone_number=new_number) is None


def test_the_same_number_in_another_format_moves_nothing_and_writes_no_line(
    world: World,
) -> None:
    guardian = world.guardian()
    number = guardian.phone_number
    world.say("START", from_number=number)

    world.move(guardian, f"({number[2:5]}) {number[5:8]}-{number[8:]}")

    thread = _thread_at(world, number)
    assert thread is not None
    assert _notes(world, thread) == []


def test_a_guardian_with_no_thread_changes_number_without_a_thread_or_a_line(
    world: World,
) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()

    world.move(guardian, new_number)

    assert guardian.phone_number == new_number
    assert _thread_at(world, old_number) is None
    assert _thread_at(world, new_number) is None


def test_a_thread_already_at_the_new_number_leaves_both_threads_as_they_are(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()
    world.say("START", from_number=old_number)
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=new_number)
    old_thread = _thread_at(world, old_number)
    new_thread = _thread_at(world, new_number)
    assert old_thread is not None and new_thread is not None
    for number in (old_number, new_number):
        save_state(
            world.db,
            phone_number=number,
            state=FlowState(step=bot_service.STEP_BOOK_CHILD, prompt="Which child?"),
        )

    world.move(guardian, new_number)

    assert guardian.phone_number == new_number
    assert load_state(world.db, phone_number=old_number) is None
    assert load_state(world.db, phone_number=new_number) is None
    assert _thread_at(world, old_number) == old_thread
    assert _thread_at(world, new_number) == new_thread
    assert _notes(world, old_thread) == []
    assert _notes(world, new_thread) == []


# --- a number given to someone else (#126) ---------------------------------------------------


def test_a_start_from_a_reassigned_number_is_recorded_for_its_new_guardian(
    world: World,
) -> None:
    first = world.guardian()
    number = first.phone_number
    world.say("START", from_number=number)
    world.move(first, world.fresh_number())
    first_consents = [(row.id, row.phone_number) for row in world.consents(first)]
    second = world.guardian()
    world.move(second, number)

    world.say("START", from_number=number)

    start = world.consents(second)[-1]
    assert (start.source, start.action, start.phone_number) == (
        ConsentSource.MESSAGE,
        ConsentAction.OPT_IN,
        number,
    )
    assert [(row.id, row.phone_number) for row in world.consents(first)] == first_consents
    thread = _thread_at(world, number)
    assert thread is not None
    assert thread.guardian_id == second.id


def test_a_guardian_created_at_a_reassigned_number_gets_their_own_start(world: World) -> None:
    first = world.guardian()
    number = first.phone_number
    world.say("START", from_number=number)
    world.move(first, world.fresh_number())
    first_consents = [row.id for row in world.consents(first)]
    created = world.api.post(
        "/api/clients", json={"name": "Second", "phone_number": number}, headers=world.auth()
    )
    assert created.status_code == 201
    second = world.db.get_one(Guardian, created.json()["id"])

    world.say("START", from_number=number)

    [start] = world.consents(second)
    assert (start.source, start.action, start.phone_number) == (
        ConsentSource.MESSAGE,
        ConsentAction.OPT_IN,
        number,
    )
    assert [row.id for row in world.consents(first)] == first_consents


def test_the_new_holder_of_a_reassigned_number_lifts_their_own_block_with_start(
    world: World,
) -> None:
    first = world.guardian()
    number = first.phone_number
    world.say("START", from_number=number)
    world.move(first, world.fresh_number())
    second = world.guardian()
    world.move(second, number)
    world.block(second)
    assert world.status(second)["blocked_by_whatsapp"] is True

    world.say("START", from_number=number)

    assert world.status(second)["blocked_by_whatsapp"] is False
    candidate = world.candidate(second)
    assert candidate is not None
    assert candidate.skip_reason is None


def test_a_stranger_writing_from_a_number_the_guardian_left_starts_intake(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    number = guardian.phone_number
    world.say("START", from_number=number)
    world.move(guardian, world.fresh_number())
    _parse_as_greeting(monkeypatch)

    world.say("Hello", from_number=number)

    thread = _thread_at(world, number)
    assert thread is not None
    assert thread.guardian_id is None
    state = load_state(world.db, phone_number=number)
    assert state is not None
    assert state.step == bot_service.STEP_INTAKE_NAME
    replies = [m["body"] for m in _messages(world, thread) if m["author_kind"] == "bot"]
    assert all("Ana" not in str(reply) for reply in replies)


# --- the 24-hour window ----------------------------------------------------------------------


def test_the_window_is_closed_after_a_move_until_the_guardian_writes_from_the_new_number(
    world: World,
) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    world.say("START", from_number=old_number)
    new_number = world.fresh_number()
    world.move(guardian, new_number)
    thread = _thread_at(world, new_number)
    assert thread is not None

    assert _detail(world, thread)["is_window_open"] is False
    refused = world.api.post(f"/api/conversations/{thread.id}/takeover", headers=world.auth())
    assert refused.status_code == 409

    world.say("START", from_number=new_number)

    assert _detail(world, thread)["is_window_open"] is True
    claimed = world.api.post(f"/api/conversations/{thread.id}/takeover", headers=world.auth())
    assert claimed.status_code == 200


def test_a_thread_opened_at_the_new_number_during_the_change_is_left_alone_without_a_500(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A first message from M that commits between the move's check and its write: the check
    is blinded once so `UNIQUE (phone_number)` is what answers, as it would in that race."""
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()
    world.say("START", from_number=old_number)
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=new_number)
    old_thread = _thread_at(world, old_number)
    assert old_thread is not None
    monkeypatch.setattr(conversation_service, "_conversation_for", lambda db, phone_number: None)

    world.move(guardian, new_number)

    assert guardian.phone_number == new_number
    assert _thread_at(world, old_number) == old_thread
    assert _notes(world, old_thread) == []


# --- a thread left behind at the old number --------------------------------------------------


def test_a_thread_the_move_skipped_does_not_hand_its_guardian_to_the_numbers_next_holder(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Guardian wrote from their new phone before Staff updated them, so the move is
    skipped and their old thread stays at N, still linked to them. N's next holder is
    recognised by the number, not by that link."""
    first = world.guardian()
    number = first.phone_number
    new_number = world.fresh_number()
    world.say("START", from_number=number)
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=new_number)
    world.move(first, new_number)
    first_consents = [row.id for row in world.consents(first)]
    created = world.api.post(
        "/api/clients", json={"name": "Second", "phone_number": number}, headers=world.auth()
    )
    assert created.status_code == 201
    second = world.db.get_one(Guardian, created.json()["id"])

    world.say("START", from_number=number)

    [start] = world.consents(second)
    assert (start.source, start.action, start.phone_number) == (
        ConsentSource.MESSAGE,
        ConsentAction.OPT_IN,
        number,
    )
    assert [row.id for row in world.consents(first)] == first_consents
    thread = _thread_at(world, number)
    assert thread is not None
    assert thread.guardian_id == second.id


# --- the acting Staff member -----------------------------------------------------------------


def test_a_number_change_by_a_deleted_staff_account_is_refused_and_changes_nothing(
    world: World,
) -> None:
    """A token can outlive its user row; the principal here names a user that is gone."""
    guardian = world.guardian()
    old_number = guardian.phone_number
    world.say("START", from_number=old_number)
    thread = _thread_at(world, old_number)
    assert thread is not None
    flow = FlowState(step=bot_service.STEP_BOOK_CHILD, prompt="Which child?")
    save_state(world.db, phone_number=old_number, state=flow)
    gone = CurrentUser(
        id=uuid.uuid4(), email="gone@example.com", role=UserRole.ADMIN, tutor_id=None
    )
    app.dependency_overrides[get_current_user] = lambda: gone
    try:
        response = world.api.patch(
            f"/api/clients/{guardian.id}", json={"phone_number": world.fresh_number()}
        )
    finally:
        del app.dependency_overrides[get_current_user]

    assert response.status_code == 401
    world.db.refresh(guardian)
    assert guardian.phone_number == old_number
    assert _thread_at(world, old_number) == thread
    assert _notes(world, thread) == []
    state = load_state(world.db, phone_number=old_number)
    assert state is not None
    assert state.step == bot_service.STEP_BOOK_CHILD
