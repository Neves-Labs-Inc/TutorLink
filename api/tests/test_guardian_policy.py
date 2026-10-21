"""`guardian_policy`: the rules a Guardian's bot booking meets and the Office's dashboard doesn't.

Every case runs against the real test database through the three `check_*` functions; nothing
is mocked. `now` is passed in, so no clock is frozen.
"""

import datetime
import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability
from app.models.booking import Booking
from app.models.child import Child
from app.models.child_assigned_tutor import ChildAssignedTutor
from app.models.enums import (
    AvailabilityMode,
    BookingKind,
    BookingLocation,
    BookingStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.models.system_setting import SETTING_VALUE_TYPE_INTEGER, SystemSetting
from app.models.tutor import Tutor
from app.models.user import User
from app.services import guardian_policy

# A Monday; every Availability range below is on its weekday.
DATE = datetime.date(2026, 9, 7)
NINE = datetime.time(9, 0)
TEN = datetime.time(10, 0)
TEN_THIRTY = datetime.time(10, 30)
ELEVEN = datetime.time(11, 0)
ELEVEN_THIRTY = datetime.time(11, 30)
TWELVE = datetime.time(12, 0)
FOURTEEN = datetime.time(14, 0)
FIFTEEN = datetime.time(15, 0)
SIXTEEN = datetime.time(16, 0)

CUTOFF_HOURS = 24
CUTOFF_SETTING = "cancellation_cutoff_hours"


@dataclass(frozen=True, slots=True)
class World:
    guardian_id: uuid.UUID
    child_id: uuid.UUID
    subject_id: uuid.UUID
    home_id: uuid.UUID
    assigned_tutor_id: uuid.UUID
    assigned_user_id: uuid.UUID
    other_tutor_id: uuid.UUID
    other_user_id: uuid.UUID


@pytest.fixture
def world(db: Session) -> World:
    """One Guardian and Child, one Assigned Tutor and one who isn't. The Assigned Tutor's
    morning range is traveler (home only) and afternoon range only-office; the other Tutor's
    range is anywhere. The cutoff is set to `CUTOFF_HOURS`."""
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(phone_number=f"+1{suffix[:10]}", name=f"Guardian {suffix}")
    child = Child(name=f"Child {suffix}", grade_level=7, school_name="Test School")
    subject = Subject(name=f"Subject {suffix}")
    home = Home(address="1 Test Street", directions="0000")
    db.add_all([guardian, child, subject, home])
    db.flush()
    db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))

    assigned = _make_tutor(db)
    other = _make_tutor(db)
    db.add(ChildAssignedTutor(child_id=child.id, user_id=assigned.user_id))
    _add_range(db, assigned.id, start=NINE, end=TWELVE, mode=AvailabilityMode.TRAVELER)
    _add_range(db, assigned.id, start=FOURTEEN, end=SIXTEEN, mode=AvailabilityMode.ONLY_OFFICE)
    _add_range(db, other.id, start=NINE, end=TWELVE, mode=AvailabilityMode.ANYWHERE)
    _set_cutoff(db, CUTOFF_HOURS)
    db.flush()

    return World(
        guardian_id=guardian.id,
        child_id=child.id,
        subject_id=subject.id,
        home_id=home.id,
        assigned_tutor_id=assigned.id,
        assigned_user_id=assigned.user_id,
        other_tutor_id=other.id,
        other_user_id=other.user_id,
    )


# --- cancellation cutoff ----------------------------------------------------------------------


def test_cancelling_inside_the_cutoff_is_refused_with_the_hours(db: Session, world: World) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)
    now = _hours_before(DATE, TEN, CUTOFF_HOURS - 1)

    refusal = guardian_policy.check_cancel(
        db, guardian_id=world.guardian_id, booking_id=booking_id, now=now
    )

    assert refusal == guardian_policy.Refusal(code="inside_cutoff", detail={"hours": 24})


def test_cancelling_outside_the_cutoff_is_allowed(db: Session, world: World) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)
    now = _hours_before(DATE, TEN, CUTOFF_HOURS)

    refusal = guardian_policy.check_cancel(
        db, guardian_id=world.guardian_id, booking_id=booking_id, now=now
    )

    assert refusal is None


