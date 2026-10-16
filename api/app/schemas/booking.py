"""Booking read shapes, and the pure refs they are built from.

The reads themselves are assembled by `services.booking_read_service`, which needs the DB for
the batched fields (`subject_level`, `guardians`); the refs here need only a loaded row.
"""

import datetime
import uuid
from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.schemas.common import Page

from app.models.enums import BookingKind, BookingLocation, BookingStatus, UserRole
from app.services.sort_out_service import SortOutReason

if TYPE_CHECKING:
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


class HomeSummaryRef(BaseModel):
    """A list row's Home. `directions` is here so a Tutor's week view needs no detail read."""

    id: uuid.UUID
    label: str | None
    address: str
    directions: str | None


class BookingSummaryChild(NamedRef):
    """A list row's Child; `notes` is on the Tutor data rule. Never `date_of_birth`."""

    notes: str | None


class BookingSummary(BaseModel):
    id: uuid.UUID
    child: BookingSummaryChild
    staff: StaffRef
    kind: BookingKind
    location: BookingLocation
    # The office address setting when the session is In office and it is set, else None.
    office_address: str | None
    # None on an Evaluation (`ck_bookings_subject_matches_kind`).
    subject: NamedRef | None
    # The Child's level in `subject`; None with no level set, or with no Subject.
    subject_level: int | None
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    status: BookingStatus
    notes: str | None
    # None when the session is In office; an archived Home is still named.
    home: HomeSummaryRef | None
    # The Child's non-archived Guardians by name; no conversation id, for any caller.
    guardians: list[NamedRef]
    # Why the Booking is to sort out, in `SORT_OUT_REASONS` order; [] when it isn't.
    sort_out_reasons: list[SortOutReason]
    # Who kept the Booking over Time off on purpose, and when; both None when nobody did. An
    # archived user is still named.
    clash_acknowledged_by: NamedRef | None
    clash_acknowledged_at: datetime.datetime | None
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
    directions: str | None


class BookingGuardian(BaseModel):
    """A non-archived Guardian of the Booking's Child, with their latest conversation if any."""

    id: uuid.UUID
    name: str
    conversation_id: uuid.UUID | None


class ClashingTimeOff(BaseModel):
    """Approved Time off of the Booking's Staff member that overlaps it."""

    id: uuid.UUID
    start_date: datetime.date
    end_date: datetime.date
    start_time: datetime.time | None
    end_time: datetime.time | None


class BookingDetail(BaseModel):
    id: uuid.UUID
    child: BookingChild
    staff: StaffRef
    kind: BookingKind
    location: BookingLocation
    # The office address setting when the session is In office and it is set, else None.
    office_address: str | None
    subject: NamedRef | None
    subject_level: int | None
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    status: BookingStatus
    notes: str | None
    availability_id: uuid.UUID | None
    # Overlapping approved Time off, acknowledged or not; [] when none.
    clashing_time_off: list[ClashingTimeOff]
    # None when the session is In office (`ck_bookings_home_matches_location`).
    home: HomeRef | None
    booked_by_guardian: NamedRef | None
    guardians: list[BookingGuardian]
    sort_out_reasons: list[SortOutReason]
    # Who kept the Booking over Time off on purpose, and when; both None when nobody did. An
    # archived user is still named.
    clash_acknowledged_by: NamedRef | None
    clash_acknowledged_at: datetime.datetime | None
    updated_at: datetime.datetime


def staff_ref(user: "User") -> StaffRef:
    return StaffRef(id=user.id, name=user.name, role=user.role)


def user_ref(user: "User | None") -> NamedRef | None:
    return None if user is None else NamedRef(id=user.id, name=user.name)


def subject_ref(subject: "Subject | None") -> NamedRef | None:
    return None if subject is None else NamedRef(id=subject.id, name=subject.name)


def home_summary_ref(home: "Home | None") -> HomeSummaryRef | None:
    return (
        None
        if home is None
        else HomeSummaryRef(
            id=home.id, label=home.label, address=home.address, directions=home.directions
        )
    )


def home_ref(home: "Home | None") -> HomeRef | None:
    return (
        None
        if home is None
        else HomeRef(id=home.id, label=home.label, address=home.address, directions=home.directions)
    )
