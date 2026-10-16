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
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dependencies import ADMIN_REQUIRED_ERROR, ADMIN_ROLES
from app.models.booking import Booking, upcoming_live_bookings
from app.models.child import Child
from app.models.enums import UserRole
from app.models.guardian import Guardian
from app.models.home import Home
from app.models.subject import Subject
from app.schemas.archive import ArchiveTarget, ChildTarget, StaffTarget
from app.services import child_service, clock
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
    guardian = db.get(Guardian, target.id)

    if guardian is None:
        return _not_found(target, CLIENT_NOT_FOUND_ERROR)

    guardian.is_archived = is_archiving
    db.flush()

    return _done(is_archiving)


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
