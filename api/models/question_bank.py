"""Question bank models — pool of teacher-approved questions per course."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class QuestionBankItem(Base):
    """A single AI-generated or teacher-edited question available for use
    in homework, tests, and student practice/learn modes once approved."""

    __tablename__ = "question_bank_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="SET NULL"), nullable=True, index=True,
    )

    question: Mapped[str] = mapped_column(Text, nullable=False)
    solution_steps: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    final_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    # status: pending / approved / rejected / archived
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    source_doc_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    generation_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )

    # One-level history for undo. Snapshotted on every edit/regen.
    previous_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_solution_steps: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    previous_final_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Workshop chat thread. List of {role, text, proposal?, accepted?,
    # discarded?, ts}. Persists across modal close so the conversation
    # survives. See plans/question-bank-workshop-v2.md.
    chat_messages: Mapped[list[Any]] = mapped_column(JSON, nullable=False, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class QuestionBankGenerationJob(Base):
    """Tracks an in-flight AI generation request. Polled by the frontend
    and resolved by an in-process FastAPI BackgroundTask. Not a durable
    queue — process restarts mid-job are acceptable for v1."""

    __tablename__ = "question_bank_generation_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="SET NULL"), nullable=True,
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )

    # status: queued / running / done / failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    requested_count: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="mixed")
    constraint: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_doc_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    produced_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
