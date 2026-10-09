"""Request-scoped authentication and the tutor-scoping rule every `/api/*` route consumes.

Application-level wiring, alongside `db.py` and `config.py` — not a router, not a service.
A router's whole auth surface is meant to be an import from here:

```python
from app.dependencies import Principal, OfficePrincipal, AdminPrincipal, TutorScope

@router.get("/api/bookings")
def list_bookings(scope: TutorScope, db: DbSession):
    return booking_service.list_bookings(db, tutor_id=scope.tutor_id)   # None means "all"
```

`TutorScope` is a dependency, not a helper call: the 403 decision runs during dependency
resolution, and the route receives the resolved scope as a parameter. The `tutor_id` the
caller asked for is declared by the dependency, so the route does not repeat it — a
`?tutor_id=` query parameter appears automatically, and on a path like
`/api/tutors/{tutor_id}/bookings` the same dependency binds the path parameter instead.

Five properties this module exists to guarantee, all of which Phase 3 onwards depends on:

- **Authentication failures are indistinguishable.** A missing, malformed, badly signed,
  expired, or wrong-`typ` token, an unknown user, and a deactivated user all produce the same
  401 and the same message. Never tell an unauthenticated caller which one it was.

- **The `users` row is read on every request** (D-023). One primary-key lookup buys the
  property that setting `is_active = false` takes effect on the caller's *next* request rather
  than up to fifteen minutes later when their access token expires — which is the entire point
  of `is_active` soft delete. `role` and `tutor_id` (the user's profile id, read through
  `tutors.user_id`) are taken from that row, not from the token's claims, for the same reason.
  Do not "optimise" this into a claims-only path and do not cache it.

- **A tutor cannot opt out of scoping.** The scope carries the caller's own `tutor_id` when a
  tutor asks for nothing in particular. Carrying `None` there would mean "no filter" and would
  silently widen a list endpoint to every tutor's rows. A tutor account with no profile is
  rejected with 403 rather than treated as an admin or scoped to `None`: only admins have no
  profile, so a tutor in that state is a data error and must fail loudly.

- **A route cannot forget to apply the scope.** The scope is an object, not a bare
  `uuid.UUID | None`, and for as long as it goes unread the request's `Session` refuses to run
  any ORM query against a tutor-owned table: `TutorScopeNotApplied` is raised from inside the
  execute hook, before the statement reaches PostgreSQL. A route that takes `TutorScope` and
  then queries unscoped gets a 500 and zero rows, which is the whole point — the old shape,
  where the scope was a return value a route could evaluate for its 403 and then discard,
  failed *open* for the one principal that most needed the filter (a tutor who requested no
  `tutor_id` at all, for whom nothing raises).

- **Cross-tutor access is 403 — never 404, and never an empty 200** (`CONSTITUTION.md:15`).
  Returning 404 to hide existence is defensible in general and is explicitly not what this
  project does. Returning an empty result set is worse still: it looks correct in a browser
  while proving nothing about whether the caller was actually denied.

Two route shapes, and they do not mix. A route that *lists* takes `TutorScope` and passes
`scope.tutor_id` into the service call. A route that *loads one row by id* takes `Principal`,
loads the row, and calls `assert_can_access_tutor` on its owner — that pattern queries before
it can know the owner, so it deliberately does not arm the guard above.
"""

import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import event
from sqlalchemy.orm import Mapper, ORMExecuteState, Session, joinedload

from app.db import get_db
from app.models.enums import UserRole
from app.models.tutor import Tutor
from app.models.user import User
from app.security import ACCESS_TOKEN_TYPE, TokenError, decode_token

CREDENTIALS_ERROR = "Could not validate credentials"
ADMIN_REQUIRED_ERROR = "Admin privileges required"
OFFICE_REQUIRED_ERROR = "Office access required"
TUTOR_SCOPE_ERROR = "Not permitted to access this tutor's data"

# Every gate below asks for a role set, never "is admin". `developer` is a superset of `admin`
# — it reaches everything an admin reaches, plus developer-only system settings — so comparing
# against `UserRole.ADMIN` by identity would refuse it everywhere.
#
# Two sets (#108). Office runs the dashboard: everything but Users and Settings, chat included, and
# never tutor-scoped. Admin roles additionally manage Users and Settings, which a Manager may
# not reach.
OFFICE_ROLES = frozenset({UserRole.ADMIN, UserRole.MANAGER, UserRole.DEVELOPER})
ADMIN_ROLES = frozenset({UserRole.ADMIN, UserRole.DEVELOPER})

