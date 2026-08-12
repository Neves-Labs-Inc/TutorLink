"""Request-scoped authentication and the tutor-scoping rule every `/api/*` route consumes.

Application-level wiring, alongside `db.py` and `config.py` — not a router, not a service.
A router's whole auth surface is meant to be an import from here:

```python
from app.dependencies import Principal, AdminPrincipal, resolve_tutor_scope

@router.get("/api/bookings")
def list_bookings(user: Principal, db: DbSession, tutor_id: uuid.UUID | None = None):
    scope = resolve_tutor_scope(user, tutor_id)          # 403 on a cross-tutor reach
    return booking_service.list_bookings(db, tutor_id=scope)   # None means "all tutors"
```

Four properties this module exists to guarantee, all of which Phase 3 onwards depends on:

- **Authentication failures are indistinguishable.** A missing, malformed, badly signed,
  expired, or wrong-`typ` token, an unknown user, and a deactivated user all produce the same
  401 and the same message. Never tell an unauthenticated caller which one it was.

- **The `users` row is read on every request** (D-023). One primary-key lookup buys the
  property that setting `is_active = false` takes effect on the caller's *next* request rather
  than up to fifteen minutes later when their access token expires — which is the entire point
  of `is_active` soft delete. `role` and `tutor_id` are taken from that row, not from the
  token's claims, for the same reason. Do not "optimise" this into a claims-only path and do
  not cache it.

- **A tutor cannot opt out of scoping.** `resolve_tutor_scope` returns the caller's own
  `tutor_id` when a tutor asks for nothing in particular. Returning `None` there would mean
  "no filter" and would silently widen a list endpoint to every tutor's rows. A tutor account
  whose `users.tutor_id` is `NULL` is rejected with 403 rather than treated as an admin or
  scoped to `NULL`: that column is nullable because admins have no tutor profile, so a tutor
  row in that state is a data error and must fail loudly.

- **Cross-tutor access is 403 — never 404, and never an empty 200** (`CONSTITUTION.md:15`).
  Returning 404 to hide existence is defensible in general and is explicitly not what this
  project does. Returning an empty result set is worse still: it looks correct in a browser
  while proving nothing about whether the caller was actually denied.

`resolve_tutor_scope` returns the filter a query must apply; it does not apply it. A route
that calls it and then ignores the returned value leaks rows, so pass the result into the
service call rather than re-deriving a filter from `user.tutor_id`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.security import ACCESS_TOKEN_TYPE, TokenError, decode_token

CREDENTIALS_ERROR = "Could not validate credentials"
ADMIN_REQUIRED_ERROR = "Admin privileges required"
TUTOR_SCOPE_ERROR = "Not permitted to access this tutor's data"

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

    user = db.get(User, claims.subject)
    if user is None or not user.is_active:
        raise _unauthorized()

    return CurrentUser(
        id=user.id,
        email=user.email,
        role=user.role,
        tutor_id=user.tutor_id,
    )


Principal = Annotated[CurrentUser, Depends(get_current_user)]


def require_admin(user: Principal) -> CurrentUser:
    # Depending on `get_current_user` rather than re-reading the token is what makes an
    # unauthenticated request a 401 and not a 403: authentication runs, and fails, first.
    if user.role is not UserRole.ADMIN:
        raise _forbidden(ADMIN_REQUIRED_ERROR)
    return user


AdminPrincipal = Annotated[CurrentUser, Depends(require_admin)]


def resolve_tutor_scope(
    user: CurrentUser, requested_tutor_id: uuid.UUID | None
) -> uuid.UUID | None:
    """The `tutor_id` a query must filter on, or `None` for "no filter, all tutors".

    | principal                | requested        | result           |
    |--------------------------|------------------|------------------|
    | admin                    | `None`           | `None`           |
    | admin                    | any UUID         | that UUID        |
    | tutor with `tutor_id`    | `None`           | own `tutor_id`   |
    | tutor with `tutor_id`    | own              | own `tutor_id`   |
    | tutor with `tutor_id`    | another tutor's  | **403**          |
    | tutor with `tutor_id` None | anything       | **403**          |
    """
    if user.role is UserRole.ADMIN:
        return requested_tutor_id

    if user.tutor_id is None:
        raise _forbidden(TUTOR_SCOPE_ERROR)

    if requested_tutor_id is not None and requested_tutor_id != user.tutor_id:
        raise _forbidden(TUTOR_SCOPE_ERROR)

    # Not `requested_tutor_id`: a tutor who asked for nothing is scoped to themselves.
    return user.tutor_id


def assert_can_access_tutor(user: CurrentUser, owner_tutor_id: uuid.UUID | None) -> None:
    """Row-level companion to `resolve_tutor_scope`, for "load by id, then check the owner".

    Admins always pass. A tutor passes only when the row belongs to them; an unowned row
    (`owner_tutor_id is None`) belongs to no tutor and so is not theirs. Raises 403 — never
    404, never a silent empty response.
    """
    if user.role is UserRole.ADMIN:
        return

    if user.tutor_id is None or owner_tutor_id != user.tutor_id:
        raise _forbidden(TUTOR_SCOPE_ERROR)
