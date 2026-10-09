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
from app.models.user import User
from app.schemas.bot import BotIntent, ParsedIntent
from app.services import bot_service, conversation_service, parser_service
from app.services.bot_state import FlowState, load_state, save_state
from app.services.reminder_service import run_week
from tests.fake_twilio import FakeTwilio
from tests.test_whatsapp_block_follows_number import EN_SID, NOW, World

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


def _renumber_before_threads_followed(world: World, guardian: Guardian, number: str) -> None:
    """Change the number as it was changed before #126, leaving the Guardian's thread behind."""
    world.db.execute(update(Guardian).where(Guardian.id == guardian.id).values(phone_number=number))
    world.db.flush()
    world.db.refresh(guardian)


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


# --- a thread already at the new number ------------------------------------------------------


def test_a_thread_at_the_new_number_is_merged_into_the_guardians_thread(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()
    world.say("START", from_number=old_number)
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=new_number)
    world.say("START", from_number=old_number)
    old_thread = _thread_at(world, old_number)
    new_thread = _thread_at(world, new_number)
    assert old_thread is not None and new_thread is not None
    expected_ids = {m["id"] for m in _messages(world, old_thread)} | {
        m["id"] for m in _messages(world, new_thread)
    }
    gone_id = new_thread.id
    for number in (old_number, new_number):
        save_state(
            world.db,
            phone_number=number,
            state=FlowState(step=bot_service.STEP_BOOK_CHILD, prompt="Which child?"),
        )

    world.move(guardian, new_number)

    assert _thread_at(world, old_number) is None
    merged = _thread_at(world, new_number)
    assert merged is not None
    assert merged.id == old_thread.id
    messages = _messages(world, merged)
    [note] = _notes(world, merged)
    assert {m["id"] for m in messages} == expected_ids | {note["id"]}
    newest_first = [datetime.datetime.fromisoformat(str(m["created_at"])) for m in messages]
    assert newest_first == sorted(newest_first, reverse=True)
    assert messages[0]["id"] == note["id"]
    gone = world.api.get(f"/api/conversations/{gone_id}", headers=world.auth())
    assert gone.status_code == 404
    assert load_state(world.db, phone_number=old_number) is None
    assert load_state(world.db, phone_number=new_number) is None


