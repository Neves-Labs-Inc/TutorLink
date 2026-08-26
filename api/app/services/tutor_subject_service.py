"""Assigning and removing which subjects a tutor teaches, and at what grade ceiling.

The junction row is hard-deleted rather than soft-deleted: unlike a tutor or a subject,
an assignment carries no `is_active` of its own.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject


class TutorSubjectServiceError(Exception):
    """Base class for every failure this module reports."""


class TutorNotFound(TutorSubjectServiceError):
    """No tutor with that id."""


class SubjectNotFound(TutorSubjectServiceError):
    """No subject with that id."""


class AssignmentExists(TutorSubjectServiceError):
    """This tutor already teaches this subject."""


class AssignmentNotFound(TutorSubjectServiceError):
    """This tutor does not teach this subject."""


def assign_subject(
    db: Session, *, tutor_id: uuid.UUID, subject_id: uuid.UUID, max_grade_level: int
) -> TutorSubject:
    if db.get(Tutor, tutor_id) is None:
        raise TutorNotFound

    if db.get(Subject, subject_id) is None:
        raise SubjectNotFound

    if _assignment_exists(db, tutor_id=tutor_id, subject_id=subject_id):
        raise AssignmentExists

    assignment = TutorSubject(
        tutor_id=tutor_id, subject_id=subject_id, max_grade_level=max_grade_level
    )

    try:
        with db.begin_nested():
            db.add(assignment)
            db.flush()
    except IntegrityError as exc:
        raise AssignmentExists from exc

    return assignment


def remove_subject(db: Session, *, tutor_id: uuid.UUID, subject_id: uuid.UUID) -> None:
    if db.get(Tutor, tutor_id) is None:
        raise TutorNotFound

    assignment = db.scalars(
        select(TutorSubject).where(
            TutorSubject.tutor_id == tutor_id, TutorSubject.subject_id == subject_id
        )
    ).first()

    if assignment is None:
        raise AssignmentNotFound

    db.delete(assignment)
    db.flush()


def _assignment_exists(db: Session, *, tutor_id: uuid.UUID, subject_id: uuid.UUID) -> bool:
    statement = select(TutorSubject.id).where(
        TutorSubject.tutor_id == tutor_id, TutorSubject.subject_id == subject_id
    )

    return db.scalars(statement).first() is not None
