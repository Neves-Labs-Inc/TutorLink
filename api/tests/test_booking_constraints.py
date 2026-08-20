"""`excl_bookings_live_overlap`, `ck_bookings_time_order`, and
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
from sqlalchemy import func, select
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from app.models.availability import TutorAvailability, TutorAvailabilityException
from app.models.booking import Booking
from app.models.child import Child
from app.models.enums import BookingStatus
from app.models.home import Home
from app.models.subject import Subject
from app.models.tutor import Tutor

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
    availability_id: uuid.UUID
    other_tutor_id: uuid.UUID
    other_availability_id: uuid.UUID


@pytest.fixture
def parents(db: Session) -> BookingParents:
    suffix = uuid.uuid4().hex[:12]

    child = Child(name=f"Child {suffix}", age=12, grade_level=7, school_name="Test School")
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
        availability_id=_make_availability(db, tutor.id),
        other_tutor_id=other_tutor.id,
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
            tutor_id=parents.other_tutor_id,
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
    tutor_id: uuid.UUID | None = None,
    availability_id: uuid.UUID | None = None,
) -> Booking:
    return Booking(
        child_id=parents.child_id,
        tutor_id=tutor_id or parents.tutor_id,
        subject_id=parents.subject_id,
        availability_id=availability_id or parents.availability_id,
        home_id=parents.home_id,
        scheduled_date=scheduled_date,
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
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
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
