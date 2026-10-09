"""Who may call what (#108): every route the app serves, classified, and each class checked
against a tutor, manager, admin and developer token.

The matrix is the point: a route nobody classified fails `test_every_route_is_classified`, so a
new endpoint cannot ship without someone deciding who reaches it. A classified route that no
longer exists fails too, so the table cannot rot.

"Allowed" means the gate let the caller through: anything but 401, 403 or a 5xx. The probes
send random ids and an empty body, so a 404 or a 422 is the expected shape of "you got past
the gate". A tutor-scoped route is probed with the tutor's own `tutor_id`, so the tutor is
asking for their own data.

The chat websocket is classified here and probed in `test_conversation_stream.py`, where the
socket fixtures live.
"""

import enum
import uuid
from collections.abc import Generator, Iterable
from dataclasses import dataclass

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from starlette.routing import BaseRoute

from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import create_access_token


class Access(enum.Enum):
    PUBLIC = "public"
    # Any signed-in role, Tutors included, reading or changing only their own row.
    AUTHENTICATED = "authenticated"
    # Any signed-in role, Tutors included, reading data shared by everyone (not their own).
    SHARED_CATALOGUE = "shared_catalogue"
    # Any signed-in role; a tutor sees only their own rows.
    TUTOR_SCOPED = "tutor_scoped"
    STAFF = "staff"
    ADMIN = "admin"


WEBSOCKET = "WS"

