"""A Child's Subject levels and its Evaluated mark: the writes behind the child screen.

Same transaction contract as `child_service`: nothing here commits, the caller owns the
boundary. Every write takes the child row `FOR UPDATE` first (the lock order is conversation
→ child → bookings, P7C-S), so a level removal and a mark-Evaluated on the same Child
serialise. Without it, "has at least one level" and "is not the last level" could each be read
true by two concurrent requests and leave an Evaluated Child with no level. The same lock is
what makes the level upsert safe against two concurrent `PUT`s on one Child and subject.

The rules (spec, "Evaluation, levels and matching"):

- Marking Evaluated needs at least one level; marking an already-Evaluated Child keeps the
  original who and when.
- Clearing Evaluated sets both columns NULL and keeps the levels.
- Removing the last level of an Evaluated Child is refused.
- An inactive subject gets no new level, but an existing row on one can still be edited or
  removed: the rows outlive the subject's deactivation.
"""

import datetime
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.child_subject_level import ChildSubjectLevel
from app.models.subject import Subject


class ChildEvaluationError(Exception):
    """Base class for every failure this module reports."""


class ChildNotFound(ChildEvaluationError):
    """No child with that id."""


class SubjectNotFound(ChildEvaluationError):
    """No subject with that id."""


class SubjectInactive(ChildEvaluationError):
    """A new level for a subject that has been deactivated."""


class LevelNotFound(ChildEvaluationError):
    """The Child has no level for that subject."""


class LastLevelOfEvaluatedChild(ChildEvaluationError):
    """Removing this level would leave an Evaluated Child with none."""


class NoLevelsToEvaluate(ChildEvaluationError):
    """Marking Evaluated a Child that has no level yet."""


def set_level(
    db: Session,
    *,
    child_id: uuid.UUID,
    subject_id: uuid.UUID,
    level: int,
    set_by_user_id: uuid.UUID,
) -> ChildSubjectLevel:
    """Create or replace the Child's level for the subject; the caller becomes its setter."""
    _locked_child(db, child_id)
    subject = db.get(Subject, subject_id)

    if subject is None:
        raise SubjectNotFound

    row = _level_row(db, child_id=child_id, subject_id=subject_id)

    if row is None and not subject.is_active:
        raise SubjectInactive

    if row is None:
        row = ChildSubjectLevel(
            child_id=child_id, subject_id=subject_id, level=level, set_by_user_id=set_by_user_id
        )
        db.add(row)
    else:
        row.level = level
        row.set_by_user_id = set_by_user_id

    db.flush()
    # Loads the server-set timestamps the response reads.
    db.refresh(row)

    return row


def remove_level(db: Session, *, child_id: uuid.UUID, subject_id: uuid.UUID) -> None:
    child = _locked_child(db, child_id)
    row = _level_row(db, child_id=child_id, subject_id=subject_id)

    if row is None:
        raise LevelNotFound

    if child.evaluated_at is not None and _level_count(db, child_id=child_id) == 1:
        raise LastLevelOfEvaluatedChild

    db.delete(row)
    db.flush()


def mark_evaluated(
    db: Session, *, child_id: uuid.UUID, by_user_id: uuid.UUID, now: datetime.datetime
) -> Child:
    """A no-op on an already-Evaluated Child, so the original who and when stay."""
    child = _locked_child(db, child_id)

    if child.evaluated_at is None:
        if _level_count(db, child_id=child_id) == 0:
            raise NoLevelsToEvaluate

        child.evaluated_at = now
        child.evaluated_by_user_id = by_user_id
        _flush_evaluated(db, child)

    return child


def clear_evaluated(db: Session, *, child_id: uuid.UUID) -> Child:
    child = _locked_child(db, child_id)
    child.evaluated_at = None
    child.evaluated_by_user_id = None
    _flush_evaluated(db, child)

    return child


def _locked_child(db: Session, child_id: uuid.UUID) -> Child:
    child = db.get(Child, child_id, with_for_update=True, populate_existing=True)

    if child is None:
        raise ChildNotFound

    return child


def _flush_evaluated(db: Session, child: Child) -> None:
    """The FK was written directly, so the cached `evaluated_by` the response reads is stale."""
    db.flush()
    db.expire(child, ["evaluated_by"])


def _level_row(
    db: Session, *, child_id: uuid.UUID, subject_id: uuid.UUID
) -> ChildSubjectLevel | None:
    return db.scalars(
        select(ChildSubjectLevel).where(
            ChildSubjectLevel.child_id == child_id, ChildSubjectLevel.subject_id == subject_id
        )
    ).first()


def _level_count(db: Session, *, child_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(ChildSubjectLevel)
            .where(ChildSubjectLevel.child_id == child_id)
        )
        or 0
    )
