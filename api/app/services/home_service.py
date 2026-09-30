"""Homes — added to an existing client, edited, deactivated and reactivated (REQ-102).

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. Every check runs before the first write or assignment, so a refused request changes
nothing — for `add_home` no `homes` row is left without its links, and for `update_home` a
409 on deactivation leaves the other fields in the same body unapplied too (A-49).

`child_ids` must name children linked to this client through `child_guardians`; an inactive
child qualifies, because a home can be prepared before a child returns (07C A2 delta 3).
Repeats collapse rather than tripping the `child_homes` UNIQUE constraint.

"Upcoming" is `upcoming_live_bookings(now)` — the phase's one definition (P7C-T) — with `now`
read through `_now()` in naive UTC so a test can freeze it. A booking earlier today that has
not been marked completed does not block deactivation; one later today does.

**The deactivation check locks the home row first.** `update_home` loads it `FOR UPDATE`, which
conflicts with the `FOR SHARE` read `booking_write_service._resolve` takes on the home before
it inserts a booking against it (P7C-S). Whichever gets there first makes the other wait: a
booking read first keeps this refusing until it commits and this then sees the booking; a
deactivation locked first keeps the booking write waiting and it then sees the home inactive.
"""

import datetime
import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.booking import Booking, upcoming_live_bookings
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home


class HomeServiceError(Exception):
    """Base class for every failure this module reports."""


class ClientNotFound(HomeServiceError):
    """No guardian with that id."""


class HomeNotFound(HomeServiceError):
    """No home with that id."""


class BlankHomeDetails(HomeServiceError):
    """An address or access code that is empty once trimmed."""


class ChildNotLinked(HomeServiceError):
    """A `child_ids` entry that is not a child linked to this client."""


class HomeHasUpcomingBookings(HomeServiceError):
    """Deactivation refused: a live booking at this home starts after now."""


def add_home(
    db: Session,
    *,
    client_id: uuid.UUID,
    label: str | None,
    address: str,
    access_code: str,
    child_ids: Sequence[uuid.UUID],
) -> Home:
    if db.get(Guardian, client_id) is None:
        raise ClientNotFound

    stored_label = _stored_label(label)
    stored_address = _required(address)
    stored_access_code = _required(access_code)
    children = _linked_child_ids(db, client_id=client_id, requested=child_ids)

    home = Home(
        label=stored_label,
        address=stored_address,
        access_code=stored_access_code,
        is_active=True,
    )
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=client_id, home_id=home.id))
    db.add_all([ChildHome(child_id=child_id, home_id=home.id) for child_id in children])
    db.flush()

    return home


def update_home(
    db: Session,
    *,
    home_id: uuid.UUID,
    label: str | None,
    address: str | None,
    access_code: str | None,
    is_active: bool | None,
) -> Home:
    """`None` leaves a field alone; `label=""` clears the label. Links are never touched."""
    home = db.get(Home, home_id, with_for_update=True)

    if home is None:
        raise HomeNotFound

    stored_address = None if address is None else _required(address)
    stored_access_code = None if access_code is None else _required(access_code)

    if is_active is False and _has_upcoming_bookings(db, home_id=home.id):
        raise HomeHasUpcomingBookings

    if label is not None:
        home.label = _stored_label(label)

    if stored_address is not None:
        home.address = stored_address

    if stored_access_code is not None:
        home.access_code = stored_access_code

    if is_active is not None:
        home.is_active = is_active

    db.flush()

    return home


def _stored_label(label: str | None) -> str | None:
    trimmed = "" if label is None else label.strip()

    return trimmed or None


def _required(value: str) -> str:
    trimmed = value.strip()

    if not trimmed:
        raise BlankHomeDetails

    return trimmed


def _linked_child_ids(
    db: Session, *, client_id: uuid.UUID, requested: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    wanted = set(requested)
    linked = set(
        db.scalars(
            select(ChildGuardian.child_id).where(
                ChildGuardian.guardian_id == client_id, ChildGuardian.child_id.in_(wanted)
            )
        ).all()
    )

    if linked != wanted:
        raise ChildNotLinked

    return wanted


def _has_upcoming_bookings(db: Session, *, home_id: uuid.UUID) -> bool:
    statement = select(Booking.id).where(Booking.home_id == home_id, upcoming_live_bookings(_now()))

    return db.scalars(statement.limit(1)).first() is not None


def _now() -> datetime.datetime:
    return datetime.datetime.now(tz=datetime.UTC).replace(tzinfo=None)
