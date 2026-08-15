"""Runtime-configurable business settings, as typed key/value rows.

A row per setting rather than one row with a column per setting: the set grows, and a new
setting should be an INSERT rather than a migration plus a model change plus a schema edit.

`value` is TEXT and `value_type` records how to read it. Type erasure costs nothing on the
read path — every caller knows the type it wants and casts at the boundary — and it is what
lets the settings page render and validate a field it has no compile-time knowledge of.
Validators stay in code; `value_type` is a rendering hint, not a constraint.
"""

import datetime
import uuid

from sqlalchemy import Boolean, DateTime, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

SETTING_VALUE_TYPE_INTEGER = "integer"


class SystemSetting(Base):
    __tablename__ = "system_settings"
    __table_args__ = (UniqueConstraint("key", name="uq_system_settings_key"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    value_type: Mapped[str] = mapped_column(String(16), nullable=False)
    # Defaults TRUE so a setting inserted without an explicit flag hides from admins rather
    # than leaking to them. No setting is developer-only today; the gate is built ahead of its
    # first occupant, and the default is what makes that safe.
    is_developer_only: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
