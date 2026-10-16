"""A Child's Assigned Tutors (#242): the edits, the batched reads, and the removal of a Staff
member's assignments.

Same transaction contract as `child_evaluation_service`: nothing here commits, the caller owns
the boundary. Edits take the child row `FOR UPDATE` first, as every Evaluation write does, so
an edit and a clear-Evaluated on the same Child serialise and the "is Evaluated" check holds
until commit. The assignee's user row is then taken `FOR SHARE`, which waits out an archive or
a role change in flight (`user_service._lock_user` holds `FOR NO KEY UPDATE`): the assignee is
judged on their committed state, so no archived Staff member or Admin is ever assigned.

The rules (spec, "Assigned Tutors"):

- Edits need an Evaluated Child; the first assignments happen at Mark Evaluated.
- Only an active (non-archived) Tutor or Manager can be assigned. Admins and Developers never
  are.
- Assigning someone already assigned is a no-op; removing the last one is allowed.
- Archiving a Staff member or promoting them out of a teaching role deletes all their
  assignments (`remove_all_for_user`); nothing brings them back.
"""

import uuid
from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.child_assigned_tutor import ChildAssignedTutor
from app.models.enums import UserRole
from app.models.user import User
from app.services.tutor_service import PROFILE_ROLES


@dataclass(frozen=True, slots=True)
class AssignedTutor:
    id: uuid.UUID
    name: str
    role: UserRole


@dataclass(frozen=True, slots=True)
class AssignedChild:
    id: uuid.UUID
    name: str


class AssignedTutorError(Exception):
    """Base class for every failure this module reports."""


class ChildNotFound(AssignedTutorError):
    """No child with that id."""


class ChildNotEvaluated(AssignedTutorError):
    """The Child has no Evaluated mark, so its Assigned Tutors can't be edited yet."""


class NotAssignable(AssignedTutorError):
    """The user doesn't exist, is archived, or isn't a Tutor or Manager."""


class NotAssigned(AssignedTutorError):
    """The user isn't one of the Child's Assigned Tutors."""


def assign(
    db: Session, *, child_id: uuid.UUID, user_id: uuid.UUID, by_user_id: uuid.UUID
) -> list[AssignedTutor]:
    """Add the user to the Child's Assigned Tutors; returns the whole list, by name then id."""
    _locked_evaluated_child(db, child_id)
    user = db.get(User, user_id, with_for_update={"read": True}, populate_existing=True)

    if user is None or user.is_archived or user.role not in PROFILE_ROLES:
        raise NotAssignable

    db.execute(
        insert(ChildAssignedTutor)
        .values(child_id=child_id, user_id=user_id, created_by_user_id=by_user_id)
        .on_conflict_do_nothing(index_elements=["child_id", "user_id"])
    )

    return assigned_tutors_by_child(db, child_ids=[child_id])[child_id]


def unassign(db: Session, *, child_id: uuid.UUID, user_id: uuid.UUID) -> None:
    _locked_evaluated_child(db, child_id)
    removed = db.execute(
        delete(ChildAssignedTutor)
        .where(ChildAssignedTutor.child_id == child_id, ChildAssignedTutor.user_id == user_id)
        .returning(ChildAssignedTutor.id)
    ).first()

    if removed is None:
        raise NotAssigned


def remove_all_for_user(db: Session, *, user_id: uuid.UUID) -> None:
    """Every assignment of the user, gone; the caller holds the user row locked."""
    db.execute(delete(ChildAssignedTutor).where(ChildAssignedTutor.user_id == user_id))


def assigned_tutors_by_child(
    db: Session, *, child_ids: Collection[uuid.UUID]
) -> defaultdict[uuid.UUID, list[AssignedTutor]]:
    """One statement for any number of Children; each list by name then id."""
    rows = db.execute(
        select(ChildAssignedTutor.child_id, User.id, User.name, User.role)
        .join(User, User.id == ChildAssignedTutor.user_id)
        .where(ChildAssignedTutor.child_id.in_(child_ids))
        .order_by(User.name, User.id)
    ).all()
    grouped: defaultdict[uuid.UUID, list[AssignedTutor]] = defaultdict(list)

    for child_id, tutor_id, name, role in rows:
        grouped[child_id].append(AssignedTutor(id=tutor_id, name=name, role=role))

    return grouped


def assigned_children_by_user(
    db: Session, *, user_ids: Collection[uuid.UUID]
) -> defaultdict[uuid.UUID, list[AssignedChild]]:
    """One statement for any number of users; each list by Child name then id."""
    rows = db.execute(
        select(ChildAssignedTutor.user_id, Child.id, Child.name)
        .join(Child, Child.id == ChildAssignedTutor.child_id)
        .where(ChildAssignedTutor.user_id.in_(user_ids))
        .order_by(Child.name, Child.id)
    ).all()
    grouped: defaultdict[uuid.UUID, list[AssignedChild]] = defaultdict(list)

    for user_id, child_id, name in rows:
        grouped[user_id].append(AssignedChild(id=child_id, name=name))

    return grouped


def _locked_evaluated_child(db: Session, child_id: uuid.UUID) -> Child:
    child = db.get(Child, child_id, with_for_update=True, populate_existing=True)

    if child is None:
        raise ChildNotFound

    if child.evaluated_at is None:
        raise ChildNotEvaluated

    return child
