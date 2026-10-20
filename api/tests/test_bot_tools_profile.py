"""`bot_tools_profile`: the agent's Intake, Subject, reminder and handoff tools.

Every case calls `ToolSpec.run` against the real test database; nothing is mocked.
"""

import datetime
import logging
import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    FlagReason,
    MessageAuthor,
    MessageStatus,
    SystemMessageKind,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.message import Message
from app.models.reminder_consent import ReminderConsent
from app.models.subject import Subject
from app.models.user import User
from app.services.bot_tool_contract import ToolContext, ToolResult
from app.services.bot_tools_profile import TOOLS

PHONE = "+12025550123"
NOW = datetime.datetime(2026, 10, 19, 15, 0, tzinfo=datetime.UTC)


@pytest.fixture
def conversation(db: Session) -> Conversation:
    thread = Conversation(phone_number=PHONE, last_message_at=NOW)
    db.add(thread)
    db.flush()

    return thread


@pytest.fixture
def ctx(db: Session, conversation: Conversation) -> ToolContext:
    return ToolContext(db=db, conversation=conversation, now=NOW)


def run(ctx: ToolContext, tool_name: str, /, **tool_input: Any) -> ToolResult:
    spec = next(tool for tool in TOOLS if tool.name == tool_name)

    return spec.run(ctx, tool_input)


def guardians_at(db: Session, phone_number: str) -> list[Guardian]:
    return list(db.scalars(select(Guardian).where(Guardian.phone_number == phone_number)).all())


# --- create_guardian -------------------------------------------------------------------------


def test_create_guardian_creates_and_links_the_guardian_on_a_new_number(
    db: Session, ctx: ToolContext, conversation: Conversation
) -> None:
    result = run(ctx, "create_guardian", name="Maria Lopez")

    [guardian] = guardians_at(db, PHONE)
    assert result.status == "ok"
    assert result.progress is True
    assert result.content["guardian_id"] == str(guardian.id)
    assert guardian.name == "Maria Lopez"
    assert conversation.guardian_id == guardian.id


def test_create_guardian_twice_keeps_one_guardian(db: Session, ctx: ToolContext) -> None:
    first = run(ctx, "create_guardian", name="Maria Lopez")
    second = run(ctx, "create_guardian", name="Maria Lopez")

    assert len(guardians_at(db, PHONE)) == 1
    assert second.status == "ok"
    assert second.content["guardian_id"] == first.content["guardian_id"]
    assert second.progress is False


def test_create_guardian_refuses_a_blank_name(db: Session, ctx: ToolContext) -> None:
    result = run(ctx, "create_guardian", name="   ")

    assert result.status == "refused"
    assert result.content["reason"] == "name_invalid"
    assert guardians_at(db, PHONE) == []


# --- create_home -----------------------------------------------------------------------------


def guardian_homes(db: Session, guardian_id: uuid.UUID) -> list[Home]:
    return list(
        db.scalars(
            select(Home)
            .join(GuardianHome, GuardianHome.home_id == Home.id)
            .where(GuardianHome.guardian_id == guardian_id)
            .order_by(Home.created_at, Home.address)
        ).all()
    )


@pytest.fixture
def guardian(ctx: ToolContext) -> Guardian:
    result = run(ctx, "create_guardian", name="Maria Lopez")

    return ctx.db.get_one(Guardian, uuid.UUID(str(result.content["guardian_id"])))


def test_create_home_needs_a_guardian(ctx: ToolContext) -> None:
    result = run(ctx, "create_home", address="12 Oak Street", directions=None, label=None)

    assert result.status == "refused"
    assert result.content["reason"] == "guardian_needed"


def test_create_home_labels_the_first_home_with_the_guardians_first_name(
    db: Session, ctx: ToolContext, guardian: Guardian
) -> None:
    result = run(ctx, "create_home", address="12 Oak Street", directions="Gate 1234", label=None)

    [home] = guardian_homes(db, guardian.id)
    assert result.status == "ok"
    assert result.progress is True
    assert result.content["home_id"] == str(home.id)
    assert (home.label, home.address, home.directions) == ("Maria's", "12 Oak Street", "Gate 1234")


