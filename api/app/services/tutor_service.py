"""Tutor profile CRUD, the grade-ceiling filter, and the two UNIQUE columns behind it.

Same transaction contract as every other service here: nothing commits, the caller owns the
boundary.

**A profile is half of a person.** `tutors` holds what only a Tutor or Manager has — phone,
bio, the subject assignments — and hangs off the `users` row that holds the name, the email
and whether the person is active. `create_tutor` writes both rows for the Tutors page, where
the person has no login yet (`hashed_password` NULL); `create_profile` writes the profile for
a user `user_service` is creating with a password. Either way the two inserts share one
savepoint, so a refused request leaves no half-person behind.

**One insert can violate two independent constraints** — `UNIQUE (users.email)` and
`UNIQUE (tutors.phone_number)`. The pre-checks below identify the field and produce the
readable message; the constraint is what holds under a race, and on that path the failure
cannot know which column collided, so it raises `TutorUniqueViolation` rather than guessing.
Matching on the constraint's *name* is not an option: PostgreSQL keeps a pre-rename name on a
migrated database while the test harness's `create_all` auto-names it, so name matching would
pass every test and fail in production.
"""

import uuid
from datetime import datetime

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models.child_subject_level import ChildSubjectLevel
from app.models.enums import UserRole
from app.models.tutor import Tutor, TutorSubject
from app.models.user import User
from app.services.name_rules import normalize_name
from app.services.password_link_service import revoke_links_for_user
from app.services.phone_service import normalize_phone_number

# The roles that carry a teaching profile, and the only ones the bot offers (#130).
PROFILE_ROLES = frozenset({UserRole.TUTOR, UserRole.MANAGER})

SUBJECTS_LOADED = selectinload(Tutor.tutor_subjects).joinedload(TutorSubject.subject)
USER_LOADED = joinedload(Tutor.user)

_LIKE_ESCAPE = "\\"
_LIKE_WILDCARDS = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


class TutorServiceError(Exception):
    """Base class for every failure this module reports."""


class TutorNotFound(TutorServiceError):
    """No tutor with that id."""


class TutorEmailTaken(TutorServiceError):
    """Another user already holds that email."""


class TutorPhoneNumberTaken(TutorServiceError):
    """Another tutor already holds that phone number."""


class TutorUniqueViolation(TutorServiceError):
    """A UNIQUE constraint fired on the write; which of the two columns collided is unknown."""


class TutorAccountForbidden(TutorServiceError):
    """The actor may not write this person's account through their profile, or a Manager
    tried to change a login email."""


def assert_may_write_person(*, actor_role: UserRole, tutor: Tutor) -> None:
    """The profile's person is also a login, so editing a profile edits an account.

    `/api/users` is admin-only and keeps Developers out of an Admin's reach; this is the same
    boundary seen from the Tutors page. A Manager may write Tutors and nobody else (not a peer
    Manager, not an Admin or Developer who kept a profile after promotion); an Admin may write
    anyone but a Developer; a Developer may write anyone.

    A login email is narrower still: it is an Admin's to change (answers 04 #11), which
    `update_tutor` checks on top of this, since the address a password link goes to is the
    account.
    """
    target = tutor.user.role

    if actor_role is UserRole.MANAGER and target is not UserRole.TUTOR:
        raise TutorAccountForbidden

    if target is UserRole.DEVELOPER and actor_role is not UserRole.DEVELOPER:
        raise TutorAccountForbidden