def test_the_merged_thread_keeps_only_the_guardians_thread_state(
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
    read_at = datetime.datetime(2026, 10, 1, 9, 0, tzinfo=datetime.UTC)
    old_thread.status = ConversationStatus.HUMAN
    old_thread.taken_over_by_user_id = world.staff().id
    old_thread.taken_over_at = read_at
    old_thread.flag_reason = FlagReason.STUCK
    old_thread.flagged_at = read_at
    old_thread.reactivation_child_id = world.db.scalars(
        select(ChildGuardian.child_id).where(ChildGuardian.guardian_id == guardian.id)
    ).one()
    old_thread.language = Language.ES
    old_thread.last_read_at = read_at
    other_staff = User(
        email=f"other-{uuid.uuid4().hex[:12]}@example.com",
        name="Other Staff",
        hashed_password="not-a-hash",
        role=UserRole.ADMIN,
    )
    world.db.add(other_staff)
    world.db.flush()
    new_thread.status = ConversationStatus.HUMAN
    new_thread.taken_over_by_user_id = other_staff.id
    new_thread.taken_over_at = read_at
    new_thread.flag_reason = FlagReason.PARSE_ERROR
    new_thread.flagged_at = read_at
    new_thread.language = Language.EN
    new_thread.last_read_at = None
    world.db.flush()

    world.move(guardian, new_number)

    merged = _thread_at(world, new_number)
    assert merged is not None
    detail = _detail(world, merged)
    assert detail["id"] == str(old_thread.id)
    assert detail["status"] == "human"
    assert detail["taken_over_by"]["id"] == str(world.staff().id)  # type: ignore[index]
    assert detail["flag_reason"] == "stuck"
    assert detail["language"] == "es"
    assert detail["reactivation_request"] is not None
    assert datetime.datetime.fromisoformat(str(detail["last_read_at"])) == read_at
    assert detail["guardian"]["id"] == str(guardian.id)  # type: ignore[index]


def test_a_thread_at_the_new_number_already_linked_to_the_guardian_is_merged_too(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Data from before threads followed their Guardian: a thread at M linked to them."""
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()
    world.say("START", from_number=old_number)
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=new_number)
    old_thread = _thread_at(world, old_number)
    new_thread = _thread_at(world, new_number)
    assert old_thread is not None and new_thread is not None
    new_thread.guardian_id = guardian.id
    world.db.flush()
    expected_ids = {m["id"] for m in _messages(world, old_thread)} | {
        m["id"] for m in _messages(world, new_thread)
    }
    gone_id = new_thread.id

    world.move(guardian, new_number)

    assert _thread_at(world, old_number) is None
    merged = _thread_at(world, new_number)
    assert merged is not None
    assert merged.id == old_thread.id
    [note] = _notes(world, merged)
    assert {m["id"] for m in _messages(world, merged)} == expected_ids | {note["id"]}
    gone = world.api.get(f"/api/conversations/{gone_id}", headers=world.auth())
    assert gone.status_code == 404


def test_with_no_thread_at_the_old_number_the_thread_at_the_new_number_becomes_theirs(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=new_number)
    new_thread = _thread_at(world, new_number)
    assert new_thread is not None
    assert new_thread.guardian_id is None

    world.move(guardian, new_number)

    thread = _thread_at(world, new_number)
    assert thread is not None
    assert thread.id == new_thread.id
    assert _detail(world, thread)["guardian"]["id"] == str(guardian.id)  # type: ignore[index]
    [note] = _notes(world, thread)
    assert note["body"] == f"Number changed from {old_number} to {new_number} by {STAFF_NAME}"


def test_a_number_whose_thread_belongs_to_another_guardian_is_refused_and_changes_nothing(
    world: World,
) -> None:
    """Only data from before threads followed their Guardian can leave M's thread linked to
    another Guardian who no longer holds M."""
    guardian = world.guardian()
    old_number = guardian.phone_number
    world.say("START", from_number=old_number)
    other = world.guardian()
    taken_number = other.phone_number
    world.say("START", from_number=taken_number)
    _renumber_before_threads_followed(world, other, world.fresh_number())
    old_thread = _thread_at(world, old_number)
    taken_thread = _thread_at(world, taken_number)
    assert old_thread is not None and taken_thread is not None
    old_ids = [m["id"] for m in _messages(world, old_thread)]
    taken_ids = [m["id"] for m in _messages(world, taken_thread)]

    response = world.api.patch(
        f"/api/clients/{guardian.id}",
        json={"phone_number": taken_number},
        headers=world.auth(),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "That number's WhatsApp chat belongs to another Guardian"
    world.db.expire_all()
    assert world.db.get_one(Guardian, guardian.id).phone_number == old_number
    assert _thread_at(world, old_number) == old_thread
    assert _thread_at(world, taken_number) == taken_thread
    assert old_thread.guardian_id == guardian.id
    assert taken_thread.guardian_id == other.id
    assert [m["id"] for m in _messages(world, old_thread)] == old_ids
    assert [m["id"] for m in _messages(world, taken_thread)] == taken_ids


def test_a_guardian_merged_at_the_new_number_has_their_start_there_recorded_for_them(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    old_number = guardian.phone_number
    new_number = world.fresh_number()
    world.say("START", from_number=old_number)
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=new_number)
    old_thread = _thread_at(world, old_number)
    assert old_thread is not None
    world.move(guardian, new_number)

    world.say("START", from_number=new_number)

    start = world.consents(guardian)[-1]
    assert (start.source, start.action, start.phone_number) == (
        ConsentSource.MESSAGE,
        ConsentAction.OPT_IN,
        new_number,
    )
    assert start.message_id is not None
    assert world.db.get_one(Message, start.message_id).conversation_id == old_thread.id


# --- a Guardian created at a number with a thread ---------------------------------------------


def test_a_guardian_created_at_a_number_with_an_unlinked_thread_gets_that_thread(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    number = world.fresh_number()
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=number)
    thread = _thread_at(world, number)
    assert thread is not None

    created = world.api.post(
        "/api/clients", json={"name": "New", "phone_number": number}, headers=world.auth()
    )

    assert created.status_code == 201
    assert _detail(world, thread)["guardian"]["id"] == created.json()["id"]  # type: ignore[index]
    assert _notes(world, thread) == []


def test_a_guardian_created_at_a_number_whose_thread_is_another_guardians_leaves_it(
    world: World,
) -> None:
    first = world.guardian()
    number = first.phone_number
    world.say("START", from_number=number)
    _renumber_before_threads_followed(world, first, world.fresh_number())

    created = world.api.post(
        "/api/clients", json={"name": "New", "phone_number": number}, headers=world.auth()
    )

    assert created.status_code == 201
    thread = _thread_at(world, number)
    assert thread is not None
    assert _detail(world, thread)["guardian"]["id"] == str(first.id)  # type: ignore[index]


def test_a_new_guardian_added_on_a_child_at_a_number_with_an_unlinked_thread_gets_it(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    child_id = world.db.scalars(
        select(ChildGuardian.child_id).where(ChildGuardian.guardian_id == guardian.id)
    ).one()
    number = world.fresh_number()
    _parse_as_greeting(monkeypatch)
    world.say("Hello", from_number=number)
    thread = _thread_at(world, number)
    assert thread is not None

    linked = world.api.post(
        f"/api/children/{child_id}/guardians",
        json={"guardian": {"name": "Second", "phone_number": number}},
        headers=world.auth(),
    )

    assert linked.status_code == 201
    second = world.db.scalars(select(Guardian).where(Guardian.phone_number == number)).one()
    assert _detail(world, thread)["guardian"]["id"] == str(second.id)  # type: ignore[index]
    assert _notes(world, thread) == []


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
    find_thread = conversation_service._conversation_for

    def blind_to_new_number(db: Session, *, phone_number: str) -> Conversation | None:
        if phone_number == new_number:
            return None

        return find_thread(db, phone_number=phone_number)

    monkeypatch.setattr(conversation_service, "_conversation_for", blind_to_new_number)

    world.move(guardian, new_number)

    assert guardian.phone_number == new_number
    assert _thread_at(world, old_number) == old_thread
    assert _notes(world, old_thread) == []


# --- a thread left behind at the old number --------------------------------------------------


def test_a_thread_left_behind_does_not_hand_its_guardian_to_the_numbers_next_holder(
    world: World,
) -> None:
    """The Guardian's number changed before threads followed them, so their old thread stays
    at N, still linked to them. N's next holder is recognised by the number, not by that
    link."""
    first = world.guardian()
    number = first.phone_number
    world.say("START", from_number=number)
    _renumber_before_threads_followed(world, first, world.fresh_number())
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


def test_a_stop_under_takeover_in_a_thread_left_behind_is_recorded_for_the_numbers_holder(
    world: World,
) -> None:
    first = world.guardian()
    number = first.phone_number
    world.say("START", from_number=number)
    thread = _thread_at(world, number)
    assert thread is not None
    thread.status = ConversationStatus.HUMAN
    thread.taken_over_by_user_id = world.staff().id
    thread.taken_over_at = datetime.datetime.now(tz=datetime.UTC)
    world.db.flush()
    _renumber_before_threads_followed(world, first, world.fresh_number())
    first_consents = [row.id for row in world.consents(first)]
    second = world.guardian()
    _renumber_before_threads_followed(world, second, number)

    world.say("STOP", from_number=number)

    stop = world.consents(second)[-1]
    assert (stop.source, stop.action, stop.phone_number) == (
        ConsentSource.MESSAGE,
        ConsentAction.OPT_OUT,
        number,
    )
    assert [row.id for row in world.consents(first)] == first_consents
    detail = _detail(world, thread)
    assert detail["status"] == "human"
    assert detail["guardian"]["id"] == str(second.id)  # type: ignore[index]


def test_a_reminder_into_a_thread_left_behind_goes_to_the_numbers_holder(
    world: World,
) -> None:
    first = world.guardian()
    number = first.phone_number
    world.say("START", from_number=number)
    thread = _thread_at(world, number)
    assert thread is not None
    _renumber_before_threads_followed(world, first, world.fresh_number())
    second = world.guardian()
    _renumber_before_threads_followed(world, second, number)

    run_week(world.db, now=NOW)

    assert [s for s in world.fake.sent if s.to == number]
    assert _detail(world, thread)["guardian"]["id"] == str(second.id)  # type: ignore[index]


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
