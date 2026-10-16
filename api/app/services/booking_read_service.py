"""Booking reads assembled from loaded `Booking` rows — every Booking-read response goes here.

`GET /api/bookings`, `GET /api/bookings/{id}`, the `PUT /api/bookings/{id}` response,
`GET /api/clients/{id}/bookings` and `GET /api/stats/overview` `recent_bookings` all build their
Bookings through this module, so a field added to the read lands on every one of them at once.

**A fixed number of statements per call, never one per row**: the caller loads `child`, `staff`,
`subject`, `home` and `clash_acknowledged_by_user` (the detail also `booked_by_guardian`) with
its query, and everything else
is one batched query per field here. A per-row lazy load would turn a page of 100 into hundreds
of round trips.

`now` is the naive business wall-clock (`clock.business_now`); it is part of the interface for
the time-dependent fields of the read.
"""

import datetime
import uuid
from collections.abc import Sequence

from sqlalchemy import and_, or_, select, tuple_
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.availability import TutorAvailabilityException
from app.models.child_subject_level import ChildSubjectLevel
from app.models.conversation import Conversation
from app.models.enums import ExceptionStatus
from app.models.guardian import ChildGuardian, Guardian
from app.schemas.booking import (
    BookingChild,
    BookingSummaryChild,
    ClashingTimeOff,
    BookingDetail,
    BookingGuardian,
    BookingSummary,
    NamedRef,
    home_ref,
    home_summary_ref,
    staff_ref,
    subject_ref,
    user_ref,
)
from app.services import conversation_service
from app.services.sort_out_service import sort_out_reasons

type _LevelKey = tuple[uuid.UUID, uuid.UUID]


