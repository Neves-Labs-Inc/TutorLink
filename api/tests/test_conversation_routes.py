"""The six `/api/conversations` endpoints over HTTP — REQ-090, REQ-091.

Three groups of assertion here are written to fail against a specific wrong implementation
rather than merely to pass against the right one:

- **`total` counts the filtered query before paging** (§8). Every list assertion asks for a
  page **shorter** than the match set, so a `total` computed as `len(items)` goes red. The
  sharp case is the thread: `before` windows `items` and deliberately does **not** narrow
  `total`, so `test_before_windows_the_items_without_narrowing_the_total` fails if somebody
  ever "fixes" the two into agreement.
- **The takeover decides once.** Two claims issued one after the other are two calls in a row
  and the second simply reads the claimed row — which passes with `with_for_update()` deleted.
  `test_a_takeover_waits_behind_a_held_row_lock_and_is_409` drives a second real connection
  that holds the lock open, so the route has to block and then see the committed claim.
- **RBAC.** A tutor token gets 403 and an anonymous one 401 on all six, and the 403 rather
  than a 500 is also what proves no route here takes `TutorScope` — an unread scope arms the
  `do_orm_execute` guard and 500s any query touching a tutor-owned table (§15).

Every negative case asserts the exact status **and** the exact `{"detail": "<string>"}` body:
`status_code != 200` would pass on a 500.

The test database outlives the run, so no assertion is made on a global row count. Every list
test tags its conversations with a `uuid4`-derived marker inside the phone number and filters
on it with `?q=`, which is the same isolation `test_conversation_service.py` uses.
"""

import datetime
import pathlib
import threading
import time
import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import delete
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    FlagReason,
    Language,
    MessageAuthor,
    MessageStatus,
    UserRole,
)
from app.models.guardian import Guardian
from app.models.message import Message
from app.models.tutor import Tutor
from app.models.user import User
from app.routers import conversations as conversations_router
from app.routers.conversations import CONVERSATION_NOT_FOUND_ERROR, HELD_BY_ANOTHER_ERROR
from app.security import create_access_token, hash_password
from app.services.broadcast_service import BroadcastEvent, ConversationUpdated
from app.services.conversation_service import claim

PASSWORD = "correct horse battery staple"

# Well in the past, never "today": `POST /read` stamps the watermark from the real clock, and a
# fixture timestamp on the day the suite runs would make the unread assertions depend on the
# hour they ran at.
NOON = datetime.datetime(2026, 1, 5, 12, 0, tzinfo=datetime.UTC)

ID_BEARING_ROUTES = [
    ("get", "/api/conversations/{conversation_id}"),
    ("get", "/api/conversations/{conversation_id}/messages"),
    ("post", "/api/conversations/{conversation_id}/takeover"),
    ("delete", "/api/conversations/{conversation_id}/takeover"),
    ("post", "/api/conversations/{conversation_id}/read"),
]
ALL_ROUTES = [("get", "/api/conversations"), *ID_BEARING_ROUTES]


# --- GET /api/conversations ------------------------------------------------------------------


