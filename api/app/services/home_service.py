"""Homes — added to an existing client and edited (REQ-102). Archive and Restore live in
`archive_service`.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. Every check runs before the first write or assignment, so a refused request changes
nothing — for `add_home` no `homes` row is left without its link.

`add_home` links the new home to that client only. Their children have it from then on, because
a child's homes are its guardians' homes (`home_set`, #214); there is no per-child list to fill.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.guardian import Guardian
from app.models.home import GuardianHome, Home

HOME_NOT_FOUND_ERROR = "Home not found"


class HomeServiceError(Exception):
    """Base class for every failure this module reports."""


class ClientNotFound(HomeServiceError):
    """No guardian with that id."""


class HomeNotFound(HomeServiceError):
    """No home with that id."""


class BlankAddress(HomeServiceError):
    """An address that is empty once trimmed."""


@dataclass(frozen=True, slots=True)
class HomeDetails:
    """A Home's fields as stored: trimmed, with a blank label or directions as `None`."""

    label: str | None
    address: str
    directions: str | None


def home_details(*, label: str | None, address: str, directions: str | None) -> HomeDetails:
    """Raises `BlankAddress` when the address is empty once trimmed."""
    return HomeDetails(
        label=_optional(label), address=_required(address), directions=_optional(directions)
    )


def add_home(
    db: Session,
    *,
    client_id: uuid.UUID,
    label: str | None,
    address: str,
    directions: str | None,
) -> Home:
    if db.get(Guardian, client_id) is None:
        raise ClientNotFound

    details = home_details(label=label, address=address, directions=directions)
    home = Home(
        label=details.label,
        address=details.address,
        directions=details.directions,
        is_archived=False,
    )
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=client_id, home_id=home.id))
    db.flush()

    return home


def update_home(
    db: Session,
    *,
    home_id: uuid.UUID,
    label: str | None,
    address: str | None,
    directions: str | None,
) -> Home:
    """`None` leaves a field alone; `""` clears the label or the directions. Links are never
    touched."""
    home = db.get(Home, home_id, with_for_update=True)

    if home is None:
        raise HomeNotFound

    stored_address = None if address is None else _required(address)

    if label is not None:
        home.label = _optional(label)

    if stored_address is not None:
        home.address = stored_address

    if directions is not None:
        home.directions = _optional(directions)

    db.flush()

    return home


def _optional(value: str | None) -> str | None:
    trimmed = "" if value is None else value.strip()

    return trimmed or None


def _required(value: str) -> str:
    trimmed = value.strip()

    if not trimmed:
        raise BlankAddress

    return trimmed
