"""The bot's booking tools: `list_slots`, `propose` and `commit_proposal` (spec §2, §3).

Every case runs through `ToolSpec.run` against the real test database; nothing is mocked. The
turn's instant is passed in `ToolContext.now`, so no clock is frozen. Scheduling columns are
business wall-clock (New York in the harness), so `_at` turns a wall-clock time into the aware
UTC instant a turn carries.
"""

import datetime
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.child_assigned_tutor import ChildAssignedTutor
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import (
    AvailabilityMode,
    BookingKind,
    BookingLocation,
    BookingStatus,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.message import Message
from app.models.subject import Subject
from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.services import bot_tools_booking
from app.services.bot_tool_contract import CommittedAction, ToolContext, ToolResult, ToolSpec

BUSINESS_ZONE = ZoneInfo("America/New_York")
# A Monday two weeks after `NOW`; every Availability range below is on its weekday.
DATE = datetime.date(2026, 11, 2)
NOW_WALL = datetime.datetime(2026, 10, 19, 12, 0)
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
TEN_THIRTY = datetime.time(10, 30)
ELEVEN_THIRTY = datetime.time(11, 30)
TWELVE = datetime.time(12, 0)
CUTOFF_HOURS = 24
CUTOFF_SETTING = "cancellation_cutoff_hours"


def _at(wall: datetime.datetime) -> datetime.datetime:
    """The aware UTC instant a business wall-clock time is."""
    return wall.replace(tzinfo=BUSINESS_ZONE).astimezone(datetime.UTC)


NOW = _at(NOW_WALL)


@dataclass(frozen=True, slots=True)
class World:
    conversation: Conversation
    guardian_id: uuid.UUID
    child_id: uuid.UUID
    sibling_id: uuid.UUID
    subject_id: uuid.UUID
    home_id: uuid.UUID
    assigned_tutor_id: uuid.UUID
    assigned_user_id: uuid.UUID
    other_tutor_id: uuid.UUID
    other_user_id: uuid.UUID


@pytest.fixture
def world(db: Session) -> World:
    """One Guardian with two Evaluated Children at one Home, on a bot conversation. One Tutor is
    both Children's Assigned Tutor and one isn't; both teach the Subject, with a 9-12 range on
    Mondays that allows either Location. Sessions are 60 minutes with a 30-minute gap, so the
    grid is 9:00-10:00 and 10:30-11:30."""
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(phone_number=f"+1{suffix[:10]}", name=f"Guardian {suffix}")
    subject = Subject(name=f"Subject {suffix}")
    home = Home(address="1 Test Street", directions="0000")
    db.add_all([guardian, subject, home])
    db.flush()
    db.add(GuardianHome(guardian_id=guardian.id, home_id=home.id))
    conversation = Conversation(phone_number=guardian.phone_number, guardian_id=guardian.id)
    db.add(conversation)

    assigned = _make_tutor(db, subject_id=subject.id)
    other = _make_tutor(db, subject_id=subject.id)
    child = _make_child(db, guardian_id=guardian.id, name=f"Ana {suffix}")
    sibling = _make_child(db, guardian_id=guardian.id, name=f"Leo {suffix}")
    for child_id in (child.id, sibling.id):
        _evaluate(db, child_id, subject_id=subject.id, evaluator_id=other.user_id)
        db.add(ChildAssignedTutor(child_id=child_id, user_id=assigned.user_id))
    _add_range(db, assigned.id)
    _add_range(db, other.id)
    _set_cutoff(db, CUTOFF_HOURS)
    db.flush()

    return World(
        conversation=conversation,
        guardian_id=guardian.id,
        child_id=child.id,
        sibling_id=sibling.id,
        subject_id=subject.id,
        home_id=home.id,
        assigned_tutor_id=assigned.id,
        assigned_user_id=assigned.user_id,
        other_tutor_id=other.id,
        other_user_id=other.user_id,
    )


# --- schemas ------------------------------------------------------------------------------------


def test_the_module_exports_the_three_booking_tools() -> None:
    names = [tool.name for tool in bot_tools_booking.TOOLS]

    assert names == ["list_slots", "propose", "commit_proposal"]


@pytest.mark.parametrize("tool", bot_tools_booking.TOOLS, ids=lambda tool: tool.name)
def test_every_input_schema_is_strict(tool: ToolSpec) -> None:
    """Every object, nested ones included, forbids extra properties and requires them all."""
    objects = list(_objects_in(tool.input_schema))

    assert objects
    for schema in objects:
        assert schema["additionalProperties"] is False
        assert sorted(schema["required"]) == sorted(schema["properties"])


# --- list_slots ---------------------------------------------------------------------------------


def test_list_slots_offers_only_the_assigned_tutors_free_slots(db: Session, world: World) -> None:
    _book(db, world, child_id=world.sibling_id, start=NINE, end=TEN)

    result = _list_slots(db, world)

    assert result.status == "ok"
    assert result.content["slots"] == [
        {
            "date": DATE.isoformat(),
            "start_time": "10:30",
            "end_time": "11:30",
            "tutor_id": str(world.assigned_tutor_id),
            "tutor_name": _name_of(db, world.assigned_user_id),
        }
    ]
    assert result.progress is False


def test_list_slots_keeps_only_ranges_that_allow_the_location(db: Session, world: World) -> None:
    _set_mode(db, world.assigned_tutor_id, AvailabilityMode.ONLY_OFFICE)
    # Home visits on Tuesdays only, so home is a Location this Tutor works, just not Mondays.
    db.add(
        TutorAvailability(
            tutor_id=world.assigned_tutor_id,
            day_of_week=DATE.weekday() + 1,
            start_time=NINE,
            end_time=TWELVE,
            mode=AvailabilityMode.TRAVELER,
        )
    )
    db.flush()

    at_home = _list_slots(db, world, location="home")
    at_office = _list_slots(db, world, location="office")

    assert at_home.content["slots"] == []
    assert [slot["start_time"] for slot in at_office.content["slots"]] == ["09:00", "10:30"]


def test_list_slots_reports_no_tutor_for_subject_apart_from_none_free(
    db: Session, world: World
) -> None:
    other_subject = Subject(name=f"Other {uuid.uuid4().hex[:8]}")
    db.add(other_subject)
    db.flush()

    result = _list_slots(db, world, subject_id=other_subject.id)

    assert result == _refused("no_tutor_for_subject")


def test_list_slots_reports_no_tutor_when_the_assigned_tutor_never_works_there(
    db: Session, world: World
) -> None:
    _set_mode(db, world.assigned_tutor_id, AvailabilityMode.ONLY_OFFICE)

    result = _list_slots(db, world, location="home")

    assert result == _refused("no_tutor_for_subject")


def test_list_slots_with_nobody_free_is_an_empty_list(db: Session, world: World) -> None:
    _book(db, world, child_id=world.sibling_id, start=NINE, end=TEN)
    _book(db, world, child_id=world.sibling_id, start=TEN_THIRTY, end=ELEVEN_THIRTY)

    result = _list_slots(db, world)

    assert result.status == "ok"
    assert result.content["slots"] == []


def test_list_slots_covers_every_day_in_the_range(db: Session, world: World) -> None:
    next_monday = DATE + datetime.timedelta(days=7)

    result = _list_slots(db, world, date_to=next_monday)

    assert [slot["date"] for slot in result.content["slots"]] == [
        DATE.isoformat(),
        DATE.isoformat(),
        next_monday.isoformat(),
        next_monday.isoformat(),
    ]


def test_list_slots_refuses_a_range_outside_the_booking_window(db: Session, world: World) -> None:
    last_week = NOW_WALL.date() - datetime.timedelta(days=7)

    result = _list_slots(db, world, date_from=last_week, date_to=last_week)

    assert result.status == "refused"
    assert result.content["reason"] == "date_out_of_window"


def test_list_slots_refuses_a_range_longer_than_two_weeks(db: Session, world: World) -> None:
    result = _list_slots(db, world, date_to=DATE + datetime.timedelta(days=14))

    assert result == _refused("range_too_long", max_days=14)


def test_list_slots_refuses_another_familys_child(db: Session, world: World) -> None:
    stranger = _make_child(db, guardian_id=_make_guardian(db), name="Stranger")

    result = _list_slots(db, world, child_id=stranger.id)

    assert result == _refused("child_not_linked")


def test_list_slots_refuses_a_child_who_is_not_evaluated(db: Session, world: World) -> None:
    child = _make_child(db, guardian_id=world.guardian_id, name="New")

    result = _list_slots(db, world, child_id=child.id)

    assert result == _refused("child_not_evaluated")


def test_list_slots_refuses_an_archived_child(db: Session, world: World) -> None:
    db.get_one(Child, world.child_id).is_archived = True
    db.flush()

    result = _list_slots(db, world)

    assert result == _refused("child_archived")


# --- propose ------------------------------------------------------------------------------------


def test_propose_stores_one_proposal_and_writes_no_booking(db: Session, world: World) -> None:
    result = _propose(db, world, [_book_action(world)])

    assert result.status == "ok"
    assert result.progress is True
    assert result.content["proposal"][0]["kind"] == "book"
    assert world.conversation.proposed_at == NOW
    assert len(world.conversation.proposal_actions or []) == 1
    assert _live_bookings(db, world) == []


def test_a_second_propose_replaces_the_first(db: Session, world: World) -> None:
    _propose(db, world, [_book_action(world, start="09:00")])
    later = NOW + datetime.timedelta(minutes=5)

    _propose(db, world, [_book_action(world, start="10:30")], now=later)

    actions = world.conversation.proposal_actions or []
    assert [action["start_time"] for action in actions] == ["10:30"]
    assert world.conversation.proposed_at == later


def test_a_refused_action_refuses_the_whole_proposal_and_stores_nothing(
    db: Session, world: World
) -> None:
    actions = [_book_action(world), _book_action(world, tutor_id=world.other_tutor_id)]

    result = _propose(db, world, actions)

    assert result.status == "refused"
    assert result.content["reason"] == "not_assigned_tutor"
    assert result.content["action"] == 1
    assert world.conversation.proposal_actions is None
    assert world.conversation.proposed_at is None


def test_propose_refuses_a_slot_the_childs_other_session_overlaps(
    db: Session, world: World
) -> None:
    other = _book(
        db, world, child_id=world.child_id, start=NINE, end=TEN, user_id=world.other_user_id
    )

    result = _propose(db, world, [_book_action(world, start="09:00")])

    assert result.status == "refused"
    assert result.content["reason"] == "child_overlap"
    assert result.content["booking_id"] == str(other)


def test_propose_refuses_a_slot_already_taken(db: Session, world: World) -> None:
    _book(db, world, child_id=world.sibling_id, start=NINE, end=TEN)

    result = _propose(db, world, [_book_action(world, start="09:00")])

    assert result.content["reason"] == "slot_not_free"


def test_propose_refuses_cancel_inside_the_cutoff_with_the_hours(db: Session, world: World) -> None:
    booking_id = _book(db, world, child_id=world.child_id, start=TEN, end=datetime.time(11))
    now = _at(datetime.datetime.combine(DATE, TEN) - datetime.timedelta(hours=CUTOFF_HOURS - 1))

    result = _propose(db, world, [_cancel_action(booking_id)], now=now)

    assert result == _refused("inside_cutoff", hours=CUTOFF_HOURS, action=0)


def test_propose_refuses_reschedule_inside_the_cutoff_with_the_hours(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, child_id=world.child_id, start=NINE, end=TEN)
    now = _at(datetime.datetime.combine(DATE, NINE) - datetime.timedelta(hours=1))

    result = _propose(db, world, [_reschedule_action(world, booking_id)], now=now)

    assert result == _refused("inside_cutoff", hours=CUTOFF_HOURS, action=0)


def test_propose_refuses_cancelling_another_familys_booking(db: Session, world: World) -> None:
    stranger = _make_child(db, guardian_id=_make_guardian(db), name="Stranger")
    booking_id = _book(db, world, child_id=stranger.id, start=NINE, end=TEN, home=False)

    result = _propose(db, world, [_cancel_action(booking_id)])

    assert result == _refused("child_not_linked", action=0)


def test_propose_refuses_a_start_whose_session_would_cross_midnight(
    db: Session, world: World
) -> None:
    result = _propose(db, world, [_book_action(world, start="23:30")])

    assert result == _refused("slot_not_free", action=0)


def test_propose_refuses_a_reschedule_that_would_cross_midnight(db: Session, world: World) -> None:
    booking_id = _book(db, world, child_id=world.child_id, start=NINE, end=TEN)

    result = _propose(db, world, [_reschedule_action(world, booking_id, start="23:30")])

    assert result == _refused("slot_not_free", action=0)


def test_a_refused_propose_drops_the_earlier_proposal(db: Session, world: World) -> None:
    _propose(db, world, [_book_action(world, start="09:00")])

    result = _propose(db, world, [_book_action(world, tutor_id=world.other_tutor_id)])

    assert result.status == "refused"
    assert world.conversation.proposal_actions is None
    assert world.conversation.proposed_at is None


# --- commit_proposal ----------------------------------------------------------------------------


def test_commit_with_nothing_pending_is_refused(db: Session, world: World) -> None:
    assert _commit(db, world) == _refused("nothing_pending")


def test_commit_in_the_same_turn_as_propose_needs_the_guardians_yes(
    db: Session, world: World
) -> None:
    _guardian_says(db, world, at=NOW - datetime.timedelta(minutes=1))
    _propose(db, world, [_book_action(world)])

    result = _commit(db, world)

    assert result == _refused("needs_guardian_yes")
    assert world.conversation.proposal_actions is not None
    assert _live_bookings(db, world) == []


def test_commit_after_the_guardians_yes_saves_and_clears_the_proposal(
    db: Session, world: World
) -> None:
    _propose(db, world, [_book_action(world, start="10:30")])
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=2))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=3))

    [booking] = _live_bookings(db, world)
    assert result.status == "ok"
    assert result.progress is True
    assert result.committed == (CommittedAction(kind="book", booking_id=booking.id),)
    assert (booking.child_id, booking.start_time) == (world.child_id, TEN_THIRTY)
    assert booking.booked_by_guardian_id == world.guardian_id
    assert world.conversation.proposal_actions is None
    assert world.conversation.proposed_at is None


