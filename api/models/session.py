"""Tutoring session model — tracks problem, steps, attempts, and conversation."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)

    # Problem
    problem: Mapped[str] = mapped_column(Text, nullable=False)
    problem_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Steps from decomposition (JSON array of step dicts)
    steps: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)

    # Progress
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, completed, abandoned
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="learn")

    # Per-step tracking (JSON: {step_index: {attempts: int, hints_used: int}})
    step_tracking: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    # Conversation history (JSON array of {role, content, timestamp})
    exchanges: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