def matching_tutors(
    *,
    is_active: bool,
    tutor_id: uuid.UUID | None,
    subject_id: uuid.UUID | None,
    grade_level: int | None,
    q: str | None = None,
    child_id: uuid.UUID | None = None,
) -> Select[tuple[Tutor]]:
    """The filtered tutor query, as `EXISTS` rather than a join.

    `is_active` and `q` are the person's: the query joins `users`, since `tutors.is_active`
    decides nothing (#130) and the name lives on the user.

    `grade_level` is a **ceiling** comparison — `max_grade_level >= grade_level` — so a tutor
    who covers grade 12 qualifies for grade 8. Correlated `EXISTS` and not a `JOIN` because a
    tutor with three qualifying assignments must appear once and `total` must stay a count of
    tutors under every combination of these filters.

    `child_id` is the same ceiling comparison against that Child's Subject level for the
    assignment's subject (an inner match, so a subject with no level qualifies no one), the
    rule `slot_service` matches the bot's tutors by.

    `q` is a case-insensitive substring of the name; blank means no filter.

    Public: `stats_service` is its second consumer, per CONSTITUTION §11.
    """
    statement = (
        select(Tutor).join(User, User.id == Tutor.user_id).where(User.is_active.is_(is_active))
    )
    pattern = _substring_pattern(q)

    if tutor_id is not None:
        statement = statement.where(Tutor.id == tutor_id)

    if pattern is not None:
        statement = statement.where(User.name.ilike(pattern, escape=_LIKE_ESCAPE))

    if subject_id is not None or grade_level is not None or child_id is not None:
        assignment = select(1).select_from(TutorSubject).where(TutorSubject.tutor_id == Tutor.id)

        if subject_id is not None:
            assignment = assignment.where(TutorSubject.subject_id == subject_id)

        if grade_level is not None:
            assignment = assignment.where(TutorSubject.max_grade_level >= grade_level)

        if child_id is not None:
            assignment = assignment.join(
                ChildSubjectLevel,
                (ChildSubjectLevel.subject_id == TutorSubject.subject_id)
                & (ChildSubjectLevel.child_id == child_id),
            ).where(TutorSubject.max_grade_level >= ChildSubjectLevel.level)

        statement = statement.where(assignment.exists())

    return statement


def _substring_pattern(raw: str | None) -> str | None:
    trimmed = "" if raw is None else raw.strip()

    if not trimmed:
        pattern = None
    else:
        pattern = f"%{trimmed.translate(_LIKE_WILDCARDS)}%"

    return pattern


def _email_taken(db: Session, *, email: str, exclude_user_id: uuid.UUID | None) -> bool:
    statement = select(User.id).where(User.email == email)

    if exclude_user_id is not None:
        statement = statement.where(User.id != exclude_user_id)

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
    q: str | None = None,
    child_id: uuid.UUID | None = None,
) -> tuple[list[Tutor], int]:
    """Rows for one page, plus the total matching before paging.

    `tutor_id` is where a request's `ResolvedTutorScope.tutor_id` goes: `None` means every
    tutor, a UUID means that one. It is a filter on `Tutor.id`, not a lookup — an unknown id
    yields an empty page rather than a 404.
    """
    filtered = matching_tutors(
        is_active=is_active,
        tutor_id=tutor_id,
        subject_id=subject_id,
        grade_level=grade_level,
        q=q,
        child_id=child_id,
    )
    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    tutors = list(
        db.scalars(
            filtered.options(SUBJECTS_LOADED, USER_LOADED)
            .order_by(User.name, Tutor.id)
            .limit(limit)
            .offset(offset)
        ).all()
    )

    return tutors, total


def get_tutor(db: Session, *, tutor_id: uuid.UUID) -> Tutor:
    """Fetch by id, ignoring `is_active` — a deactivated tutor fetched by id is a 200 (#21)."""
    tutor = db.scalars(
        select(Tutor).where(Tutor.id == tutor_id).options(SUBJECTS_LOADED, USER_LOADED)
    ).first()

    if tutor is None:
        raise TutorNotFound

    return tutor


def create_tutor(
    db: Session, *, name: str, email: str, phone_number: str, bio: str | None
) -> Tutor:
    """A Tutor the office is adding: a `tutor` user who cannot sign in yet, and their profile."""
    normalized_email = email.strip().lower()
    cleaned_name = normalize_name(name)

    if _email_taken(db, email=normalized_email, exclude_user_id=None):
        raise TutorEmailTaken

    user = User(
        email=normalized_email,
        name=cleaned_name,
        name_is_default=False,
        hashed_password=None,
        role=UserRole.TUTOR,
        is_active=True,
    )

    return create_profile(db, user=user, phone_number=phone_number, bio=bio)