def test_a_retried_commit_after_success_finds_nothing_pending(db: Session, world: World) -> None:
    _propose(db, world, [_book_action(world)])
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))
    _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result == _refused("nothing_pending")
    assert len(_live_bookings(db, world)) == 1


def test_a_proposal_older_than_thirty_minutes_is_refused_and_dropped(
    db: Session, world: World
) -> None:
    _propose(db, world, [_book_action(world)])
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=31))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=31))

    assert result == _refused("proposal_expired")
    assert world.conversation.proposal_actions is None
    assert world.conversation.proposed_at is None
    assert _live_bookings(db, world) == []


def test_a_proposal_exactly_thirty_minutes_old_still_commits(db: Session, world: World) -> None:
    _propose(db, world, [_book_action(world)])
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=29))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=30))

    assert result.status == "ok"


def test_two_children_commit_together_on_one_yes(db: Session, world: World) -> None:
    actions = [
        _book_action(world, start="09:00"),
        _book_action(world, child_id=world.sibling_id, start="10:30"),
    ]
    _propose(db, world, actions)
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    bookings = _live_bookings(db, world)
    assert result.status == "ok"
    assert {(b.child_id, b.start_time) for b in bookings} == {
        (world.child_id, NINE),
        (world.sibling_id, TEN_THIRTY),
    }
    assert [action.kind for action in result.committed] == ["book", "book"]


