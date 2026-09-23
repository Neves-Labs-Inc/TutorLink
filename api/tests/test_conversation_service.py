"""The conversation row: opening a thread, reading the inbox, and the takeover.

Run against a live PostgreSQL through the `db` fixture rather than a double, because three of
the things worth proving are the database's and not Python's: `UNIQUE (phone_number)` surviving
a race, the paired CHECK refusing a half-set takeover, and `SELECT … FOR UPDATE` making the
claim decide-once.

Two properties here are easy to assert vacuously and are written to fail loudly instead:

- **The constraint path.** `resolve_or_create` pre-reads, so a test that just calls it twice
  proves the pre-read and would pass with the unique index dropped. The race test below stubs
  the named predicate blind for exactly one call (**D-I**), which is the only way the conflict
  is reachable from a harness whose calls share one `Session`.
- **The row lock.** Two claims issued in one transaction are two calls in a row, and the second
  simply reads the already-claimed row — that passes with `with_for_update()` deleted.
  `test_a_concurrent_claim_is_serialized_by_the_row_lock` runs two real connections and asserts
  the contender *waited*, which is the only shape that can fail when the lock goes (**P4-N**,
  **OB-17**, and `test_booking_status_routes.py`'s own precedent).

Timestamps that an assertion depends on are written explicitly rather than taken from the
service's clock. `unread` is a comparison between two instants microseconds apart when both
come from `datetime.now()`, and a test that let the clock decide would be measuring its
resolution.

Row counts are never asserted globally: the test database outlives the run, so every test
creates what it asserts on under a `uuid4`-suffixed phone number and filters by it.
"""

import datetime
import pathlib
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass

import pytest
from sqlalchemy import delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.user import User
from app.security import hash_password
from app.services import conversation_service
from app.services.conversation_service import (
    ConversationHeldByAnother,
    ConversationNotFound,
    claim,
    flag,
    get,
    get_detail,
    link_guardian,
    list_conversations,
    mark_read,
    release,
    resolve_or_create,
)

# Well in the past, never "today": `mark_read` stamps the watermark from the real clock, and a
# fixture timestamp on the day the suite runs would make that assertion depend on the hour.
NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)


def test_a_first_message_opens_the_thread(db: Session) -> None:
    number = _phone_number()

    conversation = resolve_or_create(db, phone_number=number)

    assert conversation.phone_number == number
    assert conversation.status is ConversationStatus.BOT
    assert conversation.guardian_id is None
    assert conversation.taken_over_by_user_id is None
    assert conversation.last_message_at is not None


def test_a_second_message_from_one_number_reuses_the_thread(db: Session) -> None:
    number = _phone_number()

    first = resolve_or_create(db, phone_number=number)
    second = resolve_or_create(db, phone_number=number)

    assert second.id == first.id
    assert _conversation_count(db, phone_number=number) == 1


def test_the_number_is_stored_exactly_as_it_arrived(db: Session) -> None:
    """**P7-H**: Twilio's `From` minus the `whatsapp:` prefix, and nothing else done to it.

    `+15551234567` is the number `test_client_routes.py` uses to prove `phone_service` refuses
    a parseable-but-undialable input with a 400. An inbound WhatsApp message is proof of
    dialability by delivery, so the same value has to land here unchanged — a strict validator
    on this path would drop a real client's message behind a 400 Twilio retries forever.
    """
    conversation = resolve_or_create(db, phone_number="+15551234567")

    assert conversation.phone_number == "+15551234567"


def test_a_changed_number_opens_a_second_thread_for_the_same_guardian(db: Session) -> None:
    """The keying invariant (#55, **D-L**, `erd.md:274-279`): a thread is never re-pointed.

    Correcting a guardian's number moves `guardians.phone_number` and leaves the thread where
    it is, because the archive would otherwise claim messages went to a number Twilio never
    sent them to. The next inbound message from the new number opens a second conversation
    carrying the same guardian.
    """
    guardian = _make_guardian(db)
    old_number = _phone_number()
    new_number = _phone_number()
    old_thread = resolve_or_create(db, phone_number=old_number)
    link_guardian(db, conversation=old_thread, guardian_id=guardian.id)

    guardian.phone_number = new_number
    db.flush()
    new_thread = resolve_or_create(db, phone_number=new_number)
    link_guardian(db, conversation=new_thread, guardian_id=guardian.id)

    assert new_thread.id != old_thread.id
    assert old_thread.phone_number == old_number
    assert new_thread.guardian_id == old_thread.guardian_id