def test_create_home_needs_a_label_for_a_second_home(
    db: Session, ctx: ToolContext, guardian: Guardian
) -> None:
    run(ctx, "create_home", address="12 Oak Street", directions=None, label=None)

    unlabelled = run(ctx, "create_home", address="9 Elm Road", directions=None, label=None)
    labelled = run(ctx, "create_home", address="9 Elm Road", directions=None, label="Dad's")

    assert unlabelled.status == "refused"
    assert unlabelled.content["reason"] == "label_needed"
    assert labelled.status == "ok"
    assert [home.label for home in guardian_homes(db, guardian.id)] == ["Maria's", "Dad's"]


def test_create_home_returns_the_existing_home_for_the_same_address(
    db: Session, ctx: ToolContext, guardian: Guardian
) -> None:
    first = run(ctx, "create_home", address="12 Oak Street", directions=None, label=None)
    again = run(ctx, "create_home", address=" 12  oak street ", directions=None, label=None)

    assert again.status == "ok"
    assert again.content["home_id"] == first.content["home_id"]
    assert again.progress is False
    assert len(guardian_homes(db, guardian.id)) == 1


def test_create_home_refuses_a_blank_address(ctx: ToolContext, guardian: Guardian) -> None:
    result = run(ctx, "create_home", address="  ", directions=None, label=None)

    assert result.status == "refused"
    assert result.content["reason"] == "address_needed"


# --- create_child ----------------------------------------------------------------------------


def guardian_children(db: Session, guardian_id: uuid.UUID) -> list[Child]:
    return list(
        db.scalars(
            select(Child)
            .join(ChildGuardian, ChildGuardian.child_id == Child.id)
            .where(ChildGuardian.guardian_id == guardian_id)
            .order_by(Child.name)
        ).all()
    )


@pytest.fixture
def home(ctx: ToolContext, guardian: Guardian) -> Home:
    result = run(ctx, "create_home", address="12 Oak Street", directions=None, label=None)

    return ctx.db.get_one(Home, uuid.UUID(str(result.content["home_id"])))


def create_ana(ctx: ToolContext, **overrides: Any) -> ToolResult:
    tool_input: dict[str, Any] = {
        "name": "Ana",
        "school": "Lincoln Elementary",
        "grade": 5,
        "notes": None,
        "date_of_birth": None,
        "home_id": None,
    }

    return run(ctx, "create_child", **{**tool_input, **overrides})


def test_create_child_needs_a_guardian(ctx: ToolContext) -> None:
    result = create_ana(ctx)

    assert result.status == "refused"
    assert result.content["reason"] == "guardian_needed"


def test_create_child_needs_a_home(ctx: ToolContext, guardian: Guardian) -> None:
    result = create_ana(ctx)

    assert result.status == "refused"
    assert result.content["reason"] == "home_needed"


def test_create_child_saves_the_required_fields(
    db: Session, ctx: ToolContext, guardian: Guardian, home: Home
) -> None:
    result = create_ana(ctx)

    [child] = guardian_children(db, guardian.id)
    assert result.status == "ok"
    assert result.progress is True
    assert result.content["child_id"] == str(child.id)
    assert (child.name, child.school_name, child.grade_level) == ("Ana", "Lincoln Elementary", 5)
    assert (child.notes, child.date_of_birth) == (None, None)


def test_create_child_saves_the_optional_fields_when_given(
    db: Session, ctx: ToolContext, guardian: Guardian, home: Home
) -> None:
    result = create_ana(
        ctx, notes="Allergic to peanuts", date_of_birth="2016-04-23", home_id=str(home.id)
    )

    [child] = guardian_children(db, guardian.id)
    assert result.status == "ok"
    assert child.notes == "Allergic to peanuts"
    assert child.date_of_birth == datetime.date(2016, 4, 23)


