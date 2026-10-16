"""Households — the connected components guardians and children form over `child_guardians`.

Households are computed per request, in memory, and paginated by whole household (P7C-B): three
narrow reads, a union-find over the links, a filter that keeps or drops whole groups, a
deterministic sort and one slice. A stored `household_id` column was rejected because the value
is fully derivable, and keeping it true would need merge and split maintenance on every link
write, removal splits included.

Scale bound (A-72): realistic volume is hundreds of guardians, a few thousand at 10x, and the
three reads stay a few thousand narrow rows. This is comfortable to roughly 50k guardians;
beyond that, revisit the stored column.

A family read (#233) adds a name built from the Guardians' surnames, every Home of every
Guardian and the earliest upcoming live Booking of any Child. The Homes and the next Bookings
are read once per page, never per family, so the cost stays constant however many families a
page holds.

Read-only: nothing here writes or commits.
"""

import re
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.booking import Booking, upcoming_live_bookings
from app.models.child import Child
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.services import clock

_PHONE_PUNCTUATION = str.maketrans("", "", " +-().")
_NON_DIGITS = re.compile(r"[^0-9]")
# Up to this many distinct surnames are spelled out ("Martinez & Reyes family").
_MAX_LISTED_SURNAMES = 2


class FamilyNotFound(Exception):
    """No Guardian or Child has this id, or the Child has no Guardian to group it with."""


@dataclass(frozen=True, slots=True)
class FamilyHome:
    home: Home
    # The family's Guardians on this Home, in the family's Guardian order.
    guardian_ids: list[uuid.UUID]


@dataclass(frozen=True, slots=True)
class _Group:
    guardians: list[Guardian]
    children: list[Child]


@dataclass(frozen=True, slots=True)
class Household:
    guardians: list[Guardian]
    children: list[Child]
    name: str
    archived: bool
    homes: list[FamilyHome]
    next_booking: Booking | None


@dataclass(frozen=True, slots=True)
class FamilyMemberIds:
    guardian_ids: frozenset[uuid.UUID]
    child_ids: frozenset[uuid.UUID]


@dataclass(frozen=True, slots=True)
class _Search:
    needle: str
    digits: str | None


def list_households(
    db: Session, *, q: str | None, include_archived: bool, limit: int, offset: int
) -> tuple[list[Household], int]:
    """One page of whole households, plus the number matching before paging.

    A family is archived when every Guardian is; those are left out unless `include_archived`.
    """
    search = _search(q)
    matching = [
        group
        for group in _read_groups(db)
        if (include_archived or not _is_archived(group))
        and (search is None or _matches(group, search))
    ]
    matching.sort(key=lambda group: _sort_key(group.guardians[0]))

    return _complete(db, matching[offset : offset + limit]), len(matching)


def get_household(db: Session, *, member_id: uuid.UUID) -> Household:
    """The family a Guardian or a Child belongs to, archived or not; else `FamilyNotFound`."""
    found = next(
        (
            group
            for group in _read_groups(db)
            if any(member.id == member_id for member in (*group.guardians, *group.children))
        ),
        None,
    )

    if found is None:
        raise FamilyNotFound(f"no family member {member_id}")

    return _complete(db, [found])[0]


def _read_groups(db: Session) -> list[_Group]:
    """Every household, unsorted.

    The links are read **first**. Guardians and children are never hard-deleted, so every
    guardian a link names is in the guardian read that follows; a child whose first link was
    committed between the reads has no link in this snapshot and is left out until the next
    request, rather than attached to a household it cannot be placed in.
    """
    links = db.execute(select(ChildGuardian.child_id, ChildGuardian.guardian_id)).all()
    guardians = db.scalars(select(Guardian)).all()
    children = db.scalars(select(Child).where(Child.id.in_(select(ChildGuardian.child_id)))).all()

    return _group(guardians, children, links)


def _complete(db: Session, groups: list[_Group]) -> list[Household]:
    """Add the name, the Homes and the next Booking to a page, in two reads for the whole page."""
    homes_by_guardian = _homes_by_guardian(
        db, guardian_ids=[guardian.id for group in groups for guardian in group.guardians]
    )
    next_by_child = _next_booking_by_child(
        db, child_ids=[child.id for group in groups for child in group.children]
    )

    return [
        Household(
            guardians=group.guardians,
            children=group.children,
            name=_family_name(group.guardians),
            archived=_is_archived(group),
            homes=_family_homes(group, homes_by_guardian),
            next_booking=_earliest(
                [next_by_child[child.id] for child in group.children if child.id in next_by_child]
            ),
        )
        for group in groups
    ]


def _homes_by_guardian(
    db: Session, *, guardian_ids: list[uuid.UUID]
) -> defaultdict[uuid.UUID, list[Home]]:
    """Each Guardian's Homes, archived ones included, ordered by `created_at, id`."""
    statement = (
        select(GuardianHome.guardian_id, Home)
        .join(Home, Home.id == GuardianHome.home_id)
        .where(GuardianHome.guardian_id.in_(guardian_ids))
        .order_by(Home.created_at, Home.id)
    )
    grouped: defaultdict[uuid.UUID, list[Home]] = defaultdict(list)

    for guardian_id, home in db.execute(statement).all():
        grouped[guardian_id].append(home)

    return grouped


