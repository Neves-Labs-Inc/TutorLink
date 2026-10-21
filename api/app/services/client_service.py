"""Clients — `guardians` rows, read and written through the word the business uses.

Same transaction contract as `user_service`: nothing here commits, the caller owns the
boundary. `InvalidPhoneNumber` from `phone_service` travels through this module unchanged; the
router decides it is a 400.

**A `phone_number` change takes the Guardian's thread with it** (#126, reversing D-L / #55,
`docs/erd.md` §conversations). The thread at the old number that is this Guardian's is re-keyed
to the new one, a Staff-only `number_change_note` line naming the Staff member records the move,
and the bot's pending proposal on both threads is dropped. Left behind, the thread would hand this Guardian to
the old number's next holder. A thread already at the new number is merged into the
Guardian's, or becomes theirs when they have none; one linked to another Guardian refuses the
change (`WhatsAppChatTaken`). Echoing the same number moves nothing. Both threads are locked
before the Guardian row is written, keeping the lock order conversation first. Reminder consent
rows keep their number: it records where their evidence came from (#119).

**Duplicate phone numbers are refused twice**, per `03-RESEARCH.md`'s normative idiom. The
pre-check `_phone_number_taken` produces the contract's readable message; `UNIQUE
(phone_number)` is what survives a race between two requests, and the savepoint around the
write — the insert in `create_client`, the flush in `update_client` — is what leaves the
`Session` usable when it fires. Both write paths carry both layers: a `PATCH` racing a `POST`
onto the same number is the same 409, never a 500. The predicate is a named seam rather
than the inline query `user_service.py:93` writes, deliberately: without it the constraint path
is unreachable by any test this harness can run.
"""

import logging
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass

from sqlalchemy import ColumnElement, ScalarSelect, Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import Language
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.models.user import User
from app.services import conversation_service, message_service
from app.services.conversation_service import LATEST_CONVERSATION_FIRST
from app.services.home_service import HomeDetails, home_details
from app.services.guardian_state import (
    GuardianState,
    ReminderState,
    effective_language,
    guardian_states,
    reminders_state,
)
from app.services.phone_service import normalize_phone_number

logger = logging.getLogger(__name__)

CLIENT_NOT_FOUND_ERROR = "Client not found"

# The Staff-only line a number change leaves in the Guardian's thread; numbers as stored.
NUMBER_CHANGE_NOTE = "Number changed from {previous} to {current} by {staff}"

_LIKE_ESCAPE = "\\"
_LIKE_WILDCARDS = str.maketrans({"\\": "\\\\", "%": "\\%", "_": "\\_"})


@dataclass(frozen=True, slots=True)
class HomeInput:
    label: str | None
    address: str
    directions: str | None


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
    # The Guardian's most recently active conversation, whose `language` is the Guardian
    # language; `None` when the Guardian has never written, so English is used.
    language_conversation: Conversation | None


@dataclass(frozen=True, slots=True)
class ClientWithCounts:
    """One list row. `children` are the non-archived ones, by name, so `child_count` is their
    number."""

    client: Guardian
    home_count: int
    child_count: int
    children: list[Child]
    state: GuardianState


class ClientServiceError(Exception):
    """Base class for every failure this module reports."""


class ClientNotFound(ClientServiceError):
    """No guardian with that id."""


class ActingUserNotFound(ClientServiceError):
    """The Staff member changing a number no longer exists, so nobody can sign the note."""


class PhoneNumberTaken(ClientServiceError):
    """Another client already holds that phone number, active or deactivated."""


class WhatsAppChatTaken(ClientServiceError):
    """The WhatsApp thread at the new number is linked to another Guardian.

    Apart from `PhoneNumberTaken` so the bot's Intake, which handles that one, never meets it.
    """


