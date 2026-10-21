"""Linking another guardian to an existing child — REQ-103, how an admin fulfils a
`guardian_link_request` flag.

A module of its own rather than a function in `child_service` (P7B-E): the nested-guardian path
reuses `client_service.create_client`, and keeping the flow here is what stops `child_service`
and `client_service` from ever needing to import each other.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. Every check that needs no write — the child, the exactly-one rule, the homes, the
existing guardian and its link — runs before the first insert, so a refusal writes nothing. The
nested guardian goes through `create_client(home=None)` and is never an upsert:
`PhoneNumberTaken` and `InvalidPhoneNumber` travel through this module unchanged.

`home_ids` shares existing homes with the new guardian as `guardian_homes` rows. Each must be one
of the child's bookable homes (`home_set`), so it can never widen the child's home set, and it
does not limit where this guardian may book the child (P7B-D). Linking to an inactive child is
allowed.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome
from app.services.child_service import ChildNotFound
from app.services.client_service import ClientDetail, HomeInput, create_client, get_client
from app.services.home_set import child_home_ids


@dataclass(frozen=True, slots=True)
class GuardianInput:
    name: str
    phone_number: str


class GuardianLinkServiceError(Exception):
    """Base class for every failure this module reports."""


class GuardianChoiceInvalid(GuardianLinkServiceError):
    """Both or neither of an existing guardian and a new one."""


class HomesNotOfChild(GuardianLinkServiceError):
    """A home id that is not one of the child's bookable homes."""


class GuardianNotFound(GuardianLinkServiceError):
    """No guardian with that id."""


class AlreadyLinked(GuardianLinkServiceError):
    """The guardian already holds a `child_guardians` row for this child."""


def link_guardian(
    db: Session,
    *,
    child_id: uuid.UUID,
    guardian_id: uuid.UUID | None,
    new_guardian: GuardianInput | None,
    home_ids: Sequence[uuid.UUID],
) -> Child:
    child = db.get(Child, child_id)

    if child is None:
        raise ChildNotFound

    choice = _guardian_choice(guardian_id=guardian_id, new_guardian=new_guardian)
    homes = _validated_home_ids(db, child_id=child.id, requested=home_ids)

    if isinstance(choice, GuardianInput):
        guardian = create_client(
            db, name=choice.name, phone_number=choice.phone_number, home=None
        ).client
    else:
        guardian = _linkable_guardian(db, child_id=child.id, guardian_id=choice)

    # The savepoint wraps the link insert and nothing else, the shape `client_service`'s
    # `create_client` uses: a concurrent duplicate that passed the pre-check above is the
    # constraint's 409 rather than a 500, and unwinding to the savepoint keeps the `Session`
    # usable. Never match on the constraint's name.
    try:
        with db.begin_nested():
            db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
            db.flush()
    except IntegrityError as exc:
        raise AlreadyLinked from exc

    held = set(
        db.scalars(
            select(GuardianHome.home_id).where(
                GuardianHome.guardian_id == guardian.id, GuardianHome.home_id.in_(homes)
            )
        ).all()
    )

    for home_id in homes - held:
        db.add(GuardianHome(guardian_id=guardian.id, home_id=home_id))

    db.flush()
    db.expire(child, ["guardian_links"])

    return child


def create_guardian_in_family(
    db: Session,
    *,
    name: str,
    phone_number: str,
    home: HomeInput | None,
    child_ids: Sequence[uuid.UUID],
    home_ids: Sequence[uuid.UUID],
) -> ClientDetail:
    """Create a Guardian already linked to `child_ids` and sharing `home_ids`, in one go.

    No same-family check: choosing Children of two families merges them. Every check that needs
    no write runs before `create_client`, so a refusal writes nothing.
    """
    wanted_children = set(child_ids)
    found = set(db.scalars(select(Child.id).where(Child.id.in_(wanted_children))).all())

    if found != wanted_children:
        raise ChildNotFound

    wanted_homes = set(home_ids)
    bookable: set[uuid.UUID] = set()
    for child_id in wanted_children:
        bookable |= set(db.scalars(child_home_ids(child_id, include_archived=False)).all())

    if not wanted_homes <= bookable:
        raise HomesNotOfChild

    created = create_client(db, name=name, phone_number=phone_number, home=home)

    for child_id in wanted_children:
        db.add(ChildGuardian(child_id=child_id, guardian_id=created.client.id))

    for home_id in wanted_homes:
        db.add(GuardianHome(guardian_id=created.client.id, home_id=home_id))

    db.flush()

    return get_client(db, client_id=created.client.id)


def _guardian_choice(
    *, guardian_id: uuid.UUID | None, new_guardian: GuardianInput | None
) -> uuid.UUID | GuardianInput:
    if guardian_id is not None and new_guardian is None:
        choice: uuid.UUID | GuardianInput = guardian_id
    elif guardian_id is None and new_guardian is not None:
        choice = new_guardian
    else:
        raise GuardianChoiceInvalid

    return choice


def _validated_home_ids(
    db: Session, *, child_id: uuid.UUID, requested: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    wanted = set(requested)
    bookable = set(db.scalars(child_home_ids(child_id, include_archived=False)).all())

    if not wanted <= bookable:
        raise HomesNotOfChild

    return wanted


def _linkable_guardian(db: Session, *, child_id: uuid.UUID, guardian_id: uuid.UUID) -> Guardian:
    guardian = db.get(Guardian, guardian_id)

    if guardian is None:
        raise GuardianNotFound

    linked = db.scalars(
        select(ChildGuardian.id).where(
            ChildGuardian.child_id == child_id, ChildGuardian.guardian_id == guardian.id
        )
    ).first()

    if linked is not None:
        raise AlreadyLinked

    return guardian
