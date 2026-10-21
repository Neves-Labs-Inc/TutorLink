"""Acknowledging a Booking's Time off clash (#209): an Admin keeps it on purpose.

An acknowledged Booking leaves To sort out (`sort_out_service.time_off_clash_predicate`) but
still shows who kept it and when. Neither write bumps `updated_at` (an acknowledgement is not a
Change booking) nor sends any message.

This module knows nothing about FastAPI or status codes; it raises the domain exceptions below
and `app.routers.booking_clash` maps them. Nothing here commits: the caller owns the boundary.
"""

import datetime
import logging
import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.services.sort_out_service import time_off_clash_predicate

logger = logging.getLogger(__name__)


class ClashAcknowledgementError(Exception):
    """Base class for every failure this module reports."""


class BookingNotFound(ClashAcknowledgementError):
    """No `bookings` row for the requested id."""


class NoClashToAcknowledge(ClashAcknowledgementError):
    """The Booking sits in no approved Time off right now, acknowledged or not."""


def acknowledge_clash(db: Session, *, booking_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Store `user_id` and now as the acknowledgement; a repeat keeps the first one.

    The current clash is checked ahead of the stored acknowledgement, so an old acknowledgement
    on a Booking whose clash has since gone is refused rather than restated.
    """
    has_clash, acknowledged_at = _lock(db, booking_id=booking_id, operation="acknowledge")

    if not has_clash:
        logger.warning("clash_acknowledgement.acknowledge: booking %s has no clash", booking_id)
        raise NoClashToAcknowledge
    if acknowledged_at is not None:
        return

    _store(
        db,
        booking_id=booking_id,
        acknowledged_by=user_id,
        acknowledged_at=datetime.datetime.now(tz=datetime.UTC),
    )


def withdraw_clash_acknowledgement(db: Session, *, booking_id: uuid.UUID) -> None:
    """Clear the acknowledgement; with none stored, nothing changes."""
    _, acknowledged_at = _lock(db, booking_id=booking_id, operation="withdraw")

    if acknowledged_at is None:
        return

    _store(db, booking_id=booking_id, acknowledged_by=None, acknowledged_at=None)


def _lock(
    db: Session, *, booking_id: uuid.UUID, operation: str
) -> tuple[bool, datetime.datetime | None]:
    """The row locked `FOR UPDATE`: whether it clashes now, and its stored acknowledgement."""
    found = db.execute(
        select(time_off_clash_predicate(ignore_acknowledgement=True), Booking.clash_acknowledged_at)
        .where(Booking.id == booking_id)
        .with_for_update(of=Booking)
    ).one_or_none()

    if found is None:
        logger.warning("clash_acknowledgement.%s: booking %s not found", operation, booking_id)
        raise BookingNotFound

    has_clash, acknowledged_at = found
    return has_clash, acknowledged_at


def _store(
    db: Session,
    *,
    booking_id: uuid.UUID,
    acknowledged_by: uuid.UUID | None,
    acknowledged_at: datetime.datetime | None,
) -> None:
    db.execute(
        update(Booking)
        .where(Booking.id == booking_id)
        .values(
            clash_acknowledged_by=acknowledged_by,
            clash_acknowledged_at=acknowledged_at,
            # Restated so the column's `onupdate` stays quiet: this is not a Change booking.
            updated_at=Booking.updated_at,
        )
        .execution_options(synchronize_session=False)
    )
