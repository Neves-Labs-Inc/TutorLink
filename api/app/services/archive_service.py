"""Archive and Restore, one handler per archivable type.

`ArchiveService.archive` and `.restore` look the handler up in `_HANDLERS` by the body's `type`;
a new type adds its body shape to `schemas/archive.py` and one entry here. Every handler answers
an `ArchiveResult`, so the router maps every type the same way.

A repeat call (archiving an archived row, restoring an active one) is a no-op 200 with nothing
cancelled. Restore clears the flag only, for every type. A Guardian's or a Subject's archive
also sets the flag only: their Children, Homes, Bookings and Tutor teaching stay as they are.

**A Home is refused while a Booking at it is upcoming**, 409 naming every such Booking.
"Upcoming" is `upcoming_live_bookings(now)` — the one definition (P7C-T) — with `now` the naive
business wall-clock from `clock.business_now`, which is also where a test freezes it. The Home row
is locked `FOR UPDATE` before the check, which conflicts with the `FOR SHARE` read
`booking_write_service._resolve` takes on the home before it inserts a booking (P7C-S).
Whichever gets there first makes the other wait: a booking read first keeps this refusing until
it commits and this then sees it; an archive locked first keeps the booking waiting and it then
sees the home archived.

Same transaction contract as the other services: nothing here commits, the router does.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import Booking, upcoming_live_bookings
from app.models.guardian import Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.schemas.archive import ArchiveTarget
from app.services import clock
from app.services.client_service import CLIENT_NOT_FOUND_ERROR
from app.services.home_service import HOME_NOT_FOUND_ERROR
from app.services.subject_service import SUBJECT_NOT_FOUND_ERROR

logger = logging.getLogger(__name__)

HOME_HAS_UPCOMING_BOOKINGS_ERROR = "Home has upcoming bookings; cancel or move them first"

HTTP_OK = 200
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409


@dataclass(frozen=True, slots=True)
class ArchiveOutcome:
    archived: bool
    cancelled_booking_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ArchiveResult:
    value: ArchiveOutcome | None
    error: str | None
    status: int
    # Fields a refusal's body carries beside `detail`, e.g. the Bookings blocking a Home.
    extra: dict[str, object] = field(default_factory=dict)


Handler = Callable[[Session, ArchiveTarget, bool], ArchiveResult]


class ArchiveService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def archive(self, target: ArchiveTarget) -> ArchiveResult:
        return _HANDLERS[target.type](self._db, target, True)

    def restore(self, target: ArchiveTarget) -> ArchiveResult:
        return _HANDLERS[target.type](self._db, target, False)


def _set_guardian(db: Session, target: ArchiveTarget, is_archiving: bool) -> ArchiveResult:
    guardian = db.get(Guardian, target.id)

    if guardian is None:
        return _not_found(target, CLIENT_NOT_FOUND_ERROR)

    guardian.is_archived = is_archiving
    db.flush()

    return _done(is_archiving)


def _set_home(db: Session, target: ArchiveTarget, is_archiving: bool) -> ArchiveResult:
    home = db.get(Home, target.id, with_for_update=True)

    if home is None:
        return _not_found(target, HOME_NOT_FOUND_ERROR)

    # An already-archived Home is a no-op, so only a real archive is guarded.
    is_guarded = is_archiving and not home.is_archived
    blocking = _upcoming_booking_ids(db, home_id=home.id) if is_guarded else []

    if blocking:
        logger.warning("archive of home %s refused: %d upcoming booking(s)", home.id, len(blocking))
        return ArchiveResult(
            value=None,
            error=HOME_HAS_UPCOMING_BOOKINGS_ERROR,
            status=HTTP_CONFLICT,
            extra={"booking_ids": [str(booking_id) for booking_id in blocking]},
        )

    home.is_archived = is_archiving
    db.flush()

    return _done(is_archiving)


def _set_subject(db: Session, target: ArchiveTarget, is_archiving: bool) -> ArchiveResult:
    subject = db.get(Subject, target.id)

    if subject is None:
        return _not_found(target, SUBJECT_NOT_FOUND_ERROR)

    subject.is_archived = is_archiving
    db.flush()

    return _done(is_archiving)


def _upcoming_booking_ids(db: Session, *, home_id: uuid.UUID) -> list[uuid.UUID]:
    statement = (
        select(Booking.id)
        .where(Booking.home_id == home_id, upcoming_live_bookings(clock.business_now()))
        .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
    )

    return list(db.scalars(statement))


def _done(archived: bool) -> ArchiveResult:
    return ArchiveResult(value=ArchiveOutcome(archived=archived), error=None, status=HTTP_OK)


def _not_found(target: ArchiveTarget, message: str) -> ArchiveResult:
    logger.warning("archive/restore of %s %s refused: not found", target.type, target.id)

    return ArchiveResult(value=None, error=message, status=HTTP_NOT_FOUND)


_HANDLERS: dict[str, Handler] = {
    "guardian": _set_guardian,
    "home": _set_home,
    "subject": _set_subject,
}
