import datetime
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import OfficePrincipal
from app.models.enums import BookingStatus
from app.schemas.booking import BookingSummary, booking_summary
from app.schemas.common import DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Page
from app.services.booking_service import BookingFilters, ClientNotFound, list_client_bookings

CLIENT_NOT_FOUND_ERROR = "Client not found"

DbSession = Annotated[Session, Depends(get_db)]

router = APIRouter(prefix="/api/clients", tags=["bookings"])


@router.get("/{client_id}/bookings", response_model=Page[BookingSummary])
def list_bookings_for_client(
    client_id: uuid.UUID,
    user: OfficePrincipal,
    db: DbSession,
    statuses: Annotated[list[BookingStatus] | None, Query(alias="status")] = None,
    tutor_id: uuid.UUID | None = None,
    subject_id: uuid.UUID | None = None,
    date_from: Annotated[datetime.date | None, Query(alias="from")] = None,
    date_to: Annotated[datetime.date | None, Query(alias="to")] = None,
    page: Annotated[int, Query(ge=1)] = DEFAULT_PAGE,
    page_size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> Page[BookingSummary]:
    # `tutor_id` is an ordinary filter declared here, deliberately not the `TutorScope`
    # dependency's parameter: `Booking` is a tutor-owned mapper, so an unread scope would turn
    # every populated response into a 500. Clients are admin-only and have no tutor filter.
    filters = BookingFilters(
        statuses=tuple(statuses or ()),
        tutor_id=tutor_id,
        date_from=date_from,
        date_to=date_to,
        subject_id=subject_id,
    )

    try:
        bookings, total = list_client_bookings(
            db,
            client_id=client_id,
            filters=filters,
            limit=page_size,
            offset=(page - 1) * page_size,
        )
    except ClientNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, CLIENT_NOT_FOUND_ERROR) from exc

    return Page[BookingSummary](
        items=[booking_summary(row) for row in bookings],
        total=total,
        page=page,
        page_size=page_size,
    )
