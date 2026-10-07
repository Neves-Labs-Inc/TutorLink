"""Marking a flagged conversation handled — REQ-134, the user's OQ-54 answer (2026-09-23).

`POST /api/conversations/{id}/handled` and `conversation_service.mark_handled`, and the
`flagged_at` that `GET /api/conversations/{id}` gains as the token the route compares
(`07D-CONTEXT.md` §4b).

Four things here are written to fail against a specific wrong implementation:

- **A flag the admin never saw is never cleared.** The stale-token case is one microsecond off,
  so a comparison that truncates to milliseconds, or one that ignores the token, goes red. The
  two-connection races stage the re-flag while the clear waits on the row lock: with the
  `_locked` read replaced by an unlocked `get`, the webhook-first order clears the webhook's
  `parse_error` instead of refusing, and the test fails.
- **A pending reactivation request is never unflagged.** Clearing a later `stuck` over a pending
  request must put the flag back to `reactivation_request` with a fresh `flagged_at`, and the
  request itself can only be ended by Approve — a route that cleared the flag outright fails.
- **Validation is 400, never 422 and never 500.** A timezone-less token is the sharp case: a
  plain `datetime` field would accept it and the comparison under the lock would raise
  `TypeError`.
- **Nothing reaches the guardian.** `twilio_service.send_whatsapp_message` is replaced with a
  function that raises, and the thread's message count is asserted unchanged.

Every negative case asserts the exact status **and** the exact `{"detail": "<string>"}` body.
The test database outlives the run, so every row is created under a `uuid4`-derived number and
the two-connection tests delete what they commit.
"""

import datetime
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.message import Message
from app.models.tutor import Tutor
from app.models.user import User
from app.routers import conversations as conversations_router
from app.routers.conversations import (
    CONVERSATION_NOT_FOUND_ERROR,
    FLAG_CHANGED_ERROR,
    REACTIVATION_FLAG_ERROR,
)
from app.security import create_access_token, hash_password
from app.services import conversation_service, twilio_service
from app.services.broadcast_service import ConversationUpdated
from app.services.conversation_service import (
    ConversationNotFound,
    FlagChanged,
    FlagNeedsReactivationDecision,
    flag,
    mark_handled,
    resolve_reactivation,
    touch_last_message,
)

PASSWORD = "correct horse battery staple"

NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)
# Microseconds on purpose: the token is compared exactly, and a value with none would let a
# millisecond-truncating client or comparison pass.
TOKEN = NOON.replace(microsecond=418367)
ONE_MICROSECOND = datetime.timedelta(microseconds=1)

HANDLED = "/api/conversations/{conversation_id}/handled"
CLEARABLE_REASONS = [
    FlagReason.STUCK,
    FlagReason.PARSE_ERROR,
    FlagReason.GUARDIAN_LINK_REQUEST,
    FlagReason.BOOKING_REQUEST,
    FlagReason.QUESTION,
]

HOLD_SECONDS = 0.4


# --- the service -------------------------------------------------------------------------------


@pytest.mark.parametrize("reason", CLEARABLE_REASONS)
def test_mark_handled_clears_the_flag_and_nothing_else(db: Session, reason: FlagReason) -> None:
    holder = _make_user(db)
    conversation = _make_conversation(
        db, reason=reason, holder=holder, last_read_at=NOON - _minutes(5)
    )

    detail = mark_handled(db, conversation_id=conversation.id, flagged_at=TOKEN)

    assert detail.conversation.flag_reason is None
    assert detail.conversation.flagged_at is None
    row = _row(db, conversation.id)
    assert row.flag_reason is None
    assert row.flagged_at is None
    assert row.status is ConversationStatus.HUMAN
    assert row.taken_over_by_user_id == holder.id
    assert row.last_read_at == NOON - _minutes(5)


def test_mark_handled_on_an_unflagged_conversation_is_a_no_op_whatever_the_token(
    db: Session,
) -> None:
    conversation = _make_conversation(db)

    detail = mark_handled(db, conversation_id=conversation.id, flagged_at=TOKEN)

    assert detail.conversation.flag_reason is None
    assert _row(db, conversation.id).flagged_at is None


