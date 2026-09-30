import datetime
import uuid

from pydantic import BaseModel

from app.models.enums import BookingStatus


class NamedRef(BaseModel):
    id: uuid.UUID
    name: str


class BookingChild(NamedRef):
    """The assigned tutor sees a child's notes on the session detail (OQ-52 answered (b),
    2026-09-23, reversing A-43). `date_of_birth` is never here and must never be added.
    `BookingSummary.child` stays `NamedRef` (P7C-V) — the list is left out on purpose."""

    notes: str | None


class BookingSummary(BaseModel):
    id: uuid.UUID
    child: NamedRef
    tutor: NamedRef
    subject: NamedRef
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    status: BookingStatus
    notes: str | None


class HomeRef(BaseModel):
    id: uuid.UUID
    label: str | None
    address: str
    access_code: str


class BookingDetail(BaseModel):
    id: uuid.UUID
    child: BookingChild
    tutor: NamedRef
    subject: NamedRef
    scheduled_date: datetime.date
    start_time: datetime.time
    end_time: datetime.time
    status: BookingStatus
    notes: str | None
    home: HomeRef
    booked_by_guardian: NamedRef | None