ROUTE_MATRIX: dict[tuple[str, str], Access] = {
    ("GET", "/openapi.json"): Access.PUBLIC,
    ("GET", "/docs"): Access.PUBLIC,
    ("GET", "/docs/oauth2-redirect"): Access.PUBLIC,
    ("GET", "/redoc"): Access.PUBLIC,
    ("GET", "/health"): Access.PUBLIC,
    ("GET", "/health/ready"): Access.PUBLIC,
    ("POST", "/auth/token"): Access.PUBLIC,
    ("POST", "/auth/refresh"): Access.PUBLIC,
    ("POST", "/auth/logout"): Access.PUBLIC,
    # Authenticated by Twilio's signature, not by a user token.
    ("POST", "/webhook/whatsapp"): Access.PUBLIC,
    ("POST", "/webhook/whatsapp/status"): Access.PUBLIC,
    ("GET", "/api/me"): Access.AUTHENTICATED,
    ("PATCH", "/api/me"): Access.AUTHENTICATED,
    # Tutors read the subject catalogue to see what they teach; writing it is Staff only.
    ("GET", "/api/subjects"): Access.SHARED_CATALOGUE,
    ("GET", "/api/tutors"): Access.TUTOR_SCOPED,
    ("GET", "/api/tutors/{tutor_id}"): Access.TUTOR_SCOPED,
    ("GET", "/api/tutors/{tutor_id}/exceptions"): Access.TUTOR_SCOPED,
    ("POST", "/api/tutors/{tutor_id}/exceptions"): Access.TUTOR_SCOPED,
    ("DELETE", "/api/exceptions/{exception_id}"): Access.TUTOR_SCOPED,
    ("GET", "/api/tutors/{tutor_id}/availability"): Access.TUTOR_SCOPED,
    ("GET", "/api/bookings"): Access.TUTOR_SCOPED,
    ("GET", "/api/bookings/{booking_id}"): Access.TUTOR_SCOPED,
    ("PATCH", "/api/exceptions/{exception_id}"): Access.STAFF,
    ("POST", "/api/subjects"): Access.STAFF,
    ("PATCH", "/api/subjects/{subject_id}"): Access.STAFF,
    ("DELETE", "/api/subjects/{subject_id}"): Access.STAFF,
    ("GET", "/api/clients"): Access.STAFF,
    ("GET", "/api/clients/{client_id}"): Access.STAFF,
    ("POST", "/api/clients"): Access.STAFF,
    ("PATCH", "/api/clients/{client_id}"): Access.STAFF,
    ("GET", "/api/clients/{client_id}/bookings"): Access.STAFF,
    ("GET", "/api/clients/{client_id}/reminders"): Access.STAFF,
    ("POST", "/api/clients/{client_id}/reminders/consent"): Access.STAFF,
    ("POST", "/api/clients/{client_id}/homes"): Access.STAFF,
    ("POST", "/api/children"): Access.STAFF,
    ("PATCH", "/api/children/{child_id}"): Access.STAFF,
    ("GET", "/api/children"): Access.STAFF,
    ("GET", "/api/children/{child_id}"): Access.STAFF,
    ("POST", "/api/children/{child_id}/guardians"): Access.STAFF,
    ("PUT", "/api/children/{child_id}/levels/{subject_id}"): Access.STAFF,
    ("DELETE", "/api/children/{child_id}/levels/{subject_id}"): Access.STAFF,
    ("POST", "/api/children/{child_id}/evaluated"): Access.STAFF,
    ("DELETE", "/api/children/{child_id}/evaluated"): Access.STAFF,
    ("GET", "/api/households"): Access.STAFF,
    ("PATCH", "/api/homes/{home_id}"): Access.STAFF,
    ("POST", "/api/tutors"): Access.STAFF,
    ("PATCH", "/api/tutors/{tutor_id}"): Access.STAFF,
    ("DELETE", "/api/tutors/{tutor_id}"): Access.STAFF,
    ("POST", "/api/tutors/{tutor_id}/subjects"): Access.STAFF,
    ("DELETE", "/api/tutors/{tutor_id}/subjects/{subject_id}"): Access.STAFF,
    ("POST", "/api/tutors/{tutor_id}/availability"): Access.STAFF,
    ("PATCH", "/api/availability/{availability_id}"): Access.STAFF,
    ("DELETE", "/api/availability/{availability_id}"): Access.STAFF,
    ("GET", "/api/slots/available"): Access.STAFF,
    ("POST", "/api/bookings"): Access.STAFF,
    ("PATCH", "/api/bookings/{booking_id}"): Access.STAFF,
    ("GET", "/api/stats/overview"): Access.STAFF,
    ("GET", "/api/reminders/week"): Access.STAFF,
    ("GET", "/api/conversations"): Access.STAFF,
    ("GET", "/api/conversations/{conversation_id}"): Access.STAFF,
    ("PATCH", "/api/conversations/{conversation_id}"): Access.STAFF,
    ("GET", "/api/conversations/{conversation_id}/messages"): Access.STAFF,
    ("POST", "/api/conversations/{conversation_id}/takeover"): Access.STAFF,
    ("POST", "/api/conversations/{conversation_id}/transfer"): Access.STAFF,
    ("DELETE", "/api/conversations/{conversation_id}/takeover"): Access.STAFF,
    ("POST", "/api/conversations/{conversation_id}/messages/{message_id}/retry"): Access.STAFF,
    ("POST", "/api/conversations/{conversation_id}/read"): Access.STAFF,
    ("POST", "/api/conversations/{conversation_id}/reactivation/approve"): Access.STAFF,
    ("POST", "/api/conversations/{conversation_id}/reactivation/deny"): Access.STAFF,
    ("POST", "/api/conversations/{conversation_id}/handled"): Access.STAFF,
    (WEBSOCKET, "/api/conversations/stream"): Access.STAFF,
    ("GET", "/api/users"): Access.ADMIN,
    ("GET", "/api/users/{user_id}"): Access.ADMIN,
    ("POST", "/api/users"): Access.ADMIN,
    ("PATCH", "/api/users/{user_id}"): Access.ADMIN,
    ("DELETE", "/api/users/{user_id}"): Access.ADMIN,
    ("GET", "/api/settings"): Access.ADMIN,
    ("PATCH", "/api/settings"): Access.ADMIN,
}

ALLOWED_ROLES: dict[Access, frozenset[UserRole]] = {
    Access.AUTHENTICATED: frozenset(UserRole),
    Access.SHARED_CATALOGUE: frozenset(UserRole),
    Access.TUTOR_SCOPED: frozenset(UserRole),
    Access.STAFF: frozenset({UserRole.MANAGER, UserRole.ADMIN, UserRole.DEVELOPER}),
    Access.ADMIN: frozenset({UserRole.ADMIN, UserRole.DEVELOPER}),
}

# HEAD rides along with GET on Starlette's own routes; it is not a separate decision.
IGNORED_METHODS = frozenset({"HEAD"})


def _route_keys(routes: Iterable[BaseRoute]) -> set[tuple[str, str]]:
    keys: set[tuple[str, str]] = set()
    for context in iter_route_contexts(list(routes)):
        # FastAPI leaves `path` empty on an included websocket's context; the route has it.
        path = context.path or getattr(context.original_route, "path", "")
        methods = context.methods or {WEBSOCKET}
        keys |= {(method, path) for method in methods if method not in IGNORED_METHODS}
    return keys


def _unclassified(routes: Iterable[BaseRoute]) -> set[tuple[str, str]]:
    return _route_keys(routes) - ROUTE_MATRIX.keys()


