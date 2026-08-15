import datetime
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.guardian import ChildGuardian
    from app.models.home import ChildHome


class Child(Base):
    __tablename__ = "children"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    grade_level: Mapped[int] = mapped_column(Integer, nullable=False)
    school_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # No `parent_id`: a child has many guardians and many homes, and neither is derivable from
    # the other. A guardian's homes are their own; the homes a child is tutored at are theirs.
    guardian_links: Mapped[list["ChildGuardian"]] = relationship(back_populates="child")
    home_links: Mapped[list["ChildHome"]] = relationship(back_populates="child")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="child")