def create_profile(db: Session, *, user: User, phone_number: str, bio: str | None) -> Tutor:
    """The profile for `user`, a row the caller built and has not added: both are written here,
    inside one savepoint, after the phone number is checked.

    The caller has already claimed the email. `create_user` checks it against `users` before it
    ever reaches this function, and `create_tutor` does the same above.
    """
    canonical_phone_number = normalize_phone_number(db, raw=phone_number)

    if _phone_number_taken(db, phone_number=canonical_phone_number, exclude_id=None):
        raise TutorPhoneNumberTaken

    tutor = Tutor(user=user, phone_number=canonical_phone_number, bio=bio, is_active=True)

    # The savepoint wraps the inserts and nothing else, so that unwinding it leaves the Session
    # usable rather than poisoned for everything the request does afterwards.
    try:
        with db.begin_nested():
            db.add(user)
            db.add(tutor)
            db.flush()
    except IntegrityError as exc:
        raise TutorUniqueViolation from exc

    return tutor


def update_tutor(
    db: Session,
    *,
    actor_role: UserRole,
    tutor_id: uuid.UUID,
    name: str | None,
    email: str | None,
    phone_number: str | None,
    bio: str | None,
    is_active: bool | None,
    now: datetime,
) -> Tutor:
    """`name`, `email` and `is_active` are the person's and are written to the user; a chosen
    name clears `name_is_default`. `phone_number` and `bio` are the profile's. The actor must
    be allowed to write this person (`assert_may_write_person`), checked before any edit.

    A login email is an Admin's to change: a Manager sending a *different* `email` is refused
    (`TutorAccountForbidden`), even for a Tutor, so a Manager cannot point a login at an
    address they control. Echoing the stored address back, in any casing, is not a change: the
    dashboard form always sends it. Changing the address revokes every live password link the
    person holds, dated `now`, since each was sent to the old one.

    The duplicate checks exclude this person, so a `PATCH` echoing back the email or number
    already stored — in any format, since both sides are normalised first — is a no-op on that
    field rather than a conflict with itself.

    The savepoint wraps the edits and the flush, and nothing else, for the reason `create_profile`
    gives: a value claimed between a pre-check and the write is the constraint's 409, not a 500,
    and unwinding to the savepoint leaves the `Session` usable for the rest of the request.
    """
    tutor = get_tutor(db, tutor_id=tutor_id)
    assert_may_write_person(actor_role=actor_role, tutor=tutor)
    normalized_email = email.strip().lower() if email is not None else None
    email_changed = normalized_email is not None and normalized_email != tutor.user.email

    # Refused before any other check: the dashboard form always echoes the stored address, so
    # only a real change is the Admin-only write.
    if email_changed and actor_role is UserRole.MANAGER:
        raise TutorAccountForbidden

    cleaned_name = normalize_name(name) if name is not None else None
    canonical_phone_number: str | None = None

    if normalized_email is not None and _email_taken(
        db, email=normalized_email, exclude_user_id=tutor.user_id
    ):
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
            if cleaned_name is not None:
                tutor.user.name = cleaned_name
                tutor.user.name_is_default = False

            if normalized_email is not None:
                tutor.user.email = normalized_email

            if canonical_phone_number is not None:
                tutor.phone_number = canonical_phone_number

            if bio is not None:
                tutor.bio = bio

            if is_active is not None:
                tutor.user.is_active = is_active

            db.flush()
    except IntegrityError as exc:
        raise TutorUniqueViolation from exc

    if email_changed:
        revoke_links_for_user(db, user_id=tutor.user_id, now=now)

    return tutor


def deactivate_tutor(db: Session, *, actor_role: UserRole, tutor_id: uuid.UUID) -> Tutor:
    """Soft delete of the person: `users.is_active` is the one flag that counts, so this is
    what stops the login, the offer surface and the Tutors list at once.

    It does not touch `tutor_subjects`, `tutor_availability` or `bookings`: deleting the
    assignments would make deactivation irreversible.
    """
    tutor = get_tutor(db, tutor_id=tutor_id)
    assert_may_write_person(actor_role=actor_role, tutor=tutor)
    tutor.user.is_active = False
    db.flush()

    return tutor