def test_the_list_returns_the_page_envelope_never_a_bare_array(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    marker = _marker()
    _make_conversation(db, marker=marker)

    body = api.get("/api/conversations", params={"q": marker}, headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert isinstance(body["items"], list)
    assert body["page"] == 1
    assert body["page_size"] == 20


def test_a_list_item_carries_every_field_the_inbox_renders(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    guardian = _make_guardian(db)
    marker = _marker()
    conversation = _make_conversation(
        db, marker=marker, guardian=guardian, holder=admin, flag_reason=FlagReason.STUCK
    )
    _make_message(db, conversation, body="older", at=NOON - _minutes(5))
    _make_message(db, conversation, body="Could we move Tommy?", at=NOON)

    item = api.get("/api/conversations", params={"q": marker}, headers=_auth(admin)).json()[
        "items"
    ][0]

    assert set(item) == {
        "id",
        "phone_number",
        "guardian",
        "status",
        "taken_over_by",
        "last_message_at",
        "last_message_preview",
        "unread",
        "flag_reason",
    }
    assert item["guardian"] == {"id": str(guardian.id), "name": guardian.name}
    assert item["taken_over_by"] == {"id": str(admin.id), "display_name": admin.display_name}
    assert item["last_message_preview"] == "Could we move Tommy?"
    assert item["status"] == "human"
    assert item["flag_reason"] == "stuck"


def test_the_list_reads_as_an_inbox_newest_activity_first(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    marker = _marker()
    inbox = _make_inbox(db, marker=marker, admin=admin)

    body = api.get("/api/conversations", params={"q": marker}, headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(row.id) for row in inbox]


@pytest.mark.parametrize(
    ("query", "expected_total"),
    [
        ({}, 4),
        ({"status": "human"}, 1),
        ({"status": "bot"}, 3),
        ({"unread": "true"}, 2),
        ({"unread": "false"}, 2),
        ({"flagged": "true"}, 2),
        ({"flagged": "false"}, 2),
        ({"flagged": "true", "status": "bot"}, 1),
        ({"flagged": "true", "unread": "true"}, 1),
    ],
)
def test_total_counts_the_filtered_query_before_paging(
    api: TestClient, db: Session, query: dict[str, str], expected_total: int
) -> None:
    """§8, asserted with a page deliberately shorter than the match set: a `total` computed
    from the returned rows would agree with every one of these on `page_size=1` only by
    accident, and disagrees on all but the two singletons."""
    admin = _make_user(db)
    marker = _marker()
    _make_inbox(db, marker=marker, admin=admin)

    body = api.get(
        "/api/conversations",
        params={"q": marker, "page_size": 1, **query},
        headers=_auth(admin),
    ).json()

    assert len(body["items"]) == 1
    assert body["total"] == expected_total


def test_a_flag_and_a_status_are_independent_axes(api: TestClient, db: Session) -> None:
    """**P7-D**: a conversation can be flagged while the bot still holds it, and the two
    filters must not collapse into one another."""
    admin = _make_user(db)
    marker = _marker()
    flagged_bot = _make_conversation(
        db, marker=marker, flag_reason=FlagReason.GUARDIAN_LINK_REQUEST
    )
    _make_conversation(db, marker=marker, holder=admin)

    body = api.get(
        "/api/conversations",
        params={"q": marker, "flagged": "true", "status": "bot"},
        headers=_auth(admin),
    ).json()

    assert [row["id"] for row in body["items"]] == [str(flagged_bot.id)]
    assert body["items"][0]["flag_reason"] == "guardian_link_request"


def test_the_second_page_continues_where_the_first_stopped(api: TestClient, db: Session) -> None:
    """`?page=` is converted to the service's `offset` as `(page - 1) * page_size`; an
    off-by-one there repeats or skips a row rather than failing."""
    admin = _make_user(db)
    marker = _marker()
    inbox = _make_inbox(db, marker=marker, admin=admin)
    params = {"q": marker, "page_size": 2}

    first = api.get("/api/conversations", params={**params, "page": 1}, headers=_auth(admin))
    second = api.get("/api/conversations", params={**params, "page": 2}, headers=_auth(admin))

    assert [row["id"] for row in first.json()["items"]] == [str(row.id) for row in inbox[:2]]
    assert [row["id"] for row in second.json()["items"]] == [str(row.id) for row in inbox[2:]]
    assert second.json()["total"] == 4
    assert second.json()["page"] == 2


def test_q_matches_the_guardian_name_as_well_as_the_number(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    marker = _marker()
    guardian = _make_guardian(db, name=f"Nadia {marker}")
    named = _make_conversation(db, marker=_marker(), guardian=guardian)
    _make_conversation(db, marker=marker)

    body = api.get("/api/conversations", params={"q": guardian.name}, headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(named.id)]
    assert body["total"] == 1


def test_a_thread_with_no_guardian_still_lists_under_its_number(
    api: TestClient, db: Session
) -> None:
    """A `guardian` of `null` is intake not having got that far, not an error — and those are
    the threads an admin most wants to find (`api-design.md:1412-1416`)."""
    admin = _make_user(db)
    marker = _marker()
    conversation = _make_conversation(db, marker=marker)

    body = api.get("/api/conversations", params={"q": marker}, headers=_auth(admin)).json()

    assert [row["id"] for row in body["items"]] == [str(conversation.id)]
    assert body["items"][0]["guardian"] is None
    assert body["items"][0]["taken_over_by"] is None


@pytest.mark.parametrize(
    "query", [{"status": "nobody"}, {"unread": "maybe"}, {"flagged": "maybe"}, {"page": "0"}]
)
def test_a_malformed_list_query_is_400_not_422(
    api: TestClient, db: Session, query: dict[str, str]
) -> None:
    admin = _make_user(db)

    response = api.get("/api/conversations", params=query, headers=_auth(admin))

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)


# --- GET /api/conversations/{id} ---------------------------------------------------------------


def test_the_detail_carries_the_counts_the_thread_header_shows(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(
        db, marker=_marker(), last_message_at=NOON, last_read_at=NOON - _minutes(3)
    )
    _make_message(db, conversation, body="read", at=NOON - _minutes(5))
    _make_message(db, conversation, body="unread", at=NOON)

    body = api.get(f"/api/conversations/{conversation.id}", headers=_auth(admin)).json()

    assert set(body) == {
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
        "is_window_open",
        "last_client_message_at",
        "language",
    }
    assert body["message_count"] == 2
    assert body["unread_count"] == 1
    assert body["created_at"] is not None


@pytest.mark.parametrize(("method", "path"), ID_BEARING_ROUTES)
def test_an_unknown_conversation_is_404_on_every_id_bearing_route(
    api: TestClient, db: Session, method: str, path: str
) -> None:
    admin = _make_user(db)

    response = api.request(method, path.format(conversation_id=uuid.uuid4()), headers=_auth(admin))

    _assert_detail(response, 404, CONVERSATION_NOT_FOUND_ERROR)


# --- GET /api/conversations/{id}/messages ------------------------------------------------------


def test_the_thread_is_newest_first_inside_the_page_envelope(api: TestClient, db: Session) -> None:
    """The one list in the API that is not oldest-first (`api-design.md:1526-1537`): a thread
    is read from its end, so page 1 has to be what the admin sees when it opens."""
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    for minute in range(3):
        _make_message(db, conversation, body=f"message {minute}", at=NOON + _minutes(minute))

    body = api.get(f"/api/conversations/{conversation.id}/messages", headers=_auth(admin)).json()

    assert set(body) == {"items", "total", "page", "page_size"}
    assert [row["body"] for row in body["items"]] == ["message 2", "message 1", "message 0"]
    assert body["total"] == 3


def test_before_windows_the_items_without_narrowing_the_total(api: TestClient, db: Session) -> None:
    """`before` is a paging marker, not a filter. `total` stays the conversation's whole
    message count, so a thread paged with `before` returns **fewer items than its `total`** —
    deliberately (§8, `api-design.md:1526-1537`). A change that makes the two agree is a
    regression, not a fix, and this is the assertion that says so."""
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    for minute in range(5):
        _make_message(db, conversation, body=f"message {minute}", at=NOON + _minutes(minute))

    body = api.get(
        f"/api/conversations/{conversation.id}/messages",
        params={"before": (NOON + _minutes(2)).isoformat()},
        headers=_auth(admin),
    ).json()

    assert [row["body"] for row in body["items"]] == ["message 1", "message 0"]
    assert body["total"] == 5


def test_the_thread_total_counts_before_paging(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    for minute in range(5):
        _make_message(db, conversation, body=f"message {minute}", at=NOON + _minutes(minute))
    params = {"page_size": 2}

    first = api.get(
        f"/api/conversations/{conversation.id}/messages",
        params={**params, "page": 1},
        headers=_auth(admin),
    ).json()
    second = api.get(
        f"/api/conversations/{conversation.id}/messages",
        params={**params, "page": 2},
        headers=_auth(admin),
    ).json()

    assert [row["body"] for row in first["items"]] == ["message 4", "message 3"]
    assert [row["body"] for row in second["items"]] == ["message 2", "message 1"]
    assert first["total"] == 5
    assert second["total"] == 5


def test_only_an_admins_message_carries_an_author(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    _make_message(db, conversation, body="from the client", at=NOON)
    _make_message(
        db,
        conversation,
        body="from an admin",
        at=NOON + _minutes(1),
        author_kind=MessageAuthor.ADMIN,
        author=admin,
    )

    items = api.get(f"/api/conversations/{conversation.id}/messages", headers=_auth(admin)).json()[
        "items"
    ]

    assert set(items[0]) == {
        "id",
        "author_kind",
        "author",
        "body",
        "status",
        "created_at",
        "system_kind",
        "error_code",
        "reminder_child_names",
    }
    assert items[0]["author"] == {"id": str(admin.id), "display_name": admin.display_name}
    assert items[1]["author"] is None
    assert items[1]["author_kind"] == "client"


def test_a_malformed_before_marker_is_400_not_422(api: TestClient, db: Session) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())

    response = api.get(
        f"/api/conversations/{conversation.id}/messages",
        params={"before": "the day before yesterday"},
        headers=_auth(admin),
    )

    assert response.status_code == 400
    assert set(response.json()) == {"detail"}


# --- PATCH /api/conversations/{id}: the Guardian language ---------------------------------------


@pytest.mark.parametrize("language", ["es", "en", None], ids=["spanish", "english", "not detected"])
def test_staff_set_the_language_and_the_read_returns_it(
    api: TestClient, db: Session, broadcasts: list[BroadcastEvent], language: str | None
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    conversation.language = Language.ES if language is None else None
    db.flush()

    response = api.patch(
        f"/api/conversations/{conversation.id}",
        headers=_auth(admin),
        json={"language": language},
    )
    read = api.get(f"/api/conversations/{conversation.id}", headers=_auth(admin)).json()

    assert (response.status_code, response.json()["language"]) == (200, language)
    assert read["language"] == language
    assert [event.frame()["type"] for event in broadcasts] == ["conversation.updated"]
    assert broadcasts[0].conversation["language"] == language


def test_a_manager_may_set_the_language(api: TestClient, db: Session) -> None:
    manager = _make_user(db, role=UserRole.MANAGER)
    conversation = _make_conversation(db, marker=_marker())

    response = api.patch(
        f"/api/conversations/{conversation.id}", headers=_auth(manager), json={"language": "es"}
    )

    assert (response.status_code, response.json()["language"]) == (200, "es")


def test_a_tutor_may_not_set_the_language(api: TestClient, db: Session) -> None:
    tutor = _make_tutor_user(db)
    conversation = _make_conversation(db, marker=_marker())

    response = api.patch(
        f"/api/conversations/{conversation.id}", headers=_auth(tutor), json={"language": "es"}
    )

    assert response.status_code == 403
    assert _row(db, conversation.id).language is None


@pytest.mark.parametrize(
    "body",
    [{"language": "fr"}, {"language": "ES"}, {"language": ""}, {}],
    ids=["unsupported", "upper case", "empty", "missing"],
)
def test_a_language_that_is_not_en_es_or_null_is_400(
    api: TestClient, db: Session, body: dict[str, str]
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())

    response = api.patch(f"/api/conversations/{conversation.id}", headers=_auth(admin), json=body)

    assert response.status_code == 400
    assert _row(db, conversation.id).language is None


def test_setting_the_language_of_an_unknown_conversation_is_404(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)

    response = api.patch(
        f"/api/conversations/{uuid.uuid4()}", headers=_auth(admin), json={"language": "es"}
    )

    _assert_detail(response, 404, CONVERSATION_NOT_FOUND_ERROR)


# --- takeover, release, read -------------------------------------------------------------------


def test_a_takeover_claims_the_conversation_and_broadcasts_once(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    _open_window(db, conversation)

    response = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(admin))
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "human"
    assert body["taken_over_by"] == {"id": str(admin.id), "display_name": admin.display_name}
    assert body["taken_over_at"] is not None
    assert _row(db, conversation.id).taken_over_by_user_id == admin.id
    # The conversation, then the Takeover notice line (#109).
    assert [event.frame()["type"] for event in broadcasts] == [
        "conversation.updated",
        "message.created",
    ]
    assert broadcasts[0].conversation["id"] == str(conversation.id)


def test_a_reclaim_by_the_holder_is_a_no_op_200(api: TestClient, db: Session) -> None:
    """A double-click or a retry after a dropped response asks for the state the conversation
    is already in; a 409 there would put an error in front of an admin who got what they
    wanted (`api-design.md:1568-1571`)."""
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    _open_window(db, conversation)
    headers = _auth(admin)

    first = api.post(f"/api/conversations/{conversation.id}/takeover", headers=headers)
    second = api.post(f"/api/conversations/{conversation.id}/takeover", headers=headers)

    assert second.status_code == 200
    assert second.json()["taken_over_by"]["id"] == str(admin.id)
    assert second.json()["taken_over_at"] == first.json()["taken_over_at"]


def test_a_takeover_of_a_conversation_another_admin_holds_is_409_naming_them(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    """The 409 names the holder because the only useful next step is to go and ask them
    (`api-design.md:1562-1566`)."""
    holder = _make_user(db)
    contender = _make_user(db)
    conversation = _make_conversation(db, marker=_marker(), holder=holder)
    _open_window(db, conversation)

    response = api.post(f"/api/conversations/{conversation.id}/takeover", headers=_auth(contender))

    _assert_detail(response, 409, HELD_BY_ANOTHER_ERROR.format(display_name=holder.display_name))
    assert holder.display_name in response.json()["detail"]
    assert _row(db, conversation.id).taken_over_by_user_id == holder.id
    assert broadcasts == []


def test_any_admin_may_release_not_only_the_holder(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    """Deliberately unrestricted (`api-design.md:1579-1583`), which is also what answers a
    deactivated holder (**OQ-28**) without anything automatic."""
    holder = _make_user(db)
    other = _make_user(db)
    conversation = _make_conversation(db, marker=_marker(), holder=holder)

    response = api.request(
        "delete", f"/api/conversations/{conversation.id}/takeover", headers=_auth(other)
    )
    body = response.json()

    assert response.status_code == 200
    assert body["status"] == "bot"
    assert body["taken_over_by"] is None
    assert body["taken_over_at"] is None
    assert _row(db, conversation.id).taken_over_by_user_id is None
    # The conversation, then the Hand-back notice line (#109).
    assert [event.frame()["type"] for event in broadcasts] == [
        "conversation.updated",
        "message.created",
    ]
    assert broadcasts[0].conversation["id"] == str(conversation.id)


def test_releasing_a_conversation_the_bot_already_has_is_a_no_op_200(
    api: TestClient, db: Session
) -> None:
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())

    response = api.request(
        "delete", f"/api/conversations/{conversation.id}/takeover", headers=_auth(admin)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "bot"


def test_marking_read_returns_the_recomputed_unread_count_and_broadcasts_nothing(
    api: TestClient, db: Session, broadcasts: list[ConversationUpdated]
) -> None:
    """The watermark is shared, but a read is not an event anybody else needs pushed. Returning
    the conversation is what saves the caller a second request."""
    admin = _make_user(db)
    conversation = _make_conversation(db, marker=_marker())
    _make_message(db, conversation, body="unread", at=NOON)
    headers = _auth(admin)

    before = api.get(f"/api/conversations/{conversation.id}", headers=headers).json()
    after = api.post(f"/api/conversations/{conversation.id}/read", headers=headers).json()

    assert before["unread_count"] == 1
    assert after["unread_count"] == 0
    assert after["message_count"] == 1
    assert after["last_read_at"] is not None
    assert broadcasts == []


# --- the claim decides once --------------------------------------------------------------------


def test_two_concurrent_takeovers_produce_one_200_and_one_409(
    session_per_request_api: TestClient, committed_sessions: sessionmaker[Session]
) -> None:
    """Two connections, released together — not the sequential pair the rolled-back `db`
    fixture would fake (**D-J**, **OB-17**)."""
    committed = _make_committed_conversation(committed_sessions)
    path = f"/api/conversations/{committed.conversation_id}/takeover"
    ready = threading.Barrier(2)

    def take_over(user_id: uuid.UUID) -> Response:
        ready.wait(timeout=10)
        return session_per_request_api.post(path, headers=_auth_for(user_id))

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(take_over, committed.holder_id),
                pool.submit(take_over, committed.contender_id),
            ]
            responses = [future.result() for future in futures]

        winner = [row for row in responses if row.status_code == 200]
        loser = [row for row in responses if row.status_code == 409]

        assert sorted(row.status_code for row in responses) == [200, 409]
        assert winner[0].json()["taken_over_by"]["display_name"] in loser[0].json()["detail"]
    finally:
        _delete_committed_conversation(committed_sessions, committed)


def test_a_takeover_waits_behind_a_held_row_lock_and_is_409(
    session_per_request_api: TestClient, committed_sessions: sessionmaker[Session]
) -> None:
    """The lock assertion, and the only shape here that can fail when `with_for_update()` goes.

    A second connection claims the row and holds its transaction open past the `flush()`. The
    request issued while that lock is held must block inside the service until the holder
    commits, and must then judge the *committed* claim rather than the stale `bot` it would
    have read — proven by asserting the request took at least as long as the lock was held.
    Without the lock it reads `bot`, claims, answers 200, and the holder's claim is silently
    discarded.
    """
    committed = _make_committed_conversation(committed_sessions)
    hold_seconds = 0.4
    holder_locked = threading.Event()

    def hold_lock() -> None:
        with committed_sessions() as session:
            claim(
                session,
                conversation_id=committed.conversation_id,
                user_id=committed.holder_id,
            )
            holder_locked.set()
            time.sleep(hold_seconds)
            session.commit()

    try:
        holder = threading.Thread(target=hold_lock)
        holder.start()
        holder_locked.wait(timeout=5)

        started = time.monotonic()
        response = session_per_request_api.post(
            f"/api/conversations/{committed.conversation_id}/takeover",
            headers=_auth_for(committed.contender_id),
        )
        elapsed = time.monotonic() - started
        holder.join(timeout=5)

        assert elapsed >= hold_seconds * 0.8
        _assert_detail(
            response, 409, HELD_BY_ANOTHER_ERROR.format(display_name=committed.holder_display_name)
        )
        with committed_sessions() as session:
            assert (
                session.get_one(Conversation, committed.conversation_id).taken_over_by_user_id
                == committed.holder_id
            )
    finally:
        _delete_committed_conversation(committed_sessions, committed)


# --- RBAC ----------------------------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), ALL_ROUTES)
def test_a_tutor_is_refused_on_every_conversation_route(
    api: TestClient, db: Session, method: str, path: str
) -> None:
    """Chat is an admin surface and there is no tutor-scoped view of it to fall back to
    (`api-design.md:1423-1424`). A 403 rather than a 500 is also what proves no route here
    takes `TutorScope`, which would arm the unapplied-scope guard (§15)."""
    tutor = _make_tutor_user(db)
    conversation = _make_conversation(db, marker=_marker())

    response = api.request(
        method, path.format(conversation_id=conversation.id), headers=_auth(tutor)
    )

    assert response.status_code == 403
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)
    assert _row(db, conversation.id).status is ConversationStatus.BOT


@pytest.mark.parametrize(("method", "path"), ALL_ROUTES)
def test_an_unauthenticated_request_is_401_not_403(api: TestClient, method: str, path: str) -> None:
    response = api.request(method, path.format(conversation_id=uuid.uuid4()))

    assert response.status_code == 401
    assert set(response.json()) == {"detail"}
    assert isinstance(response.json()["detail"], str)


def test_a_developer_may_use_every_conversation_route(api: TestClient, db: Session) -> None:
    developer = _make_user(db, role=UserRole.DEVELOPER)
    conversation = _make_conversation(db, marker=_marker())
    _open_window(db, conversation)
    headers = _auth(developer)

    responses = [
        api.request(method, path.format(conversation_id=conversation.id), headers=headers)
        for method, path in ALL_ROUTES
    ]

    assert [row.status_code for row in responses] == [200] * len(ALL_ROUTES)


def test_no_route_in_the_module_takes_a_tutor_scope() -> None:
    """§15, pinned rather than reviewed: an unread `TutorScope` arms the `do_orm_execute` guard
    and 500s any query against a tutor-owned table."""
    source = pathlib.Path(conversations_router.__file__).read_text()

    assert "TutorScope" not in source


# --- helpers -------------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def broadcasts(monkeypatch: pytest.MonkeyPatch) -> list[BroadcastEvent]:
    """Every event the routes publish: `conversation.updated`, and since #109 the notice line's
    `message.created`.

    Autouse rather than opt-in: these tests exercise the routes, not the transport, so none of
    them may reach the real `publish` and its NOTIFY — that is `test_broadcast_service.py`'s
    subject. Recording the calls is also what makes "exactly one event" and "no event at all"
    assertable — "it did not raise" would not be.
    """
    recorded: list[BroadcastEvent] = []
    monkeypatch.setattr(
        conversations_router,
        "publish",
        lambda event: recorded.append(event),
    )

    return recorded


@pytest.fixture
def committed_sessions(_test_engine: Engine) -> sessionmaker[Session]:
    """A factory of real, independently-committing sessions on `_test_engine`.

    The rolled-back `db` fixture shares one transaction, so two sessions from it can never
    contend for the same row lock — only sessions each bound to their own connection can.
    """
    return sessionmaker(bind=_test_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture
def session_per_request_api(
    committed_sessions: sessionmaker[Session],
) -> Generator[TestClient, None, None]:
    from app.db import get_db
    from app.main import app

    def open_and_close_one_session_per_request() -> Generator[Session, None, None]:
        session = committed_sessions()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = open_and_close_one_session_per_request
    try:
        yield TestClient(app)
    finally:
        del app.dependency_overrides[get_db]


@dataclass(frozen=True, slots=True)
class _CommittedConversation:
    conversation_id: uuid.UUID
    holder_id: uuid.UUID
    holder_display_name: str
    contender_id: uuid.UUID


def _make_committed_conversation(
    sessions: sessionmaker[Session],
) -> _CommittedConversation:
    with sessions() as session:
        conversation = _make_conversation(session, marker=_marker())
        _open_window(session, conversation)
        holder = _make_user(session)
        contender = _make_user(session)
        session.commit()

        return _CommittedConversation(
            conversation_id=conversation.id,
            holder_id=holder.id,
            holder_display_name=holder.display_name,
            contender_id=contender.id,
        )


def _delete_committed_conversation(
    sessions: sessionmaker[Session], row: _CommittedConversation
) -> None:
    with sessions() as session:
        session.execute(delete(Message).where(Message.conversation_id == row.conversation_id))
        session.execute(delete(Conversation).where(Conversation.id == row.conversation_id))
        session.execute(delete(User).where(User.id.in_([row.holder_id, row.contender_id])))
        session.commit()


def _assert_detail(response: Response, expected_status: int, expected_detail: str) -> None:
    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, role=user.role, tutor_id=user.tutor_id)
    return {"Authorization": f"Bearer {token}"}


def _auth_for(user_id: uuid.UUID) -> dict[str, str]:
    token = create_access_token(user_id=user_id, role=UserRole.ADMIN, tutor_id=None)
    return {"Authorization": f"Bearer {token}"}


def _marker() -> str:
    """The digits every conversation in one test shares, so `?q=` isolates it from the rows the
    test database carries over from earlier runs."""
    return f"{uuid.uuid4().int % 10**8:08d}"


def _phone_number(marker: str) -> str:
    return f"+1{marker}{uuid.uuid4().int % 10**4:04d}"


def _minutes(count: int) -> datetime.timedelta:
    return datetime.timedelta(minutes=count)


def _make_inbox(db: Session, *, marker: str, admin: User) -> list[Conversation]:
    """Four conversations spanning both statuses, both read states and both flag states, in the
    order `last_message_at DESC` puts them."""
    return [
        _make_conversation(
            db,
            marker=marker,
            last_message_at=NOON + _minutes(3),
            flag_reason=FlagReason.STUCK,
        ),
        _make_conversation(
            db,
            marker=marker,
            last_message_at=NOON + _minutes(2),
            last_read_at=NOON + _minutes(2),
        ),
        _make_conversation(
            db,
            marker=marker,
            last_message_at=NOON + _minutes(1),
            last_read_at=NOON + _minutes(1),
            holder=admin,
            flag_reason=FlagReason.GUARDIAN_LINK_REQUEST,
        ),
        _make_conversation(db, marker=marker, last_message_at=NOON),
    ]


def _make_conversation(
    db: Session,
    *,
    marker: str,
    last_message_at: datetime.datetime = NOON,
    last_read_at: datetime.datetime | None = None,
    holder: User | None = None,
    guardian: Guardian | None = None,
    flag_reason: FlagReason | None = None,
) -> Conversation:
    conversation = Conversation(
        phone_number=_phone_number(marker),
        guardian_id=None if guardian is None else guardian.id,
        status=ConversationStatus.BOT if holder is None else ConversationStatus.HUMAN,
        taken_over_by_user_id=None if holder is None else holder.id,
        taken_over_at=None if holder is None else last_message_at,
        last_message_at=last_message_at,
        last_read_at=last_read_at,
        flag_reason=flag_reason,
        flagged_at=None if flag_reason is None else last_message_at,
    )
    db.add(conversation)
    db.flush()

    return conversation


def _make_message(
    db: Session,
    conversation: Conversation,
    *,
    body: str,
    at: datetime.datetime,
    author_kind: MessageAuthor = MessageAuthor.CLIENT,
    author: User | None = None,
) -> Message:
    message = Message(
        conversation_id=conversation.id,
        author_kind=author_kind,
        author_user_id=None if author is None else author.id,
        body=body,
        status=MessageStatus.RECEIVED,
        created_at=at,
    )
    db.add(message)
    db.flush()

    return message


def _open_window(db: Session, conversation: Conversation) -> None:
    """A Guardian message a minute old: a takeover is only allowed inside the 24-hour window."""
    _make_message(
        db,
        conversation,
        body="hello",
        at=datetime.datetime.now(tz=datetime.UTC) - _minutes(1),
    )


def _make_guardian(db: Session, *, name: str | None = None) -> Guardian:
    guardian = Guardian(
        name=name or f"Guardian {uuid.uuid4().hex[:8]}",
        phone_number=_phone_number(_marker()),
        is_active=True,
    )
    db.add(guardian)
    db.flush()

    return guardian


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


def _row(db: Session, conversation_id: uuid.UUID) -> Conversation:
    db.expire_all()

    return db.get_one(Conversation, conversation_id)
