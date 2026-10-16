"""Archive and Restore, one handler per archivable type.

`ArchiveService.archive` and `.restore` look the handler up in `_HANDLERS` by the body's `type`;
a new type adds its body shape to `schemas/archive.py` and one entry here. Every handler answers
an `ArchiveResult`, so the router maps every type the same way.

A repeat call (archiving an archived row, restoring an active one) is a no-op 200 with nothing
cancelled. Restore clears the flag only, for every type. A Subject's archive also sets the flag
only: its Bookings and Tutor teaching stay as they are.

**Archiving a family's last active Guardian archives its active Children** (the family is the
household `household_service` groups over `child_guardians`). Each Child goes through
`child_service.set_child_archived`, which cancels its upcoming Bookings. Their count is checked
the Child way, summed across the family: when there are any, `expected_cancellations` must match
or it is a 409 with nothing written, the Guardian included. While another Guardian of the family
is active, only the flag changes. Homes are never touched, and restoring the Guardian brings back
the Guardian only. Locks: the Guardian row `FOR NO KEY UPDATE` (so a bot booking's foreign-key
KEY SHARE on it never waits), then the family's active Children in id order, then their Bookings.
No conversation is locked, so the conversation → child order holds.

**A Home is refused while a Booking at it is upcoming**, 409 naming every such Booking.
"Upcoming" is `upcoming_live_bookings(now)` — the one definition (P7C-T) — with `now` the naive
business wall-clock from `clock.business_now`, which is also where a test freezes it. The Home row
is locked `FOR UPDATE` before the check, which conflicts with the `FOR SHARE` read
`booking_write_service._resolve` takes on the home before it inserts a booking (P7C-S).
Whichever gets there first makes the other wait: a booking read first keeps this refusing until
it commits and this then sees it; an archive locked first keeps the booking waiting and it then
sees the home archived.

**Staff is Admin-only, and the one archive that signs someone out.** The actor must be in
`ADMIN_ROLES` (a Manager is refused), and the target is reached through
`user_service.lock_writable_user`, so the developer boundary and the peer-admin rule (#173) are
`user_service`'s, read from the target's current role on a locked row. Nobody archives
themselves, a Developer included: the office would lose the account it is acting from. An archive
revokes every refresh token and every live Invite and reset link in the same transaction, so a
restore brings back the password only: nothing that was revoked comes back.

**A Staff member's upcoming Bookings are a warning, not a refusal** (#151). Unconfirmed, the
archive is a 409 listing them under `archived_staff_bookings`, with nothing written; confirmed,
it lands whatever the list is by then. The Bookings keep their status and their Staff member:
they wait for the office to reassign them.

Same transaction contract as the other services: nothing here commits, the router does.
"""

import logging
import uuid
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, ADMIN_ROLES
from app.models.booking import Booking, upcoming_live_bookings
from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.schemas.archive import ArchiveTarget, ChildTarget, GuardianTarget, StaffTarget
from app.services import child_service, clock, household_service
from app.services.assigned_tutor_service import remove_all_for_user
from app.services.auth_service import revoke_all_refresh_tokens_for_user
from app.services.client_service import CLIENT_NOT_FOUND_ERROR
from app.services.home_service import HOME_NOT_FOUND_ERROR
from app.services.password_link_service import revoke_links_for_user
from app.services.subject_service import SUBJECT_NOT_FOUND_ERROR
from app.services.user_service import (
    PeerAdminNotPermitted,
    RoleNotPermitted,
    UserNotFound,
    lock_writable_user,
)

logger = logging.getLogger(__name__)

CHILD_NOT_FOUND_ERROR = "Child not found"
UPCOMING_SESSIONS_CHANGED_ERROR = "Upcoming sessions changed; review them and confirm again"
HOME_HAS_UPCOMING_BOOKINGS_ERROR = "Home has upcoming bookings; cancel or move them first"
USER_NOT_FOUND_ERROR = "User not found"
# The same words `/api/users` answers with for the same rules (#173).
DEVELOPER_FORBIDDEN_ERROR = "Only a developer may create or modify a developer account"
PEER_ADMIN_FORBIDDEN_ERROR = "Only a developer may modify another admin's account"
SELF_ARCHIVE_FORBIDDEN_ERROR = "You cannot archive your own account"
UNCONFIRMED_WARNINGS_ERROR = "This archive needs the listed warnings confirmed"
STAFF_BOOKINGS_WARNING = "archived_staff_bookings"
STAFF_BOOKINGS_WARNING_MESSAGE = (
    "This Staff member has upcoming bookings that will wait for the office"
)

HTTP_OK = 200
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409


@dataclass(frozen=True, slots=True)
class ArchiveOutcome:
    archived: bool
    cancelled_booking_ids: list[uuid.UUID] = field(default_factory=list)
    archived_child_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ArchiveResult:
    value: ArchiveOutcome | None
    error: str | None
    status: int
    # Fields a refusal's body carries beside `detail`, e.g. the Bookings blocking a Home.
    extra: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Actor:
    """Who is archiving. The route already admits Office; a type with a stricter rule (Staff)
    checks it in its handler."""

    id: uuid.UUID
    role: UserRole


