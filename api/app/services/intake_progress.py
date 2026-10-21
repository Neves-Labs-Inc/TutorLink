"""How far a chat's intake has got: does it have a named Guardian, a Home and a Child.

Derived on read, with no storage of its own (spec §8 "Derived"): the office's "Intake in
progress" badge and the agent's snapshot both ask this one module. A thread is in progress when
no Guardian owns it, or its Guardian has no Home or no Child. Ownership is
`conversation_service.owner_id`, so a Guardian who has left the thread's number counts as no
Guardian. An archived Child or Home still counts: intake is about what was collected, not what
is active today.

Nothing here commits.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.guardian import ChildGuardian
from app.models.home import GuardianHome
from app.services import conversation_service

MISSING_GUARDIAN_NAME = "guardian_name"
MISSING_HOME = "home"
MISSING_CHILD = "child"


@dataclass(frozen=True, slots=True)
class IntakeProgress:
    in_progress: bool
    # A subset of ("guardian_name", "home", "child"), in that order.
    missing: tuple[str, ...]


def intake_progress(db: Session, *, conversation: Conversation) -> IntakeProgress:
    """What this one thread still lacks. With no owning Guardian, all three are missing."""
    owner = conversation_service.owner_id(db, conversation=conversation)

    if owner is None:
        return _progress(has_guardian=False, has_home=False, has_child=False)

    return _progress(
        has_guardian=True,
        has_home=owner in _guardians_with_home(db, [owner]),
        has_child=owner in _guardians_with_child(db, [owner]),
    )


def intake_in_progress_for(
    db: Session, conversation_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, bool]:
    """`in_progress` for each thread, in a fixed number of queries however many are asked."""
    if not conversation_ids:
        return {}

    owners = conversation_service.owner_ids(db, conversation_ids=conversation_ids)
    guardian_ids = [owner for owner in owners.values() if owner is not None]
    with_home = _guardians_with_home(db, guardian_ids)
    with_child = _guardians_with_child(db, guardian_ids)

    return {
        conversation_id: owner is None or owner not in with_home or owner not in with_child
        for conversation_id, owner in owners.items()
    }


def _progress(*, has_guardian: bool, has_home: bool, has_child: bool) -> IntakeProgress:
    missing = tuple(
        name
        for name, is_present in (
            (MISSING_GUARDIAN_NAME, has_guardian),
            (MISSING_HOME, has_home),
            (MISSING_CHILD, has_child),
        )
        if not is_present
    )

    return IntakeProgress(in_progress=bool(missing), missing=missing)


def _guardians_with_home(db: Session, guardian_ids: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    return set(
        db.scalars(
            select(GuardianHome.guardian_id).where(GuardianHome.guardian_id.in_(guardian_ids))
        )
    )


def _guardians_with_child(db: Session, guardian_ids: Sequence[uuid.UUID]) -> set[uuid.UUID]:
    return set(
        db.scalars(
            select(ChildGuardian.guardian_id).where(ChildGuardian.guardian_id.in_(guardian_ids))
        )
    )
