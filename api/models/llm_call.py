"""LLM call log model — tracks every Claude API call for monitoring."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class LLMCall(Base):
    __tablename__ = "llm_calls"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # Denormalized at write time from users.school_id so the admin
    # dashboard can filter calls by school without a multi-hop join.
    # Null = "Internal" bucket (founder, test accounts, non-school
    # users). Snapshot semantics: a call keeps its original school_id
    # even if the user is later moved to a different school.
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # The submission this call relates to (Vision extraction, integrity
    # equivalence/agent turns, AI grading). Lets the dashboard pull a
    # full per-submission LLM trace with one indexed query. Null on
    # calls that aren't tied to a submission (admin tools, etc).
    submission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    function: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False)
    input_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Free-form per-call structured tags. Different functions stamp
    # different keys (posture, tier, selection_reason, student_turn,
    # loop_iter, phase, n_trivial_matches, etc). The dashboard renders
    # whatever's there as labeled chips — no consumer code needs to
    # know all possible keys at once. Column is named call_metadata
    # because `metadata` is reserved on SQLAlchemy's Base class.
    call_metadata: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