def test_create_child_returns_the_existing_child_with_the_same_name(
    db: Session, ctx: ToolContext, guardian: Guardian, home: Home
) -> None:
    first = create_ana(ctx)
    again = create_ana(ctx, name=" ana ")

    assert again.status == "ok"
    assert again.content["child_id"] == first.content["child_id"]
    assert again.progress is False
    assert len(guardian_children(db, guardian.id)) == 1


def test_create_child_refuses_the_name_of_an_archived_child(
    db: Session, ctx: ToolContext, guardian: Guardian, home: Home
) -> None:
    first = create_ana(ctx)
    archived = db.get_one(Child, uuid.UUID(str(first.content["child_id"])))
    archived.is_archived = True
    db.flush()

    result = create_ana(ctx)

    assert result.status == "refused"
    assert result.content == {"reason": "child_archived", "child_id": str(archived.id)}
    assert len(guardian_children(db, guardian.id)) == 1


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"grade": 13}, "grade_out_of_range"),
        ({"grade": -1}, "grade_out_of_range"),
        ({"date_of_birth": "23/04/2016"}, "date_of_birth_unreadable"),
        ({"date_of_birth": "2999-01-01"}, "date_of_birth_implausible"),
        ({"school": " "}, "school_invalid"),
        ({"name": ""}, "name_invalid"),
        ({"home_id": str(uuid.uuid4())}, "home_not_found"),
    ],
)
def test_create_child_refuses_invalid_details(
    db: Session,
    ctx: ToolContext,
    guardian: Guardian,
    home: Home,
    overrides: dict[str, Any],
    reason: str,
) -> None:
    result = create_ana(ctx, **overrides)

    assert result.status == "refused"
    assert result.content["reason"] == reason
    assert guardian_children(db, guardian.id) == []


# --- update_guardian, update_home, update_child ----------------------------------------------


@pytest.fixture
def ana(ctx: ToolContext, home: Home) -> Child:
    result = create_ana(ctx)

    return ctx.db.get_one(Child, uuid.UUID(str(result.content["child_id"])))


def test_update_guardian_renames_while_intake_is_in_progress(
    ctx: ToolContext, guardian: Guardian, home: Home
) -> None:
    result = run(ctx, "update_guardian", name="María López")

    assert result.status == "ok"
    assert result.progress is True
    assert guardian.name == "María López"


def test_update_guardian_is_refused_once_intake_is_finished(
    ctx: ToolContext, guardian: Guardian, ana: Child
) -> None:
    result = run(ctx, "update_guardian", name="María López")

    assert result.status == "refused"
    assert result.content["reason"] == "saved_details_go_to_office"
    assert guardian.name == "Maria Lopez"


def test_update_guardian_needs_a_guardian(ctx: ToolContext) -> None:
    result = run(ctx, "update_guardian", name="María López")

    assert result.content["reason"] == "guardian_needed"


def test_update_home_fills_empty_directions(ctx: ToolContext, home: Home) -> None:
    result = run(ctx, "update_home", home_id=str(home.id), directions="Gate 1234", label=None)

    assert result.status == "ok"
    assert result.progress is True
    assert home.directions == "Gate 1234"


def test_update_home_refuses_to_change_saved_directions(ctx: ToolContext, home: Home) -> None:
    run(ctx, "update_home", home_id=str(home.id), directions="Gate 1234", label=None)

    repeated = run(ctx, "update_home", home_id=str(home.id), directions="Gate 1234", label=None)
    changed = run(ctx, "update_home", home_id=str(home.id), directions="Gate 9999", label=None)
    relabelled = run(ctx, "update_home", home_id=str(home.id), directions=None, label="Mum's")

    assert (repeated.status, repeated.progress) == ("ok", False)
    assert changed.content["reason"] == "saved_details_go_to_office"
    assert relabelled.content["reason"] == "saved_details_go_to_office"
    assert (home.directions, home.label) == ("Gate 1234", "Maria's")


