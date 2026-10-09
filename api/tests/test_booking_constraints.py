"""`excl_bookings_live_overlap`, `ck_bookings_time_order`, the kind/location CHECKs, the one
live Evaluation per Child index, `ck_tutor_availability_mode` and
`ck_tutor_availability_exceptions_date_order`, against a real PostgreSQL.

Metadata assertions prove the constraints are declared, not that the database rejects
anything. This module is the half that matters: every case below is an INSERT that either
lands or comes back as an `IntegrityError`, so a constraint that is dropped, mis-scoped, or
built on a closed range instead of a half-open one fails here rather than in production.

The two constraints are tested together because the check is what makes the exclusion sound:
an empty or inverted `tsrange` slips past an EXCLUDE entirely, so neither guarantee holds
without the other.

Each rejection runs inside its own `begin_nested()`. A failed statement aborts the surrounding
transaction, and the `db` fixture's rollback is the outer one — without the savepoint the next
statement in the same test dies with `InFailedSqlTransaction` and hides what it meant to prove.
"""

import datetime
import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import AvailabilityMode, BookingKind, BookingLocation, BookingStatus, UserRole
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor
from app.models.user import User

DATE = datetime.date(2026, 9, 7)
NEXT_DATE = datetime.date(2026, 9, 8)

NINE = datetime.time(9, 0)
NINE_THIRTY = datetime.time(9, 30)
TEN = datetime.time(10, 0)
TEN_THIRTY = datetime.time(10, 30)
ELEVEN = datetime.time(11, 0)
ELEVEN_THIRTY = datetime.time(11, 30)
TWELVE = datetime.time(12, 0)

OVERLAP_CONSTRAINT = "excl_bookings_live_overlap"
TIME_ORDER_CONSTRAINT = "ck_bookings_time_order"
HOME_LOCATION_CONSTRAINT = "ck_bookings_home_matches_location"
SUBJECT_KIND_CONSTRAINT = "ck_bookings_subject_matches_kind"
EVALUATION_SLOT_CONSTRAINT = "ck_bookings_evaluation_has_no_slot"
ONE_LIVE_EVALUATION_INDEX = "uq_bookings_one_live_evaluation_per_child"
MODE_CONSTRAINT = "ck_tutor_availability_mode"
DATE_ORDER_CONSTRAINT = "ck_tutor_availability_exceptions_date_order"

OVERLAPPING_WINDOWS = [
    (TEN, ELEVEN),
    (TEN_THIRTY, ELEVEN_THIRTY),
    (NINE_THIRTY, TEN_THIRTY),
    (NINE, TWELVE),
    (TEN_THIRTY, ELEVEN),
]


@dataclass(frozen=True, slots=True)
class BookingParents:
    child_id: uuid.UUID
    subject_id: uuid.UUID
    home_id: uuid.UUID
    tutor_id: uuid.UUID
    user_id: uuid.UUID
    availability_id: uuid.UUID
    other_tutor_id: uuid.UUID
    other_user_id: uuid.UUID
    other_availability_id: uuid.UUID


@pytest.fixture
def parents(db: Session) -> BookingParents:
    suffix = uuid.uuid4().hex[:12]

    child = Child(name=f"Child {suffix}", grade_level=7, school_name="Test School")
    subject = Subject(name=f"Subject {suffix}")
    home = Home(address="1 Test Street", access_code="0000")
    db.add_all([child, subject, home])

    tutor = _make_tutor(db)
    other_tutor = _make_tutor(db)
    db.flush()

    return BookingParents(
        child_id=child.id,
        subject_id=subject.id,
        home_id=home.id,
        tutor_id=tutor.id,
        user_id=tutor.user_id,
        availability_id=_make_availability(db, tutor.id),
        other_tutor_id=other_tutor.id,
        other_user_id=other_tutor.user_id,
        other_availability_id=_make_availability(db, other_tutor.id),
    )


@pytest.mark.parametrize(("start", "end"), OVERLAPPING_WINDOWS)
def test_a_live_booking_overlapping_another_is_rejected(
    db: Session, parents: BookingParents, start: datetime.time, end: datetime.time
) -> None:
    """The equal-start case is the guarantee the old unique index gave and must not be lost;
    the four others are the ones it never caught, and the reason #42 exists."""
    db.add(_booking(parents, start=TEN, end=ELEVEN))
    db.flush()

    with pytest.raises(IntegrityError, match=OVERLAP_CONSTRAINT), db.begin_nested():
        db.add(_booking(parents, start=start, end=end))
        db.flush()