def test_when_the_second_action_fails_neither_lands_and_the_proposal_stays(
    db: Session, world: World
) -> None:
    actions = [
        _book_action(world, start="09:00"),
        _book_action(world, child_id=world.sibling_id, start="10:30"),
    ]
    _propose(db, world, actions)
    proposed = world.conversation.proposal_actions
    # The office books the Tutor's 10:30 for another family meanwhile.
    stranger = _make_child(db, guardian_id=_make_guardian(db), name="Stranger")
    _book(db, world, child_id=stranger.id, start=TEN_THIRTY, end=ELEVEN_THIRTY, home=False)
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result == _refused("slot_not_free", action=1)
    assert _live_bookings(db, world) == []
    assert world.conversation.proposal_actions == proposed
    assert world.conversation.proposed_at == NOW


def test_a_session_that_would_cross_midnight_at_commit_is_refused(
    db: Session, world: World, set_int_setting: Callable[[str, int], None]
) -> None:
    _propose(db, world, [_book_action(world, start="10:30")])
    # The office lengthens Sessions meanwhile, so 10:30 would now end after midnight.
    set_int_setting("session_length_minutes", 14 * 60)
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result == _refused("slot_not_free", action=0)
    assert _live_bookings(db, world) == []


def test_commit_cancels_a_booking(db: Session, world: World) -> None:
    booking_id = _book(db, world, child_id=world.child_id, start=NINE, end=TEN)
    _propose(db, world, [_cancel_action(booking_id)])
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result.committed == (CommittedAction(kind="cancel", booking_id=booking_id),)
    assert db.get_one(Booking, booking_id).status is BookingStatus.CANCELLED