def test_update_home_refuses_a_home_that_is_not_the_guardians(
    db: Session, ctx: ToolContext, home: Home
) -> None:
    stranger = Home(address="1 Other Street")
    db.add(stranger)
    db.flush()

    result = run(ctx, "update_home", home_id=str(stranger.id), directions="Gate 1", label=None)

    assert result.content["reason"] == "home_not_found"
    assert stranger.directions is None


def test_update_child_fills_empty_notes_and_date_of_birth(ctx: ToolContext, ana: Child) -> None:
    result = run(
        ctx,
        "update_child",
        child_id=str(ana.id),
        notes="Loves maths",
        date_of_birth="2016-04-23",
    )

    assert result.status == "ok"
    assert result.progress is True
    assert (ana.notes, ana.date_of_birth) == ("Loves maths", datetime.date(2016, 4, 23))


def test_update_child_refuses_to_change_saved_values(ctx: ToolContext, ana: Child) -> None:
    run(ctx, "update_child", child_id=str(ana.id), notes="Loves maths", date_of_birth=None)

    changed = run(
        ctx, "update_child", child_id=str(ana.id), notes="Hates maths", date_of_birth=None
    )
    filled = run(
        ctx, "update_child", child_id=str(ana.id), notes="Hates maths", date_of_birth="2016-04-23"
    )

    assert changed.content["reason"] == "saved_details_go_to_office"
    # Nothing lands when one field of the call is refused.
    assert filled.content["reason"] == "saved_details_go_to_office"
    assert (ana.notes, ana.date_of_birth) == ("Loves maths", None)


def test_update_child_refuses_a_child_that_is_not_the_guardians(
    db: Session, ctx: ToolContext, ana: Child
) -> None:
    stranger = Child(name="Leo", school_name="Elsewhere", grade_level=3)
    db.add(stranger)
    db.flush()

    result = run(ctx, "update_child", child_id=str(stranger.id), notes="x", date_of_birth=None)

    assert result.content["reason"] == "child_not_found"
    assert stranger.notes is None


# --- redaction marking -----------------------------------------------------------------------

EARLIER = datetime.datetime(2026, 1, 1, 12, 0, tzinfo=datetime.UTC)


def add_message(
    db: Session,
    conversation: Conversation,
    author_kind: MessageAuthor,
    *,
    minutes: int,
    body: str = "hello",
) -> Message:
    is_admin = author_kind is MessageAuthor.ADMIN
    message = Message(
        conversation_id=conversation.id,
        author_kind=author_kind,
        author_user_id=staff_id(db) if is_admin else None,
        body=body,
        status=MessageStatus.SENT,
        system_kind=SystemMessageKind.HANDOFF_NOTE if author_kind is MessageAuthor.SYSTEM else None,
        created_at=EARLIER + datetime.timedelta(minutes=minutes),
    )
    db.add(message)
    db.flush()

    return message


def staff_id(db: Session) -> uuid.UUID:
    user = User(
        email=f"staff-{uuid.uuid4().hex[:8]}@example.com",
        name="Staff",
        role=UserRole.ADMIN,
        hashed_password="x",
    )
    db.add(user)
    db.flush()

    return user.id


def test_a_new_home_marks_the_guardian_and_bot_messages_in_the_history_window(
    db: Session, ctx: ToolContext, conversation: Conversation, guardian: Guardian
) -> None:
    # 21 Guardian and bot messages: the oldest is outside the 20-message window.
    chat = [
        add_message(db, conversation, author, minutes=index)
        for index, author in enumerate(
            [MessageAuthor.CLIENT, MessageAuthor.BOT] * 10 + [MessageAuthor.CLIENT]
        )
    ]
    office = add_message(db, conversation, MessageAuthor.ADMIN, minutes=30)
    note = add_message(db, conversation, MessageAuthor.SYSTEM, minutes=31)

    run(ctx, "create_home", address="12 Oak Street", directions="Gate 1234", label=None)

    assert chat[0].redacted_fields is None
    assert all(
        message.redacted_fields == ["home_address", "home_directions"] for message in chat[1:]
    )
    assert office.redacted_fields is None
    assert note.redacted_fields is None
    assert all(message.body == "hello" for message in chat)


