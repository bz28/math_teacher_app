"""Per-student persistent mastery state on a teacher-authored bank item.

Powers the school-student Mastery Loop: every interaction with a
practice problem updates this row, and every read of a practice set
joins through it to render mastery dots. Distinct from BankConsumption
(which tracks HW variation rotation) because mastery is keyed by the
problem itself, not by a single "served" instance — re-attempts roll
into the same row.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

# Mastery state values. Stored on the row so list/aggregation endpoints
# filter without recomputing from the atomic columns. Strict definition:
# `mastered` requires correct-on-first-try with no walkthrough ever
# opened. Once mastered, never demoted.
STATE_NOT_STARTED = "not_started"
STATE_WALKED_THROUGH = "walked_through"
STATE_MISSED = "missed"
STATE_ATTEMPTED = "attempted"
STATE_MASTERED = "mastered"

MASTERY_STATES = (
    STATE_NOT_STARTED,
    STATE_WALKED_THROUGH,
    STATE_MISSED,
    STATE_ATTEMPTED,
    STATE_MASTERED,
)


class StudentProblemMastery(Base):
    """One row per (student, bank_item) — created lazily on first
    interaction. Absence of a row means `not_started`."""

    __tablename__ = "student_problem_mastery"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        # Composite PK enforces one row per pair; the index also
        # serves the common "all of this student's mastery rows"
        # lookup with a leading column.
        Index(
            "ix_student_problem_mastery_student_state",
            "student_id",
            "state",
        ),
        # Reserved for PR 3's History-tab "needs review" surface,
        # which orders by `last_attempt_at DESC` for the recently-
        # missed list. Cheap to land alongside the table — adding
        # an index later would require a backfill scan.
        Index(
            "ix_student_problem_mastery_student_last_attempt",
            "student_id",
            "last_attempt_at",
        ),
        # CHECK at the DB level so any direct SQL or buggy code path
        # can't land an unknown state. Pydantic's Literal validation
        # would otherwise 500 on read.
        CheckConstraint(
            "state IN ('not_started','walked_through','missed',"
            "'attempted','mastered')",
            name="ck_student_problem_mastery_state_valid",
        ),
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="CASCADE"),
        primary_key=True,
    )

    state: Mapped[str] = mapped_column(
        String(20), nullable=False, default=STATE_NOT_STARTED,
        server_default=STATE_NOT_STARTED,
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0",
    )
    walkthrough_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # First-attempt flags decide `mastered` eligibility forever — they
    # never change after the first answer is submitted.
    first_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    first_attempt_was_correct: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True,
    )
    last_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    last_correct_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
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


class StudentProblemChat(Base):
    """One row per turn of a per-(student, bank_item) tutor chat
    thread. Reused across walk-through and post-answer asks for the
    same problem — global, not per-session, so a student returning a
    week later sees their earlier conversation.

    Distinct table from the existing stateless step/problem chat
    endpoints because those are FE-stateful (history echoed every
    call); the Mastery Loop persists history so re-entry resumes."""

    __tablename__ = "student_problem_chat"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        # Threaded reads order by created_at ascending; the composite
        # index is also the natural scope-by-thread index.
        Index(
            "ix_student_problem_chat_thread",
            "student_id",
            "bank_item_id",
            "created_at",
        ),
        CheckConstraint(
            "role IN ('user','assistant')",
            name="ck_student_problem_chat_role_valid",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    # "user" or "assistant" — same convention as the stateless chat
    # endpoints' ChatMessage shape, so the wire payload reuses cleanly.
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(
        # Text; LLM responses can be long. Per-message size cap is
        # enforced at the API edge, not the column.
        String(8192), nullable=False,
    )
    # When the message was asked about a specific step (walk-through
    # mode) we persist the index for context. Null = post-walkthrough
    # / whole-problem ask.
    step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