def _next_booking_by_child(db: Session, *, child_ids: list[uuid.UUID]) -> dict[uuid.UUID, Booking]:
    """Each Child's earliest upcoming live Booking, one row per Child (`DISTINCT ON`)."""
    statement = (
        select(Booking)
        .options(joinedload(Booking.staff))
        .where(Booking.child_id.in_(child_ids), upcoming_live_bookings(clock.business_now()))
        .order_by(Booking.child_id, Booking.scheduled_date, Booking.start_time, Booking.id)
        .distinct(Booking.child_id)
    )

    return {booking.child_id: booking for booking in db.scalars(statement).unique()}


def _family_homes(
    group: _Group, homes_by_guardian: defaultdict[uuid.UUID, list[Home]]
) -> list[FamilyHome]:
    """Every Home of every Guardian once, ordered by `created_at, id`, with its owners here."""
    owners: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    homes: dict[uuid.UUID, Home] = {}

    for guardian in group.guardians:
        for home in homes_by_guardian[guardian.id]:
            homes[home.id] = home
            owners[home.id].append(guardian.id)

    ordered = sorted(homes.values(), key=lambda home: (home.created_at, home.id))

    return [FamilyHome(home=home, guardian_ids=owners[home.id]) for home in ordered]


def _earliest(bookings: list[Booking]) -> Booking | None:
    return min(
        bookings,
        key=lambda booking: (booking.scheduled_date, booking.start_time, booking.id),
        default=None,
    )


def _family_name(guardians: list[Guardian]) -> str:
    """The family's display name: "Gomez family", "Martinez & Reyes family", "Ana Gomez + 2 family".

    Built from the active Guardians, or from all of them when none is active. Nothing is stored.
    """
    active = [guardian for guardian in guardians if not guardian.is_archived]
    counted = active or guardians
    surnames: dict[str, str] = {}

    for guardian in counted:
        surname = _surname(guardian.name)
        surnames.setdefault(surname.casefold(), surname)

    if len(surnames) <= _MAX_LISTED_SURNAMES:
        label = " & ".join(surnames.values())
    else:
        label = f"{counted[0].name} + {len(counted) - 1}"

    return f"{label} family"


def _surname(name: str) -> str:
    words = name.split()
    return words[-1] if words else name


def _is_archived(group: _Group) -> bool:
    return all(guardian.is_archived for guardian in group.guardians)


def family_member_ids(db: Session, *, guardian_id: uuid.UUID) -> FamilyMemberIds:
    """The ids in a Guardian's household, the same connected group `list_households` forms.

    Walks `child_guardians` outward from the Guardian, one read per hop, so it touches only the
    family's own links. Archived members are included; the caller decides what they mean.
    """
    guardian_ids = {guardian_id}
    child_ids: set[uuid.UUID] = set()
    frontier = {guardian_id}

    while frontier:
        children_of_frontier = select(ChildGuardian.child_id).where(
            ChildGuardian.guardian_id.in_(frontier)
        )
        new_children = set(db.scalars(children_of_frontier)) - child_ids
        child_ids |= new_children

        guardians_of_new_children = select(ChildGuardian.guardian_id).where(
            ChildGuardian.child_id.in_(new_children)
        )
        frontier = set(db.scalars(guardians_of_new_children)) - guardian_ids
        guardian_ids |= frontier

    return FamilyMemberIds(guardian_ids=frozenset(guardian_ids), child_ids=frozenset(child_ids))


def _group(
    guardians: Iterable[Guardian],
    children: Iterable[Child],
    links: Iterable[tuple[uuid.UUID, uuid.UUID]],
) -> list[_Group]:
    guardians_by_id = {guardian.id: guardian for guardian in guardians}
    roots = _UnionFind(guardians_by_id)
    first_guardian_of: dict[uuid.UUID, uuid.UUID] = {}

    for child_id, guardian_id in links:
        first = first_guardian_of.setdefault(child_id, guardian_id)
        roots.union(first, guardian_id)

    members: dict[uuid.UUID, list[Guardian]] = defaultdict(list)
    for guardian in guardians_by_id.values():
        members[roots.find(guardian.id)].append(guardian)

    offspring: dict[uuid.UUID, list[Child]] = defaultdict(list)
    for child in children:
        if child.id in first_guardian_of:
            offspring[roots.find(first_guardian_of[child.id])].append(child)

    return [
        _Group(
            guardians=sorted(group, key=_sort_key),
            children=sorted(offspring[root], key=_sort_key),
        )
        for root, group in members.items()
    ]


def _search(q: str | None) -> _Search | None:
    term = (q or "").strip()

    if term:
        digits = term.translate(_PHONE_PUNCTUATION)
        by_digits = digits.isascii() and digits.isdigit()
        result = _Search(needle=term.casefold(), digits=digits if by_digits else None)
    else:
        result = None

    return result


def _matches(household: _Group, search: _Search) -> bool:
    names = [member.name for member in (*household.guardians, *household.children)]
    phones = [_NON_DIGITS.sub("", guardian.phone_number) for guardian in household.guardians]

    return any(search.needle in name.casefold() for name in names) or (
        search.digits is not None and any(search.digits in phone for phone in phones)
    )


def _sort_key(member: Guardian | Child) -> tuple[str, uuid.UUID]:
    return member.name.casefold(), member.id


class _UnionFind:
    def __init__(self, nodes: Iterable[uuid.UUID]) -> None:
        self._parent = {node: node for node in nodes}

    def find(self, node: uuid.UUID) -> uuid.UUID:
        root = node
        while self._parent[root] != root:
            root = self._parent[root]
        while self._parent[node] != root:
            self._parent[node], node = root, self._parent[node]
        return root

    def union(self, left: uuid.UUID, right: uuid.UUID) -> None:
        self._parent[self.find(left)] = self.find(right)