def test_filling_directions_marks_the_messages_since_the_homes_last_save(
    db: Session, ctx: ToolContext, conversation: Conversation, home: Home
) -> None:
    home.updated_at = EARLIER + datetime.timedelta(minutes=10)
    db.flush()
    before = add_message(db, conversation, MessageAuthor.CLIENT, minutes=5)
    asked = add_message(db, conversation, MessageAuthor.BOT, minutes=11)
    answered = add_message(db, conversation, MessageAuthor.CLIENT, minutes=12)

    run(ctx, "update_home", home_id=str(home.id), directions="Gate 1234", label=None)

    # `before` is in the window, so it already carries the address from the Home's creation.
    assert before.redacted_fields is None
    assert asked.redacted_fields == ["home_directions"]
    assert answered.redacted_fields == ["home_directions"]


def test_a_new_child_marks_only_the_fields_it_saved(
    db: Session, ctx: ToolContext, conversation: Conversation, home: Home
) -> None:
    message = add_message(db, conversation, MessageAuthor.CLIENT, minutes=1)

    create_ana(ctx, notes="Allergic to peanuts", date_of_birth="2016-04-23")
    create_ana(ctx, name="Leo")

    assert message.redacted_fields == ["child_date_of_birth", "child_notes"]


def test_filling_notes_marks_the_messages_since_the_childs_last_save(
    db: Session, ctx: ToolContext, conversation: Conversation, ana: Child
) -> None:
    ana.updated_at = EARLIER + datetime.timedelta(minutes=10)
    db.flush()
    before = add_message(db, conversation, MessageAuthor.CLIENT, minutes=5)
    after = add_message(db, conversation, MessageAuthor.CLIENT, minutes=12)

    run(ctx, "update_child", child_id=str(ana.id), notes="Loves maths", date_of_birth=None)

    assert before.redacted_fields is None
    assert after.redacted_fields == ["child_notes"]


def test_a_refused_save_marks_nothing(
    db: Session, ctx: ToolContext, conversation: Conversation, home: Home
) -> None:
    message = add_message(db, conversation, MessageAuthor.CLIENT, minutes=1)

    create_ana(ctx, notes="Allergic to peanuts", grade=13)

    assert message.redacted_fields is None


# --- list_subjects ---------------------------------------------------------------------------


def test_list_subjects_lists_active_subjects_in_both_languages(
    db: Session, ctx: ToolContext
) -> None:
    suffix = uuid.uuid4().hex[:8]
    maths = Subject(name=f"Maths {suffix}", name_es=f"Matemáticas {suffix}")
    reading = Subject(name=f"Reading {suffix}")
    retired = Subject(name=f"Latin {suffix}", is_archived=True)
    db.add_all([maths, reading, retired])
    db.flush()

    result = run(ctx, "list_subjects")

    listed = {subject["subject_id"]: subject for subject in result.content["subjects"]}
    assert result.status == "ok"
    assert result.progress is False
    assert listed[str(maths.id)] == {
        "subject_id": str(maths.id),
        "name_en": f"Maths {suffix}",
        "name_es": f"Matemáticas {suffix}",
    }
    assert listed[str(reading.id)]["name_es"] == f"Reading {suffix}"
    assert str(retired.id) not in listed


# --- set_reminder_preference -----------------------------------------------------------------


def consents(db: Session, guardian_id: uuid.UUID) -> list[ReminderConsent]:
    return list(
        db.scalars(
            select(ReminderConsent)
            .where(ReminderConsent.guardian_id == guardian_id)
            .order_by(ReminderConsent.created_at, ReminderConsent.id)
        ).all()
    )


def test_set_reminder_preference_needs_a_guardian(ctx: ToolContext) -> None:
    result = run(ctx, "set_reminder_preference", opt_in=True)

    assert result.content["reason"] == "guardian_needed"


