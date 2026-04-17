"""Tutoring session model — tracks problem, steps, attempts, and conversation."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class SessionStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class SessionMode(StrEnum):
    LEARN = "learn"
    PRACTICE = "practice"
    MOCK_TEST = "mock_test"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # Problem
    problem: Mapped[str] = mapped_column(Text, nullable=False)
    problem_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Steps from decomposition (JSON array of step dicts)
    steps: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)

    # Progress
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    total_steps: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default=SessionStatus.ACTIVE, index=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default=SessionMode.LEARN)
    subject: Mapped[str] = mapped_column(String(30), nullable=False, server_default="math")
    topic: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # School context — tags session to a class section for teacher analytics
    section_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sections.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # Conversation history (JSON array of {role, content, timestamp})
    exchanges: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_sessions_user_id_created_at", "user_id", "created_at"),
    )