def test_commit_reschedules_a_booking_to_a_new_one(db: Session, world: World) -> None:
    booking_id = _book(db, world, child_id=world.child_id, start=NINE, end=TEN)
    _propose(db, world, [_reschedule_action(world, booking_id, start="10:30")])
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    [moved] = _live_bookings(db, world)
    assert result.committed == (CommittedAction(kind="reschedule", booking_id=moved.id),)
    assert (moved.child_id, moved.start_time, moved.subject_id) == (
        world.child_id,
        TEN_THIRTY,
        world.subject_id,
    )
    assert db.get_one(Booking, booking_id).status is BookingStatus.CANCELLED


def test_a_reschedule_may_move_a_session_onto_its_own_time_neighbourhood(
    db: Session, world: World
) -> None:
    """The old session is cancelled before the new one is written, so a move to an overlapping
    time with the same Tutor isn't refused as an overlap with itself."""
    _set_range(db, world.assigned_tutor_id, start=NINE, end=datetime.time(13))
    booking_id = _book(db, world, child_id=world.child_id, start=NINE, end=TEN)
    _propose(db, world, [_reschedule_action(world, booking_id, start="09:30")])
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result.status == "ok"


def test_a_reschedule_of_a_booking_changed_since_the_proposal_is_refused(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, child_id=world.child_id, start=NINE, end=TEN)
    _propose(db, world, [_reschedule_action(world, booking_id, start="10:30")])
    booking = db.get_one(Booking, booking_id)
    booking.updated_at = booking.updated_at + datetime.timedelta(seconds=1)
    db.flush()
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result == _refused("booking_changed", action=0)
    assert db.get_one(Booking, booking_id).status is BookingStatus.CONFIRMED
    assert world.conversation.proposal_actions is not None


