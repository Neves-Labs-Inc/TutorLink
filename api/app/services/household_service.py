"""Households — the connected components guardians and children form over `child_guardians`.

Households are computed per request, in memory, and paginated by whole household (P7C-B): three
narrow reads, a union-find over the links, a filter that keeps or drops whole groups, a
deterministic sort and one slice. A stored `household_id` column was rejected because the value
is fully derivable, and keeping it true would need merge and split maintenance on every link
write, removal splits included.

Scale bound (A-72): realistic volume is hundreds of guardians, a few thousand at 10x, and the
three reads stay a few thousand narrow rows. This is comfortable to roughly 50k guardians;
beyond that, revisit the stored column.

Read-only: nothing here writes or commits.
"""

import re
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.guardian import ChildGuardian, Guardian

_PHONE_PUNCTUATION = str.maketrans("", "", " +-().")
_NON_DIGITS = re.compile(r"[^0-9]")


@dataclass(frozen=True, slots=True)
class Household:
    guardians: list[Guardian]
    children: list[Child]


@dataclass(frozen=True, slots=True)
class _Search:
    needle: str
    digits: str | None


def list_households(
    db: Session, *, q: str | None, limit: int, offset: int
) -> tuple[list[Household], int]:
    """One page of whole households, plus the number matching before paging.

    The links are read **first**. Guardians and children are never hard-deleted, so every
    guardian a link names is in the guardian read that follows; a child whose first link was
    committed between the reads has no link in this snapshot and is left out until the next
    request, rather than attached to a household it cannot be placed in.
    """
    links = db.execute(select(ChildGuardian.child_id, ChildGuardian.guardian_id)).all()
    guardians = db.scalars(select(Guardian)).all()
    children = db.scalars(select(Child).where(Child.id.in_(select(ChildGuardian.child_id)))).all()

    search = _search(q)
    matching = [
        household
        for household in _group(guardians, children, links)
        if search is None or _matches(household, search)
    ]
    matching.sort(key=lambda household: _sort_key(household.guardians[0]))

    return matching[offset : offset + limit], len(matching)


def _group(
    guardians: Iterable[Guardian],
    children: Iterable[Child],
    links: Iterable[tuple[uuid.UUID, uuid.UUID]],
) -> list[Household]:
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
        Household(
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


def _matches(household: Household, search: _Search) -> bool:
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
