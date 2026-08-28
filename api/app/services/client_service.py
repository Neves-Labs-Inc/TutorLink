"""Clients — `guardians` rows, read and written through the word the business uses.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. `InvalidPhoneNumber` from `phone_service` travels through this module unchanged; the
router decides it is a 400.

**A `phone_number` edit moves `guardians.phone_number` and nothing else.** Phase 7 adds
`conversations`, keyed on the number a thread was actually held with (`docs/erd.md`
§conversations). When it lands, `update_client` must still not re-point an existing thread: a
guardian who changes handset opens a *second* thread carrying the same client, and rewriting
the old thread's key would silently reattribute the messages already in it.

**Duplicate phone numbers are refused twice**, per `03-RESEARCH.md`'s normative idiom. The
pre-check `_phone_number_taken` produces the contract's readable message; `UNIQUE
(phone_number)` is what survives a race between two requests, and the savepoint around the
write — the insert in `create_client`, the flush in `update_client` — is what leaves the
`Session` usable when it fires. Both write paths carry both layers: a `PATCH` racing a `POST`
onto the same number is the same 409, never a 500. The predicate is a named seam rather
than the inline query `user_service.py:93` writes, deliberately: without it the constraint path
is unreachable by any test this harness can run.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.services.phone_service import normalize_phone_number


@dataclass(frozen=True, slots=True)
class HomeInput:
    label: str | None
    address: str
    access_code: str


@dataclass(frozen=True, slots=True)
class ClientDetail:
    """A client with the rows the by-id response nests.

    `Guardian` carries no relationship to `Home` — `guardian_homes` is navigable only from the
    junction — so the homes cannot ride along on the ORM instance, and a router that queried
    for them itself would stop being a thin HTTP shell.
    """

    client: Guardian
    homes: list[Home]
    children: list[Child]


class ClientServiceError(Exception):
    """Base class for every failure this module reports."""


class ClientNotFound(ClientServiceError):
    """No guardian with that id."""


class PhoneNumberTaken(ClientServiceError):
    """Another client already holds that phone number, active or deactivated."""


def list_clients(
    db: Session, *, is_active: bool, phone_number: str | None, limit: int, offset: int
) -> tuple[list[Guardian], int]:
    """Rows for one page, plus the total matching before paging.

    `phone_number` is normalised before it is compared (D-E), so a human-typed
    `(202) 555-0123` finds the row stored as `+12025550123`. An unparseable one raises
    `InvalidPhoneNumber` rather than returning an empty page: a malformed input is a validation
    failure, not "no match", and answering it with an empty page tells the bot to create a
    duplicate.

    The two filters compose, and `is_active` is **not** special-cased for the lookup: a
    deactivated client is found only with `is_active=False`.
    """
    canonical = None if phone_number is None else normalize_phone_number(db, raw=phone_number)
    matching = _visible(is_active=is_active, phone_number=canonical)
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0
    clients = list(
        db.scalars(matching.order_by(Guardian.name, Guardian.id).limit(limit).offset(offset)).all()
    )

    return clients, total


def get_client(db: Session, *, client_id: uuid.UUID) -> ClientDetail:
    """The client whatever its `is_active` state — a deactivated one is a 200, never a 404,
    because the surface that deactivated it has to open it in order to reactivate it."""
    return _detail(db, _guardian(db, client_id=client_id))


def create_client(
    db: Session, *, name: str, phone_number: str, home: HomeInput | None
) -> ClientDetail:
    """Never an upsert: a number any client already holds, active or deactivated, is refused."""
    canonical = normalize_phone_number(db, raw=phone_number)

    if _phone_number_taken(db, phone_number=canonical, exclude_id=None):
        raise PhoneNumberTaken

    client = Guardian(name=name, phone_number=canonical, is_active=True)

    # The savepoint wraps the insert and nothing else. Unwinding it on `IntegrityError` is what
    # keeps the `Session` usable for the rest of the request; the home below is added outside
    # it so a failure there is never mislabelled a duplicate phone number. The constraint is
    # matched by the exception, never by its name — PostgreSQL kept the pre-rename `parents`
    # name on a migrated database while `create_all` produces the `guardians` one, so name
    # matching passes every test here and misses in production.
    try:
        with db.begin_nested():
            db.add(client)
            db.flush()
    except IntegrityError as exc:
        raise PhoneNumberTaken from exc

    homes: list[Home] = []

    if home is not None:
        homes = [_attach_home(db, client=client, home=home)]

    return ClientDetail(client=client, homes=homes, children=[])


def update_client(
    db: Session,
    *,
    client_id: uuid.UUID,
    name: str | None,
    phone_number: str | None,
    is_active: bool | None,
) -> ClientDetail:
    """The only deactivation and reactivation path there is; `is_active` moves either way.

    The duplicate check excludes this client, so a `PATCH` echoing back the number already
    stored — in any format, since both sides are normalised first — is a no-op on that field
    rather than a conflict with itself.

    The savepoint wraps the edits and the flush, and nothing else, for the reason
    `create_client` gives: a number claimed between the pre-check and the write is the
    constraint's 409, not a 500, and unwinding to the savepoint leaves the `Session` usable for
    the rest of the request.
    """
    client = _guardian(db, client_id=client_id)
    canonical: str | None = None

    if phone_number is not None:
        canonical = normalize_phone_number(db, raw=phone_number)

        if _phone_number_taken(db, phone_number=canonical, exclude_id=client.id):
            raise PhoneNumberTaken

    # The edits are applied *inside* the savepoint because `begin_nested` flushes whatever is
    # already dirty before it emits the SAVEPOINT (`SessionTransaction._take_snapshot`):
    # assigned above the block, the UPDATE would run outside the savepoint and a constraint
    # violation would deactivate the whole request's transaction, leaving the `Session`
    # unusable even though this raises the right error. Nothing in the block but three
    # in-memory assignments and the flush, so no other failure can be mislabelled. The
    # constraint is matched by the exception, never by its name — see `create_client`.
    try:
        with db.begin_nested():
            if canonical is not None:
                client.phone_number = canonical

            if name is not None:
                client.name = name

            if is_active is not None:
                client.is_active = is_active

            db.flush()
    except IntegrityError as exc:
        raise PhoneNumberTaken from exc

    return _detail(db, client)


def _visible(*, is_active: bool, phone_number: str | None) -> Select[tuple[Guardian]]:
    statement = select(Guardian).where(Guardian.is_active.is_(is_active))

    if phone_number is not None:
        statement = statement.where(Guardian.phone_number == phone_number)

    return statement


def _phone_number_taken(db: Session, *, phone_number: str, exclude_id: uuid.UUID | None) -> bool:
    statement = select(Guardian.id).where(Guardian.phone_number == phone_number)

    if exclude_id is not None:
        statement = statement.where(Guardian.id != exclude_id)

    return db.scalars(statement).first() is not None


def _guardian(db: Session, *, client_id: uuid.UUID) -> Guardian:
    client = db.get(Guardian, client_id)

    if client is None:
        raise ClientNotFound

    return client


def _attach_home(db: Session, *, client: Guardian, home: HomeInput) -> Home:
    created = Home(label=home.label, address=home.address, access_code=home.access_code)
    db.add(created)
    db.flush()
    db.add(GuardianHome(guardian_id=client.id, home_id=created.id))
    db.flush()

    return created


def _detail(db: Session, client: Guardian) -> ClientDetail:
    homes = list(
        db.scalars(
            select(Home)
            .join(GuardianHome, GuardianHome.home_id == Home.id)
            .where(GuardianHome.guardian_id == client.id)
            .order_by(Home.created_at, Home.id)
        ).all()
    )
    children = list(
        db.scalars(
            select(Child)
            .join(ChildGuardian, ChildGuardian.child_id == Child.id)
            .where(ChildGuardian.guardian_id == client.id)
            .order_by(Child.name, Child.id)
        ).all()
    )

    return ClientDetail(client=client, homes=homes, children=children)