def booking_summaries(
    db: Session, rows: Sequence[Booking], *, now: datetime.datetime
) -> list[BookingSummary]:
    """Needs `child`, `staff`, `subject`, `home` and `clash_acknowledged_by_user` loaded."""
    levels = _subject_levels(db, rows)
    reasons = sort_out_reasons(db, [row.id for row in rows], now)
    guardians = _guardian_refs(db, {row.child_id for row in rows})

    return [
        BookingSummary(
            id=row.id,
            child=BookingSummaryChild(id=row.child.id, name=row.child.name, notes=row.child.notes),
            staff=staff_ref(row.staff),
            kind=row.kind,
            location=row.location,
            subject=subject_ref(row.subject),
            subject_level=_level_of(row, levels),
            scheduled_date=row.scheduled_date,
            start_time=row.start_time,
            end_time=row.end_time,
            status=row.status,
            notes=row.notes,
            home=home_summary_ref(row.home),
            guardians=guardians.get(row.child_id, []),
            sort_out_reasons=reasons[row.id],
            clash_acknowledged_by=user_ref(row.clash_acknowledged_by_user),
            clash_acknowledged_at=row.clash_acknowledged_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


def booking_detail(
    db: Session, row: Booking, *, now: datetime.datetime, shows_conversations: bool
) -> BookingDetail:
    """Needs `child`, `staff`, `subject`, `home`, `clash_acknowledged_by_user` and
    `booked_by_guardian` loaded on `row`.

    `shows_conversations` is the caller being Office: a conversation id is the Office inbox's,
    so anyone else (a Tutor reading their own Booking) gets `conversation_id: null`.
    """
    levels = _subject_levels(db, [row])

    return BookingDetail(
        id=row.id,
        child=BookingChild(id=row.child.id, name=row.child.name, notes=row.child.notes),
        staff=staff_ref(row.staff),
        kind=row.kind,
        location=row.location,
        subject=subject_ref(row.subject),
        subject_level=_level_of(row, levels),
        scheduled_date=row.scheduled_date,
        start_time=row.start_time,
        end_time=row.end_time,
        status=row.status,
        notes=row.notes,
        availability_id=row.availability_id,
        clashing_time_off=_clashing_time_off(db, row),
        home=home_ref(row.home),
        booked_by_guardian=(
            None
            if row.booked_by_guardian is None
            else NamedRef(id=row.booked_by_guardian.id, name=row.booked_by_guardian.name)
        ),
        guardians=_guardians(db, child_id=row.child_id, shows_conversations=shows_conversations),
        sort_out_reasons=sort_out_reasons(db, [row.id], now)[row.id],
        clash_acknowledged_by=user_ref(row.clash_acknowledged_by_user),
        clash_acknowledged_at=row.clash_acknowledged_at,
        updated_at=row.updated_at,
    )


def _subject_levels(db: Session, rows: Sequence[Booking]) -> dict[_LevelKey, int]:
    """Every `(child_id, subject_id) -> level` the rows need, in one query.

    Archived Subjects are not filtered out: a Booking in one still shows the Child's level.
    """
    keys = {(row.child_id, row.subject_id) for row in rows if row.subject_id is not None}
    if not keys:
        return {}

    found = db.execute(
        select(
            ChildSubjectLevel.child_id, ChildSubjectLevel.subject_id, ChildSubjectLevel.level
        ).where(tuple_(ChildSubjectLevel.child_id, ChildSubjectLevel.subject_id).in_(keys))
    ).all()

    return {(child_id, subject_id): level for child_id, subject_id, level in found}


def _guardian_refs(db: Session, child_ids: set[uuid.UUID]) -> dict[uuid.UUID, list[NamedRef]]:
    """Each Child's non-archived Guardians by name, for all the Children in one query."""
    if not child_ids:
        return {}

    found = db.execute(
        select(ChildGuardian.child_id, Guardian.id, Guardian.name)
        .join(Guardian, Guardian.id == ChildGuardian.guardian_id)
        .where(ChildGuardian.child_id.in_(child_ids), Guardian.is_archived.is_(False))
        .order_by(Guardian.name, Guardian.id)
    ).all()

    refs: dict[uuid.UUID, list[NamedRef]] = {}
    for child_id, guardian_id, name in found:
        refs.setdefault(child_id, []).append(NamedRef(id=guardian_id, name=name))
    return refs


def _clashing_time_off(db: Session, row: Booking) -> list[ClashingTimeOff]:
    """The Staff member's approved Time off overlapping the Booking, acknowledged or not.

    The overlap of `sort_out_service.time_off_clash_predicate` (keep the two in step).
    """
    time_off = TutorAvailabilityException
    found = db.scalars(
        select(time_off)
        .where(
            time_off.status == ExceptionStatus.APPROVED,
            time_off.user_id == row.user_id,
            time_off.start_date <= row.scheduled_date,
            time_off.end_date >= row.scheduled_date,
            or_(
                time_off.start_time.is_(None),
                and_(time_off.start_time < row.end_time, time_off.end_time > row.start_time),
            ),
        )
        .order_by(time_off.start_date, time_off.id)
    ).all()

    return [
        ClashingTimeOff(
            id=item.id,
            start_date=item.start_date,
            end_date=item.end_date,
            start_time=item.start_time,
            end_time=item.end_time,
        )
        for item in found
    ]


def _guardians(
    db: Session, *, child_id: uuid.UUID, shows_conversations: bool
) -> list[BookingGuardian]:
    """The Child's non-archived Guardians by name, each with their latest conversation."""
    guardians = db.scalars(
        select(Guardian)
        .join(ChildGuardian, ChildGuardian.guardian_id == Guardian.id)
        .where(ChildGuardian.child_id == child_id, Guardian.is_archived.is_(False))
        .order_by(Guardian.name, Guardian.id)
    ).all()
    conversations = (
        _latest_conversations(db, guardian_ids=[guardian.id for guardian in guardians])
        if shows_conversations
        else {}
    )

    return [
        BookingGuardian(
            id=guardian.id, name=guardian.name, conversation_id=conversations.get(guardian.id)
        )
        for guardian in guardians
    ]


def _latest_conversations(
    db: Session, *, guardian_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """Each Guardian's latest conversation id (`LATEST_CONVERSATION_FIRST`); none, absent."""
    if not guardian_ids:
        return {}

    latest = db.execute(
        select(Conversation.guardian_id, Conversation.id)
        .where(Conversation.guardian_id.in_(guardian_ids))
        .distinct(Conversation.guardian_id)
        .order_by(Conversation.guardian_id, *conversation_service.LATEST_CONVERSATION_FIRST)
    ).all()

    return {guardian_id: conversation_id for guardian_id, conversation_id in latest}


def _level_of(row: Booking, levels: dict[_LevelKey, int]) -> int | None:
    # An Evaluation has no Subject, so it has no level either.
    return None if row.subject_id is None else levels.get((row.child_id, row.subject_id))