@pytest.mark.parametrize(
    ("opt_in", "action"), [(True, ConsentAction.OPT_IN), (False, ConsentAction.OPT_OUT)]
)
def test_set_reminder_preference_records_the_latest_inbound_message_as_evidence(
    db: Session,
    ctx: ToolContext,
    conversation: Conversation,
    guardian: Guardian,
    opt_in: bool,
    action: ConsentAction,
) -> None:
    add_message(db, conversation, MessageAuthor.CLIENT, minutes=1)
    add_message(db, conversation, MessageAuthor.BOT, minutes=2)
    latest = add_message(db, conversation, MessageAuthor.CLIENT, minutes=3, body="yes please")
    add_message(db, conversation, MessageAuthor.BOT, minutes=4)

    result = run(ctx, "set_reminder_preference", opt_in=opt_in)
    run(ctx, "set_reminder_preference", opt_in=opt_in)

    [consent] = consents(db, guardian.id)
    assert result.status == "ok"
    assert result.progress is True
    assert consent.action is action
    assert consent.source is ConsentSource.MESSAGE
    assert consent.message_id == latest.id
    assert consent.phone_number == PHONE


# --- hand_off_to_office ----------------------------------------------------------------------


def handoff_notes(db: Session, conversation: Conversation) -> list[Message]:
    return list(
        db.scalars(
            select(Message).where(
                Message.conversation_id == conversation.id,
                Message.system_kind == SystemMessageKind.HANDOFF_NOTE,
            )
        ).all()
    )


def hand_off(
    ctx: ToolContext, reason: str, summary: str, child_id: str | None = None
) -> ToolResult:
    return run(ctx, "hand_off_to_office", reason=reason, summary=summary, child_id=child_id)


@pytest.mark.parametrize("reason", ["question", "booking_request", "guardian_link_request"])
def test_hand_off_flags_the_chat_and_writes_a_staff_only_note(
    db: Session, ctx: ToolContext, conversation: Conversation, reason: str
) -> None:
    result = hand_off(ctx, reason, "Asks whether we tutor chemistry")
    hand_off(ctx, reason, "Asks whether we tutor chemistry")

    [note] = handoff_notes(db, conversation)
    assert result.status == "ok"
    assert result.progress is True
    assert conversation.flag_reason == FlagReason(reason)
    assert note.body == "Asks whether we tutor chemistry"
    assert note.author_kind is MessageAuthor.SYSTEM


def test_hand_off_latest_reason_wins(ctx: ToolContext, conversation: Conversation) -> None:
    hand_off(ctx, "booking_request", "First session for Ana")
    hand_off(ctx, "didnt_understand", "Going in circles about times")

    assert conversation.flag_reason is FlagReason.DIDNT_UNDERSTAND


def test_hand_off_refuses_a_blank_summary(ctx: ToolContext, conversation: Conversation) -> None:
    result = hand_off(ctx, "question", "  ")

    assert result.content["reason"] == "summary_needed"
    assert conversation.flag_reason is None


def test_hand_off_requests_reactivation_of_an_archived_child(
    db: Session, ctx: ToolContext, conversation: Conversation, ana: Child
) -> None:
    ana.is_archived = True
    db.flush()

    result = hand_off(ctx, "reactivation_request", "Wants Ana back", child_id=str(ana.id))

    [note] = handoff_notes(db, conversation)
    assert result.status == "ok"
    assert conversation.reactivation_child_id == ana.id
    assert conversation.flag_reason is FlagReason.REACTIVATION_REQUEST
    assert note.body == "Wants Ana back"


def test_hand_off_refuses_reactivation_while_one_is_pending(
    db: Session, ctx: ToolContext, conversation: Conversation, ana: Child
) -> None:
    leo = create_ana(ctx, name="Leo")
    leo_child = db.get_one(Child, uuid.UUID(str(leo.content["child_id"])))
    ana.is_archived = True
    leo_child.is_archived = True
    db.flush()
    hand_off(ctx, "reactivation_request", "Wants Ana back", child_id=str(ana.id))

    result = hand_off(ctx, "reactivation_request", "Wants Leo back", child_id=str(leo_child.id))

    assert result.content["reason"] == "reactivation_already_pending"
    assert conversation.reactivation_child_id == ana.id
    assert len(handoff_notes(db, conversation)) == 1