def list_clients(
    db: Session,
    *,
    is_archived: bool,
    phone_number: str | None,
    limit: int,
    offset: int,
    q: str | None = None,
    languages: Collection[Language] = (),
    reminders: Collection[ReminderState] = (),
) -> tuple[list[ClientWithCounts], int]:
    """Rows for one page, plus the total matching before paging.

    `phone_number` is normalised before it is compared (D-E), so a human-typed
    `(202) 555-0123` finds the row stored as `+12025550123`. An unparseable one raises
    `InvalidPhoneNumber` rather than returning an empty page: a malformed input is a validation
    failure, not "no match", and answering it with an empty page tells the bot to create a
    duplicate.

    `q` is deliberately **not** normalised: a partial number such as `555` is unparseable, and
    normalising it would turn a search into a 400. It is a raw case-insensitive substring of
    the stored name or the stored E.164 string.

    It also matches the name of any of the Guardian's non-archived Children.

    `languages` and `reminders` keep a Guardian whose state is any of the listed values; empty
    means no filter. The filters compose, and `is_archived` is **not** special-cased for the
    lookup: a deactivated client is found only with `is_archived=True`.

    A constant number of statements whatever the page size: the Children and the Guardian
    state are read for the whole page at once.
    """
    canonical = None if phone_number is None else normalize_phone_number(db, raw=phone_number)
    matching = visible_clients(
        is_archived=is_archived,
        phone_number=canonical,
        q=q,
        languages=languages,
        reminders=reminders,
    )
    total = db.scalar(select(func.count()).select_from(matching.subquery())) or 0
    rows = db.execute(
        matching.add_columns(_home_count(), _child_count())
        .order_by(Guardian.name, Guardian.id)
        .limit(limit)
        .offset(offset)
    ).all()
    guardian_ids = [client.id for client, _, _ in rows]
    children = _active_children(db, guardian_ids=guardian_ids)
    states = guardian_states(db, guardian_ids)
    clients = [
        ClientWithCounts(
            client=client,
            home_count=home_count,
            child_count=child_count,
            children=children.get(client.id, []),
            state=states[client.id],
        )
        for client, home_count, child_count in rows
    ]

    return clients, total


def get_client(db: Session, *, client_id: uuid.UUID) -> ClientDetail:
    """The client whatever its `is_archived` state — a deactivated one is a 200, never a 404,
    because the surface that deactivated it has to open it in order to reactivate it."""
    return _detail(db, _guardian(db, client_id=client_id))


def create_client(
    db: Session,
    *,
    name: str,
    phone_number: str,
    home: HomeInput | None,
    is_bot_turn: bool = False,
) -> ClientDetail:
    """Never an upsert: a number any client already holds, active or deactivated, is refused.

    An unlinked WhatsApp thread already at the number becomes the new Guardian's. One linked to
    another Guardian (data from before threads followed their Guardian) is left alone.

    `is_bot_turn`: called by a bot turn's Intake on the number's own thread. The thread is
    neither locked nor linked here: the turn links its detached copy, applied under its end
    lock, so the webhook and Takeover never wait on the rest of the turn. A Staff write at the
    same number waits for the turn instead (`conversation_service.lock_thread_at`).
    """
    # Before any write, so a blank address (`BlankAddress`) leaves no Guardian behind.
    details = (
        None
        if home is None
        else home_details(label=home.label, address=home.address, directions=home.directions)
    )
    canonical = normalize_phone_number(db, raw=phone_number)

    if _phone_number_taken(db, phone_number=canonical, exclude_id=None):
        raise PhoneNumberTaken

    # Locked before the Guardian is inserted: conversation first, as every turn's end does.
    thread = (
        None if is_bot_turn else conversation_service.lock_thread_at(db, phone_number=canonical)
    )
    client = Guardian(name=name, phone_number=canonical, is_archived=False)

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

    if details is not None:
        homes = [_attach_home(db, client=client, home=details)]

    language_conversation = None
    if thread is not None and thread.guardian_id is None:
        language_conversation = conversation_service.link_guardian(
            db, conversation=thread, guardian_id=client.id
        )

    return ClientDetail(
        client=client, homes=homes, children=[], language_conversation=language_conversation
    )


