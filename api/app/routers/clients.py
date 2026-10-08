"""`/api/clients` — admin-only, and the one router that answers the duplicate-phone 409.

A thin HTTP shell over `client_service`, matching `users.py`: the service raises domain
exceptions, this maps them to status codes and owns the commit.

`StaffPrincipal` everywhere and `TutorScope` nowhere. The RBAC table
(`docs/api-design.md:283`) gives tutors no access to any client route, so there is no tutor
filter to apply — and arming the unapplied-scope guard on a route that has nothing to pass it
turns every query here into a 500.

`GET /api/clients/{id}/bookings` lives in `client_bookings.py`, mounted on this same prefix.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import StaffPrincipal
from app.schemas.client import (
    ChildRead,
    ClientCreate,
    ClientRead,
    ClientSummary,
    ClientUpdate,
    HomeCreate,
    HomeRead,
)
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.services.client_service import (
    ActingUserNotFound,
    ClientDetail,
    ClientNotFound,
    ClientWithCounts,
    HomeInput,
    PhoneNumberTaken,
    WhatsAppChatTaken,
    create_client,
    get_client,
    list_clients,
    update_client,
)
from app.services.phone_service import InvalidPhoneNumber

CLIENT_NOT_FOUND_ERROR = "Client not found"
PHONE_NUMBER_TAKEN_ERROR = "A client with that phone number already exists"
INVALID_PHONE_NUMBER_ERROR = "phone_number is not a phone number that can be dialled"
ACTING_USER_NOT_FOUND_ERROR = "Your account no longer exists; sign in again"
WHATSAPP_CHAT_TAKEN_ERROR = "That number's WhatsApp chat belongs to another Guardian"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/clients", tags=["clients"])


@router.get("", response_model=Page[ClientSummary])
def list_all(
    user: StaffPrincipal,
    db: DbSession,
    is_active: bool = True,
    phone_number: str | None = None,
    q: str | None = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[ClientSummary]:
    try:
        clients, total = list_clients(
            db,
            is_active=is_active,
            phone_number=phone_number,
            q=q,
            limit=page_size,
            offset=(page - 1) * page_size,
        )
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc

    return Page[ClientSummary](
        items=[_summary(row) for row in clients],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{client_id}", response_model=ClientRead)
def read_one(client_id: uuid.UUID, user: StaffPrincipal, db: DbSession) -> ClientRead:
    try:
        found = get_client(db, client_id=client_id)
    except ClientNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CLIENT_NOT_FOUND_ERROR) from exc

    return _to_read(found)


@router.post("", response_model=ClientRead, status_code=status.HTTP_201_CREATED)
def create(payload: ClientCreate, user: StaffPrincipal, db: DbSession) -> ClientRead:
    try:
        created = create_client(
            db,
            name=payload.name,
            phone_number=payload.phone_number,
            home=_home_input(payload.home),
        )
    except PhoneNumberTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, PHONE_NUMBER_TAKEN_ERROR) from exc
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc

    db.commit()

    return _to_read(created)


@router.patch("/{client_id}", response_model=ClientRead)
def update(
    client_id: uuid.UUID, payload: ClientUpdate, user: StaffPrincipal, db: DbSession
) -> ClientRead:
    try:
        updated = update_client(
            db,
            client_id=client_id,
            name=payload.name,
            phone_number=payload.phone_number,
            is_active=payload.is_active,
            acting_user_id=user.id,
        )
    except ClientNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CLIENT_NOT_FOUND_ERROR) from exc
    except ActingUserNotFound as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, ACTING_USER_NOT_FOUND_ERROR) from exc
    except PhoneNumberTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, PHONE_NUMBER_TAKEN_ERROR) from exc
    except WhatsAppChatTaken as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, WHATSAPP_CHAT_TAKEN_ERROR) from exc
    except InvalidPhoneNumber as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_PHONE_NUMBER_ERROR) from exc

    db.commit()

    return _to_read(updated)


def _summary(row: ClientWithCounts) -> ClientSummary:
    return ClientSummary(
        id=row.client.id,
        name=row.client.name,
        phone_number=row.client.phone_number,
        is_active=row.client.is_active,
        home_count=row.home_count,
        child_count=row.child_count,
    )


def _home_input(home: HomeCreate | None) -> HomeInput | None:
    return (
        None
        if home is None
        else HomeInput(label=home.label, address=home.address, access_code=home.access_code)
    )


def _to_read(detail: ClientDetail) -> ClientRead:
    conversation = detail.language_conversation

    return ClientRead(
        id=detail.client.id,
        name=detail.client.name,
        phone_number=detail.client.phone_number,
        is_active=detail.client.is_active,
        homes=[HomeRead.model_validate(home) for home in detail.homes],
        children=[ChildRead.model_validate(child) for child in detail.children],
        language=None if conversation is None else conversation.language,
        language_conversation_id=None if conversation is None else conversation.id,
    )
