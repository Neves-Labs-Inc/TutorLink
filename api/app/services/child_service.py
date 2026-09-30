"""Children, and the guardian and home links that a child cannot exist without.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. Every id in the body is resolved *before* any row is written, so a bad link can
never leave a guardian-less or home-less child behind — an orphan `docs/erd.md` says cannot
exist, and one no later request could repair through this surface.

An unresolvable `guardian_id` or `home_id` is a bad body rather than a missing resource, so it
is 400 and not 404. The addressed resource is the child. Precedent:
`user_service._assert_profile_matches_role` for a `tutor_id` that does not resolve.

`date_of_birth_is_plausible` is the one date-of-birth rule (A-46): the router turns a refusal
into a 400, the bot into a re-prompt. "Today" is the UTC date, read through `_today()` so a test
can freeze it. `notes` is normalised here rather than in a validator (CONSTITUTION §7): stripped,
and blank is stored as NULL. On update, an absent `notes` or `date_of_birth` is left alone, a
blank `notes` clears it, and `date_of_birth` cannot be cleared (A-47).

**Deactivation cancels the child's upcoming sessions, after a count check (P7C-O, OQ-59).**
"Upcoming" is `upcoming_live_bookings(now)` (P7C-T), `now` read through `_now()` in naive UTC.
`is_active: false` on an active child selects those bookings `FOR UPDATE`; if there are any and
`expected_cancellations` — the number the admin was shown and confirmed — differs from how many
there are now, `UpcomingSessionsChanged` refuses the whole update. Otherwise each one goes to
`cancelled` through `booking_status_service.change_status`, the one transition authority, in the
same transaction as the deactivation. Nothing is sent to anyone: no WhatsApp, no tutor notice,
no broadcast — nothing here may import `twilio_service`, `broadcast_service` or the bot.
Reactivation cancels nothing, and deactivating a child that is already inactive is a no-op on
its bookings.

**Home-unlink guard (A-62, OQ-61).** A `home_ids` set that drops a home at which the child has an
upcoming live booking is `HomeRemovalHasUpcomingBookings`: the session would otherwise point at a
home the child no longer has.

**Lock order is conversation → child → bookings (P7C-S).** `update_child` takes the child row
`FOR UPDATE` before anything else, and `booking_write_service._resolve` reads it `FOR SHARE`, so
a deactivation and a concurrent booking of the same child serialise: booking first, and the
count here sees the new session and refuses; deactivation first, and the booking sees the child
inactive and refuses. Without the child lock a booking committed between the count and the
commit is a live session on an inactive child that nobody confirmed and nobody is told about.
`populate_existing` makes the locked read replace whatever the session had cached, which is the
stale value the lock exists to avoid (`conversation_service._locked`).

Check order is the contract (`docs/api-design.md`, `PATCH /api/children/{id}`): unknown child →
date of birth → link ids → home-unlink guard → deactivation count → write. Every refusal is
raised before the first write, and the caller's single commit is what makes the cancellations
and the deactivation land together or not at all.
"""

import datetime
import uuid
from collections.abc import Callable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import Booking, upcoming_live_bookings
from app.models.child import Child
from app.models.enums import BookingStatus
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home
from app.services import booking_status_service

DATE_OF_BIRTH_EARLIEST = datetime.date(1900, 1, 1)


class ChildServiceError(Exception):
    """Base class for every failure this module reports."""


class ChildNotFound(ChildServiceError):
    """No child with that id."""


class InvalidChildLinks(ChildServiceError):
    """An empty link set, or an id naming no existing guardian or home."""


class InvalidDateOfBirth(ChildServiceError):
    """A date of birth before `DATE_OF_BIRTH_EARLIEST` or after today."""


class HomeRemovalHasUpcomingBookings(ChildServiceError):
    """`home_ids` drops a home at which the child has an upcoming live booking."""


class UpcomingSessionsChanged(ChildServiceError):
    """A deactivation whose `expected_cancellations` is absent or no longer the real count."""


def date_of_birth_is_plausible(value: datetime.date, *, today: datetime.date) -> bool:
    """DATE_OF_BIRTH_EARLIEST <= value <= today. The one rule; the bot and the API both call it."""
    return DATE_OF_BIRTH_EARLIEST <= value <= today


def create_child(
    db: Session,
    *,
    guardian_ids: Sequence[uuid.UUID],
    home_ids: Sequence[uuid.UUID],
    name: str,
    date_of_birth: datetime.date,
    grade_level: int,
    school_name: str,
    notes: str | None = None,
) -> Child:
    _assert_plausible(date_of_birth)
    guardians = _validated_link_ids(db, Guardian, guardian_ids)
    homes = _validated_link_ids(db, Home, home_ids)

    child = Child(
        name=name,
        date_of_birth=date_of_birth,
        grade_level=grade_level,
        school_name=school_name,
        notes=None if notes is None else _stored_notes(notes),
    )
    db.add(child)
    db.flush()

    for guardian_id in guardians:
        db.add(ChildGuardian(child_id=child.id, guardian_id=guardian_id))

    for home_id in homes:
        db.add(ChildHome(child_id=child.id, home_id=home_id))

    _expire_link_sets(db, child)

    return child