def update_client(
    db: Session,
    *,
    client_id: uuid.UUID,
    name: str | None,
    phone_number: str | None,
    acting_user_id: uuid.UUID,
) -> ClientDetail:
    """Archive and Restore are `archive_service`'s, not this.

    The duplicate check excludes this client, so a `PATCH` echoing back the number already
    stored — in any format, since both sides are normalised first — is a no-op on that field
    rather than a conflict with itself.

    The savepoint wraps the edits and the flush, and nothing else, for the reason
    `create_client` gives: a number claimed between the pre-check and the write is the
    constraint's 409, not a 500, and unwinding to the savepoint leaves the `Session` usable for
    the rest of the request.

    A number that actually changes takes the Guardian's thread with it (see the module
    docstring); `acting_user_id` is the Staff member the thread's number-change line names.
    """
    client = _guardian(db, client_id=client_id)
    previous_number = client.phone_number
    canonical: str | None = None
    change: conversation_service.NumberChange | None = None
    staff: User | None = None

    if phone_number is not None:
        canonical = normalize_phone_number(db, raw=phone_number)

        if _phone_number_taken(db, phone_number=canonical, exclude_id=client.id):
            raise PhoneNumberTaken

    is_number_changed = canonical is not None and canonical != previous_number

    if is_number_changed:
        # Read before anything is written: a token can outlive its user row, and the note
        # needs an author.
        staff = db.get(User, acting_user_id)

        if staff is None:
            raise ActingUserNotFound

        # Locked before the Guardian's row is written: conversation first, as every turn does.
        change = conversation_service.lock_number_change(
            db, guardian_id=client.id, previous_number=previous_number, phone_number=canonical
        )

        if change.is_new_number_thread_anothers:
            logger.warning(
                "refused guardian %s's number change: the thread at the new number is another"
                " guardian's",
                client.id,
            )
            raise WhatsAppChatTaken

    # The edits are applied *inside* the savepoint because `begin_nested` flushes whatever is
    # already dirty before it emits the SAVEPOINT (`SessionTransaction._take_snapshot`):
    # assigned above the block, the UPDATE would run outside the savepoint and a constraint
    # violation would deactivate the whole request's transaction, leaving the `Session`
    # unusable even though this raises the right error. Nothing in the block but two
    # in-memory assignments and the flush, so no other failure can be mislabelled. The
    # constraint is matched by the exception, never by its name — see `create_client`.
    try:
        with db.begin_nested():
            if canonical is not None:
                client.phone_number = canonical

            if name is not None:
                client.name = name

            db.flush()
    except IntegrityError as exc:
        raise PhoneNumberTaken from exc

    if canonical is not None and change is not None and staff is not None:
        _follow_number_change(
            db, change=change, previous_number=previous_number, phone_number=canonical, staff=staff
        )

    return _detail(db, client)


def visible_clients(
    *,
    is_archived: bool,
    phone_number: str | None,
    q: str | None = None,
    languages: Collection[Language] = (),
    reminders: Collection[ReminderState] = (),
) -> Select[tuple[Guardian]]:
    statement = select(Guardian).where(Guardian.is_archived.is_(is_archived))
    pattern = _substring_pattern(q)

    if phone_number is not None:
        statement = statement.where(Guardian.phone_number == phone_number)

    if pattern is not None:
        statement = statement.where(
            or_(
                Guardian.name.ilike(pattern, escape=_LIKE_ESCAPE),
                Guardian.phone_number.ilike(pattern, escape=_LIKE_ESCAPE),
                _has_active_child_named(pattern),
            )
        )

    if languages:
        statement = statement.where(effective_language().in_(languages))

    if reminders:
        statement = statement.where(reminders_state().in_(reminders))

    return statement


def _has_active_child_named(pattern: str) -> ColumnElement[bool]:
    # `EXISTS` rather than a join, so a Guardian with two matching Children is one row.
    return (
        select(ChildGuardian.child_id)
        .join(Child, Child.id == ChildGuardian.child_id)
        .where(
            ChildGuardian.guardian_id == Guardian.id,
            Child.is_archived.is_(False),
            Child.name.ilike(pattern, escape=_LIKE_ESCAPE),
        )
        .exists()
    )


