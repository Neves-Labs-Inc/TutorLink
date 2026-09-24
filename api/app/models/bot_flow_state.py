"""The bot's in-progress conversation flow, one row per phone number.

Keyed on `phone_number` with no foreign key to `conversations`: a flow can be mid-intake before
a conversation's guardian is known, and `erd.md` records that nothing is written to both. The
row holds a live flow only — `expires_at` is reaped nightly rather than indexed, since the table
stays small between purges.
"""

import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class BotFlowState(Base):
    __tablename__ = "bot_flow_state"

    phone_number: Mapped[str] = mapped_column(String(32), primary_key=True)
    step: Mapped[str] = mapped_column(Text, nullable=False)
    collected_data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    misses: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
