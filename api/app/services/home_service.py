"""Homes — added to an existing client and edited (REQ-102). Archive and Restore live in
`archive_service`.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. Every check runs before the first write or assignment, so a refused request changes
nothing — for `add_home` no `homes` row is left without its link.

`add_home` links the new home to that client only. Their children have it from then on, because
a child's homes are its guardians' homes (`home_set`, #214); there is no per-child list to fill.
"""

import uuid

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


class BlankHomeDetails(HomeServiceError):
    """An address or access code that is empty once trimmed."""


def add_home(
    db: Session,
    *,
    client_id: uuid.UUID,
    label: str | None,
    address: str,
    access_code: str,
) -> Home:
    if db.get(Guardian, client_id) is None:
        raise ClientNotFound

    stored_label = _stored_label(label)
    stored_address = _required(address)
    stored_access_code = _required(access_code)

    home = Home(
        label=stored_label,
        address=stored_address,
        access_code=stored_access_code,
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
    access_code: str | None,
) -> Home:
    """`None` leaves a field alone; `label=""` clears the label. Links are never touched."""
    home = db.get(Home, home_id, with_for_update=True)

    if home is None:
        raise HomeNotFound

    stored_address = None if address is None else _required(address)
    stored_access_code = None if access_code is None else _required(access_code)

    if label is not None:
        home.label = _stored_label(label)

    if stored_address is not None:
        home.address = stored_address

    if stored_access_code is not None:
        home.access_code = stored_access_code

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
