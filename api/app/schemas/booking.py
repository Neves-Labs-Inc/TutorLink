"""Booking read shapes, and the builders that fill them from a loaded `Booking` row.

The builders live here rather than in each router because three routers (`bookings`,
`client_bookings`, `stats`) render the same summary and each had its own copy; the null-safe
`subject` and `home` of #130 are one rule, kept in one place.
"""

import datetime
import uuid
from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.schemas.common import Page

from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.home import Home
    from app.models.subject import Subject
    from app.models.user import User


class NamedRef(BaseModel):
    id: uuid.UUID
    name: str


class StaffRef(BaseModel):
    """The Staff member a Booking is with, as a person (#130). `id` is the user's id."""

    id: uuid.UUID
    name: str
    role: UserRole


class BookingChild(NamedRef):
    """The assigned tutor sees a child's notes on the session detail (OQ-52 answered (b),
    2026-09-23, reversing A-43). `date_of_birth` is never here and must never be added.
    `BookingSummary.child` stays `NamedRef` (P7C-V) — the list is left out on purpose."""

    notes: str | None


class BookingSummary(BaseModel):
    id: uuid.UUID
    child: NamedRef
    staff: StaffRef
    kind: BookingKind
    location: BookingLocation
    # None on an Evaluation (`ck_bookings_subject_matches_kind`).
    subject: NamedRef | None
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    status: BookingStatus
    notes: str | None
    updated_at: datetime.datetime


class BookingKindCounts(BaseModel):
    regular: int
    evaluation: int


class BookingPage(Page[BookingSummary]):
    """Each count is the `total` the same request would return with `kind` forced to it."""

    counts_by_kind: BookingKindCounts


class HomeRef(BaseModel):
    id: uuid.UUID
    label: str | None
    address: str
    access_code: str


class BookingDetail(BaseModel):
    id: uuid.UUID
    child: BookingChild
    staff: StaffRef
    kind: BookingKind
    location: BookingLocation
    subject: NamedRef | None
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    status: BookingStatus
    notes: str | None
    # None when the session is In office (`ck_bookings_home_matches_location`).
    home: HomeRef | None
    booked_by_guardian: NamedRef | None
    updated_at: datetime.datetime


def staff_ref(user: "User") -> StaffRef:
    return StaffRef(id=user.id, name=user.name, role=user.role)


def subject_ref(subject: "Subject | None") -> NamedRef | None:
    return None if subject is None else NamedRef(id=subject.id, name=subject.name)


def home_ref(home: "Home | None") -> HomeRef | None:
    return (
        None
        if home is None
        else HomeRef(
            id=home.id, label=home.label, address=home.address, access_code=home.access_code
        )
    )


def booking_summary(row: "Booking") -> BookingSummary:
    """Needs `child`, `staff` and `subject` loaded on `row`."""
    return BookingSummary(
        id=row.id,
        child=NamedRef(id=row.child.id, name=row.child.name),
        staff=staff_ref(row.staff),
        kind=row.kind,
        location=row.location,
        subject=subject_ref(row.subject),
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
        status=row.status,
        notes=row.notes,
        updated_at=row.updated_at,
    )


def booking_detail(row: "Booking") -> BookingDetail:
    """Needs `child`, `staff`, `subject`, `home` and `booked_by_guardian` loaded on `row`."""
    return BookingDetail(
        id=row.id,
        child=BookingChild(id=row.child.id, name=row.child.name, notes=row.child.notes),
        staff=staff_ref(row.staff),
        kind=row.kind,
        location=row.location,
        subject=subject_ref(row.subject),
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
        status=row.status,
        notes=row.notes,
        home=home_ref(row.home),
        booked_by_guardian=(
            None
            if row.booked_by_guardian is None
            else NamedRef(id=row.booked_by_guardian.id, name=row.booked_by_guardian.name)
        ),
        updated_at=row.updated_at,
    )
