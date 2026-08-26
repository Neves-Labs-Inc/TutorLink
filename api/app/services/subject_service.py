"""Subject CRUD, with the active-tutor count every route in `routers/subjects.py` attaches."""

import uuid
from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.subject import Subject
from app.models.tutor import Tutor, TutorSubject


class SubjectServiceError(Exception):
    pass


class SubjectNotFound(SubjectServiceError):
    pass


class SubjectNameTaken(SubjectServiceError):
    pass


@dataclass(frozen=True)
class SubjectWithCount:
    subject: Subject
    tutor_count: int


def _visible(is_active: bool) -> Select[tuple[Subject]]:
    return select(Subject).where(Subject.is_active.is_(is_active))


def _count_expr() -> Select[tuple[int]]:
    return (
        select(func.count())
        .select_from(TutorSubject)
        .join(Tutor, Tutor.id == TutorSubject.tutor_id)
        .where(TutorSubject.subject_id == Subject.id, Tutor.is_active.is_(True))
        .scalar_subquery()
    )


def _name_taken(db: Session, *, name: str, exclude_id: uuid.UUID | None) -> bool:
    statement = select(Subject.id).where(Subject.name == name)

    if exclude_id is not None:
        statement = statement.where(Subject.id != exclude_id)

    return db.scalars(statement).first() is not None


def list_subjects(
    db: Session, *, is_active: bool, limit: int, offset: int
) -> tuple[list[SubjectWithCount], int]:
    total = db.scalar(select(func.count()).select_from(_visible(is_active).subquery())) or 0
    rows = db.execute(
        select(Subject, _count_expr())
        .where(Subject.is_active.is_(is_active))
        .order_by(Subject.name)
        .limit(limit)
        .offset(offset)
    ).all()

    subjects = [SubjectWithCount(subject=subject, tutor_count=count) for subject, count in rows]

    return subjects, total


def _get_with_count(db: Session, *, subject_id: uuid.UUID) -> SubjectWithCount:
    row = db.execute(select(Subject, _count_expr()).where(Subject.id == subject_id)).first()

    if row is None:
        raise SubjectNotFound

    subject, count = row

    return SubjectWithCount(subject=subject, tutor_count=count)


def create_subject(db: Session, *, name: str, description: str | None) -> SubjectWithCount:
    if _name_taken(db, name=name, exclude_id=None):
        raise SubjectNameTaken

    subject = Subject(name=name, description=description, is_active=True)

    try:
        with db.begin_nested():
            db.add(subject)
            db.flush()
    except IntegrityError as exc:
        raise SubjectNameTaken from exc

    return SubjectWithCount(subject=subject, tutor_count=0)


def update_subject(
    db: Session,
    *,
    subject_id: uuid.UUID,
    name: str | None,
    description: str | None,
    is_active: bool | None,
) -> SubjectWithCount:
    found = _get_with_count(db, subject_id=subject_id)
    subject = found.subject

    if name is not None:
        if _name_taken(db, name=name, exclude_id=subject.id):
            raise SubjectNameTaken

        subject.name = name

    if description is not None:
        subject.description = description

    if is_active is not None:
        subject.is_active = is_active

    try:
        with db.begin_nested():
            db.flush()
    except IntegrityError as exc:
        raise SubjectNameTaken from exc

    return SubjectWithCount(subject=subject, tutor_count=found.tutor_count)


def deactivate_subject(db: Session, *, subject_id: uuid.UUID) -> SubjectWithCount:
    found = _get_with_count(db, subject_id=subject_id)
    found.subject.is_active = False
    db.flush()

    return found
