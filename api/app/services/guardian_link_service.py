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

`home_ids` becomes `guardian_homes` rows only. It never touches `child_homes`, and it does not
limit where this guardian may book the child (P7B-D). Linking to an inactive child is allowed.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, GuardianHome, Home
from app.services.child_service import ChildNotFound
from app.services.client_service import create_client


@dataclass(frozen=True, slots=True)
class GuardianInput:
    name: str
    phone_number: str


class GuardianLinkServiceError(Exception):
    """Base class for every failure this module reports."""


class GuardianChoiceInvalid(GuardianLinkServiceError):
    """Both or neither of an existing guardian and a new one."""


class HomesNotOfChild(GuardianLinkServiceError):
    """A home id that is not an active home of the child."""


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
    db.expire(child, ["guardian_links", "home_links"])

    return child


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
    active = set(
        db.scalars(
            select(ChildHome.home_id)
            .join(Home, Home.id == ChildHome.home_id)
            .where(ChildHome.child_id == child_id, Home.is_active.is_(True))
        ).all()
    )

    if not wanted <= active:
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
