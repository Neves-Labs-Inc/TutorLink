"""Helpers shared by test modules that build rows by hand."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.tutor import Tutor


def user_id_of(db: Session, tutor_id: uuid.UUID) -> uuid.UUID:
    """The person behind a teaching profile: what a Booking's `user_id` names (#130)."""
    return db.scalars(select(Tutor.user_id).where(Tutor.id == tutor_id)).one()


def profile_id_of(db: Session, user_id: uuid.UUID) -> uuid.UUID:
    """The teaching profile of a Booking's Staff member, for the scopes that key on it."""
    return db.scalars(select(Tutor.id).where(Tutor.user_id == user_id)).one()
