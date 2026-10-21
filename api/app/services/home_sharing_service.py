"""Shared Homes: create one Home on several Guardians, share it with one more, unshare it.

A couple living together share one Home rather than holding two copies of the address. There is
no family check: the office may link any Guardian, archived ones included (archiving a Guardian
is not unlinking them).

Every write locks the Home row `FOR UPDATE` before it checks anything. That conflicts with the
`FOR SHARE` read `booking_write_service._resolve` takes on the Home before inserting a Booking,
and with `archive_service`'s own `FOR UPDATE`, so a share never lands on a Home archived under
it and an unshare never misses a Booking written beside it (P7C-S).

**Unsharing mirrors the guardian-unlink rule** (`child_service`): it is refused while a Child
of that Guardian would lose the Home — no other Guardian of that Child is on it — and that Child
has an upcoming live Booking there. A Home is never left without a Guardian: archive it instead.

Same transaction contract as the other services: nothing here commits, the router does.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy import exists, select
from sqlalchemy.orm import Session, aliased

from app.models.booking import Booking, upcoming_live_bookings
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.services import clock
from app.services.client_service import CLIENT_NOT_FOUND_ERROR
from app.services.home_service import HOME_NOT_FOUND_ERROR, BlankAddress, home_details

logger = logging.getLogger(__name__)

# The same literal `routers/homes.py` and `routers/client_homes.py` answer with.
BLANK_ADDRESS_ERROR = "address must not be blank"
ARCHIVED_HOME_ERROR = "This home is archived; restore it first"
GUARDIAN_NOT_ON_HOME_ERROR = "This Guardian is not on this home"
LAST_GUARDIAN_ERROR = "A home needs at least one Guardian; archive it instead"
HOME_LOST_WITH_UPCOMING_BOOKINGS_ERROR = (
    "A Child would lose this home while it has upcoming bookings there; cancel or move them first"
)

HTTP_OK = 200
HTTP_CREATED = 201
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409


@dataclass(frozen=True, slots=True)
class HomeResult:
    value: Home | None
    error: str | None
    status: int
    # Fields a refusal's body carries beside `detail`: the Bookings blocking an unshare.
    extra: dict[str, object] = field(default_factory=dict)


class HomeSharingService:
    def __init__(self, db: Session) -> None:
        self._db = db

    def create(
        self,
        *,
        guardian_ids: Sequence[uuid.UUID],
        label: str | None,
        address: str,
        directions: str | None,
    ) -> HomeResult:
        """One Home linked to every listed Guardian; a repeated id links once."""
        wanted = set(guardian_ids)
        known = set(self._db.scalars(select(Guardian.id).where(Guardian.id.in_(wanted))))

        if known != wanted:
            logger.warning("create home refused: unknown guardian(s) %s", wanted - known)
            return _refused(HTTP_NOT_FOUND, CLIENT_NOT_FOUND_ERROR)

        try:
            details = home_details(label=label, address=address, directions=directions)
        except BlankAddress:
            logger.warning("create home refused: blank address")
            return _refused(HTTP_BAD_REQUEST, BLANK_ADDRESS_ERROR)

        home = Home(
            label=details.label,
            address=details.address,
            directions=details.directions,
            is_archived=False,
        )
        self._db.add(home)
        self._db.flush()
        self._db.add_all(
            [GuardianHome(guardian_id=guardian_id, home_id=home.id) for guardian_id in wanted]
        )
        self._db.flush()

        return HomeResult(value=home, error=None, status=HTTP_CREATED)

    def share(self, *, home_id: uuid.UUID, guardian_id: uuid.UUID) -> HomeResult:
        """A Guardian already on the Home is a no-op."""
        home = self._db.get(Home, home_id, with_for_update=True)

        if home is None:
            logger.warning("share home %s refused: home not found", home_id)
            return _refused(HTTP_NOT_FOUND, HOME_NOT_FOUND_ERROR)

        if self._db.get(Guardian, guardian_id) is None:
            logger.warning("share home %s refused: guardian %s not found", home_id, guardian_id)
            return _refused(HTTP_NOT_FOUND, CLIENT_NOT_FOUND_ERROR)

        if home.is_archived:
            logger.warning("share home %s refused: home archived", home_id)
            return _refused(HTTP_CONFLICT, ARCHIVED_HOME_ERROR)

        if self._link(home_id=home_id, guardian_id=guardian_id) is None:
            self._db.add(GuardianHome(guardian_id=guardian_id, home_id=home_id))
            self._db.flush()

        return HomeResult(value=home, error=None, status=HTTP_OK)

    def unshare(self, *, home_id: uuid.UUID, guardian_id: uuid.UUID) -> HomeResult:
        home = self._db.get(Home, home_id, with_for_update=True)

        if home is None:
            logger.warning("unshare home %s refused: home not found", home_id)
            return _refused(HTTP_NOT_FOUND, HOME_NOT_FOUND_ERROR)

        link = self._link(home_id=home_id, guardian_id=guardian_id)

        if link is None:
            logger.warning("unshare home %s refused: guardian %s not on it", home_id, guardian_id)
            return _refused(HTTP_NOT_FOUND, GUARDIAN_NOT_ON_HOME_ERROR)

        other_links = self._db.scalars(
            select(GuardianHome.id).where(
                GuardianHome.home_id == home_id, GuardianHome.guardian_id != guardian_id
            )
        ).first()

        if other_links is None:
            logger.warning("unshare home %s refused: guardian %s is the last", home_id, guardian_id)
            return _refused(HTTP_CONFLICT, LAST_GUARDIAN_ERROR)

        blocking = self._bookings_losing_the_home(home_id=home_id, guardian_id=guardian_id)

        if blocking:
            logger.warning(
                "unshare home %s from guardian %s refused: %d upcoming booking(s)",
                home_id,
                guardian_id,
                len(blocking),
            )
            return HomeResult(
                value=None,
                error=HOME_LOST_WITH_UPCOMING_BOOKINGS_ERROR,
                status=HTTP_CONFLICT,
                extra={"booking_ids": [str(booking_id) for booking_id in blocking]},
            )

        self._db.delete(link)
        self._db.flush()

        return HomeResult(value=home, error=None, status=HTTP_OK)

    def _link(self, *, home_id: uuid.UUID, guardian_id: uuid.UUID) -> GuardianHome | None:
        return self._db.scalars(
            select(GuardianHome).where(
                GuardianHome.home_id == home_id, GuardianHome.guardian_id == guardian_id
            )
        ).first()

    def _bookings_losing_the_home(
        self, *, home_id: uuid.UUID, guardian_id: uuid.UUID
    ) -> list[uuid.UUID]:
        """Upcoming live Bookings at the Home of this Guardian's Children who have no other
        Guardian on it. Archived Homes and Guardians count, as in `child_service`'s rule."""
        other = aliased(ChildGuardian)
        kept_through_another_guardian = exists().where(
            other.child_id == ChildGuardian.child_id,
            other.guardian_id != guardian_id,
            GuardianHome.guardian_id == other.guardian_id,
            GuardianHome.home_id == home_id,
        )
        losing_children = select(ChildGuardian.child_id).where(
            ChildGuardian.guardian_id == guardian_id, ~kept_through_another_guardian
        )

        return list(
            self._db.scalars(
                select(Booking.id)
                .where(
                    Booking.child_id.in_(losing_children),
                    Booking.home_id == home_id,
                    upcoming_live_bookings(clock.business_now()),
                )
                .order_by(Booking.scheduled_date, Booking.start_time, Booking.id)
            ).all()
        )


def _refused(status: int, error: str) -> HomeResult:
    return HomeResult(value=None, error=error, status=status)