Handler = Callable[[Session, Actor, ArchiveTarget, bool], ArchiveResult]


class ArchiveService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def archive(self, actor: Actor, target: ArchiveTarget) -> ArchiveResult:
        return _HANDLERS[target.type](self._db, actor, target, True)

    def restore(self, actor: Actor, target: ArchiveTarget) -> ArchiveResult:
        return _HANDLERS[target.type](self._db, actor, target, False)


def _set_child(
    db: Session, _actor: Actor, target: ArchiveTarget, is_archiving: bool
) -> ArchiveResult:
    assert isinstance(target, ChildTarget)

    try:
        cancelled = child_service.set_child_archived(
            db,
            child_id=target.id,
            is_archived=is_archiving,
            expected_cancellations=target.expected_cancellations,
        )
    except child_service.ChildNotFound:
        return _not_found(target, CHILD_NOT_FOUND_ERROR)
    except child_service.UpcomingSessionsChanged:
        logger.warning("archive of child %s refused: upcoming sessions changed", target.id)
        return ArchiveResult(
            value=None, error=UPCOMING_SESSIONS_CHANGED_ERROR, status=HTTP_CONFLICT
        )

    outcome = ArchiveOutcome(archived=is_archiving, cancelled_booking_ids=cancelled)

    return ArchiveResult(value=outcome, error=None, status=HTTP_OK)


def _set_guardian(
    db: Session, _actor: Actor, target: ArchiveTarget, is_archiving: bool
) -> ArchiveResult:
    assert isinstance(target, GuardianTarget)

    # Locked before the family is read, but FOR NO KEY UPDATE, not FOR UPDATE: a Booking or link
    # insert takes KEY SHARE on this row through its foreign key *after* locking its Child, so a
    # FOR UPDATE here, waiting on that Child below, would close a deadlock cycle.
    guardian = db.get(
        Guardian, target.id, with_for_update={"key_share": True}, populate_existing=True
    )

    if guardian is None:
        return _not_found(target, CLIENT_NOT_FOUND_ERROR)

    is_real_archive = is_archiving and not guardian.is_archived
    orphans = _children_left_without_guardian(db, guardian.id) if is_real_archive else []
    sessions = _upcoming_session_counts(db, orphans)
    total = sum(sessions.values())

    # The Child rule, summed across the family: any sessions need the admin's count to match.
    if total and target.expected_cancellations != total:
        logger.warning(
            "archive of guardian %s refused: expected %s cancellation(s), found %d",
            guardian.id,
            target.expected_cancellations,
            total,
        )
        return ArchiveResult(
            value=None, error=UPCOMING_SESSIONS_CHANGED_ERROR, status=HTTP_CONFLICT
        )

    guardian.is_archived = is_archiving
    cancelled: list[uuid.UUID] = []
    try:
        for child_id in orphans:
            cancelled += child_service.set_child_archived(
                db, child_id=child_id, is_archived=True, expected_cancellations=sessions[child_id]
            )
    except child_service.UpcomingSessionsChanged:
        # A session started between the count above and the Child's own re-count. The router
        # commits nothing on a refusal, so what this loop already wrote rolls back.
        logger.warning("archive of guardian %s refused: a session started mid-cascade", guardian.id)
        return ArchiveResult(
            value=None, error=UPCOMING_SESSIONS_CHANGED_ERROR, status=HTTP_CONFLICT
        )
    db.flush()

    outcome = ArchiveOutcome(
        archived=is_archiving, cancelled_booking_ids=cancelled, archived_child_ids=orphans
    )

    return ArchiveResult(value=outcome, error=None, status=HTTP_OK)


def _children_left_without_guardian(db: Session, guardian_id: uuid.UUID) -> list[uuid.UUID]:
    """The family's active Children, when this Guardian is its last active one; else none."""
    family = household_service.family_member_ids(db, guardian_id=guardian_id)

    # Locked in id order *before* the other Guardians are read, so two archives racing for a
    # family's last two Guardians serialise here and the second sees the first's flag.
    active_children = list(
        db.scalars(
            select(Child.id)
            .where(Child.id.in_(family.child_ids), Child.is_archived.is_(False))
            .order_by(Child.id)
            .with_for_update()
        )
    )
    has_other_active_guardian = db.scalar(
        select(
            exists().where(
                Guardian.id.in_(family.guardian_ids - {guardian_id}),
                Guardian.is_archived.is_(False),
            )
        )
    )

    return [] if has_other_active_guardian else active_children


def _upcoming_session_counts(db: Session, child_ids: list[uuid.UUID]) -> Counter[uuid.UUID]:
    """Locked `FOR UPDATE`, so none changes status before `set_child_archived` counts it again."""
    statement = (
        select(Booking.child_id)
        .where(Booking.child_id.in_(child_ids), upcoming_live_bookings(clock.business_now()))
        .with_for_update()
    )

    return Counter(db.scalars(statement))


