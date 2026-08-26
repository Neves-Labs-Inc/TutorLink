"""Tutor profile CRUD, the grade-ceiling filter, and the two UNIQUE columns behind it.

Same transaction contract as every other service here: nothing commits, the caller owns the
boundary.

**`tutors` is the one table in this phase where a single insert can violate two independent
constraints** — `UNIQUE (email)` and `UNIQUE (phone_number)` (`0001_initial_schema.py:69-70`).
The pre-checks below identify the field and produce the readable message; the constraint is
what holds under a race, and on that path the failure cannot know which column collided, so it
raises `TutorUniqueViolation` rather than guessing. Matching on the constraint's *name* is not
an option: PostgreSQL keeps a pre-rename name on a migrated database while the test harness's
`create_all` auto-names it, so name matching would pass every test and fail in production.
"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.tutor import Tutor, TutorSubject
from app.services.phone_service import normalize_phone_number

SUBJECTS_LOADED = selectinload(Tutor.tutor_subjects).joinedload(TutorSubject.subject)


class TutorServiceError(Exception):
    """Base class for every failure this module reports."""


class TutorNotFound(TutorServiceError):
    """No tutor with that id."""


class TutorEmailTaken(TutorServiceError):
    """Another tutor already holds that email."""


class TutorPhoneNumberTaken(TutorServiceError):
    """Another tutor already holds that phone number."""


class TutorUniqueViolation(TutorServiceError):
    """A UNIQUE constraint on `tutors` fired; which of the two columns collided is unknown."""


def _matching(
    *,
    is_active: bool,
    tutor_id: uuid.UUID | None,
    subject_id: uuid.UUID | None,
    grade_level: int | None,
) -> Select[tuple[Tutor]]:
    """The filtered tutor query, as `EXISTS` rather than a join.

    `grade_level` is a **ceiling** comparison — `max_grade_level >= grade_level` — so a tutor
    who covers grade 12 qualifies for grade 8. Correlated `EXISTS` and not a `JOIN` because a
    tutor with three qualifying assignments must appear once and `total` must stay a count of
    tutors under every combination of these filters.
    """
    statement = select(Tutor).where(Tutor.is_active.is_(is_active))

    if tutor_id is not None:
        statement = statement.where(Tutor.id == tutor_id)

    if subject_id is not None or grade_level is not None:
        assignment = select(1).select_from(TutorSubject).where(TutorSubject.tutor_id == Tutor.id)

        if subject_id is not None:
            assignment = assignment.where(TutorSubject.subject_id == subject_id)

        if grade_level is not None:
            assignment = assignment.where(TutorSubject.max_grade_level >= grade_level)

        statement = statement.where(assignment.exists())

    return statement


def _email_taken(db: Session, *, email: str, exclude_id: uuid.UUID | None) -> bool:
    statement = select(Tutor.id).where(Tutor.email == email)

    if exclude_id is not None:
        statement = statement.where(Tutor.id != exclude_id)

    return db.scalars(statement).first() is not None


def _phone_number_taken(db: Session, *, phone_number: str, exclude_id: uuid.UUID | None) -> bool:
    statement = select(Tutor.id).where(Tutor.phone_number == phone_number)

    if exclude_id is not None:
        statement = statement.where(Tutor.id != exclude_id)

    return db.scalars(statement).first() is not None


def list_tutors(
    db: Session,
    *,
    is_active: bool,
    tutor_id: uuid.UUID | None,
    subject_id: uuid.UUID | None,
    grade_level: int | None,
    limit: int,
    offset: int,
) -> tuple[list[Tutor], int]:
    """Rows for one page, plus the total matching before paging.

    `tutor_id` is where a request's `ResolvedTutorScope.tutor_id` goes: `None` means every
    tutor, a UUID means that one. It is a filter on `Tutor.id`, not a lookup — an unknown id
    yields an empty page rather than a 404.
    """
    filtered = _matching(
        is_active=is_active, tutor_id=tutor_id, subject_id=subject_id, grade_level=grade_level
    )
    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    tutors = list(
        db.scalars(
            filtered.options(SUBJECTS_LOADED)
            .order_by(Tutor.name, Tutor.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return tutors, total


def get_tutor(db: Session, *, tutor_id: uuid.UUID) -> Tutor:
    """Fetch by id, ignoring `is_active` — a deactivated tutor fetched by id is a 200 (#21)."""
    tutor = db.scalars(select(Tutor).where(Tutor.id == tutor_id).options(SUBJECTS_LOADED)).first()

    if tutor is None:
        raise TutorNotFound

    return tutor


def create_tutor(
    db: Session, *, name: str, email: str, phone_number: str, bio: str | None
) -> Tutor:
    normalized_email = email.strip().lower()
    canonical_phone_number = normalize_phone_number(db, raw=phone_number)

    if _email_taken(db, email=normalized_email, exclude_id=None):
        raise TutorEmailTaken

    if _phone_number_taken(db, phone_number=canonical_phone_number, exclude_id=None):
        raise TutorPhoneNumberTaken

    tutor = Tutor(
        name=name,
        email=normalized_email,
        phone_number=canonical_phone_number,
        bio=bio,
        is_active=True,
    )

    # The savepoint wraps the insert and nothing else, so that unwinding it leaves the Session
    # usable rather than poisoned for everything the request does afterwards.
    try:
        with db.begin_nested():
            db.add(tutor)
            db.flush()
    except IntegrityError as exc:
        raise TutorUniqueViolation from exc

    return tutor


def update_tutor(
    db: Session,
    *,
    tutor_id: uuid.UUID,
    name: str | None,
    email: str | None,
    phone_number: str | None,
    bio: str | None,
    is_active: bool | None,
) -> Tutor:
    """The duplicate checks exclude this tutor, so a `PATCH` echoing back the email or number
    already stored — in any format, since both sides are normalised first — is a no-op on that
    field rather than a conflict with itself.

    The savepoint wraps the edits and the flush, and nothing else, for the reason `create_tutor`
    gives: a value claimed between a pre-check and the write is the constraint's 409, not a 500,
    and unwinding to the savepoint leaves the `Session` usable for the rest of the request.
    """
    tutor = get_tutor(db, tutor_id=tutor_id)
    normalized_email: str | None = None
    canonical_phone_number: str | None = None

    if email is not None:
        normalized_email = email.strip().lower()

        if _email_taken(db, email=normalized_email, exclude_id=tutor.id):
            raise TutorEmailTaken

    if phone_number is not None:
        canonical_phone_number = normalize_phone_number(db, raw=phone_number)

        if _phone_number_taken(db, phone_number=canonical_phone_number, exclude_id=tutor.id):
            raise TutorPhoneNumberTaken

    # The edits are applied *inside* the savepoint because `begin_nested` flushes whatever is
    # already dirty before it emits the SAVEPOINT (`SessionTransaction._take_snapshot`): assigned
    # above the block, the UPDATE would run outside the savepoint and a constraint violation would
    # deactivate the whole request's transaction, leaving the `Session` unusable even though this
    # raises the right error. Nothing in the block but in-memory assignments and the flush, so no
    # other failure can be mislabelled a duplicate. The normalisation above stays outside it: it
    # reads the database and can raise `InvalidPhoneNumber`, which is a 400, not a 409.
    try:
        with db.begin_nested():
            if name is not None:
                tutor.name = name

            if normalized_email is not None:
                tutor.email = normalized_email

            if canonical_phone_number is not None:
                tutor.phone_number = canonical_phone_number

            if bio is not None:
                tutor.bio = bio

            if is_active is not None:
                tutor.is_active = is_active

            db.flush()
    except IntegrityError as exc:
        raise TutorUniqueViolation from exc

    return tutor


def deactivate_tutor(db: Session, *, tutor_id: uuid.UUID) -> Tutor:
    """Soft delete, and nothing more.

    It does not touch `tutor_subjects`, `tutor_availability`, `bookings`, or the tutor's
    `users` row: `tutor_count` on `GET /api/subjects` already accounts for `tutors.is_active`
    (REQ-031.3), and deleting the assignments would make deactivation irreversible.
    """
    tutor = get_tutor(db, tutor_id=tutor_id)
    tutor.is_active = False
    db.flush()

    return tutor