def test_rescheduling_inside_the_cutoff_is_refused_with_the_hours(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)
    now = _hours_before(DATE, TEN, CUTOFF_HOURS - 1)

    refusal = _reschedule(db, world, booking_id, start=ELEVEN, end=TWELVE, now=now)

    assert refusal == guardian_policy.Refusal(code="inside_cutoff", detail={"hours": 24})


def test_rescheduling_outside_the_cutoff_is_allowed(db: Session, world: World) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)
    now = _hours_before(DATE, TEN, CUTOFF_HOURS)

    assert _reschedule(db, world, booking_id, start=ELEVEN, end=TWELVE, now=now) is None


# --- Assigned Tutors --------------------------------------------------------------------------


def test_booking_an_assigned_tutor_is_allowed(db: Session, world: World) -> None:
    assert _check_book(db, world, tutor_id=world.assigned_tutor_id) is None


def test_booking_a_tutor_who_is_not_assigned_is_refused(db: Session, world: World) -> None:
    refusal = _check_book(db, world, tutor_id=world.other_tutor_id)

    assert refusal == guardian_policy.Refusal(code="not_assigned_tutor", detail={})


def test_rescheduling_onto_a_tutor_who_is_not_assigned_is_refused(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)

    refusal = _reschedule(
        db, world, booking_id, start=ELEVEN, end=TWELVE, tutor_id=world.other_tutor_id
    )

    assert refusal == guardian_policy.Refusal(code="not_assigned_tutor", detail={})


def test_a_tutor_assigned_to_another_child_is_still_refused(db: Session, world: World) -> None:
    sibling = Child(name="Sibling", grade_level=5, school_name="Test School")
    db.add(sibling)
    db.flush()
    db.add(ChildAssignedTutor(child_id=sibling.id, user_id=world.other_user_id))
    db.flush()

    refusal = _check_book(db, world, tutor_id=world.other_tutor_id)

    assert refusal == guardian_policy.Refusal(code="not_assigned_tutor", detail={})


# --- Location mode ----------------------------------------------------------------------------


def test_the_office_in_a_home_only_range_is_refused(db: Session, world: World) -> None:
    refusal = _check_book(
        db, world, tutor_id=world.assigned_tutor_id, location=BookingLocation.IN_OFFICE
    )

    assert refusal == guardian_policy.Refusal(
        code="location_not_allowed", detail={"allowed": ["home"]}
    )


def test_the_office_in_an_office_only_range_is_allowed(db: Session, world: World) -> None:
    refusal = _check_book(
        db,
        world,
        tutor_id=world.assigned_tutor_id,
        start=FOURTEEN,
        end=FIFTEEN,
        location=BookingLocation.IN_OFFICE,
    )

    assert refusal is None


def test_a_home_in_an_office_only_range_is_refused(db: Session, world: World) -> None:
    refusal = _check_book(db, world, tutor_id=world.assigned_tutor_id, start=FOURTEEN, end=FIFTEEN)

    assert refusal == guardian_policy.Refusal(
        code="location_not_allowed", detail={"allowed": ["in_office"]}
    )


def test_either_location_in_an_anywhere_range_is_allowed(db: Session, world: World) -> None:
    db.add(ChildAssignedTutor(child_id=world.child_id, user_id=world.other_user_id))
    db.flush()

    refusals = [
        _check_book(db, world, tutor_id=world.other_tutor_id, location=location)
        for location in BookingLocation
    ]

    assert refusals == [None, None]


def test_a_slot_no_active_range_covers_allows_no_location(db: Session, world: World) -> None:
    """Fail closed: the bot only offers slots inside a range, so anything else is refused."""
    # Starts inside the 9-12 range but runs past its end.
    outside = _check_book(
        db, world, tutor_id=world.assigned_tutor_id, start=ELEVEN, end=datetime.time(12, 30)
    )

    assert outside == guardian_policy.Refusal(code="location_not_allowed", detail={"allowed": []})


def test_an_inactive_range_allows_no_location(db: Session, world: World) -> None:
    for availability in db.scalars(
        select(TutorAvailability).where(TutorAvailability.tutor_id == world.assigned_tutor_id)
    ):
        availability.is_active = False
    db.flush()

    refusal = _check_book(db, world, tutor_id=world.assigned_tutor_id)

    assert refusal == guardian_policy.Refusal(code="location_not_allowed", detail={"allowed": []})