@pytest.mark.parametrize("is_archived", [False, True])
def test_hand_off_refuses_reactivation_without_an_archived_child_of_the_guardian(
    db: Session, ctx: ToolContext, conversation: Conversation, ana: Child, is_archived: bool
) -> None:
    stranger = Child(name="Leo", school_name="Elsewhere", grade_level=3, is_archived=True)
    db.add(stranger)
    db.flush()
    child_id = str(stranger.id) if is_archived else str(ana.id)

    missing = hand_off(ctx, "reactivation_request", "Wants a child back", child_id=None)
    wrong = hand_off(ctx, "reactivation_request", "Wants a child back", child_id=child_id)

    assert missing.content["reason"] == "child_needed"
    assert wrong.content["reason"] == "archived_child_not_found"
    assert conversation.reactivation_child_id is None
    assert handoff_notes(db, conversation) == []


# --- schemas ---------------------------------------------------------------------------------


def test_every_tool_has_a_strict_input_schema() -> None:
    names = [tool.name for tool in TOOLS]

    assert names == [
        "create_guardian",
        "update_guardian",
        "create_home",
        "update_home",
        "create_child",
        "update_child",
        "list_subjects",
        "set_reminder_preference",
        "hand_off_to_office",
    ]
    for tool in TOOLS:
        schema = tool.input_schema
        assert schema["type"] == "object", tool.name
        assert schema["additionalProperties"] is False, tool.name
        assert sorted(schema["required"]) == sorted(schema["properties"]), tool.name


# --- logging ---------------------------------------------------------------------------------


