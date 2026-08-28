"""Children, and the guardian and home links that a child cannot exist without.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. Every id in the body is resolved *before* any row is written, so a bad link can
never leave a guardian-less or home-less child behind — an orphan `docs/erd.md` says cannot
exist, and one no later request could repair through this surface.

An unresolvable `guardian_id` or `home_id` is a bad body rather than a missing resource, so it
is 400 and not 404. The addressed resource is the child. Precedent:
`user_service._assert_profile_matches_role` for a `tutor_id` that does not resolve.
"""

import uuid
from collections.abc import Callable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import ChildHome, Home


class ChildServiceError(Exception):
    """Base class for every failure this module reports."""


class ChildNotFound(ChildServiceError):
    """No child with that id."""


class InvalidChildLinks(ChildServiceError):
    """An empty link set, or an id naming no existing guardian or home."""


def create_child(
    db: Session,
    *,
    guardian_ids: Sequence[uuid.UUID],
    home_ids: Sequence[uuid.UUID],
    name: str,
    age: int,
    grade_level: int,
    school_name: str,
) -> Child:
    guardians = _validated_link_ids(db, Guardian, guardian_ids)
    homes = _validated_link_ids(db, Home, home_ids)

    child = Child(name=name, age=age, grade_level=grade_level, school_name=school_name)
    db.add(child)
    db.flush()

    for guardian_id in guardians:
        db.add(ChildGuardian(child_id=child.id, guardian_id=guardian_id))

    for home_id in homes:
        db.add(ChildHome(child_id=child.id, home_id=home_id))

    _expire_link_sets(db, child)

    return child


def update_child(
    db: Session,
    *,
    child_id: uuid.UUID,
    guardian_ids: Sequence[uuid.UUID] | None,
    home_ids: Sequence[uuid.UUID] | None,
    name: str | None,
    age: int | None,
    grade_level: int | None,
    school_name: str | None,
) -> Child:
    child = db.get(Child, child_id)

    if child is None:
        raise ChildNotFound

    guardians = None if guardian_ids is None else _validated_link_ids(db, Guardian, guardian_ids)
    homes = None if home_ids is None else _validated_link_ids(db, Home, home_ids)

    if name is not None:
        child.name = name

    if age is not None:
        child.age = age

    if grade_level is not None:
        child.grade_level = grade_level

    if school_name is not None:
        child.school_name = school_name

    if guardians is not None:
        guardian_links = db.scalars(
            select(ChildGuardian).where(ChildGuardian.child_id == child.id)
        ).all()
        _replace_links(
            db,
            existing={link.guardian_id: link for link in guardian_links},
            wanted=guardians,
            build=lambda guardian_id: ChildGuardian(child_id=child.id, guardian_id=guardian_id),
        )

    if homes is not None:
        home_links = db.scalars(select(ChildHome).where(ChildHome.child_id == child.id)).all()
        _replace_links(
            db,
            existing={link.home_id: link for link in home_links},
            wanted=homes,
            build=lambda home_id: ChildHome(child_id=child.id, home_id=home_id),
        )

    _expire_link_sets(db, child)

    return child


def _validated_link_ids(
    db: Session, model: type[Guardian] | type[Home], requested: Sequence[uuid.UUID]
) -> set[uuid.UUID]:
    """The distinct ids to link to, once every one of them is known to exist.

    Repeats collapse rather than being refused: the junction's UNIQUE constraint would turn a
    harmless duplicate in the body into a 500.
    """
    wanted = set(requested)

    if not wanted:
        raise InvalidChildLinks

    found = set(db.scalars(select(model.id).where(model.id.in_(wanted))).all())

    if found != wanted:
        raise InvalidChildLinks

    return wanted


def _replace_links[LinkT](
    db: Session,
    *,
    existing: dict[uuid.UUID, LinkT],
    wanted: set[uuid.UUID],
    build: Callable[[uuid.UUID], LinkT],
) -> None:
    """Set replacement, not delete-all-then-reinsert.

    A link that stays keeps its own row. Rewriting every junction primary key on each `PATCH`
    would look identical over HTTP and would break any future foreign key onto a link row.
    """
    for target_id in wanted - existing.keys():
        db.add(build(target_id))

    for target_id in existing.keys() - wanted:
        db.delete(existing[target_id])


def _expire_link_sets(db: Session, child: Child) -> None:
    """Flush the junction writes, then drop what the relationships cached about them.

    The rows above are written to the junction tables directly rather than through
    `child.guardian_links` / `child.home_links`, so those collections are stale by the time the
    router reads them for the response body.
    """
    db.flush()
    db.expire(child, ["guardian_links", "home_links"])