def test_a_first_contact_race_resolves_to_the_thread_that_won(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-read answers the ordinary case; `UNIQUE (phone_number)` is what survives a race.

    Stubbing the predicate blind for one call is how the second layer becomes reachable at all
    — under two real concurrent webhooks it is the database that answers, and there is no way
    to stage that against a harness whose calls share one `Session`. The stub falls back to the
    real predicate afterwards, because the recovery this proves *is* a re-read: without the
    unique index the assertion below would find two rows.
    """
    number = _phone_number()
    winner = resolve_or_create(db, phone_number=number)
    monkeypatch.setattr(conversation_service, "_conversation_for", _blind_once())

    resolved = resolve_or_create(db, phone_number=number)

    assert resolved.id == winner.id
    assert _conversation_count(db, phone_number=number) == 1
    # The savepoint's whole purpose: the session is still usable afterwards.
    assert resolve_or_create(db, phone_number=_phone_number()) is not None


def test_an_unknown_conversation_is_not_found(db: Session) -> None:
    unknown = uuid.uuid4()

    with pytest.raises(ConversationNotFound):
        get(db, conversation_id=unknown)

    with pytest.raises(ConversationNotFound):
        get_detail(db, conversation_id=unknown)

    with pytest.raises(ConversationNotFound):
        claim(db, conversation_id=unknown, user_id=uuid.uuid4())

    with pytest.raises(ConversationNotFound):
        release(db, conversation_id=unknown)

    with pytest.raises(ConversationNotFound):
        mark_read(db, conversation_id=unknown)


def test_the_inbox_reads_newest_activity_first(db: Session) -> None:
    marker = _marker()
    oldest = _make_conversation(db, marker=marker, last_message_at=NOON)
    newest = _make_conversation(db, marker=marker, last_message_at=NOON + _minutes(10))
    middle = _make_conversation(db, marker=marker, last_message_at=NOON + _minutes(5))

    items, total = _page(db, q=marker)

    assert [item.conversation.id for item in items] == [newest.id, middle.id, oldest.id]
    assert total == 3


def test_the_total_counts_the_filtered_query_before_paging(db: Session) -> None:
    marker = _marker()
    for offset_minutes in range(3):
        _make_conversation(db, marker=marker, last_message_at=NOON + _minutes(offset_minutes))

    items, total = _page(db, q=marker, limit=1)

    assert len(items) == 1
    assert total == 3


def test_the_status_filter_narrows_to_who_is_answering(db: Session) -> None:
    marker = _marker()
    admin = _make_user(db)
    _make_conversation(db, marker=marker)
    held = _make_conversation(db, marker=marker)
    claim(db, conversation_id=held.id, user_id=admin.id)

    human, human_total = _page(db, q=marker, status=ConversationStatus.HUMAN)
    bot, bot_total = _page(db, q=marker, status=ConversationStatus.BOT)

    assert [item.conversation.id for item in human] == [held.id]
    assert human_total == 1
    assert bot_total == 1
    assert held.id not in [item.conversation.id for item in bot]


def test_the_flag_filter_answers_both_ways(db: Session) -> None:
    marker = _marker()
    plain = _make_conversation(db, marker=marker)
    flagged = _make_conversation(db, marker=marker)
    flag(db, conversation=flagged, reason=FlagReason.STUCK)

    with_flag, with_total = _page(db, q=marker, flagged=True)
    without_flag, without_total = _page(db, q=marker, flagged=False)

    assert [item.conversation.id for item in with_flag] == [flagged.id]
    assert with_total == 1
    assert [item.conversation.id for item in without_flag] == [plain.id]
    assert without_total == 1


def test_a_conversation_is_unread_until_the_watermark_passes_its_last_message(
    db: Session,
) -> None:
    marker = _marker()
    never_read = _make_conversation(db, marker=marker, last_message_at=NOON)
    read = _make_conversation(db, marker=marker, last_message_at=NOON)
    read.last_read_at = NOON + _minutes(1)
    caught_up = _make_conversation(db, marker=marker, last_message_at=NOON + _minutes(2))
    caught_up.last_read_at = NOON + _minutes(1)
    db.flush()

    unread, unread_total = _page(db, q=marker, unread=True)
    seen, seen_total = _page(db, q=marker, unread=False)

    assert {item.conversation.id for item in unread} == {never_read.id, caught_up.id}
    assert unread_total == 2
    assert [item.conversation.id for item in seen] == [read.id]
    assert seen_total == 1
    assert all(item.unread for item in unread)
    assert not any(item.unread for item in seen)


def test_the_search_matches_a_number_fragment_or_a_guardian_name(db: Session) -> None:
    """**P5-C**: `q` is not phone-normalised. A fragment has no canonical form, and normalising
    it would turn a search into a 400 — and a thread with no guardian, which is the one an admin
    most wants to find, has only its number to match on."""
    marker = _marker()
    guardian = _make_guardian(db, name=f"Jane {marker}")
    named = _make_conversation(db, phone_number=f"+1{marker}1111")
    link_guardian(db, conversation=named, guardian_id=guardian.id)
    anonymous = _make_conversation(db, phone_number=f"+1{marker}2222")

    by_fragment, fragment_total = _page(db, q=f"{marker}2222")
    by_name, name_total = _page(db, q=f"jane {marker}".upper())

    assert [item.conversation.id for item in by_fragment] == [anonymous.id]
    assert fragment_total == 1
    assert [item.conversation.id for item in by_name] == [named.id]
    assert name_total == 1
    assert by_name[0].guardian is not None
    assert by_fragment[0].guardian is None


def test_the_filters_compose_and_the_total_follows_them(db: Session) -> None:
    marker = _marker()
    admin = _make_user(db)
    for _ in range(3):
        _make_conversation(db, marker=marker)
    wanted = _make_conversation(db, marker=marker)
    flag(db, conversation=wanted, reason=FlagReason.PARSE_ERROR)
    claim(db, conversation_id=wanted.id, user_id=admin.id)

    items, total = _page(
        db, q=marker, status=ConversationStatus.HUMAN, flagged=True, unread=True, limit=1
    )

    assert [item.conversation.id for item in items] == [wanted.id]
    assert total == 1


def test_an_inbox_row_carries_the_newest_message_and_the_holder(db: Session) -> None:
    marker = _marker()
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=marker, last_message_at=NOON + _minutes(5))
    _make_message(db, conversation, body="first", at=NOON)
    _make_message(db, conversation, body="latest", at=NOON + _minutes(5))
    claim(db, conversation_id=conversation.id, user_id=admin.id)

    items, _ = _page(db, q=marker)

    assert items[0].last_message_preview == "latest"
    assert items[0].holder is not None
    assert items[0].holder.id == admin.id


def test_a_claim_pauses_the_bot_and_names_the_holder(db: Session) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db)

    detail = claim(db, conversation_id=conversation.id, user_id=admin.id)

    assert detail.conversation.status is ConversationStatus.HUMAN
    assert detail.conversation.taken_over_by_user_id == admin.id
    assert detail.conversation.taken_over_at is not None
    assert detail.holder is not None
    assert detail.holder.email == admin.email


def test_a_reclaim_by_the_holder_is_a_no_op_success(db: Session) -> None:
    """A double-click, or a retry after a dropped response, asks for the state the conversation
    is already in (`api-design.md:1568-1571`)."""
    admin = _make_user(db)
    conversation = _make_conversation(db)
    first = claim(db, conversation_id=conversation.id, user_id=admin.id)
    claimed_at = first.conversation.taken_over_at

    second = claim(db, conversation_id=conversation.id, user_id=admin.id)

    assert second.conversation.taken_over_by_user_id == admin.id
    assert second.conversation.taken_over_at == claimed_at


def test_a_claim_on_a_conversation_another_admin_holds_names_them(db: Session) -> None:
    holder = _make_user(db)
    contender = _make_user(db)
    conversation = _make_conversation(db)
    claim(db, conversation_id=conversation.id, user_id=holder.id)

    with pytest.raises(ConversationHeldByAnother) as raised:
        claim(db, conversation_id=conversation.id, user_id=contender.id)

    assert raised.value.holder.id == holder.id
    assert holder.email in str(raised.value)
    assert _row(db, conversation.id).taken_over_by_user_id == holder.id


def test_any_admin_may_release_not_only_the_holder(db: Session) -> None:
    """Deliberately asymmetric with `claim` (`api-design.md:1579-1583`): a claim only its owner
    could undo leaves a client talking to nobody when that admin closes their laptop."""
    holder = _make_user(db)
    conversation = _make_conversation(db)
    claim(db, conversation_id=conversation.id, user_id=holder.id)

    detail = release(db, conversation_id=conversation.id)

    assert detail.conversation.status is ConversationStatus.BOT
    assert detail.conversation.taken_over_by_user_id is None
    assert detail.conversation.taken_over_at is None
    assert detail.holder is None


def test_releasing_a_conversation_the_bot_already_has_is_a_no_op_success(db: Session) -> None:
    conversation = _make_conversation(db)

    detail = release(db, conversation_id=conversation.id)

    assert detail.conversation.status is ConversationStatus.BOT
    assert detail.conversation.taken_over_by_user_id is None


def test_a_concurrent_claim_is_serialized_by_the_row_lock(
    committed_sessions: sessionmaker[Session],
) -> None:
    """A genuine two-connection race, not the sequential one the rolled-back `db` fixture would
    fake: two claims in one transaction are two calls in a row, and the second just reads the
    already-claimed row — which passes with `with_for_update()` deleted (**D-J**, **OB-17**).

    Thread A claims and holds the row open past its `flush()`. Thread B's claim is issued while
    A still holds the lock, so it must block inside `with_for_update()` until A commits —
    proven by asserting B's own call took at least as long as A held it — and then see A's
    committed claim rather than the stale `bot` A first read. Without the lock both read `bot`,
    both pass the check, and one admin's claim is silently discarded with a 200 in their hand.
    """
    committed = _make_committed_conversation(committed_sessions)
    hold_seconds = 0.4
    a_locked = threading.Event()
    b_elapsed: list[float] = []
    b_error: list[ConversationHeldByAnother] = []

    def hold_lock() -> None:
        with committed_sessions() as session:
            claim(session, conversation_id=committed.conversation_id, user_id=committed.holder_id)
            a_locked.set()
            time.sleep(hold_seconds)
            session.commit()

    def contend() -> None:
        a_locked.wait(timeout=5)
        start = time.monotonic()
        with committed_sessions() as session:
            try:
                claim(
                    session,
                    conversation_id=committed.conversation_id,
                    user_id=committed.contender_id,
                )
            except ConversationHeldByAnother as error:
                b_error.append(error)
        b_elapsed.append(time.monotonic() - start)

    try:
        holder = threading.Thread(target=hold_lock)
        contender = threading.Thread(target=contend)
        holder.start()
        contender.start()
        holder.join(timeout=5)
        contender.join(timeout=5)

        assert b_elapsed[0] >= hold_seconds * 0.8
        assert len(b_error) == 1
        assert b_error[0].holder.id == committed.holder_id
        with committed_sessions() as session:
            final = session.get_one(Conversation, committed.conversation_id)
        assert final.taken_over_by_user_id == committed.holder_id
    finally:
        _delete_committed_conversation(committed_sessions, committed)


def test_marking_read_clears_the_unread_count_without_touching_the_messages(
    db: Session,
) -> None:
    conversation = _make_conversation(db, last_message_at=NOON)
    _make_message(db, conversation, body="one", at=NOON - _minutes(2))
    _make_message(db, conversation, body="two", at=NOON)

    before = get_detail(db, conversation_id=conversation.id)
    after = mark_read(db, conversation_id=conversation.id)

    assert before.unread_count == 2
    assert after.unread_count == 0
    assert after.message_count == 2
    assert after.conversation.last_read_at is not None


def test_the_unread_count_is_the_messages_newer_than_the_watermark(db: Session) -> None:
    conversation = _make_conversation(db, last_message_at=NOON + _minutes(5))
    _make_message(db, conversation, body="read", at=NOON)
    _make_message(db, conversation, body="unread", at=NOON + _minutes(5))
    conversation.last_read_at = NOON + _minutes(1)
    db.flush()

    detail = get_detail(db, conversation_id=conversation.id)

    assert detail.message_count == 2
    assert detail.unread_count == 1


def test_linking_a_guardian_attaches_intake_to_the_thread(db: Session) -> None:
    guardian = _make_guardian(db)
    conversation = _make_conversation(db)

    linked = link_guardian(db, conversation=conversation, guardian_id=guardian.id)
    detail = get_detail(db, conversation_id=conversation.id)

    assert linked.guardian_id == guardian.id
    assert detail.guardian is not None
    assert detail.guardian.name == guardian.name


def test_a_second_flag_overwrites_the_first(db: Session) -> None:
    """The column answers "why does this need attention now", so a thread that failed to parse
    and later got stuck has to show the state it is actually in."""
    conversation = _make_conversation(db)

    flag(db, conversation=conversation, reason=FlagReason.PARSE_ERROR)
    first_flagged_at = conversation.flagged_at
    flag(db, conversation=conversation, reason=FlagReason.STUCK)

    assert conversation.flag_reason is FlagReason.STUCK
    assert conversation.flagged_at is not None
    assert first_flagged_at is not None


def test_a_flag_is_independent_of_who_is_answering(db: Session) -> None:
    """**P7-D**: `flag_reason` and `status` are two questions with two answers, and a flag
    raised while the bot was answering survives the takeover that follows it."""
    admin = _make_user(db)
    conversation = _make_conversation(db)
    flag(db, conversation=conversation, reason=FlagReason.GUARDIAN_LINK_REQUEST)

    detail = claim(db, conversation_id=conversation.id, user_id=admin.id)

    assert detail.conversation.status is ConversationStatus.HUMAN
    assert detail.conversation.flag_reason is FlagReason.GUARDIAN_LINK_REQUEST


def test_the_service_owns_no_http_and_no_transaction() -> None:
    """CONSTITUTION §4 and §6, pinned rather than reviewed: the router commits and maps, and a
    service that imported FastAPI would be the first one in the codebase to."""
    source = pathlib.Path(conversation_service.__file__).read_text()

    assert "from fastapi" not in source
    assert "import fastapi" not in source
    assert "HTTPException" not in source
    assert "db.commit()" not in source


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    """A factory of real, independently-committing sessions on `_test_engine`.

    The rolled-back `db` fixture shares one transaction, so two sessions from it can never
    contend for the same row lock — only sessions each bound to their own connection can, which
    is what `test_a_concurrent_claim_is_serialized_by_the_row_lock` needs.
    """
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@dataclass(frozen=True, slots=True)
class _CommittedConversation:
    conversation_id: uuid.UUID
    holder_id: uuid.UUID
    contender_id: uuid.UUID


def _make_committed_conversation(
    sessions: sessionmaker[Session],
) -> _CommittedConversation:
    """A conversation and two admins committed on their own connection, so a second connection
    can lock the row for real."""
    with sessions() as session:
        conversation = _make_conversation(session)
        holder = _make_user(session)
        contender = _make_user(session)
        session.commit()

        return _CommittedConversation(
            conversation_id=conversation.id, holder_id=holder.id, contender_id=contender.id
        )


def _delete_committed_conversation(
    sessions: sessionmaker[Session], row: _CommittedConversation
) -> None:
    with sessions() as session:
        session.execute(delete(Conversation).where(Conversation.id == row.conversation_id))
        session.execute(delete(User).where(User.id.in_([row.holder_id, row.contender_id])))
        session.commit()


def _blind_once() -> Callable[..., Conversation | None]:
    """`_conversation_for` as it behaves in the losing half of a race: it finds nothing on the
    call that decides whether to insert, and finds the winner's row on the recovery read."""
    calls: list[int] = []
    real = conversation_service._conversation_for

    def predicate(db: Session, *, phone_number: str) -> Conversation | None:
        calls.append(1)

        if len(calls) == 1:
            return None

        return real(db, phone_number=phone_number)

    return predicate


def _page(
    db: Session,
    *,
    q: str | None = None,
    status: ConversationStatus | None = None,
    unread: bool | None = None,
    flagged: bool | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[conversation_service.ConversationListItem], int]:
    return list_conversations(
        db, status=status, unread=unread, flagged=flagged, q=q, limit=limit, offset=offset
    )


def _marker() -> str:
    """The digits every conversation in one test shares, so `q` isolates it from the rows the
    test database carries over from earlier runs."""
    return f"{uuid.uuid4().int % 10**8:08d}"


def _phone_number(marker: str | None = None) -> str:
    suffix = f"{uuid.uuid4().int % 10**4:04d}"
    return f"+1{marker or _marker()}{suffix}"


def _minutes(count: int) -> datetime.timedelta:
    return datetime.timedelta(minutes=count)


def _make_conversation(
    db: Session,
    *,
    marker: str | None = None,
    phone_number: str | None = None,
    last_message_at: datetime.datetime = NOON,
) -> Conversation:
    conversation = Conversation(
        phone_number=phone_number or _phone_number(marker), last_message_at=last_message_at
    )
    db.add(conversation)
    db.flush()
    return conversation


def _make_message(
    db: Session, conversation: Conversation, *, body: str, at: datetime.datetime
) -> Message:
    message = Message(
        conversation_id=conversation.id,
        author_kind=MessageAuthor.CLIENT,
        body=body,
        status=MessageStatus.RECEIVED,
        created_at=at,
    )
    db.add(message)
    db.flush()
    return message


def _make_guardian(db: Session, *, name: str | None = None) -> Guardian:
    guardian = Guardian(
        name=name or f"Guardian {uuid.uuid4().hex[:8]}",
        phone_number=_phone_number(),
        is_active=True,
    )
    db.add(guardian)
    db.flush()
    return guardian


def _make_user(db: Session) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        hashed_password=hash_password("conversation-service-password"),
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()
    return user


def _conversation_count(db: Session, *, phone_number: str) -> int:
    return len(
        db.scalars(select(Conversation).where(Conversation.phone_number == phone_number)).all()
    )


def _row(db: Session, conversation_id: uuid.UUID) -> Conversation:
    db.expire_all()
    return db.get_one(Conversation, conversation_id)
