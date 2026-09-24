"""Approving and denying a reactivation request over HTTP — REQ-130, REQ-131.

`POST /api/conversations/{id}/reactivation/approve` and `…/deny`, and the `reactivation_request`
field `GET /api/conversations/{id}` gains for them (`07D-CONTEXT.md` §4).

Three things here are written to fail against a specific wrong implementation:

- **Nothing reaches the guardian** (OQ-72). `twilio_service.send_whatsapp_message` is replaced
  with a function that raises, and the thread's message count is asserted unchanged — a route
  that wrote an admin message, or sent one, fails rather than passing quietly.
- **The flag is cleared only while it is still the request's.** A `stuck` raised after the
  request survives both routes, which a route that cleared the flag unconditionally fails.
- **RBAC.** A tutor token gets 403 and an anonymous one 401 on both, and the 403 rather than a
  500 is also what proves neither route takes a tutor scope (§15).

Every negative case asserts the exact status **and** the exact `{"detail": "<string>"}` body.
The test database outlives the run, so every row is created under a `uuid4`-derived name.
"""

import datetime
import uuid

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, FlagReason, UserRole
from app.models.message import Message
from app.models.tutor import Tutor
from app.models.user import User
from app.routers import conversations as conversations_router
from app.routers.conversations import CONVERSATION_NOT_FOUND_ERROR, NO_REACTIVATION_PENDING_ERROR
from app.security import create_access_token, hash_password
from app.services import twilio_service
from app.services.broadcast_service import ConversationUpdated
PASSWORD = "correct horse battery staple"

NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)

APPROVE = "/api/conversations/{conversation_id}/reactivation/approve"
DENY = "/api/conversations/{conversation_id}/reactivation/deny"
REACTIVATION_ROUTES = [APPROVE, DENY]

CONVERSATION_READ_KEYS = {
    "id",
    "phone_number",
    "guardian",
    "status",
    "taken_over_by",
    "taken_over_at",
    "last_message_at",
    "last_read_at",
    "flag_reason",
    "flagged_at",
    "message_count",
    "unread_count",
    "created_at",
    "reactivation_request",
}


# --- GET /api/conversations/{id} ---------------------------------------------------------------