def test_bookings_that_only_touch_at_an_endpoint_are_accepted(
    db: Session, parents: BookingParents
) -> None:
    """`tsrange` is half-open, so 11:00 belongs to the second hour and not the first. A closed
    range here would make every back-to-back session in a tutor's day a conflict."""
    db.add(_booking(parents, start=TEN, end=ELEVEN))
    db.add(_booking(parents, start=ELEVEN, end=TWELVE))
    db.flush()

    assert _live_count(db) == 2


def test_overlapping_bookings_for_different_tutors_are_accepted(
    db: Session, parents: BookingParents
) -> None:
    db.add(_booking(parents, start=TEN, end=ELEVEN))
    db.add(
        _booking(
            parents,
            start=TEN_THIRTY,
            end=ELEVEN_THIRTY,
            user_id=parents.other_user_id,
            availability_id=parents.other_availability_id,
        )
    )
    db.flush()

    assert _live_count(db) == 2


def test_overlapping_bookings_on_different_dates_are_accepted(
    db: Session, parents: BookingParents
) -> None:
    """The range is built from `scheduled_date + start_time`, so the date is inside the
    comparison rather than beside it — two 10:00 hours a day apart do not overlap."""
    db.add(_booking(parents, start=TEN, end=ELEVEN))
    db.add(_booking(parents, start=TEN_THIRTY, end=ELEVEN_THIRTY, scheduled_date=NEXT_DATE))
    db.flush()

    assert _live_count(db) == 2


@pytest.mark.parametrize("status", [BookingStatus.CANCELLED, BookingStatus.COMPLETED])
def test_a_booking_leaving_the_live_set_frees_its_window(
    db: Session, parents: BookingParents, status: BookingStatus
) -> None:
    """A cancelled hour has to be rebookable, which is the whole point of scoping the
    constraint by status rather than applying it to every row."""
    first = _booking(parents, start=TEN, end=ELEVEN)
    db.add(first)
    db.flush()

    with pytest.raises(IntegrityError, match=OVERLAP_CONSTRAINT), db.begin_nested():
        db.add(_booking(parents, start=TEN_THIRTY, end=ELEVEN_THIRTY))
        db.flush()

    first.status = status
    db.flush()
    db.add(_booking(parents, start=TEN_THIRTY, end=ELEVEN_THIRTY))
    db.flush()

    assert _live_count(db) == 1


@pytest.mark.parametrize(("start", "end"), [(TEN, TEN), (ELEVEN, TEN)])
def test_a_booking_that_does_not_span_time_is_rejected(
    db: Session, parents: BookingParents, start: datetime.time, end: datetime.time
) -> None:
    """A zero-length window builds an empty `tsrange` and an inverted one builds no range at
    all, so neither is something the exclusion constraint can ever see. Both have to be
    refused at the row level or the overlap guarantee has a hole under it."""
    with pytest.raises(IntegrityError, match=TIME_ORDER_CONSTRAINT), db.begin_nested():
        db.add(_booking(parents, start=start, end=end))
        db.flush()


def test_an_inverted_window_is_a_constraint_violation_not_a_database_error(
    db: Session, parents: BookingParents
) -> None:
    """`tsrange(t, t - 1h)` raises SQLSTATE 22000 — a `DataError`, a sibling of
    `IntegrityError` rather than a subclass. A service catching `IntegrityError` to answer 409
    would let that escape as a 500, so the check has to fire first and it has to be the check
    that reports. `pytest.raises(IntegrityError)` is the assertion: a `DataError` fails it."""
    with pytest.raises(IntegrityError) as caught, db.begin_nested():
        db.add(_booking(parents, start=ELEVEN, end=TEN))
        db.flush()

    assert not isinstance(caught.value, DataError)
    assert TIME_ORDER_CONSTRAINT in str(caught.value)


def test_two_zero_length_bookings_cannot_both_land(db: Session, parents: BookingParents) -> None:
    """The regression the check closes. An empty range overlaps nothing — not even another
    empty range — so before `ck_bookings_time_order` both of these were accepted, which is
    weaker than the unique index #42 removed."""
    for _ in range(2):
        with pytest.raises(IntegrityError, match=TIME_ORDER_CONSTRAINT), db.begin_nested():
            db.add(_booking(parents, start=TEN, end=TEN))
            db.flush()

    assert _live_count(db) == 0


# --- kind, location and the per-user overlap ---------------------------------------------------


