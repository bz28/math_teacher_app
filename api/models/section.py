"""Section model — a class period under a course."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    join_code: Mapped[str | None] = mapped_column(String(10), unique=True, nullable=True)

    # Whether the join code still admits new students. Teacher-controlled
    # and open by default: a class runs a semester, so a code that dies on
    # a timer breaks the honest case (and a leaked one is live for the
    # whole window anyway). Rotating the code is the fix for a leak;
    # closing enrollment is the deliberate "no more students" action.
    enrollment_open: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