def test_the_detail_names_the_child_a_pending_request_is_for(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    child = _make_child(db, is_active=False)
    conversation = _make_conversation(db, child=child)

    body = api.get(f"/api/conversations/{conversation.id}", headers=_auth(admin)).json()

    assert body["flag_reason"] == "reactivation_request"
    assert body["reactivation_request"] == {
        "child": {"id": str(child.id), "name": child.name, "is_active": False}
    }


def test_the_detail_carries_a_null_request_when_nothing_is_pending(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db)

    body = api.get(f"/api/conversations/{conversation.id}", headers=_auth(admin)).json()

    assert "reactivation_request" in body
    assert body["reactivation_request"] is None


def test_the_list_shape_is_unchanged_by_a_pending_request(api: TestClient, db: Session) -> None:
    """The list's `flag_reason` already carries the badge; the request is the thread's."""
    admin = _make_user(db)
    marker = _marker()
    _make_conversation(db, marker=marker, child=_make_child(db, is_active=False))

    item = api.get("/api/conversations", params={"q": marker}, headers=_auth(admin)).json()[
        "items"
    ][0]

    assert "reactivation_request" not in item
    assert item["flag_reason"] == "reactivation_request"


# --- approve and deny ------------------------------------------------------------------------


def test_approving_reactivates_the_child_and_ends_the_request(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    admin = _make_user(db)
    child = _make_child(db, is_active=False)
    conversation = _make_conversation(db, child=child)

    response = api.post(APPROVE.format(conversation_id=conversation.id), headers=_auth(admin))
    body = response.json()

    assert response.status_code == 200
    assert set(body) == CONVERSATION_READ_KEYS
    assert body["reactivation_request"] is None
    assert body["flag_reason"] is None
    row = _row(db, conversation.id)
    assert row.reactivation_child_id is None
    assert row.flagged_at is None
    assert db.get_one(Child, child.id).is_active is True
    assert [event.conversation["id"] for event in broadcasts] == [str(conversation.id)]
    assert broadcasts[0].frame()["type"] == "conversation.updated"


def test_denying_ends_the_request_and_leaves_the_child_inactive(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    admin = _make_user(db)
    child = _make_child(db, is_active=False)
    conversation = _make_conversation(db, child=child)

    response = api.post(DENY.format(conversation_id=conversation.id), headers=_auth(admin))
    body = response.json()

    assert response.status_code == 200
    assert set(body) == CONVERSATION_READ_KEYS
    assert body["reactivation_request"] is None
    assert body["flag_reason"] is None
    assert _row(db, conversation.id).reactivation_child_id is None
    assert db.get_one(Child, child.id).is_active is False
    assert [event.conversation["id"] for event in broadcasts] == [str(conversation.id)]


@pytest.mark.parametrize(("path", "active_after"), [(APPROVE, True), (DENY, False)])
def test_a_flag_raised_after_the_request_survives_its_resolution(
    api: TestClient, db: Session, path: str, active_after: bool
) -> None:
    admin = _make_user(db)
    child = _make_child(db, is_active=False)
    conversation = _make_conversation(db, child=child, flag_reason=FlagReason.STUCK)

    response = api.post(path.format(conversation_id=conversation.id), headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["flag_reason"] == "stuck"
    row = _row(db, conversation.id)
    assert row.reactivation_child_id is None
    assert row.flag_reason is FlagReason.STUCK
    assert row.flagged_at == NOON
    assert db.get_one(Child, child.id).is_active is active_after


def test_approving_a_child_that_is_already_active_is_200_and_ends_the_request(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    child = _make_child(db, is_active=True)
    conversation = _make_conversation(db, child=child)

    response = api.post(APPROVE.format(conversation_id=conversation.id), headers=_auth(admin))

    assert response.status_code == 200
    assert _row(db, conversation.id).reactivation_child_id is None
    assert db.get_one(Child, child.id).is_active is True


def test_no_takeover_is_needed_and_none_is_taken(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, child=_make_child(db, is_active=False))

    response = api.post(APPROVE.format(conversation_id=conversation.id), headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["status"] == "bot"
    assert response.json()["taken_over_by"] is None


@pytest.mark.parametrize("path", REACTIVATION_ROUTES)
def test_nothing_is_written_to_the_thread_or_sent_to_the_guardian(
    api: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    """OQ-72: the decision is the admin's and the office's; the guardian hears nothing."""

    def refuse_to_send(*, to: str, body: str) -> str:
        raise AssertionError(f"a message was sent to {to}")

    monkeypatch.setattr(twilio_service, "send_whatsapp_message", refuse_to_send)
    admin = _make_user(db)
    conversation = _make_conversation(db, child=_make_child(db, is_active=False))

    response = api.post(path.format(conversation_id=conversation.id), headers=_auth(admin))

    assert response.status_code == 200
    assert response.json()["message_count"] == 0
    assert _message_count(db, conversation.id) == 0


@pytest.mark.parametrize("path", REACTIVATION_ROUTES)
def test_nothing_pending_is_409_and_changes_nothing(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated], path: str
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, flag_reason=FlagReason.GUARDIAN_LINK_REQUEST)

    response = api.post(path.format(conversation_id=conversation.id), headers=_auth(admin))

    _assert_detail(response, 409, NO_REACTIVATION_PENDING_ERROR)
    assert _row(db, conversation.id).flag_reason is FlagReason.GUARDIAN_LINK_REQUEST
    assert broadcasts == []


@pytest.mark.parametrize("path", REACTIVATION_ROUTES)
def test_an_unknown_conversation_is_404(api: TestClient, db: Session, path: str) -> None:
    admin = _make_user(db)

    response = api.post(path.format(conversation_id=uuid.uuid4()), headers=_auth(admin))

    _assert_detail(response, 404, CONVERSATION_NOT_FOUND_ERROR)


@pytest.mark.parametrize("path", REACTIVATION_ROUTES)
def test_a_malformed_conversation_id_is_400_not_422(
    api: TestClient, db: Session, path: str
) -> None:
    admin = _make_user(db)

    response = api.post(path.format(conversation_id="not-a-uuid"), headers=_auth(admin))

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)


# --- RBAC ----------------------------------------------------------------------------------


@pytest.mark.parametrize("path", REACTIVATION_ROUTES)
def test_a_tutor_is_refused_and_the_request_stays_pending(
    api: TestClient, db: Session, path: str
) -> None:
    tutor = _make_tutor_user(db)
    child = _make_child(db, is_active=False)
    conversation = _make_conversation(db, child=child)

    response = api.post(path.format(conversation_id=conversation.id), headers=_auth(tutor))

    assert response.status_code == 403
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)
    assert _row(db, conversation.id).reactivation_child_id == child.id


@pytest.mark.parametrize("path", REACTIVATION_ROUTES)
def test_an_unauthenticated_request_is_401_not_403(api: TestClient, path: str) -> None:
    response = api.post(path.format(conversation_id=uuid.uuid4()))

    assert response.status_code == 401
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("path", REACTIVATION_ROUTES)
def test_a_developer_may_resolve_a_request(api: TestClient, db: Session, path: str) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    conversation = _make_conversation(db, child=_make_child(db, is_active=False))

    response = api.post(path.format(conversation_id=conversation.id), headers=_auth(developer))

    assert response.status_code == 200


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def broadcasts(monkeypatch: pytest.MonkeyPatch) -> list[ConversationUpdated]:
    """Every `conversation.updated` the routes publish. Autouse, exactly as in
    `test_conversation_routes.py`: no test here may reach the real `publish`."""
    recorded: list[ConversationUpdated] = []
    monkeypatch.setattr(
        conversations_router,
        "publish",
        lambda event: recorded.append(event),
    )

    return recorded


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _marker() -> str:
    return f"{uuid.uuid4().int % 10**8:08d}"


def _make_conversation(
    db: Session,
    *,
    marker: str | None = None,
    child: Child | None = None,
    flag_reason: FlagReason | None = None,
) -> Conversation:
    """A conversation, with a pending request for `child` when one is given. `flag_reason`
    overrides the request's own reason, standing in for a flag raised after it."""
    if flag_reason is None and child is not None:
        flag_reason = FlagReason.REACTIVATION_REQUEST

    conversation = Conversation(
        phone_number=f"+1{marker or _marker()}{uuid.uuid4().int % 10**4:04d}",
        status=ConversationStatus.BOT,
        last_message_at=NOON,
        flag_reason=flag_reason,
        flagged_at=None if flag_reason is None else NOON,
        reactivation_child_id=None if child is None else child.id,
    )
    db.add(conversation)
    db.flush()

    return conversation


def _make_child(db: Session, *, is_active: bool) -> Child:
    child = Child(
        name=f"Child {uuid.uuid4().hex[:8]}",
        grade_level=3,
        school_name="Elm Primary",
        is_active=is_active,
    )
    db.add(child)
    db.flush()

    return child


def _make_user(
    db: Session, *, role: UserRole = UserRole.ADMIN, tutor_id: uuid.UUID | None = None
) -> User:
    user = User(
        email=f"admin-{uuid.uuid4().hex[:12]}@example.com",
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
