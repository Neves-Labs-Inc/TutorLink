"""A Child's Home set — the one place that knows where a Child's Homes come from (#214).

A Child's Homes are every Home of any of its Guardians: `child_guardians` -> `guardian_homes`
-> `homes`. An archived Guardian still counts, because archiving a Guardian is not unlinking
them. **Bookable** is that set minus archived Homes (`include_archived=False`). A Home two
Guardians share is in the set once.

Every consumer — booking rule 6, the bot, the child reads, the guardian-link and guardian-unlink
checks — asks here rather than re-writing the join, so the rule can only change in one place.
"""

import uuid
from collections import defaultdict
from collections.abc import Collection

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home


def guardian_home_ids(
    guardian_ids: Collection[uuid.UUID] | Select[tuple[uuid.UUID]], *, include_archived: bool
) -> Select[tuple[uuid.UUID]]:
    """The distinct ids of the Homes held by any of these Guardians."""
    statement = (
        select(GuardianHome.home_id)
        .join(Home, Home.id == GuardianHome.home_id)
        .where(GuardianHome.guardian_id.in_(guardian_ids))
        .distinct()
    )

    if not include_archived:
        statement = statement.where(Home.is_archived.is_(False))

    return statement


def child_home_ids(child_id: uuid.UUID, *, include_archived: bool) -> Select[tuple[uuid.UUID]]:
    """The distinct ids of the Child's Homes; usable as a subquery (`Home.id.in_(...)`)."""
    guardians = select(ChildGuardian.guardian_id).where(ChildGuardian.child_id == child_id)

    return guardian_home_ids(guardians, include_archived=include_archived)


def homes_by_child(
    db: Session, *, child_ids: Collection[uuid.UUID], include_archived: bool
) -> defaultdict[uuid.UUID, list[Home]]:
    """Each Child's Homes, in one statement for a whole page, ordered by `created_at, id`."""
    statement = (
        select(ChildGuardian.child_id, Home)
        .join(GuardianHome, GuardianHome.guardian_id == ChildGuardian.guardian_id)
        .join(Home, Home.id == GuardianHome.home_id)
        .where(ChildGuardian.child_id.in_(child_ids))
        .distinct()
        .order_by(Home.created_at, Home.id)
    )

    if not include_archived:
        statement = statement.where(Home.is_archived.is_(False))

    grouped: defaultdict[uuid.UUID, list[Home]] = defaultdict(list)

    for child_id, home in db.execute(statement).all():
        grouped[child_id].append(home)

    return grouped


def guardians_by_home(
    db: Session, *, home_ids: Collection[uuid.UUID]
) -> defaultdict[uuid.UUID, list[Guardian]]:
    """Each Home's owners, archived Guardians included, in one statement ordered by name, id."""
    statement = (
        select(GuardianHome.home_id, Guardian)
        .join(Guardian, Guardian.id == GuardianHome.guardian_id)
        .where(GuardianHome.home_id.in_(home_ids))
        .order_by(Guardian.name, Guardian.id)
    )
    grouped: defaultdict[uuid.UUID, list[Guardian]] = defaultdict(list)

    for home_id, guardian in db.execute(statement).all():
        grouped[home_id].append(guardian)

    return grouped