def test_a_live_evaluation_overlapping_a_regular_booking_of_the_same_user_is_rejected(
    db: Session, parents: BookingParents
) -> None:
    """The EXCLUDE keys on the Staff member's user, so a Regular session and an Evaluation of
    the same person collide even though one names a slot and the other does not."""
    db.add(_booking(parents, start=TEN, end=ELEVEN))
    db.flush()

    with pytest.raises(IntegrityError, match=OVERLAP_CONSTRAINT), db.begin_nested():
        db.add(_evaluation(parents, start=TEN_THIRTY, end=ELEVEN_THIRTY))
        db.flush()


def test_an_evaluation_adjacent_to_a_regular_booking_of_the_same_user_is_accepted(
    db: Session, parents: BookingParents
) -> None:
    db.add(_booking(parents, start=TEN, end=ELEVEN))
    db.add(_evaluation(parents, start=ELEVEN, end=TWELVE))
    db.flush()

    assert _live_count(db) == 2


def test_a_home_booking_without_a_home_is_rejected(db: Session, parents: BookingParents) -> None:
    with pytest.raises(IntegrityError, match=HOME_LOCATION_CONSTRAINT), db.begin_nested():
        booking = _booking(parents, start=TEN, end=ELEVEN)
        booking.home_id = None
        db.add(booking)
        db.flush()


def test_an_office_booking_with_a_home_is_rejected(db: Session, parents: BookingParents) -> None:
    with pytest.raises(IntegrityError, match=HOME_LOCATION_CONSTRAINT), db.begin_nested():
        booking = _booking(parents, start=TEN, end=ELEVEN)
        booking.location = BookingLocation.IN_OFFICE
        db.add(booking)
        db.flush()


def test_a_regular_booking_at_the_office_is_accepted(db: Session, parents: BookingParents) -> None:
    booking = _booking(parents, start=TEN, end=ELEVEN)
    booking.location = BookingLocation.IN_OFFICE
    booking.home_id = None
    db.add(booking)
    db.flush()

    assert _live_count(db) == 1


def test_a_regular_booking_without_a_subject_is_rejected(
    db: Session, parents: BookingParents
) -> None:
    with pytest.raises(IntegrityError, match=SUBJECT_KIND_CONSTRAINT), db.begin_nested():
        booking = _booking(parents, start=TEN, end=ELEVEN)
        booking.subject_id = None
        db.add(booking)
        db.flush()


def test_an_evaluation_with_a_subject_is_rejected(db: Session, parents: BookingParents) -> None:
    with pytest.raises(IntegrityError, match=SUBJECT_KIND_CONSTRAINT), db.begin_nested():
        booking = _evaluation(parents, start=TEN, end=ELEVEN)
        booking.subject_id = parents.subject_id
        db.add(booking)
        db.flush()


def test_an_evaluation_with_a_slot_is_rejected(db: Session, parents: BookingParents) -> None:
    with pytest.raises(IntegrityError, match=EVALUATION_SLOT_CONSTRAINT), db.begin_nested():
        booking = _evaluation(parents, start=TEN, end=ELEVEN)
        booking.availability_id = parents.availability_id
        db.add(booking)
        db.flush()


def test_a_regular_booking_without_a_slot_is_accepted(db: Session, parents: BookingParents) -> None:
    """An Admin's Regular booking names no range (spec 01); only an Evaluation is slotless by
    constraint."""
    booking = _booking(parents, start=TEN, end=ELEVEN)
    booking.availability_id = None
    db.add(booking)
    db.flush()

    assert _live_count(db) == 1


def test_an_evaluation_at_the_office_without_subject_or_slot_is_accepted(
    db: Session, parents: BookingParents
) -> None:
    db.add(_evaluation(parents, start=TEN, end=ELEVEN))
    db.flush()

    assert _live_count(db) == 1


# --- one live Evaluation per Child -------------------------------------------------------------


def test_a_second_live_evaluation_for_a_child_is_rejected(
    db: Session, parents: BookingParents
) -> None:
    """Another Staff member on another day, so only the partial unique index can refuse it."""
    db.add(_evaluation(parents, start=TEN, end=ELEVEN))
    db.flush()

    with pytest.raises(IntegrityError, match=ONE_LIVE_EVALUATION_INDEX), db.begin_nested():
        second = _evaluation(parents, start=TEN, end=ELEVEN, user_id=parents.other_user_id)
        second.scheduled_date = NEXT_DATE
        db.add(second)
        db.flush()


@pytest.mark.parametrize("status", [BookingStatus.CANCELLED, BookingStatus.COMPLETED])
def test_a_child_may_have_another_evaluation_once_the_first_leaves_the_live_set(
    db: Session, parents: BookingParents, status: BookingStatus
) -> None:
    first = _evaluation(parents, start=TEN, end=ELEVEN)
    db.add(first)
    db.flush()

    first.status = status
    db.flush()
    second = _evaluation(parents, start=TEN, end=ELEVEN, user_id=parents.other_user_id)
    second.scheduled_date = NEXT_DATE
    db.add(second)
    db.flush()

    assert _live_count(db) == 1