def _substring_pattern(raw: str | None) -> str | None:
    trimmed = "" if raw is None else raw.strip()

    if not trimmed:
        pattern = None
    else:
        pattern = f"%{trimmed.translate(_LIKE_WILDCARDS)}%"

    return pattern


# Neither count includes archived rows: an archived home or Child is not counted (#213, which
# replaced decision P7C-N's count of every linked Child), so `child_count` is the number of
# Children the row names. The two subqueries are scalar and
# correlated rather than joined: a join over `guardian_homes` would multiply the guardian row
# and turn `total` into a count of links (CONSTITUTION §8).
#
# This count and the nested list `_detail` builds are deliberately not the same predicate, and
# that is not a §11 drift: `docs/api-design.md:69` places nested homes outside the collection
# `is_archived` rule, so the by-id response returns every linked home. `HomeRead` carries
# the flag so the caller can tell which of them this number left out.
def _home_count() -> ScalarSelect[int]:
    return (
        select(func.count())
        .select_from(GuardianHome)
        .join(Home, Home.id == GuardianHome.home_id)
        .where(GuardianHome.guardian_id == Guardian.id, Home.is_archived.is_(False))
        .scalar_subquery()
    )


def _child_count() -> ScalarSelect[int]:
    return (
        select(func.count())
        .select_from(ChildGuardian)
        .join(Child, Child.id == ChildGuardian.child_id)
        .where(ChildGuardian.guardian_id == Guardian.id, Child.is_archived.is_(False))
        .scalar_subquery()
    )


def _active_children(
    db: Session, *, guardian_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[Child]]:
    """Each Guardian's non-archived Children by name, for a whole page in one statement."""
    rows = db.execute(
        select(ChildGuardian.guardian_id, Child)
        .join(Child, Child.id == ChildGuardian.child_id)
        .where(ChildGuardian.guardian_id.in_(guardian_ids), Child.is_archived.is_(False))
        .order_by(Child.name, Child.id)
    ).all()

    children: dict[uuid.UUID, list[Child]] = {}
    for guardian_id, child in rows:
        children.setdefault(guardian_id, []).append(child)

    return children


def _phone_number_taken(db: Session, *, phone_number: str, exclude_id: uuid.UUID | None) -> bool:
    statement = select(Guardian.id).where(Guardian.phone_number == phone_number)

    if exclude_id is not None:
        statement = statement.where(Guardian.id != exclude_id)

    return db.scalars(statement).first() is not None


def _follow_number_change(
    db: Session,
    *,
    change: conversation_service.NumberChange,
    previous_number: str,
    phone_number: str,
    staff: User,
) -> None:
    """Move the Guardian's thread to their new number (dropping the bot's pending proposal on
    both threads) and note it there."""
    thread = conversation_service.follow_number_change(db, change=change)

    if thread is not None:
        message_service.record_number_change_note(
            db,
            conversation=thread,
            body=NUMBER_CHANGE_NOTE.format(
                previous=previous_number, current=phone_number, staff=staff.name
            ),
            author_user_id=staff.id,
        )


def _guardian(db: Session, *, client_id: uuid.UUID) -> Guardian:
    client = db.get(Guardian, client_id)

    if client is None:
        raise ClientNotFound

    return client


def _attach_home(db: Session, *, client: Guardian, home: HomeDetails) -> Home:
    created = Home(label=home.label, address=home.address, directions=home.directions)
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
            .options(selectinload(Child.evaluated_by))
        ).all()
    )

    language_conversation = db.scalars(
        select(Conversation)
        .where(Conversation.guardian_id == client.id)
        .order_by(*LATEST_CONVERSATION_FIRST)
        .limit(1)
    ).first()

    return ClientDetail(
        client=client,
        homes=homes,
        children=children,
        language_conversation=language_conversation,
    )
