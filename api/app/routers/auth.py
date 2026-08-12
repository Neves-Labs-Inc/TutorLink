from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
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

REFRESH_COOKIE_NAME = "refresh_token"
REFRESH_COOKIE_PATH = "/auth"
REFRESH_COOKIE_SAMESITE = "Lax"
INVALID_CREDENTIALS_ERROR = "Incorrect email or password"
INVALID_REFRESH_ERROR = "Invalid refresh token"
SECONDS_PER_DAY = 24 * 60 * 60

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token", response_model=TokenPair)
def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    response: Response,
    db: DbSession,
) -> TokenPair:
    try:
        user = authenticate_user(db, email=form_data.username, password=form_data.password)
    except InvalidCredentials as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=INVALID_CREDENTIALS_ERROR,
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

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
