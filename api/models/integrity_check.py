"""Integrity-checker models — conversational understanding-check
state. After a student submits a homework, an extraction runs over
the uploaded image, up to 3 primary problems are sampled, and a
single teacher-agent conversation runs for the whole submission.
The agent probes the student's work, submits per-problem verdicts
via tool calls, and emits an overall finish with a badge + summary.

Three tables:
- integrity_check_submissions — one row per checked submission,
  carries submission-level status + overall verdict.
- integrity_check_problems — one row per sampled problem, carries
  per-problem badge/confidence/reasoning + extraction snapshot.
- integrity_conversation_turns — one row per conversation turn,
  including tool calls + tool results so the whole agent loop is
  auditable.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
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


class IntegrityCheckSubmission(Base):
    """One row per submission that has an integrity check. Tracks the
    submission-level lifecycle and the overall verdict the agent
    emits via `finish_check`.
    """

    __tablename__ = "integrity_check_submissions"
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # unique=True already creates a btree index in PG
    )

    # status: extracting / awaiting_student / in_progress / complete /
    # skipped_unreadable. The agent's finish_check flips the row to
    # `complete` and populates disposition + summary.
    status: Mapped[str] = mapped_column(String(32), nullable=False)

    # Filled in by finish_check (or by the server-side force-finalize
    # when the turn cap is hit). One of:
    #   pass / needs_practice / tutor_pivot / flag_for_review
    # Null when status is `extracting`, `awaiting_student`,
    # `in_progress`, or `skipped_unreadable` (the last carries meaning
    # via status alone).
    disposition: Mapped[str | None] = mapped_column(String(32), nullable=True)
    overall_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Why the pipeline picked the problem it did — one of
    # verified_hardest_correct / struggling_easiest. Drives the
    # agent's posture (see derive_agent_posture). For audit. Null
    # when the submission was unreadable (no real selection ran).
    probe_selection_reason: Mapped[str | None] = mapped_column(
        String(32), nullable=True,
    )

    # Whether the agent used the inline variant disambiguator
    # mid-session (the "solve this similar one" escalation path).
    inline_variant_used: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false",
    )
    # Outcome of the variant probe if it ran:
    #   specific_approach / approach_after_followup / blank_or_wrong /
    #   not_applicable
    inline_variant_result: Mapped[str | None] = mapped_column(
        String(32), nullable=True,
    )

    # Precomputed rollup of student-turn telemetry for this session.
    # Populated when the agent finalizes (or the turn cap fires); null
    # while in_progress, when no student turn carries telemetry, and
    # on rows from before this column shipped. The IntegrityActivitySummary
    # Pydantic model in api/routes/integrity_check.py is the canonical
    # shape — it serializes from this JSON blob on read and is the
    # API contract for both the queue overview (level only) and the
    # per-submission detail endpoint (full summary).
    activity_summary: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class IntegrityCheckProblem(Base):
    """One row per (submission, sampled problem). Carries the
    extraction snapshot and the per-problem verdict the agent emits
    via `submit_problem_verdict`.
    """

    __tablename__ = "integrity_check_problems"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint(
            "integrity_check_submission_id", "bank_item_id",
            name="uq_icp_check_submission_bank_item",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    integrity_check_submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("integrity_check_submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    sample_position: Mapped[int] = mapped_column(Integer, nullable=False)

    # status: pending / verdict_submitted / dismissed / skipped_unreadable
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    student_work_extraction: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True,
    )

    # Filled in by submit_problem_verdict. Six dimensions scored
    # low / mid / high (paraphrase + causal always; transfer,
    # prediction, authority_resistance, self_correction may be
    # not_probed / not_observed).
    rubric: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    ai_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Why this problem was selected as a probe target. One of
    # verified_hardest_correct / struggling_easiest. Mirrors
    # IntegrityCheckSubmission.probe_selection_reason on the row
    # the pipeline picked first (sample_position 0). Null on the
    # unreadable path (no selection ran).
    selected_reason: Mapped[str | None] = mapped_column(
        String(32), nullable=True,
    )

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


class IntegrityConversationTurn(Base):
    """One row per conversation turn. Includes agent/student text
    turns AND tool_call/tool_result turns so the whole agent loop is
    reconstructible. Ordinal is a monotonic integer within a
    conversation; ties are impossible because we hold the connection
    session when writing a new turn.

    Content semantics by role:
    - agent: `content` is the assistant's text reply.
    - student: `content` is the student's message.
    - tool_call: `content` is JSON-encoded tool input, `tool_name` +
      `tool_use_id` identify the call.
    - tool_result: `content` is the server's textual reply to the
      call (e.g. "accepted" or "rejected: need at least one student
      turn on this problem first"), `tool_use_id` links back.
    """

    __tablename__ = "integrity_conversation_turns"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        UniqueConstraint(
            "integrity_check_submission_id", "ordinal",
            name="uq_ict_submission_ordinal",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    integrity_check_submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("integrity_check_submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tool_use_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    seconds_on_turn: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Behavioral telemetry from the student client: focus/blur events,
    # paste events, typing cadence summary, device type,
    # need_more_time_used. Student turns only. Teacher-facing evidence
    # only — never surfaced to the student. Shape:
    #   {
    #     "focus_blur_events": [{"at": ISO, "duration_ms": int}, ...],
    #     "paste_events": [{"at": ISO, "byte_count": int}, ...],
    #     "typing_cadence": {"total_ms": int, "pauses_over_3s": int, "edits": int},
    #     "device_type": "desktop" | "mobile",
    #     "need_more_time_used": bool
    #   }
    telemetry: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