def test_rescheduling_to_a_home_in_an_office_only_range_is_refused(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)

    refusal = _reschedule(db, world, booking_id, start=FOURTEEN, end=FIFTEEN)

    assert refusal == guardian_policy.Refusal(
        code="location_not_allowed", detail={"allowed": ["in_office"]}
    )


# --- per-Child overlap ------------------------------------------------------------------------


def test_a_child_with_an_overlapping_live_session_is_refused(db: Session, world: World) -> None:
    held = _book(db, world, start=TEN, end=ELEVEN, user_id=world.other_user_id)

    refusal = _check_book(
        db, world, tutor_id=world.assigned_tutor_id, start=TEN_THIRTY, end=ELEVEN_THIRTY
    )

    assert refusal == guardian_policy.Refusal(
        code="child_overlap", detail={"booking_id": str(held)}
    )


def test_a_pending_session_counts_as_live(db: Session, world: World) -> None:
    _book(
        db, world, start=TEN, end=ELEVEN, user_id=world.other_user_id, status=BookingStatus.PENDING
    )

    refusal = _check_book(db, world, tutor_id=world.assigned_tutor_id)

    assert refusal is not None and refusal.code == "child_overlap"


def test_a_cancelled_session_does_not_block(db: Session, world: World) -> None:
    _book(
        db,
        world,
        start=TEN,
        end=ELEVEN,
        user_id=world.other_user_id,
        status=BookingStatus.CANCELLED,
    )

    assert _check_book(db, world, tutor_id=world.assigned_tutor_id) is None


def test_back_to_back_sessions_do_not_overlap(db: Session, world: World) -> None:
    _book(db, world, start=TEN, end=ELEVEN, user_id=world.other_user_id)

    assert (
        _check_book(db, world, tutor_id=world.assigned_tutor_id, start=ELEVEN, end=TWELVE) is None
    )


def test_another_childs_session_at_the_same_time_does_not_block(db: Session, world: World) -> None:
    sibling = Child(name="Sibling", grade_level=5, school_name="Test School")
    db.add(sibling)
    db.flush()
    db.add(
        Booking(
            child_id=sibling.id,
            user_id=world.other_user_id,
            kind=BookingKind.REGULAR,
            location=BookingLocation.IN_OFFICE,
            subject_id=world.subject_id,
            scheduled_date=DATE,
            start_time=TEN,
            end_time=ELEVEN,
            status=BookingStatus.CONFIRMED,
        )
    )
    db.flush()

    assert _check_book(db, world, tutor_id=world.assigned_tutor_id) is None


def test_rescheduling_onto_a_time_that_overlaps_only_itself_is_allowed(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)

    assert _reschedule(db, world, booking_id, start=TEN_THIRTY, end=ELEVEN_THIRTY) is None


def test_rescheduling_onto_another_session_of_the_child_is_refused(
    db: Session, world: World
) -> None:
    booking_id = _book(db, world, start=NINE, end=TEN)
    held = _book(db, world, start=ELEVEN, end=TWELVE, user_id=world.other_user_id)

    refusal = _reschedule(db, world, booking_id, start=TEN_THIRTY, end=ELEVEN_THIRTY)

    assert refusal == guardian_policy.Refusal(
        code="child_overlap", detail={"booking_id": str(held)}
    )


# --- helpers ----------------------------------------------------------------------------------


FAR_AHEAD = datetime.datetime.combine(DATE, NINE) - datetime.timedelta(days=7)


def _check_book(
    db: Session,
    world: World,
    *,
    tutor_id: uuid.UUID,
    start: datetime.time = TEN,
    end: datetime.time = ELEVEN,
    location: BookingLocation = BookingLocation.HOME,
) -> guardian_policy.Refusal | None:
    return guardian_policy.check_book(
        db,
        guardian_id=world.guardian_id,
        child_id=world.child_id,
        tutor_id=tutor_id,
        date=DATE,
        start_time=start,
        end_time=end,
        location=location,
        now=FAR_AHEAD,
    )