def update_child(
    db: Session,
    *,
    child_id: uuid.UUID,
    guardian_ids: Sequence[uuid.UUID] | None,
    home_ids: Sequence[uuid.UUID] | None,
    name: str | None,
    date_of_birth: datetime.date | None,
    grade_level: int | None,
    school_name: str | None,
    notes: str | None,
    is_active: bool | None,
    expected_cancellations: int | None,
) -> Child:
    child = db.get(Child, child_id, with_for_update=True, populate_existing=True)

    if child is None:
        raise ChildNotFound

    if date_of_birth is not None:
        _assert_plausible(date_of_birth)

    guardians = None if guardian_ids is None else _validated_link_ids(db, Guardian, guardian_ids)
    homes = None if home_ids is None else _validated_link_ids(db, Home, home_ids)
    now = _now()

    if homes is not None:
        _assert_no_upcoming_booking_at_removed_home(db, child_id=child.id, wanted=homes, now=now)

    if is_active is False and child.is_active:
        cancellations = _confirmed_cancellations(
            db, child_id=child.id, expected=expected_cancellations, now=now
        )
    else:
        cancellations = []

    for booking_id in cancellations:
        booking_status_service.change_status(
            db, booking_id=booking_id, target=BookingStatus.CANCELLED
        )

    if is_active is not None:
        child.is_active = is_active

    if name is not None:
        child.name = name

    if date_of_birth is not None:
        child.date_of_birth = date_of_birth

    if grade_level is not None:
        child.grade_level = grade_level

    if school_name is not None:
        child.school_name = school_name

    if notes is not None:
        child.notes = _stored_notes(notes)

    if guardians is not None:
        guardian_links = db.scalars(
            select(ChildGuardian).where(ChildGuardian.child_id == child.id)
        ).all()
        _replace_links(
            db,
            existing={link.guardian_id: link for link in guardian_links},
            wanted=guardians,
            build=lambda guardian_id: ChildGuardian(child_id=child.id, guardian_id=guardian_id),
        )

    if homes is not None:
        home_links = db.scalars(select(ChildHome).where(ChildHome.child_id == child.id)).all()
        _replace_links(
            db,
            existing={link.home_id: link for link in home_links},
            wanted=homes,
            build=lambda home_id: ChildHome(child_id=child.id, home_id=home_id),
        )

    _expire_link_sets(db, child)

    return child


def _assert_plausible(date_of_birth: datetime.date) -> None:
    if not date_of_birth_is_plausible(date_of_birth, today=_today()):
        raise InvalidDateOfBirth


def _today() -> datetime.date:
    return datetime.datetime.now(tz=datetime.UTC).date()


def _now() -> datetime.datetime:
    """Naive UTC, the form every scheduling column stores (`bot_service.server_now`)."""
    return datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)


def _assert_no_upcoming_booking_at_removed_home(
    db: Session, *, child_id: uuid.UUID, wanted: set[uuid.UUID], now: datetime.datetime
) -> None:
    linked = set(db.scalars(select(ChildHome.home_id).where(ChildHome.child_id == child_id)))
    removed = linked - wanted

    if removed:
        blocking = db.scalars(
            select(Booking.id).where(
                Booking.child_id == child_id,
                Booking.home_id.in_(removed),
                upcoming_live_bookings(now),
            )
        ).first()

        if blocking is not None:
            raise HomeRemovalHasUpcomingBookings


def _confirmed_cancellations(
    db: Session, *, child_id: uuid.UUID, expected: int | None, now: datetime.datetime
) -> list[uuid.UUID]:
    """The upcoming live bookings a deactivation cancels, once the admin's count still holds.

    Locked `FOR UPDATE` so none of them can change status between this count and the cancel.
    The child is already locked by the caller, so no new one can appear either (P7C-S).
    """
    booking_ids = list(
        db.scalars(
            select(Booking.id)
            .where(Booking.child_id == child_id, upcoming_live_bookings(now))
            .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
            .with_for_update()
        ).all()
    )

    if booking_ids and expected != len(booking_ids):
        raise UpcomingSessionsChanged

    return booking_ids


def _validated_link_ids(
    db: Session, model: type[Guardian] | type[Home], requested: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """The distinct ids to link to, once every one of them is known to exist.

    Repeats collapse rather than being refused: the junction's UNIQUE constraint would turn a
    harmless duplicate in the body into a 500.
    """
    wanted = set(requested)

    if not wanted:
        raise InvalidChildLinks

    found = set(db.scalars(select(model.id).where(model.id.in_(wanted))).all())

    if found != wanted:
        raise InvalidChildLinks

    return wanted


def _stored_notes(notes: str) -> str | None:
    return notes.strip() or None


def _replace_links[LinkT](
    db: Session,
    *,
    existing: dict[uuid.UUID, LinkT],
    wanted: set[uuid.UUID],
    build: Callable[[uuid.UUID], LinkT],
) -> None:
    """Set replacement, not delete-all-then-reinsert.

    A link that stays keeps its own row. Rewriting every junction primary key on each `PATCH`
    would look identical over HTTP and would break any future foreign key onto a link row.
    """
    for target_id in wanted - existing.keys():
        db.add(build(target_id))

    for target_id in existing.keys() - wanted:
        db.delete(existing[target_id])


def _expire_link_sets(db: Session, child: Child) -> None:
    """Flush the junction writes, then drop what the relationships cached about them.

    The rows above are written to the junction tables directly rather than through
    `child.guardian_links` / `child.home_links`, so those collections are stale by the time the
    router reads them for the response body.
    """
    db.flush()
    db.expire(child, ["guardian_links", "home_links"])