@pytest.mark.parametrize(
    "stale_token",
    [TOKEN - ONE_MICROSECOND, TOKEN + ONE_MICROSECOND, TOKEN.replace(microsecond=418000)],
    ids=["a microsecond early", "a microsecond late", "truncated to milliseconds"],
)
def test_mark_handled_refuses_a_token_that_is_not_the_stored_one(
    db: Session, stale_token: datetime.datetime
) -> None:
    conversation = _make_conversation(db, reason=FlagReason.STUCK)

    with pytest.raises(FlagChanged):
        mark_handled(db, conversation_id=conversation.id, flagged_at=stale_token)

    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.STUCK
    assert row.flagged_at == TOKEN


def test_mark_handled_compares_the_token_by_instant_not_by_offset(db: Session) -> None:
    conversation = _make_conversation(db, reason=FlagReason.STUCK)
    same_instant = TOKEN.astimezone(datetime.timezone(datetime.timedelta(hours=2)))

    mark_handled(db, conversation_id=conversation.id, flagged_at=same_instant)

    assert _row(db, conversation.id).flag_reason is None


def test_mark_handled_refuses_a_reactivation_request_and_changes_nothing(db: Session) -> None:
    child = _make_child(db)
    conversation = _make_conversation(db, reason=FlagReason.REACTIVATION_REQUEST, child=child)

    with pytest.raises(FlagNeedsReactivationDecision):
        mark_handled(db, conversation_id=conversation.id, flagged_at=TOKEN)

    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.REACTIVATION_REQUEST
    assert row.flagged_at == TOKEN
    assert row.reactivation_child_id == child.id


def test_mark_handled_checks_the_token_before_the_reason(db: Session) -> None:
    """A stale token on a reactivation request is "the flag changed", not "approve or deny":
    the admin is looking at something else, and that is what they need to be told first."""
    conversation = _make_conversation(
        db, reason=FlagReason.REACTIVATION_REQUEST, child=_make_child(db)
    )

    with pytest.raises(FlagChanged):
        mark_handled(db, conversation_id=conversation.id, flagged_at=TOKEN - ONE_MICROSECOND)


@pytest.mark.parametrize("reason", CLEARABLE_REASONS)
def test_mark_handled_resurfaces_a_request_pending_under_a_later_flag(
    db: Session, reason: FlagReason
) -> None:
    child = _make_child(db)
    conversation = _make_conversation(db, reason=reason, child=child)

    detail = mark_handled(db, conversation_id=conversation.id, flagged_at=TOKEN)

    assert detail.conversation.flag_reason is FlagReason.REACTIVATION_REQUEST
    assert detail.reactivation_child is not None
    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.REACTIVATION_REQUEST
    assert row.flagged_at is not None
    assert row.flagged_at > TOKEN
    assert row.reactivation_child_id == child.id


def test_mark_handled_on_an_unknown_conversation_is_not_found(db: Session) -> None:
    with pytest.raises(ConversationNotFound):
        mark_handled(db, conversation_id=uuid.uuid4(), flagged_at=TOKEN)


# --- POST /api/conversations/{id}/handled ------------------------------------------------------


@pytest.mark.parametrize("reason", CLEARABLE_REASONS)
def test_marking_handled_clears_the_flag_and_takes_the_thread_off_the_flagged_list(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated], reason: FlagReason
) -> None:
    admin = _make_user(db)
    marker = _marker()
    conversation = _make_conversation(
        db, marker=marker, reason=reason, holder=admin, last_read_at=NOON - _minutes(5)
    )
    _make_message(db, conversation)
    listed_before = _flagged_total(api, admin, marker)

    response = _post_handled(api, admin, conversation.id, TOKEN.isoformat())
    body = response.json()

    assert response.status_code == 200
    assert body["flag_reason"] is None
    assert body["flagged_at"] is None
    assert body["status"] == "human"
    assert body["taken_over_by"] == {"id": str(admin.id), "display_name": admin.display_name}
    assert body["message_count"] == 1
    row = _row(db, conversation.id)
    assert row.flag_reason is None
    assert row.flagged_at is None
    assert row.status is ConversationStatus.HUMAN
    assert row.taken_over_by_user_id == admin.id
    assert row.last_read_at == NOON - _minutes(5)
    assert _message_count(db, conversation.id) == 1
    assert listed_before == 1
    assert _flagged_total(api, admin, marker) == 0
    assert [event.conversation["id"] for event in broadcasts] == [str(conversation.id)]
    assert broadcasts[0].frame()["type"] == "conversation.updated"
    assert broadcasts[0].conversation["flag_reason"] is None