def test_cancel_inside_the_cutoff_at_commit_is_refused_with_the_hours(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, child_id=world.child_id, start=NINE, end=TEN)
    starts_at = datetime.datetime.combine(DATE, NINE)
    proposed_at = _at(starts_at - datetime.timedelta(hours=CUTOFF_HOURS, minutes=10))
    _propose(db, world, [_cancel_action(booking_id)], now=proposed_at)
    _guardian_says(db, world, at=proposed_at + datetime.timedelta(minutes=12))

    result = _commit(db, world, now=proposed_at + datetime.timedelta(minutes=15))

    assert result == _refused("inside_cutoff", hours=CUTOFF_HOURS, action=0)


def test_a_tutor_unassigned_since_the_proposal_is_refused_at_commit(
    db: Session, world: World
) -> None:
    _propose(db, world, [_book_action(world)])
    assignment = db.scalars(
        select(ChildAssignedTutor).where(
            ChildAssignedTutor.child_id == world.child_id,
            ChildAssignedTutor.user_id == world.assigned_user_id,
        )
    ).one()
    db.delete(assignment)
    db.flush()
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result == _refused("not_assigned_tutor", action=0)


def test_a_child_overlap_arising_since_the_proposal_is_refused_at_commit(
    db: Session, world: World
) -> None:
    _propose(db, world, [_book_action(world, start="09:00")])
    _book(db, world, child_id=world.child_id, start=NINE, end=TEN, user_id=world.other_user_id)
    _guardian_says(db, world, at=NOW + datetime.timedelta(minutes=1))

    result = _commit(db, world, now=NOW + datetime.timedelta(minutes=2))

    assert result.content["reason"] == "child_overlap"