@dataclass(frozen=True, slots=True)
class Caller:
    role: UserRole
    headers: dict[str, str]
    tutor_id: uuid.UUID | None


@pytest.fixture
def gate_client(db: Session) -> Generator[TestClient, None, None]:
    """The app on the rolled-back session, with server errors returned rather than raised so a
    500 is reported against the route that produced it."""
    from app.db import get_db
    from app.main import app

    def override_get_db() -> Generator[Session, None, None]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        del app.dependency_overrides[get_db]


@pytest.fixture
def callers(db: Session) -> dict[UserRole, Caller]:
    suffix = uuid.uuid4().hex[:10]
    tutor = Tutor(
        user=User(email=f"t-{suffix}@x.com", name="Matrix Tutor", role=UserRole.TUTOR),
        phone_number=f"+1{suffix}",
    )
    db.add(tutor)
    db.flush()

    def make(role: UserRole, tutor_id: uuid.UUID | None) -> Caller:
        if tutor_id is None:
            user = User(
                email=f"{role.value}-{uuid.uuid4().hex[:10]}@x.com",
                name=f"Matrix {role.value}",
                hashed_password="not-a-real-hash",
                role=role,
                is_active=True,
            )
            db.add(user)
        else:
            # The profile's own user is the login: one record per person.
            user = db.get_one(Tutor, tutor_id).user
            user.hashed_password = "not-a-real-hash"
            user.role = role
            user.is_active = True
        db.flush()
        token = create_access_token(user_id=user.id, role=role, tutor_id=tutor_id)
        return Caller(role=role, headers={"Authorization": f"Bearer {token}"}, tutor_id=tutor_id)

    return {role: make(role, tutor.id if role is UserRole.TUTOR else None) for role in UserRole}


def _url(path: str, *, tutor_id: uuid.UUID | None) -> str:
    """Random ids for every segment, except a tutor-scoped route's `tutor_id`, which is the
    tutor's own so the tutor is asking for their own rows."""
    url = path
    if tutor_id is not None:
        url = url.replace("{tutor_id}", str(tutor_id))
    while "{" in url:
        start = url.index("{")
        end = url.index("}", start)
        url = url[:start] + str(uuid.uuid4()) + url[end + 1 :]
    return url


def _call(client: TestClient, method: str, url: str, headers: dict[str, str]) -> int:
    body = {} if method in {"POST", "PUT", "PATCH"} else None
    return client.request(method, url, headers=headers, json=body).status_code


def _gated_routes() -> list[tuple[str, str, Access]]:
    return [
        (method, path, access)
        for (method, path), access in ROUTE_MATRIX.items()
        if access is not Access.PUBLIC and method != WEBSOCKET
    ]


def test_every_route_is_classified() -> None:
    from app.main import app

    assert _unclassified(app.routes) == set()


def test_an_unclassified_route_fails_the_matrix() -> None:
    from app.main import app

    router = APIRouter()

    @router.get("/api/unclassified-probe")
    def unclassified_probe() -> None:
        return None

    probe_app = FastAPI()
    probe_app.include_router(router)

    assert _unclassified([*app.routes, *probe_app.routes]) == {("GET", "/api/unclassified-probe")}


def test_every_classified_route_exists() -> None:
    from app.main import app

    assert ROUTE_MATRIX.keys() - _route_keys(app.routes) == set()


@pytest.mark.parametrize(("method", "path", "access"), _gated_routes())
def test_each_role_reaches_exactly_its_class(
    gate_client: TestClient,
    callers: dict[UserRole, Caller],
    method: str,
    path: str,
    access: Access,
) -> None:
    outcomes: dict[UserRole, int] = {}
    for role, caller in callers.items():
        scoped_tutor_id = caller.tutor_id if access is Access.TUTOR_SCOPED else None
        url = _url(path, tutor_id=scoped_tutor_id)
        outcomes[role] = _call(gate_client, method, url, caller.headers)

    allowed = {role for role, code in outcomes.items() if code not in {401, 403} and code < 500}
    refused = {role for role, code in outcomes.items() if code == 403}

    assert allowed == ALLOWED_ROLES[access], outcomes
    assert refused == set(UserRole) - ALLOWED_ROLES[access], outcomes


@pytest.mark.parametrize(("method", "path", "access"), _gated_routes())
def test_no_token_is_401(gate_client: TestClient, method: str, path: str, access: Access) -> None:
    assert _call(gate_client, method, _url(path, tutor_id=None), {}) == 401