# --- availability mode -------------------------------------------------------------------------


def test_an_availability_range_with_an_unknown_mode_is_rejected(db: Session) -> None:
    """Raw SQL, because the ORM's enum type refuses the value before it reaches PostgreSQL."""
    tutor = _make_tutor(db)

    with pytest.raises(IntegrityError, match=MODE_CONSTRAINT), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO tutor_availability"
                " (tutor_id, day_of_week, start_time, end_time, mode)"
                " VALUES (:tutor_id, 0, '09:00', '12:00', 'teleport')"
            ),
            {"tutor_id": tutor.id},
        )


def test_an_availability_range_defaults_to_traveler(db: Session) -> None:
    tutor = _make_tutor(db)

    db.execute(
        text(
            "INSERT INTO tutor_availability (tutor_id, day_of_week, start_time, end_time)"
            " VALUES (:tutor_id, 0, '09:00', '12:00')"
        ),
        {"tutor_id": tutor.id},
    )
    mode = db.scalar(select(TutorAvailability.mode).where(TutorAvailability.tutor_id == tutor.id))

    assert mode == AvailabilityMode.TRAVELER


def test_an_exception_with_end_date_before_start_date_is_rejected(db: Session) -> None:
    tutor = _make_tutor(db)

    with pytest.raises(IntegrityError, match=DATE_ORDER_CONSTRAINT), db.begin_nested():
        db.add(_exception(tutor.id, start_date=NEXT_DATE, end_date=DATE))
        db.flush()


def test_a_single_day_exception_with_equal_start_and_end_date_is_accepted(
    db: Session,
) -> None:
    """The comparison is inclusive on both ends, so a one-day exception must not be caught by
    the same check that rejects an inverted range."""
    tutor = _make_tutor(db)
    exception = _exception(tutor.id, start_date=DATE, end_date=DATE)
    db.add(exception)
    db.flush()

    assert exception.end_date == exception.start_date


def _booking(
    parents: BookingParents,
    *,
    start: datetime.time,
    end: datetime.time,
    scheduled_date: datetime.date = DATE,
    status: BookingStatus = BookingStatus.PENDING,
    user_id: uuid.UUID | None = None,
    availability_id: uuid.UUID | None = None,
) -> Booking:
    return Booking(
        child_id=parents.child_id,
        user_id=user_id or parents.user_id,
        kind=BookingKind.REGULAR,
        location=BookingLocation.HOME,
        subject_id=parents.subject_id,
        availability_id=availability_id or parents.availability_id,
        home_id=parents.home_id,
        scheduled_date=scheduled_date,
        start_time=start,
        end_time=end,
        status=status,
    )


def _evaluation(
    parents: BookingParents,
    *,
    start: datetime.time,
    end: datetime.time,
    status: BookingStatus = BookingStatus.PENDING,
    user_id: uuid.UUID | None = None,
) -> Booking:
    """An Evaluation at the office: no Subject, no slot, no home."""
    return Booking(
        child_id=parents.child_id,
        user_id=user_id or parents.user_id,
        kind=BookingKind.EVALUATION,
        location=BookingLocation.IN_OFFICE,
        scheduled_date=DATE,
        start_time=start,
        end_time=end,
        status=status,
    )


def _exception(
    tutor_id: uuid.UUID, *, start_date: datetime.date, end_date: datetime.date
) -> TutorAvailabilityException:
    return TutorAvailabilityException(
        tutor_id=tutor_id, start_date=start_date, end_date=end_date, reason="vacation"
    )


def _make_tutor(db: Session) -> Tutor:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        user=User(email=f"tutor-{suffix}@example.com", name=f"Tutor {suffix}", role=UserRole.TUTOR),
        phone_number=f"+1{suffix[:10]}",
    )
    db.add(tutor)
    db.flush()
    return tutor


def _make_availability(db: Session, tutor_id: uuid.UUID) -> uuid.UUID:
    availability = TutorAvailability(
        tutor_id=tutor_id, day_of_week=DATE.weekday(), start_time=NINE, end_time=TWELVE
    )
    db.add(availability)
    db.flush()
    return availability.id


def _live_count(db: Session) -> int:
    return db.execute(
        select(func.count())
        .select_from(Booking)
        .where(Booking.status.in_([BookingStatus.PENDING, BookingStatus.CONFIRMED]))
    ).scalar_one()