def test_each_call_and_result_is_logged_with_the_conversation_id_and_no_redacted_values(
    ctx: ToolContext,
    conversation: Conversation,
    guardian: Guardian,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.services.bot_tools_profile")

    run(ctx, "create_home", address="12 Oak Street", directions=None, label=None)

    records = [record for record in caplog.records if record.__dict__.get("tool") == "create_home"]
    assert [record.getMessage() for record in records] == [
        "bot tool create_home called",
        "bot tool create_home ok",
    ]
    assert all(record.__dict__["conversation_id"] == str(conversation.id) for record in records)
    assert records[0].__dict__["input"]["address"] == "[set]"
    assert "12 Oak Street" not in caplog.text


# --- round 2: deactivated Guardian, handoff retries, summary cap -----------------------------


DEACTIVATED_CALLS: list[tuple[str, dict[str, Any]]] = [
    ("create_guardian", {"name": "Maria Lopez"}),
    ("update_guardian", {"name": "María López"}),
    ("create_home", {"address": "9 Elm Road", "directions": None, "label": "Dad's"}),
    ("update_home", {"directions": "Gate 1234", "label": None}),
    (
        "create_child",
        {
            "name": "Leo",
            "school": "Lincoln Elementary",
            "grade": 3,
            "notes": None,
            "date_of_birth": None,
            "home_id": None,
        },
    ),
    ("update_child", {"notes": "Loves maths", "date_of_birth": None}),
    ("set_reminder_preference", {"opt_in": True}),
]


@pytest.mark.parametrize(("tool_name", "tool_input"), DEACTIVATED_CALLS)
def test_a_deactivated_guardian_is_refused(
    db: Session,
    ctx: ToolContext,
    conversation: Conversation,
    guardian: Guardian,
    home: Home,
    tool_name: str,
    tool_input: dict[str, Any],
) -> None:
    child = create_ana(ctx)
    add_message(db, conversation, MessageAuthor.CLIENT, minutes=1)
    guardian.is_archived = True
    db.flush()
    ids = {
        "update_home": {"home_id": str(home.id)},
        "update_child": {"child_id": child.content["child_id"]},
    }

    result = run(ctx, tool_name, **tool_input, **ids.get(tool_name, {}))

    assert result.status == "refused"
    assert result.content["reason"] == "guardian_deactivated"
    assert guardian.name == "Maria Lopez"
    assert len(guardian_homes(db, guardian.id)) == 1
    assert len(guardian_children(db, guardian.id)) == 1
    assert home.directions is None
    assert consents(db, guardian.id) == []


def test_a_deactivated_guardian_can_still_hand_off(
    db: Session, ctx: ToolContext, conversation: Conversation, guardian: Guardian
) -> None:
    guardian.is_archived = True
    db.flush()

    result = hand_off(ctx, "question", "Wants to come back")

    assert result.status == "ok"
    assert conversation.flag_reason is FlagReason.QUESTION


def test_hand_off_retried_while_the_flag_stands_writes_nothing_again(
    db: Session, ctx: ToolContext, conversation: Conversation
) -> None:
    first = hand_off(ctx, "didnt_understand", "Going in circles")
    flagged_at = conversation.flagged_at

    again = hand_off(ctx, "didnt_understand", "Going in circles")

    assert (first.progress, again.status, again.progress) == (True, "ok", False)
    assert conversation.flagged_at == flagged_at
    assert len(handoff_notes(db, conversation)) == 1


def test_hand_off_after_staff_handled_the_flag_is_a_new_handoff(
    db: Session, ctx: ToolContext, conversation: Conversation
) -> None:
    hand_off(ctx, "didnt_understand", "Going in circles")
    conversation.flag_reason = None
    conversation.flagged_at = None
    db.flush()

    again = hand_off(ctx, "didnt_understand", "Going in circles")

    assert (again.status, again.progress) == ("ok", True)
    assert conversation.flag_reason is FlagReason.DIDNT_UNDERSTAND
    assert len(handoff_notes(db, conversation)) == 2


def test_hand_off_reactivation_retried_for_the_pending_child_writes_nothing_again(
    db: Session, ctx: ToolContext, conversation: Conversation, ana: Child
) -> None:
    ana.is_archived = True
    db.flush()
    hand_off(ctx, "reactivation_request", "Wants Ana back", child_id=str(ana.id))

    again = hand_off(ctx, "reactivation_request", "Wants Ana back", child_id=str(ana.id))

    assert (again.status, again.progress) == ("ok", False)
    assert len(handoff_notes(db, conversation)) == 1


def test_hand_off_reactivation_after_a_denial_is_a_new_request(
    db: Session, ctx: ToolContext, conversation: Conversation, ana: Child
) -> None:
    ana.is_archived = True
    db.flush()
    hand_off(ctx, "reactivation_request", "Wants Ana back", child_id=str(ana.id))
    # Staff denied it: the request and its flag are cleared.
    conversation.reactivation_child_id = None
    conversation.flag_reason = None
    conversation.flagged_at = None
    db.flush()

    again = hand_off(ctx, "reactivation_request", "Wants Ana back", child_id=str(ana.id))

    assert (again.status, again.progress) == ("ok", True)
    assert conversation.reactivation_child_id == ana.id
    assert len(handoff_notes(db, conversation)) == 2


def test_hand_off_refuses_a_summary_over_the_cap(
    ctx: ToolContext, conversation: Conversation
) -> None:
    result = hand_off(ctx, "question", "x" * 2001)

    assert result.content == {"reason": "summary_too_long", "max_length": 2000}
    assert conversation.flag_reason is None


def test_names_and_schools_stay_out_of_the_log(
    ctx: ToolContext, home: Home, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="app.services.bot_tools_profile")

    create_ana(ctx)

    [called, finished] = [
        record for record in caplog.records if record.__dict__.get("tool") == "create_child"
    ]
    assert called.__dict__["input"]["name"] == "[set]"
    assert called.__dict__["input"]["school"] == "[set]"
    assert finished.__dict__["result"]["name"] == "[set]"
    assert finished.__dict__["result"]["grade"] == "[set]"
    assert finished.__dict__["result"]["child_id"] is not None
