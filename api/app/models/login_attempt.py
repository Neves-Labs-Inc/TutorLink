"""A row per bucket a login attempt is charged against, written under `pg_advisory_xact_lock`.

`attempt_id` is shared by every bucket one request arms — email always, IP when known — so a
single reservation is visible as one or two rows with the same id. There is no `HasID`: the
primary key is `(bucket_key, attempt_id)`, and a surrogate id would only exist to be ignored.
"""

import datetime
import uuid

from sqlalchemy import DateTime, Index, PrimaryKeyConstraint, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    __table_args__ = (
        PrimaryKeyConstraint("bucket_key", "attempt_id"),
        Index("ix_login_attempts_bucket_key_attempted_at", "bucket_key", "attempted_at"),
    )

    bucket_key: Mapped[str] = mapped_column(Text, nullable=False)
    attempt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    attempted_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
