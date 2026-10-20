"""Children, and the guardian links that a child cannot exist without.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. Every id in the body is resolved *before* any row is written, so a bad link can
never leave a guardian-less child behind — an orphan `docs/erd.md` says cannot exist, and one
no later request could repair through this surface. A child's homes are not written here: they
are its guardians' homes, derived by `home_set` (#214).

An unresolvable `guardian_id` is a bad body rather than a missing resource, so it
is 400 and not 404. The addressed resource is the child. Precedent:
`user_service._assert_profile_matches_role` for a `tutor_id` that does not resolve.

`date_of_birth_is_plausible` is the one date-of-birth rule (A-46): the router turns a refusal
into a 400, the bot into a re-prompt. "Today" is the business date (`clock.business_today`,
per `BUSINESS_TIMEZONE`), which a test freezes through `clock.business_now`. `notes` is normalised here rather than in a validator (CONSTITUTION §7): stripped,
and blank is stored as NULL. On update, an absent `notes` or `date_of_birth` is left alone, a
blank `notes` clears it, and `date_of_birth` cannot be cleared (A-47).

**Archiving cancels the child's upcoming sessions, after a count check (P7C-O, OQ-59).**
"Upcoming" is `upcoming_live_bookings(now)` (P7C-T), `now` the business wall-clock from
`clock.business_now` (`BUSINESS_TIMEZONE`).
`set_child_archived` on an active child selects those bookings `FOR UPDATE`; if there are any and
`expected_cancellations` — the number the admin was shown and confirmed — differs from how many
there are now, `UpcomingSessionsChanged` refuses the whole archive. Otherwise each one goes to
`cancelled` through `booking_status_service.change_status`, the one transition authority, in the
same transaction as the deactivation. Nothing is sent to anyone: no WhatsApp, no tutor notice,
no broadcast — nothing here may import `twilio_service`, `broadcast_service` or the bot.
Restore cancels nothing, and archiving a child that is already archived is a no-op on
its bookings.

**Guardian-unlink guard (#214, replaces A-62's home-unlink guard).** A `guardian_ids` set that
takes a home out of the child's home set (archived homes included), while the child has an
upcoming live booking there, is `GuardianRemovalHasUpcomingBookings`, carrying those bookings'
ids: the session would otherwise point at a home the child no longer has. A home another
remaining guardian also holds stays in the set and blocks nothing.

**Lock order is conversation → child → bookings (P7C-S).** `update_child` and `set_child_archived` take the child row
`FOR UPDATE` before anything else, and `booking_write_service._resolve` reads it `FOR SHARE`, so
a deactivation and a concurrent booking of the same child serialise: booking first, and the
count here sees the new session and refuses; deactivation first, and the booking sees the child
inactive and refuses. Without the child lock a booking committed between the count and the
commit is a live session on an inactive child that nobody confirmed and nobody is told about.
`populate_existing` makes the locked read replace whatever the session had cached, which is the
stale value the lock exists to avoid (`conversation_service._locked`).

`update_child` check order is the contract (`docs/api-design.md`, `PATCH /api/children/{id}`):
unknown child → date of birth → link ids → guardian-unlink guard → write. Every refusal is raised
before the first write; the caller's single commit makes an archive's cancellations and flag
land together or not at all.
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
from app.services import booking_status_service, clock
from app.services.home_set import child_home_ids, guardian_home_ids

DATE_OF_BIRTH_EARLIEST = datetime.date(1900, 1, 1)


class ChildServiceError(Exception):
    """Base class for every failure this module reports."""


class ChildNotFound(ChildServiceError):
    """No child with that id."""


class InvalidChildLinks(ChildServiceError):
    """An empty guardian set, or an id naming no existing guardian."""


class InvalidDateOfBirth(ChildServiceError):
    """A date of birth before `DATE_OF_BIRTH_EARLIEST` or after today."""


class GuardianRemovalHasUpcomingBookings(ChildServiceError):
    """`guardian_ids` takes away a home at which the child has upcoming live bookings."""

    def __init__(self, booking_ids: list[uuid.UUID]) -> None:
        super().__init__()
        # Ordered by `scheduled_date, start_time, id`.
        self.booking_ids = booking_ids


class UpcomingSessionsChanged(ChildServiceError):
    """A deactivation whose `expected_cancellations` is absent or no longer the real count."""


def date_of_birth_is_plausible(value: datetime.date, *, today: datetime.date) -> bool:
    """DATE_OF_BIRTH_EARLIEST <= value <= today. The one rule; the bot and the API both call it."""
    return DATE_OF_BIRTH_EARLIEST <= value <= today


def create_child(
    db: Session,
    *,
    guardian_ids: Sequence[uuid.UUID],
    name: str,
    date_of_birth: datetime.date | None,
    grade_level: int | None,
    school_name: str,
    notes: str | None = None,
) -> Child:
    # The bot saves a Child without one: it is asked for only when volunteered.
    if date_of_birth is not None:
        _assert_plausible(date_of_birth)

    guardians = _validated_guardian_ids(db, guardian_ids)

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

    _expire_link_sets(db, child)

    return child


def update_child(
    db: Session,
    *,
    child_id: uuid.UUID,
    guardian_ids: Sequence[uuid.UUID] | None,
    name: str | None,
    date_of_birth: datetime.date | None,
    grade_level: int | None,
    school_name: str | None,
    notes: str | None,
) -> Child:
    child = db.get(Child, child_id, with_for_update=True, populate_existing=True)

    if child is None:
        raise ChildNotFound

    if date_of_birth is not None:
        _assert_plausible(date_of_birth)

    guardians = None if guardian_ids is None else _validated_guardian_ids(db, guardian_ids)

    if guardians is not None:
        _assert_no_upcoming_booking_at_lost_home(
            db, child_id=child.id, guardians=guardians, now=clock.business_now()
        )

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

    _expire_link_sets(db, child)

    return child


def set_child_archived(
    db: Session, *, child_id: uuid.UUID, is_archived: bool, expected_cancellations: int | None
) -> list[uuid.UUID]:
    """Archive or restore a child; answers the ids of the bookings an archive cancelled.

    Only a real archive (of an active child) counts and cancels; a repeat of either call is a
    no-op that ignores `expected_cancellations`. Restore clears the flag and cancels nothing.
    """
    child = db.get(Child, child_id, with_for_update=True, populate_existing=True)

    if child is None:
        raise ChildNotFound

    cancellations: list[uuid.UUID] = []

    if is_archived and not child.is_archived:
        cancellations = _confirmed_cancellations(
            db, child_id=child.id, expected=expected_cancellations, now=clock.business_now()
        )

    for booking_id in cancellations:
        booking_status_service.change_status(
            db, booking_id=booking_id, target=BookingStatus.CANCELLED
        )

    child.is_archived = is_archived
    db.flush()

    return cancellations


def _assert_plausible(date_of_birth: datetime.date) -> None:
    if not date_of_birth_is_plausible(date_of_birth, today=clock.business_today()):
        raise InvalidDateOfBirth


def _assert_no_upcoming_booking_at_lost_home(
    db: Session, *, child_id: uuid.UUID, guardians: set[uuid.UUID], now: datetime.datetime
) -> None:
    """Archived homes count on both sides: a session can still sit at a home archived since."""
    before = set(db.scalars(child_home_ids(child_id, include_archived=True)))
    after = set(db.scalars(guardian_home_ids(guardians, include_archived=True)))
    lost = before - after

    if lost:
        blocking = list(
            db.scalars(
                select(Booking.id)
                .where(
                    Booking.child_id == child_id,
                    Booking.home_id.in_(lost),
                    upcoming_live_bookings(now),
                )
                .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
            ).all()
        )

        if blocking:
            raise GuardianRemovalHasUpcomingBookings(blocking)


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


def _validated_guardian_ids(db: Session, requested: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    """The distinct guardian ids to link to, once every one of them is known to exist.

    Repeats collapse rather than being refused: the junction's UNIQUE constraint would turn a
    harmless duplicate in the body into a 500.
    """
    wanted = set(requested)

    if not wanted:
        raise InvalidChildLinks

    found = set(db.scalars(select(Guardian.id).where(Guardian.id.in_(wanted))).all())

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

    The rows above are written to the junction table directly rather than through
    `child.guardian_links`, so that collection is stale by the time the router reads it for the
    response body.
    """
    db.flush()
    db.expire(child, ["guardian_links"])
