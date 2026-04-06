"""Unit model — organizes documents into chapters/topics within a course."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    parent_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="CASCADE"), nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