def _reschedule(
    db: Session,
    world: World,
    booking_id: uuid.UUID,
    *,
    start: datetime.time,
    end: datetime.time,
    tutor_id: uuid.UUID | None = None,
    location: BookingLocation = BookingLocation.HOME,
    now: datetime.datetime = FAR_AHEAD,
) -> guardian_policy.Refusal | None:
    return guardian_policy.check_reschedule(
        db,
        guardian_id=world.guardian_id,
        booking_id=booking_id,
        tutor_id=tutor_id or world.assigned_tutor_id,
        date=DATE,
        start_time=start,
        end_time=end,
        location=location,
        now=now,
    )


def _hours_before(date: datetime.date, time: datetime.time, hours: int) -> datetime.datetime:
    return datetime.datetime.combine(date, time) - datetime.timedelta(hours=hours)


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _add_range(
    db: Session,
    tutor_id: uuid.UUID,
    *,
    start: datetime.time,
    end: datetime.time,
    mode: AvailabilityMode,
) -> None:
    db.add(
        TutorAvailability(
            tutor_id=tutor_id, day_of_week=DATE.weekday(), start_time=start, end_time=end, mode=mode
        )
    )


def _set_cutoff(db: Session, hours: int) -> None:
    """The harness seeds no `cancellation_cutoff_hours` row."""
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


def _book(
    db: Session,
    world: World,
    *,
    start: datetime.time,
    end: datetime.time,
    user_id: uuid.UUID | None = None,
    status: BookingStatus = BookingStatus.CONFIRMED,
) -> uuid.UUID:
    booking = Booking(
        child_id=world.child_id,
        user_id=user_id or world.assigned_user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=world.subject_id,
        home_id=world.home_id,
        scheduled_date=DATE,
        start_time=start,
        end_time=end,
        status=status,
    )
    db.add(booking)
    db.flush()
    return booking.id


# --- Guardian-Child link ---------------------------------------------------------------------

NOT_LINKED = guardian_policy.Refusal(code="child_not_linked", detail={})


def test_booking_for_a_child_the_guardian_is_not_linked_to_is_refused(
    db: Session, world: World
) -> None:
    """Checked first: an unassigned Tutor would otherwise leak the other family's set-up."""
    stranger = _make_guardian(db)

    refusal = guardian_policy.check_book(
        db,
        guardian_id=stranger,
        child_id=world.child_id,
        tutor_id=world.other_tutor_id,
        date=DATE,
        start_time=TEN,
        end_time=ELEVEN,
        location=BookingLocation.HOME,
        now=FAR_AHEAD,
    )

    assert refusal == NOT_LINKED


def test_cancelling_another_familys_booking_is_refused(db: Session, world: World) -> None:
    """Even inside the cutoff, so the refusal says nothing about the Session's time."""
    booking_id = _book(db, world, start=TEN, end=ELEVEN)
    stranger = _make_guardian(db)

    refusal = guardian_policy.check_cancel(
        db,
        guardian_id=stranger,
        booking_id=booking_id,
        now=_hours_before(DATE, TEN, 1),
    )

    assert refusal == NOT_LINKED


def test_rescheduling_another_familys_booking_is_refused(db: Session, world: World) -> None:
    booking_id = _book(db, world, start=TEN, end=ELEVEN)
    stranger = _make_guardian(db)

    refusal = guardian_policy.check_reschedule(
        db,
        guardian_id=stranger,
        booking_id=booking_id,
        tutor_id=world.other_tutor_id,
        date=DATE,
        start_time=TEN_THIRTY,
        end_time=ELEVEN_THIRTY,
        location=BookingLocation.HOME,
        now=_hours_before(DATE, TEN, 1),
    )

    assert refusal == NOT_LINKED


def test_a_booking_id_that_names_nothing_is_refused_like_another_familys(
    db: Session, world: World
) -> None:
    """The same refusal as a foreign Booking, so the policy is no oracle for which ids exist."""
    missing = uuid.uuid4()

    cancel = guardian_policy.check_cancel(
        db, guardian_id=world.guardian_id, booking_id=missing, now=FAR_AHEAD
    )
    reschedule = _reschedule(db, world, missing, start=TEN, end=ELEVEN)

    assert (cancel, reschedule) == (NOT_LINKED, NOT_LINKED)


def _make_guardian(db: Session) -> uuid.UUID:
    suffix = uuid.uuid4().hex[:12]
    guardian = Guardian(phone_number=f"+1{suffix[:10]}", name=f"Guardian {suffix}")
    db.add(guardian)
    db.flush()
    return guardian.id