# --- helpers ------------------------------------------------------------------------------------


def _tool(name: str) -> ToolSpec:
    return next(tool for tool in bot_tools_booking.TOOLS if tool.name == name)


def _context(db: Session, world: World, now: datetime.datetime) -> ToolContext:
    return ToolContext(db=db, conversation=world.conversation, now=now)


def _list_slots(
    db: Session,
    world: World,
    *,
    child_id: uuid.UUID | None = None,
    subject_id: uuid.UUID | None = None,
    date_from: datetime.date = DATE,
    date_to: datetime.date = DATE,
    location: str = "home",
) -> ToolResult:
    return _tool("list_slots").run(
        _context(db, world, NOW),
        {
            "child_id": str(child_id or world.child_id),
            "subject_id": str(subject_id or world.subject_id),
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "location": location,
        },
    )


def _propose(
    db: Session, world: World, actions: list[dict[str, Any]], *, now: datetime.datetime = NOW
) -> ToolResult:
    return _tool("propose").run(_context(db, world, now), {"actions": actions})


def _commit(db: Session, world: World, *, now: datetime.datetime = NOW) -> ToolResult:
    return _tool("commit_proposal").run(_context(db, world, now), {})


def _book_action(
    world: World,
    *,
    child_id: uuid.UUID | None = None,
    tutor_id: uuid.UUID | None = None,
    start: str = "09:00",
) -> dict[str, Any]:
    return {
        "kind": "book",
        "booking_id": None,
        "child_id": str(child_id or world.child_id),
        "subject_id": str(world.subject_id),
        "tutor_id": str(tutor_id or world.assigned_tutor_id),
        "date": DATE.isoformat(),
        "start_time": start,
        "location": "home",
        "home_id": str(world.home_id),
    }


def _cancel_action(booking_id: uuid.UUID) -> dict[str, Any]:
    return {
        "kind": "cancel",
        "booking_id": str(booking_id),
        "child_id": None,
        "subject_id": None,
        "tutor_id": None,
        "date": None,
        "start_time": None,
        "location": None,
        "home_id": None,
    }


def _reschedule_action(
    world: World, booking_id: uuid.UUID, *, start: str = "10:30"
) -> dict[str, Any]:
    return {
        "kind": "reschedule",
        "booking_id": str(booking_id),
        "child_id": None,
        "subject_id": None,
        "tutor_id": str(world.assigned_tutor_id),
        "date": DATE.isoformat(),
        "start_time": start,
        "location": "home",
        "home_id": str(world.home_id),
    }


def _refused(reason: str, **detail: object) -> ToolResult:
    return ToolResult(status="refused", content={"reason": reason, **detail})


def _objects_in(schema: dict[str, Any]) -> Any:
    """Every object schema in `schema`, itself included."""
    if schema.get("type") == "object":
        yield schema
    for child in schema.get("properties", {}).values():
        yield from _objects_in(child)
    if isinstance(schema.get("items"), dict):
        yield from _objects_in(schema["items"])


def _guardian_says(db: Session, world: World, *, at: datetime.datetime) -> None:
    """An inbound message, stamped explicitly: `now()` is frozen for the test's transaction."""
    db.add(
        Message(
            conversation_id=world.conversation.id,
            author_kind=MessageAuthor.CLIENT,
            body="yes",
            status=MessageStatus.RECEIVED,
            created_at=at,
            updated_at=at,
        )
    )
    db.flush()