# `auto_error=False` so this module owns the failure: FastAPI's built-in error omits the
# challenge header on some paths and does not go through the project's `{"detail": ...}`
# envelope. `tokenUrl` is what makes the Authorize button in /docs work.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    """The authenticated principal. Frozen, and never the ORM `User` — the constitution
    forbids an ORM instance crossing the HTTP boundary, and a route cannot widen its own
    authority by mutating a frozen principal."""

    id: uuid.UUID
    email: str
    role: UserRole
    tutor_id: uuid.UUID | None


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=CREDENTIALS_ERROR,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def get_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> CurrentUser:
    if not token:
        raise _unauthorized()

    try:
        claims = decode_token(token, expected_type=ACCESS_TOKEN_TYPE)
    except TokenError as exc:
        raise _unauthorized() from exc

    user = db.get(User, claims.subject, options=[joinedload(User.profile)])
    if user is None or not user.is_active:
        raise _unauthorized()

    return CurrentUser(
        id=user.id,
        email=user.email,
        role=user.role,
        tutor_id=user.profile_id,
    )


Principal = Annotated[CurrentUser, Depends(get_current_user)]


def require_admin(user: Principal) -> CurrentUser:
    # Depending on `get_current_user` rather than re-reading the token is what makes an
    # unauthenticated request a 401 and not a 403: authentication runs, and fails, first.
    if user.role not in ADMIN_ROLES:
        raise _forbidden(ADMIN_REQUIRED_ERROR)
    return user


AdminPrincipal = Annotated[CurrentUser, Depends(require_admin)]


def require_office(user: Principal) -> CurrentUser:
    # Same 401-before-403 ordering as `require_admin`.
    if user.role not in OFFICE_ROLES:
        raise _forbidden(OFFICE_REQUIRED_ERROR)
    return user


OfficePrincipal = Annotated[CurrentUser, Depends(require_office)]


class TutorScopeNotApplied(RuntimeError):
    """A tutor-owned table was queried on a request whose `TutorScope` was never read.

    Raised from inside SQLAlchemy's `do_orm_execute` hook, so it fires *before* the statement
    reaches the database and the offending query yields no rows to anybody. Deliberately not
    an `HTTPException`: this is a bug in the route, not a client error, and it must surface as
    a 500 in the logs rather than as something a caller could mistake for a normal 4xx.
    """


class ResolvedTutorScope:
    """The tutor filter a request's queries must apply — an object, never a bare UUID.

    Not a `uuid.UUID | None`, so it cannot be passed into a query by accident and cannot be
    compared against a column into a silently-true filter. `tutor_id` is read-only for the
    same reason `CurrentUser` is frozen: a route must not be able to widen its own scope.

    Reading `tutor_id` is what marks the scope applied and disarms the guard, so read it only
    at the point where the value is handed to the service call that will filter on it.
    """

    __slots__ = ("_applied", "_tutor_id")

    def __init__(self, tutor_id: uuid.UUID | None) -> None:
        self._tutor_id = tutor_id
        self._applied = False

    def __repr__(self) -> str:
        # Deliberately does not go through the property: repr must not disarm the guard.
        return f"ResolvedTutorScope(tutor_id={self._tutor_id!r}, applied={self._applied})"

    @property
    def tutor_id(self) -> uuid.UUID | None:
        """The `tutor_id` to filter on, or `None` for "no filter, all tutors"."""
        self._applied = True
        return self._tutor_id

    @property
    def applied(self) -> bool:
        return self._applied


def _decide_tutor_scope(
    user: CurrentUser, requested_tutor_id: uuid.UUID | None
) -> uuid.UUID | None:
    """The scoping decision table. Kept separate from the dependency so it stays readable.

    | principal                   | requested        | result           |
    |-----------------------------|------------------|------------------|
    | office (admin, manager, dev) | `None`           | `None`           |
    | office (admin, manager, dev) | any UUID         | that UUID        |
    | tutor with `tutor_id`       | `None`           | own `tutor_id`   |
    | tutor with `tutor_id`       | own              | own `tutor_id`   |
    | tutor with `tutor_id`       | another tutor's  | **403**          |
    | tutor with `tutor_id` None | anything         | **403**          |

    A developer has no tutor profile, so treating them as anything but unscoped would send
    them down the tutor branch and 403 on `tutor_id is None` — the most confusing possible
    failure for the one role that is meant to see everything.
    """
    if user.role in OFFICE_ROLES:
        scoped_tutor_id = requested_tutor_id
    else:
        if user.tutor_id is None:
            raise _forbidden(TUTOR_SCOPE_ERROR)

        if requested_tutor_id is not None and requested_tutor_id != user.tutor_id:
            raise _forbidden(TUTOR_SCOPE_ERROR)

        # Not `requested_tutor_id`: a tutor who asked for nothing is scoped to themselves.
        scoped_tutor_id = user.tutor_id

    return scoped_tutor_id


def _is_tutor_owned(mapper: Mapper[Any]) -> bool:
    # Fail closed by shape, not by a list someone has to remember to extend: anything mapped
    # onto a table with a `tutor_id`, plus `tutors` itself, whose own primary key is what a
    # tutor's scope filters on. A table added in a later phase is guarded the day it gains
    # the column.
    return "tutor_id" in mapper.columns or mapper.local_table is Tutor.__table__


def _guard_unapplied_scope(scope: ResolvedTutorScope) -> Callable[[ORMExecuteState], None]:
    """Build the `do_orm_execute` hook that refuses tutor-owned reads until `scope` is read."""

    def guard(state: ORMExecuteState) -> None:
        is_query = state.is_select or state.is_update or state.is_delete
        offenders: list[str] = []

        if not scope.applied and is_query:
            offenders = sorted({m.class_.__name__ for m in state.all_mappers if _is_tutor_owned(m)})

        if offenders:
            raise TutorScopeNotApplied(
                f"{', '.join(offenders)} queried before this request's tutor scope was applied. "
                "Pass `scope.tutor_id` into the service call that builds this query, or — if the "
                "route loads a single row and checks its owner — depend on `Principal` and "
                "`assert_can_access_tutor` instead of on `TutorScope`."
            )

    return guard


def get_tutor_scope(
    user: Principal,
    db: Annotated[Session, Depends(get_db)],
    tutor_id: uuid.UUID | None = None,
) -> Generator[ResolvedTutorScope, None, None]:
    """Resolve the request's tutor scope, and arm the guard that makes ignoring it fail.

    `tutor_id` is the caller's request, taken from the path when the route has a `{tutor_id}`
    segment and from the query string otherwise; `_decide_tutor_scope` turns it into the
    filter, raising 403 on a cross-tutor reach before the endpoint ever runs.

    The listener is bound to this request's `Session` — the same instance the route gets from
    `Depends(get_db)`, since FastAPI caches a dependency per request — and is removed on the
    way out so it cannot outlive the request on a pooled or test-scoped session.
    """
    scope = ResolvedTutorScope(_decide_tutor_scope(user, tutor_id))
    guard = _guard_unapplied_scope(scope)

    event.listen(db, "do_orm_execute", guard)
    try:
        yield scope
    finally:
        event.remove(db, "do_orm_execute", guard)


TutorScope = Annotated[ResolvedTutorScope, Depends(get_tutor_scope)]


def assert_can_access_tutor(user: CurrentUser, owner_tutor_id: uuid.UUID | None) -> None:
    """Row-level companion to `TutorScope`, for "load by id, then check the owner".

    Office (admins, managers, developers) always pass. A tutor passes only when the row belongs
    to them; an unowned row (`owner_tutor_id is None`) belongs to no tutor and so is not
    theirs. Raises 403 — never 404, never a silent empty response.

    A route using this pattern takes `Principal`, not `TutorScope`: it has to read the row
    before it can know the owner, so there is no filter to apply up front and nothing for the
    unapplied-scope guard to check.
    """
    if user.role not in OFFICE_ROLES and (user.tutor_id is None or owner_tutor_id != user.tutor_id):
        raise _forbidden(TUTOR_SCOPE_ERROR)