def test_the_token_the_detail_returns_is_accepted_verbatim(api: TestClient, db: Session) -> None:
    """The dashboard echoes `ConversationRead.flagged_at` as a string it never re-serialises;
    the route has to accept exactly what the detail route rendered."""
    admin = _make_user(db)
    conversation = _make_conversation(db, reason=FlagReason.STUCK)
    token = api.get(f"/api/conversations/{conversation.id}", headers=_auth(admin)).json()[
        "flagged_at"
    ]

    response = _post_handled(api, admin, conversation.id, token)

    assert response.status_code == 200
    assert _row(db, conversation.id).flag_reason is None


def test_marking_an_unflagged_conversation_handled_is_a_no_op_200(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    """A double click, a retry or a second admin: the second request asks for the state already
    there. Each 200 still publishes, as takeover and release do."""
    admin = _make_user(db)
    conversation = _make_conversation(db, reason=FlagReason.PARSE_ERROR)

    first = _post_handled(api, admin, conversation.id, TOKEN.isoformat())
    second = _post_handled(api, admin, conversation.id, TOKEN.isoformat())

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    row = _row(db, conversation.id)
    assert row.flag_reason is None
    assert row.flagged_at is None
    assert len(broadcasts) == 2


def test_a_token_one_microsecond_off_is_409_and_changes_nothing(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, reason=FlagReason.STUCK)

    response = _post_handled(api, admin, conversation.id, (TOKEN - ONE_MICROSECOND).isoformat())

    _assert_detail(response, 409, FLAG_CHANGED_ERROR)
    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.STUCK
    assert row.flagged_at == TOKEN
    assert broadcasts == []


def test_a_reactivation_request_is_409_and_changes_nothing(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    conversation = _make_conversation(db, reason=FlagReason.REACTIVATION_REQUEST, child=child)

    response = _post_handled(api, admin, conversation.id, TOKEN.isoformat())

    _assert_detail(response, 409, REACTIVATION_FLAG_ERROR)
    row = _row(db, conversation.id)
    assert row.flag_reason is FlagReason.REACTIVATION_REQUEST
    assert row.flagged_at == TOKEN
    assert row.reactivation_child_id == child.id
    assert broadcasts == []


def test_a_pending_request_resurfaces_and_only_approve_then_ends_it(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    admin = _make_user(db)
    child = _make_child(db)
    conversation = _make_conversation(db, reason=FlagReason.STUCK, child=child)

    cleared = _post_handled(api, admin, conversation.id, TOKEN.isoformat())
    resurfaced = cleared.json()
    refused = _post_handled(api, admin, conversation.id, resurfaced["flagged_at"])
    approved = api.post(
        f"/api/conversations/{conversation.id}/reactivation/approve", headers=_auth(admin)
    )

    assert cleared.status_code == 200
    assert resurfaced["flag_reason"] == "reactivation_request"
    assert datetime.datetime.fromisoformat(resurfaced["flagged_at"]) > TOKEN
    assert resurfaced["reactivation_request"]["child"]["id"] == str(child.id)
    _assert_detail(refused, 409, REACTIVATION_FLAG_ERROR)
    assert approved.status_code == 200
    row = _row(db, conversation.id)
    assert row.reactivation_child_id is None
    assert row.flag_reason is None
    assert row.flagged_at is None
    assert db.get_one(Child, child.id).is_active is True
    assert len(broadcasts) == 2


def test_the_resurfaced_request_is_back_on_the_flagged_list(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    marker = _marker()
    conversation = _make_conversation(
        db, marker=marker, reason=FlagReason.GUARDIAN_LINK_REQUEST, child=_make_child(db)
    )

    _post_handled(api, admin, conversation.id, TOKEN.isoformat())
    listed = api.get(
        "/api/conversations", params={"q": marker, "flagged": "true"}, headers=_auth(admin)
    ).json()

    assert [row["flag_reason"] for row in listed["items"]] == ["reactivation_request"]


@pytest.mark.parametrize(
    "request_body",
    [
        {},
        {"json": {}},
        {"json": {"flagged_at": None}},
        {"json": {"flagged_at": "yesterday"}},
        {"json": {"flagged_at": "2026-01-05T12:00:00.418367"}},
        {"content": "not json", "headers": {"Content-Type": "application/json"}},
    ],
    ids=["no body", "no flagged_at", "null", "malformed", "naive", "not json"],
)
def test_an_invalid_body_is_400_never_422_or_500(
    api: TestClient,
    db: Session,
    broadcasts: list[ConversationUpdated],
    request_body: dict[str, Any],
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, reason=FlagReason.STUCK)
    headers = {**_auth(admin), **request_body.get("headers", {})}
    fields = {key: value for key, value in request_body.items() if key != "headers"}

    response = api.post(HANDLED.format(conversation_id=conversation.id), headers=headers, **fields)

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)
    assert _row(db, conversation.id).flag_reason is FlagReason.STUCK
    assert broadcasts == []


def test_an_unknown_conversation_is_404(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    admin = _make_user(db)

    response = _post_handled(api, admin, uuid.uuid4(), TOKEN.isoformat())

    _assert_detail(response, 404, CONVERSATION_NOT_FOUND_ERROR)
    assert broadcasts == []


def test_a_malformed_conversation_id_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)

    response = api.post(
        HANDLED.format(conversation_id="not-a-uuid"),
        json={"flagged_at": TOKEN.isoformat()},
        headers=_auth(admin),
    )

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("reason", CLEARABLE_REASONS)
def test_nothing_is_written_to_the_thread_or_sent_to_the_guardian(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, reason: FlagReason
) -> None:
    def refuse_to_send(*, to: str, body: str) -> str:
        raise AssertionError(f"a message was sent to {to}")

    monkeypatch.setattr(twilio_service, "send_whatsapp_message", refuse_to_send)
    admin = _make_user(db)
    conversation = _make_conversation(db, reason=reason)

    response = _post_handled(api, admin, conversation.id, TOKEN.isoformat())

    assert response.status_code == 200
    assert response.json()["message_count"] == 0
    assert _message_count(db, conversation.id) == 0


# --- flagged_at on the read shapes -----------------------------------------------------------


def test_the_detail_carries_flagged_at_and_the_list_does_not(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    marker = _marker()
    flagged = _make_conversation(db, marker=marker, reason=FlagReason.STUCK)
    unflagged = _make_conversation(db, marker=marker)

    flagged_body = api.get(f"/api/conversations/{flagged.id}", headers=_auth(admin)).json()
    unflagged_body = api.get(f"/api/conversations/{unflagged.id}", headers=_auth(admin)).json()
    items = api.get("/api/conversations", params={"q": marker}, headers=_auth(admin)).json()[
        "items"
    ]

    assert datetime.datetime.fromisoformat(flagged_body["flagged_at"]) == TOKEN
    assert "flagged_at" in unflagged_body
    assert unflagged_body["flagged_at"] is None
    assert len(items) == 2
    assert all("flagged_at" not in item for item in items)


# --- RBAC ----------------------------------------------------------------------------------


def test_a_tutor_is_refused_and_the_flag_stays(api: TestClient, db: Session) -> None:
    tutor = _make_tutor_user(db)
    conversation = _make_conversation(db, reason=FlagReason.STUCK)

    response = _post_handled(api, tutor, conversation.id, TOKEN.isoformat())

    assert response.status_code == 403
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)
    assert _row(db, conversation.id).flag_reason is FlagReason.STUCK


def test_an_unauthenticated_request_is_401_not_403(api: TestClient) -> None:
    response = api.post(
        HANDLED.format(conversation_id=uuid.uuid4()), json={"flagged_at": TOKEN.isoformat()}
    )

    assert response.status_code == 401
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)


def test_a_developer_may_mark_a_conversation_handled(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    conversation = _make_conversation(db, reason=FlagReason.STUCK)

    response = _post_handled(api, developer, conversation.id, TOKEN.isoformat())

    assert response.status_code == 200


def test_no_takeover_is_needed_and_none_is_taken(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, reason=FlagReason.STUCK)

    response = _post_handled(api, admin, conversation.id, TOKEN.isoformat())

    assert response.status_code == 200
    assert response.json()["status"] == "bot"
    assert response.json()["taken_over_by"] is None


# --- two connections: a re-flag -----------------------------------------------------------------


def test_a_reflag_committed_first_makes_the_clear_wait_and_refuse(
    committed_sessions: sessionmaker[Session],
) -> None:
    """Criterion 11 (a). The webhook-shaped turn has locked the row with its `last_message_at`
    update and re-flagged `parse_error`, and the clear is issued with the old token while it
    holds the lock. The clear has to block, then compare against the committed re-flag and
    refuse. With an unlocked read it would compare against the old flag, pass, and its update
    would land after the turn's commit — erasing a `parse_error` nobody saw."""
    committed = _make_committed_flag(committed_sessions, child=False)
    turn_locked = threading.Event()
    errors: list[Exception] = []
    refused: list[FlagChanged] = []
    reflagged_at: list[datetime.datetime] = []
    clear_elapsed: list[float] = []

    def turn() -> None:
        try:
            with committed_sessions() as session:
                reflagged_at.append(_reflag_like_the_webhook(session, committed.conversation_id))
                turn_locked.set()
                time.sleep(HOLD_SECONDS)
                session.commit()
        except Exception as error:
            errors.append(error)
            turn_locked.set()

    def clear() -> None:
        turn_locked.wait(timeout=5)
        start = time.monotonic()
        try:
            with committed_sessions() as session:
                mark_handled(session, conversation_id=committed.conversation_id, flagged_at=TOKEN)
                session.commit()
        except FlagChanged as error:
            refused.append(error)
        except Exception as error:
            errors.append(error)
        clear_elapsed.append(time.monotonic() - start)

    try:
        _run_together(turn, clear)

        assert errors == []
        assert len(refused) == 1
        assert clear_elapsed[0] >= HOLD_SECONDS * 0.8
        final = _committed_row(committed_sessions, committed.conversation_id)
        assert final.flag_reason is FlagReason.PARSE_ERROR
        assert final.flagged_at == reflagged_at[0]
    finally:
        _delete_committed_flag(committed_sessions, committed)


def test_a_reflag_after_the_clear_waits_for_it_and_stands(
    committed_sessions: sessionmaker[Session],
) -> None:
    """Criterion 11 (b). The clear holds the row lock; the turn is issued then, and its
    `last_message_at` update has to wait for the clear's commit. Its flag then lands on the
    cleared row and is the final state — the clear loses nothing that came after it."""
    committed = _make_committed_flag(committed_sessions, child=False)
    clear_locked = threading.Event()
    errors: list[Exception] = []
    reflagged_at: list[datetime.datetime] = []
    turn_elapsed: list[float] = []

    def clear() -> None:
        try:
            with committed_sessions() as session:
                mark_handled(session, conversation_id=committed.conversation_id, flagged_at=TOKEN)
                clear_locked.set()
                time.sleep(HOLD_SECONDS)
                session.commit()
        except Exception as error:
            errors.append(error)
            clear_locked.set()

    def turn() -> None:
        clear_locked.wait(timeout=5)
        start = time.monotonic()
        try:
            with committed_sessions() as session:
                reflagged_at.append(_reflag_like_the_webhook(session, committed.conversation_id))
                session.commit()
        except Exception as error:
            errors.append(error)
        turn_elapsed.append(time.monotonic() - start)

    try:
        _run_together(clear, turn)

        assert errors == []
        assert turn_elapsed[0] >= HOLD_SECONDS * 0.8
        final = _committed_row(committed_sessions, committed.conversation_id)
        assert final.flag_reason is FlagReason.PARSE_ERROR
        assert final.flagged_at == reflagged_at[0]
    finally:
        _delete_committed_flag(committed_sessions, committed)


# --- two connections: Approve ---------------------------------------------------------------


def test_an_approval_waits_behind_the_clear_and_both_complete(
    committed_sessions: sessionmaker[Session],
) -> None:
    """Criterion 12, the clear first. It resurfaces the pending request under `stuck`, and the
    approval — conversation first, then the child — waits on the conversation and then ends the
    request it resurfaced. Neither deadlocks: the clear holds no second lock."""
    committed = _make_committed_flag(committed_sessions, child=True)
    clear_locked = threading.Event()
    errors: list[Exception] = []
    approval_elapsed: list[float] = []

    def clear() -> None:
        try:
            with committed_sessions() as session:
                mark_handled(session, conversation_id=committed.conversation_id, flagged_at=TOKEN)
                clear_locked.set()
                time.sleep(HOLD_SECONDS)
                session.commit()
        except Exception as error:
            errors.append(error)
            clear_locked.set()

    def approval() -> None:
        clear_locked.wait(timeout=5)
        start = time.monotonic()
        try:
            with committed_sessions() as session:
                resolve_reactivation(
                    session, conversation_id=committed.conversation_id, approve=True
                )
                session.commit()
        except Exception as error:
            errors.append(error)
        approval_elapsed.append(time.monotonic() - start)

    try:
        _run_together(clear, approval)

        assert errors == []
        assert approval_elapsed[0] >= HOLD_SECONDS * 0.8
        _assert_request_ended(committed_sessions, committed)
    finally:
        _delete_committed_flag(committed_sessions, committed)


def test_the_clear_waits_behind_an_approval_and_both_complete(
    committed_sessions: sessionmaker[Session],
) -> None:
    """Criterion 12, the approval first. It ends the request but keeps the later `stuck` with
    its `flagged_at`, so the clear — waiting on the conversation with `stuck`'s token — then
    finds a matching token and no request underneath, and clears."""
    committed = _make_committed_flag(committed_sessions, child=True)
    approval_locked = threading.Event()
    errors: list[Exception] = []
    clear_elapsed: list[float] = []

    def approval() -> None:
        try:
            with committed_sessions() as session:
                resolve_reactivation(
                    session, conversation_id=committed.conversation_id, approve=True
                )
                approval_locked.set()
                time.sleep(HOLD_SECONDS)
                session.commit()
        except Exception as error:
            errors.append(error)
            approval_locked.set()

    def clear() -> None:
        approval_locked.wait(timeout=5)
        start = time.monotonic()
        try:
            with committed_sessions() as session:
                mark_handled(session, conversation_id=committed.conversation_id, flagged_at=TOKEN)
                session.commit()
        except Exception as error:
            errors.append(error)
        clear_elapsed.append(time.monotonic() - start)

    try:
        _run_together(approval, clear)

        assert errors == []
        assert clear_elapsed[0] >= HOLD_SECONDS * 0.8
        _assert_request_ended(committed_sessions, committed)
    finally:
        _delete_committed_flag(committed_sessions, committed)


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def broadcasts(monkeypatch: pytest.MonkeyPatch) -> list[ConversationUpdated]:
    """Every `conversation.updated` the route publishes. Autouse, exactly as in
    `test_conversation_routes.py`: no test here may reach the real `publish`."""
    recorded: list[ConversationUpdated] = []
    monkeypatch.setattr(
        conversations_router,
        "publish",
        lambda event: recorded.append(event),
    )

    return recorded


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    """Real, independently-committing sessions: the rolled-back `db` fixture shares one
    transaction, so two sessions from it can never contend for a row lock."""
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@dataclass(frozen=True, slots=True)
class _CommittedFlag:
    conversation_id: uuid.UUID
    child_id: uuid.UUID | None


def _make_committed_flag(sessions: sessionmaker[Session], *, child: bool) -> _CommittedFlag:
    """A conversation flagged `stuck` at `TOKEN`, over a pending request for an inactive child
    when `child` is set — the P7D-A overwrite — committed on its own connection."""
    with sessions() as session:
        requested = _make_child(session) if child else None
        conversation = _make_conversation(session, reason=FlagReason.STUCK, child=requested)
        session.commit()

        return _CommittedFlag(
            conversation_id=conversation.id,
            child_id=None if requested is None else requested.id,
        )


def _delete_committed_flag(sessions: sessionmaker[Session], row: _CommittedFlag) -> None:
    with sessions() as session:
        session.execute(delete(Conversation).where(Conversation.id == row.conversation_id))
        if row.child_id is not None:
            session.execute(delete(Child).where(Child.id == row.child_id))
        session.commit()


def _reflag_like_the_webhook(session: Session, conversation_id: uuid.UUID) -> datetime.datetime:
    """A webhook turn's writes in the webhook's order: the unlocked read `resolve_or_create`
    makes, then `record_inbound`'s `last_message_at` update — which takes the conversation's row
    lock — and only then the bot's `flag()`."""
    conversation = conversation_service.get(session, conversation_id=conversation_id)
    touch_last_message(
        session, conversation=conversation, at=datetime.datetime.now(tz=datetime.UTC)
    )
    flag(session, conversation=conversation, reason=FlagReason.PARSE_ERROR)

    return conversation.flagged_at


def _run_together(first: Callable[[], None], second: Callable[[], None]) -> None:
    threads = [threading.Thread(target=first), threading.Thread(target=second)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert not any(thread.is_alive() for thread in threads)


def _committed_row(sessions: sessionmaker[Session], conversation_id: uuid.UUID) -> Conversation:
    with sessions() as session:
        return session.get_one(Conversation, conversation_id)


def _assert_request_ended(sessions: sessionmaker[Session], row: _CommittedFlag) -> None:
    with sessions() as session:
        conversation = session.get_one(Conversation, row.conversation_id)
        child = session.get_one(Child, row.child_id)

        assert conversation.reactivation_child_id is None
        assert conversation.flag_reason is None
        assert conversation.flagged_at is None
        assert child.is_active is True


def _post_handled(api: TestClient, user: User, conversation_id: uuid.UUID, token: str) -> Response:
    return api.post(
        HANDLED.format(conversation_id=conversation_id),
        json={"flagged_at": token},
        headers=_auth(user),
    )


def _flagged_total(api: TestClient, user: User, marker: str) -> int:
    return api.get(
        "/api/conversations", params={"q": marker, "flagged": "true"}, headers=_auth(user)
    ).json()["total"]


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _marker() -> str:
    return f"{uuid.uuid4().int % 10**8:08d}"


def _minutes(count: int) -> datetime.timedelta:
    return datetime.timedelta(minutes=count)


def _make_conversation(
    db: Session,
    *,
    marker: str | None = None,
    reason: FlagReason | None = None,
    holder: User | None = None,
    last_read_at: datetime.datetime | None = None,
    child: Child | None = None,
) -> Conversation:
    """A conversation flagged `reason` at `TOKEN`, with a pending request for `child` when one
    is given — under whatever `reason` says, standing in for a flag raised after it."""
    conversation = Conversation(
        phone_number=f"+1{marker or _marker()}{uuid.uuid4().int % 10**4:04d}",
        status=ConversationStatus.BOT if holder is None else ConversationStatus.HUMAN,
        taken_over_by_user_id=None if holder is None else holder.id,
        taken_over_at=None if holder is None else NOON,
        last_message_at=NOON,
        last_read_at=last_read_at,
        flag_reason=reason,
        flagged_at=None if reason is None else TOKEN,
        reactivation_child_id=None if child is None else child.id,
    )
    db.add(conversation)
    db.flush()

    return conversation


def _make_message(db: Session, conversation: Conversation) -> Message:
    message = Message(
        conversation_id=conversation.id,
        author_kind=MessageAuthor.CLIENT,
        body="asdfgh",
        status=MessageStatus.RECEIVED,
        created_at=NOON,
    )
    db.add(message)
    db.flush()

    return message


def _make_child(db: Session) -> Child:
    child = Child(
        name=f"Child {uuid.uuid4().hex[:8]}",
        grade_level=3,
        school_name="Elm Primary",
        is_active=False,
    )
    db.add(child)
    db.flush()

    return child


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
        display_name="Test User",
        hashed_password=hash_password(PASSWORD),
        role=role,
        tutor_id=tutor_id,
        is_active=True,
    )
    db.add(user)
    db.flush()

    return user


def _make_tutor_user(db: Session) -> User:
    suffix = uuid.uuid4().hex[:12]
    tutor = Tutor(
        name=f"Tutor {suffix}",
        phone_number=f"+1{suffix[:10]}",
        email=f"tutor-{suffix}@example.com",
    )
    db.add(tutor)
    db.flush()

    return _make_user(db, role=UserRole.TUTOR, tutor_id=tutor.id)


def _message_count(db: Session, conversation_id: uuid.UUID) -> int:
    return db.execute(
        select(func.count()).select_from(Message).where(Message.conversation_id == conversation_id)
    ).scalar_one()


def _row(db: Session, conversation_id: uuid.UUID) -> Conversation:
    db.expire_all()
    return db.get_one(Conversation, conversation_id)