def _live_bookings(db: Session, world: World) -> list[Booking]:
    return list(
        db.scalars(
            select(Booking)
            .where(
                Booking.child_id.in_([world.child_id, world.sibling_id]),
                Booking.status == BookingStatus.CONFIRMED,
            )
            .order_by(Booking.start_time)
            .execution_options(populate_existing=True)
        )
    )


def _book(
    db: Session,
    world: World,
    *,
    child_id: uuid.UUID,
    start: datetime.time,
    end: datetime.time,
    user_id: uuid.UUID | None = None,
    home: bool = True,
) -> uuid.UUID:
    """A confirmed Session written straight to the table, as the office would have."""
    booking = Booking(
        child_id=child_id,
        user_id=user_id or world.assigned_user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME if home else BookingLocation.IN_OFFICE,
        subject_id=world.subject_id,
        home_id=world.home_id if home else None,
        scheduled_date=DATE,
        start_time=start,
        end_time=end,
        status=BookingStatus.CONFIRMED,
    )
    db.add(booking)
    db.flush()
    return booking.id


def _make_guardian(db: Session) -> uuid.UUID:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(phone_number=f"+1{suffix[:10]}", name=f"Guardian {suffix}")
    db.add(guardian)
    db.flush()
    return guardian.id


def _make_child(db: Session, *, guardian_id: uuid.UUID, name: str) -> Child:
    child = Child(name=name, grade_level=7, school_name="Test School")
    db.add(child)
    db.flush()
    db.add(ChildGuardian(child_id=child.id, guardian_id=guardian_id))
    db.flush()
    return child


def _make_tutor(db: Session, *, subject_id: uuid.UUID) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    db.add(TutorSubject(tutor_id=tutor.id, subject_id=subject_id, max_grade_level=12))
    return tutor


def _evaluate(
    db: Session, child_id: uuid.UUID, *, subject_id: uuid.UUID, evaluator_id: uuid.UUID
) -> None:
    child = db.get_one(Child, child_id)
    child.evaluated_at = NOW
    child.evaluated_by_user_id = evaluator_id
    db.add(
        ChildSubjectLevel(
            child_id=child_id, subject_id=subject_id, level=7, set_by_user_id=evaluator_id
        )
    )


def _add_range(db: Session, tutor_id: uuid.UUID) -> None:
    db.add(
        TutorAvailability(
            tutor_id=tutor_id,
            day_of_week=DATE.weekday(),
            start_time=NINE,
            end_time=TWELVE,
            mode=AvailabilityMode.ANYWHERE,
        )
    )


def _ranges_of(db: Session, tutor_id: uuid.UUID) -> list[TutorAvailability]:
    return list(db.scalars(select(TutorAvailability).where(TutorAvailability.tutor_id == tutor_id)))


def _set_mode(db: Session, tutor_id: uuid.UUID, mode: AvailabilityMode) -> None:
    for row in _ranges_of(db, tutor_id):
        row.mode = mode
    db.flush()


def _set_range(
    db: Session, tutor_id: uuid.UUID, *, start: datetime.time, end: datetime.time
) -> None:
    for row in _ranges_of(db, tutor_id):
        row.start_time = start
        row.end_time = end
    db.flush()


def _set_cutoff(db: Session, hours: int) -> None:
    """The harness seeds no `cancellation_cutoff_hours` row (see `test_guardian_policy`)."""
    row = db.execute(
        select(SystemSetting).where(SystemSetting.key == CUTOFF_SETTING)
    ).scalar_one_or_none()

    if row is None:
        db.add(
            SystemSetting(
                key=CUTOFF_SETTING,
                value=str(hours),
                value_type=SETTING_VALUE_TYPE_INTEGER,
                is_developer_only=False,
            )
        )
    else:
        row.value = str(hours)


def _name_of(db: Session, user_id: uuid.UUID) -> str:
    return db.get_one(User, user_id).name
