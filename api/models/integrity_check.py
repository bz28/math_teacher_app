"""Integrity-checker models — per-submission understanding-check
state. After a student submits a homework, an AI pipeline samples up
to 5 primary problems, asks 2-3 short questions about each, scores
the answers, and produces a confidence badge for the teacher.

Two tables: one row per (submission × picked problem) for the
problem-level state + badge, and one row per (problem × question
slot) for the actual Q&A.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class IntegrityCheckProblem(Base):
    """One row per (submission, sampled problem). Tracks the
    problem's status through the AI pipeline (pending → generating →
    awaiting_student → scoring → complete) and the eventual badge.

    `sample_position` records the order this problem was picked at
    submit time, so a student resuming the chat gets the same set in
    the same order regardless of how the sampling logic evolves later.
    """

    __tablename__ = "integrity_check_problems"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint(
            "submission_id", "bank_item_id", name="uq_icp_submission_bank_item",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    sample_position: Mapped[int] = mapped_column(Integer, nullable=False)

    # status: pending / generating / awaiting_student / scoring /
    # complete / skipped_unreadable / dismissed. The dismissed status
    # is set by the teacher action; everything else is owned by the
    # pipeline.
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    student_work_extraction: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    # badge: likely / uncertain / unlikely / unreadable. Computed when
    # all the response rows for this problem are scored.
    badge: Mapped[str | None] = mapped_column(String(20), nullable=True)
    raw_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    teacher_dismissed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False,
    )
    teacher_dismissal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class IntegrityCheckResponse(Base):
    """One row per (problem, question slot). The slot is created when
    the pipeline generates the question and the student-answer fields
    are filled in when the kid submits an answer via the chat UI
    (PR 2). Verdict comes from the scorer (stub in PR 1, real Sonnet
    in PR 4).
    """

    __tablename__ = "integrity_check_responses"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint(
            "integrity_check_problem_id", "question_index",
            name="uq_icr_problem_question",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    integrity_check_problem_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("integrity_check_problems.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_index: Mapped[int] = mapped_column(Integer, nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    expected_shape: Mapped[str | None] = mapped_column(Text, nullable=True)
    rubric_hint: Mapped[str | None] = mapped_column(Text, nullable=True)

    student_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    # answer_verdict: good / weak / bad / skipped / rephrased
    answer_verdict: Mapped[str | None] = mapped_column(String(20), nullable=True)
    seconds_on_question: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tab_switch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rephrase_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    answered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    scored_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
