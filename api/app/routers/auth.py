from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from redis import Redis
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.redis_client import get_redis
from app.schemas.auth import RefreshRequest, TokenPair
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
SECONDS_PER_DAY = 24 * 60 * 60

DbSession = Annotated[Session, Depends(get_db)]
RedisClient = Annotated[Redis, Depends(get_redis)]

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token", response_model=TokenPair)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    request: Request,
    response: Response,
    db: DbSession,
    redis: RedisClient,
) -> TokenPair:
    policies = load_login_policies(db)

    # Reserved before `authenticate_user`, so a throttled request never pays the bcrypt round.
    # Reserving after would leave the endpoint's real cost — a deliberately slow hash — fully
    # available to an attacker, which is most of what the limit is protecting, and would let
    # every request arriving during one hash read the same stale count and be admitted.
    attempt = reserve_login_attempt(
        redis, client_ip=_client_ip(request), email=form_data.username, policies=policies
    )
    if not attempt.allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=RATE_LIMITED_ERROR,
            headers={"Retry-After": str(attempt.retry_after_seconds)},
        )

    try:
        user = authenticate_user(db, email=form_data.username, password=form_data.password)
    except InvalidCredentials as exc:
        # Nothing to record: the reservation taken above already is this failure. Adding a
        # write here would double-count it.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=INVALID_CREDENTIALS_ERROR,
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    release_login_attempt(redis, attempt=attempt)

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
    """The socket peer, and deliberately never `X-Forwarded-For` — but only half of that
    guarantee lives here.

    This function reads `request.client` and nothing else. What `request.client` *contains* is
    the server's decision, not this module's: uvicorn ships `proxy_headers=True` with
    `forwarded_allow_ips` defaulting to `127.0.0.1`, so whenever the real peer is loopback it
    overwrites `scope["client"]` from `X-Forwarded-For` before any application code runs. That
    is a header the client wrote — an attacker rotates it per request, lands in a fresh bucket
    every time, and the per-IP limit is worth nothing. `docker/api.Dockerfile` therefore starts
    uvicorn with `--no-proxy-headers`, and that flag is part of this security property rather
    than a deployment detail. Removing it silently re-arms the spoof.

    **When the reverse proxy from #2 lands, XFF handling must land with it.** Behind a proxy
    every request arrives from the proxy's address, so this function would collapse the whole
    internet into one bucket — the limit does not fail open or closed, it silently locks out
    every user at once the first time an attacker spends the shared budget. Re-enabling
    `--proxy-headers` at that point requires `forwarded_allow_ips` set to the proxy's specific
    address. `FORWARDED_ALLOW_IPS=*` is the obvious reflex and must never be used: it trusts
    the header from any peer and restores full spoofability, which is worse than the collapsed
    bucket because it looks like it works.

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
        "secure": not get_settings().debug,
    }


def _token_pair(issued: IssuedTokens) -> TokenPair:
    return TokenPair(access_token=issued.access_token, refresh_token=issued.refresh_token)


def _invalid_refresh_token() -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_REFRESH_ERROR)
