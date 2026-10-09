from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.schemas.auth import RefreshRequest, SetPasswordRequest, TokenPair
from app.services.auth_service import (
    InvalidCredentials,
    InvalidRefreshToken,
    IssuedTokens,
    RefreshTokenReused,
    authenticate_user,
    issue_token_pair,
    revoke_family_for_token,
    rotate_refresh_token,
)
from app.services.password_link_service import (
    InvalidLink,
    InvalidPassword,
    set_password_with_link,
)
from app.services.rate_limit_service import (
    load_login_policies,
    release_login_attempt,
    reserve_login_attempt,
)

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/auth"
REFRESH_COOKIE_SAMESITE = "Lax"
INVALID_CREDENTIALS_ERROR = "Incorrect email or password"
INVALID_REFRESH_ERROR = "Invalid refresh token"
# One message for both buckets and for every address. Naming the bucket would tell an
# unauthenticated caller whether it was their address or their network that tripped, and a
# message that appeared only for real accounts would turn the 429 into the account-enumeration
# oracle the shared 401 exists to prevent.
RATE_LIMITED_ERROR = "Too many login attempts. Try again later."
# One message for every refusal of a link, so the endpoint never says whether a token exists.
INVALID_LINK_ERROR = "This link is invalid or has expired"
INVALID_PASSWORD_ERROR = "Password must be between 8 characters and 72 bytes"
SECONDS_PER_DAY = 24 * 60 * 60

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token", response_model=TokenPair)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    request: Request,
    response: Response,
    db: DbSession,
) -> TokenPair:
    policies = load_login_policies(db)

    # Reserved before `authenticate_user`, so a throttled request never pays the bcrypt round.
    # Reserving after would leave the endpoint's real cost — a deliberately slow hash — fully
    # available to an attacker, which is most of what the limit is protecting, and would let
    # every request arriving during one hash read the same stale count and be admitted.
    reservation = reserve_login_attempt(
        db, client_ip=_client_ip(request), email=form_data.username, policies=policies
    )
    # Committed here, before the password check, and not folded into the commit below. The 401
    # path raises without committing, so without this the reservation would be rolled back with
    # it and no failure would ever be counted. It also ends the transaction holding the bucket's
    # advisory lock, so concurrent attempts wait on it for milliseconds rather than a bcrypt round.
    db.commit()

    if not reservation.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=RATE_LIMITED_ERROR,
            headers={"Retry-After": str(reservation.retry_after_seconds)},
        )

    try:
        user = authenticate_user(db, email=form_data.username, password=form_data.password)
    except InvalidCredentials as exc:
        # Nothing to record: the reservation committed above already is this failure. Adding a
        # write here would double-count it.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=INVALID_CREDENTIALS_ERROR,
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    release_login_attempt(db, reservation=reservation)

    issued = issue_token_pair(db, user=user)
    db.commit()
    _set_refresh_cookie(response, issued.refresh_token)

    return _token_pair(issued)


@router.post("/refresh", response_model=TokenPair)
def refresh(
    response: Response,
    db: DbSession,
    refresh_token: Annotated[str | None, Cookie()] = None,
    payload: RefreshRequest | None = None,
) -> TokenPair:
    presented = _presented_refresh_token(refresh_token, payload)

    if presented is None:
        raise _invalid_refresh_token()

    try:
        issued = rotate_refresh_token(db, presented=presented)
    except RefreshTokenReused as exc:
        db.commit()
        raise _invalid_refresh_token() from exc
    except InvalidRefreshToken as exc:
        raise _invalid_refresh_token() from exc

    db.commit()
    _set_refresh_cookie(response, issued.refresh_token)

    return _token_pair(issued)


@router.post("/password/set", response_model=TokenPair)
def set_password(payload: SetPasswordRequest, response: Response, db: DbSession) -> TokenPair:
    """Spend an Invite or reset link, store the password, and sign the user in.

    Beside `/token` so the refresh cookie's `Path=/auth` covers it unchanged. Not rate limited:
    the token is 32 random bytes, so guessing one is not a feasible attack, and the link is
    single-use.
    """
    try:
        user = set_password_with_link(
            db, token=payload.token, password=payload.password, now=datetime.now(UTC)
        )
    except InvalidPassword as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=INVALID_PASSWORD_ERROR
        ) from exc
    except InvalidLink as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=INVALID_LINK_ERROR
        ) from exc

    issued = issue_token_pair(db, user=user)
    db.commit()
    _set_refresh_cookie(response, issued.refresh_token)

    return _token_pair(issued)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def logout(
    db: DbSession,
    refresh_token: Annotated[str | None, Cookie()] = None,
    payload: RefreshRequest | None = None,
) -> Response:
    presented = _presented_refresh_token(refresh_token, payload)

    if presented is not None:
        revoke_family_for_token(db, presented=presented)
        db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _clear_refresh_cookie(response)

    return response


def _client_ip(request: Request) -> str | None:
    """The ASGI peer, `request.client`, and nothing else — this function never reads
    `X-Forwarded-For` itself.

    What `request.client` *contains* is decided before this function runs, and no longer split
    across a Dockerfile flag. `create_app()` mounts `ProxyHeadersMiddleware` whenever
    `TRUSTED_PROXIES` names one or more addresses or CIDR blocks; when a request arrives from
    one of those addresses, the middleware replaces `scope["client"]` from `X-Forwarded-For`
    before this function ever sees it. From any other peer the header is ignored.

    With `TRUSTED_PROXIES` unset the limiter buckets by socket peer, which is correct when the
    API is reached directly and collapses every user into one bucket behind a proxy — that is
    the outage this mechanism exists to avoid. Widening the trusted set to `*` would let an
    attacker rotate the header per request and make the per-IP limit stop existing, which is
    worse than the collapsed bucket because it looks like it is working; the setting refuses `*`
    at startup, so that failure mode is no longer reachable by configuration (`app/config.py`).

    A forged header still loses through a correctly-configured proxy: Caddy appends the address
    it actually received the request from, and uvicorn scans the forwarded list from the right,
    taking the first untrusted entry — a value the client wrote survives only as a prefix that
    gets skipped. That holds only while the trusted set contains the proxy and nothing else,
    which is the other reason not to widen it.

    `request.client` is None when the ASGI server reports no peer address; the caller skips the
    IP bucket rather than inventing a key for it.
    """
    return request.client.host if request.client is not None else None


def _presented_refresh_token(
    cookie_token: str | None, payload: RefreshRequest | None
) -> str | None:
    if cookie_token:
        presented = cookie_token
    elif payload is not None and payload.refresh_token:
        presented = payload.refresh_token
    else:
        presented = None

    return presented


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    max_age = get_settings().refresh_token_expire_days * SECONDS_PER_DAY
    response.set_cookie(value=refresh_token, max_age=max_age, **_shared_cookie_attributes())


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(**_shared_cookie_attributes())


def _shared_cookie_attributes() -> dict[str, object]:
    return {
        "key": REFRESH_COOKIE_NAME,
        "httponly": True,
        "samesite": REFRESH_COOKIE_SAMESITE,
        "path": REFRESH_COOKIE_PATH,
        "secure": get_settings().cookie_secure,
    }


def _token_pair(issued: IssuedTokens) -> TokenPair:
    return TokenPair(access_token=issued.access_token, refresh_token=issued.refresh_token)


def _invalid_refresh_token() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_REFRESH_ERROR)