def _set_home(
    db: Session, _actor: Actor, target: ArchiveTarget, is_archiving: bool
) -> ArchiveResult:
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


def _set_subject(
    db: Session, _actor: Actor, target: ArchiveTarget, is_archiving: bool
) -> ArchiveResult:
    subject = db.get(Subject, target.id)

    if subject is None:
        return _not_found(target, SUBJECT_NOT_FOUND_ERROR)

    subject.is_archived = is_archiving
    db.flush()

    return _done(is_archiving)


def _set_staff(
    db: Session, actor: Actor, target: ArchiveTarget, is_archiving: bool
) -> ArchiveResult:
    if actor.role not in ADMIN_ROLES:
        return _forbidden(actor, target, ADMIN_REQUIRED_ERROR)

    try:
        user = lock_writable_user(db, actor_role=actor.role, actor_id=actor.id, user_id=target.id)
    except UserNotFound:
        return _not_found(target, USER_NOT_FOUND_ERROR)
    except RoleNotPermitted:
        return _forbidden(actor, target, DEVELOPER_FORBIDDEN_ERROR)
    except PeerAdminNotPermitted:
        return _forbidden(actor, target, PEER_ADMIN_FORBIDDEN_ERROR)

    if is_archiving and user.id == actor.id:
        return _forbidden(actor, target, SELF_ARCHIVE_FORBIDDEN_ERROR)

    # A repeat call is a no-op: no warning, and nothing revoked a second time.
    if user.is_archived == is_archiving:
        return _done(is_archiving)

    is_confirmed = (
        isinstance(target, StaffTarget) and STAFF_BOOKINGS_WARNING in target.confirm_warnings
    )
    upcoming = [] if not is_archiving or is_confirmed else _upcoming_staff_bookings(db, user.id)

    if upcoming:
        logger.warning(
            "archive of staff %s refused: %d upcoming booking(s) unconfirmed",
            user.id,
            len(upcoming),
        )
        return ArchiveResult(
            value=None,
            error=UNCONFIRMED_WARNINGS_ERROR,
            status=HTTP_CONFLICT,
            extra={"warnings": [_staff_bookings_warning(upcoming)]},
        )

    user.is_archived = is_archiving

    # Restore clears the flag only: what an archive revoked or removed stays that way.
    if is_archiving:
        revoke_all_refresh_tokens_for_user(db, user_id=user.id)
        revoke_links_for_user(db, user_id=user.id, now=datetime.now(UTC))
        remove_all_for_user(db, user_id=user.id)

    db.flush()

    return _done(is_archiving)


def _upcoming_staff_bookings(db: Session, user_id: uuid.UUID) -> list[tuple[Booking, str]]:
    statement = (
        select(Booking, Child.name)
        .join(Child, Child.id == Booking.child_id)
        .where(Booking.user_id == user_id, upcoming_live_bookings(clock.business_now()))
        .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
    )

    return [(booking, child_name) for booking, child_name in db.execute(statement)]


def _staff_bookings_warning(upcoming: list[tuple[Booking, str]]) -> dict[str, object]:
    return {
        "code": STAFF_BOOKINGS_WARNING,
        "message": STAFF_BOOKINGS_WARNING_MESSAGE,
        "bookings": [
            {
                "id": str(booking.id),
                "scheduled_date": booking.scheduled_date.isoformat(),
                "start_time": booking.start_time.isoformat(),
                "end_time": booking.end_time.isoformat(),
                "child_name": child_name,
                "status": booking.status.value,
            }
            for booking, child_name in upcoming
        ],
    }


def _upcoming_booking_ids(db: Session, *, home_id: uuid.UUID) -> list[uuid.UUID]:
    statement = (
        select(Booking.id)
        .where(Booking.home_id == home_id, upcoming_live_bookings(clock.business_now()))
        .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
    )

    return list(db.scalars(statement))


def _done(archived: bool) -> ArchiveResult:
    return ArchiveResult(value=ArchiveOutcome(archived=archived), error=None, status=HTTP_OK)


def _forbidden(actor: Actor, target: ArchiveTarget, message: str) -> ArchiveResult:
    logger.warning(
        "archive/restore of %s %s refused for %s %s: %s",
        target.type,
        target.id,
        actor.role.value,
        actor.id,
        message,
    )

    return ArchiveResult(value=None, error=message, status=HTTP_FORBIDDEN)


def _not_found(target: ArchiveTarget, message: str) -> ArchiveResult:
    logger.warning("archive/restore of %s %s refused: not found", target.type, target.id)

    return ArchiveResult(value=None, error=message, status=HTTP_NOT_FOUND)


_HANDLERS: dict[str, Handler] = {
    "child": _set_child,
    "guardian": _set_guardian,
    "home": _set_home,
    "subject": _set_subject,
    "staff": _set_staff,
}
