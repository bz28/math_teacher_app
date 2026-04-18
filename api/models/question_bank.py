"""Question bank models — pool of teacher-approved questions per course."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.ext.mutable import MutableList
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class QuestionBankItem(Base):
    """A single AI-generated or teacher-edited question available for use
    in homework, tests, and student practice/learn modes once approved."""

    __tablename__ = "question_bank_items"
    # eager_defaults makes SQLAlchemy fetch onupdate/server_default
    # values inline with the INSERT/UPDATE via RETURNING, instead of
    # lazy-loading them on next attribute access. The lazy load fails
    # in async sessions with MissingGreenlet, which is why every
    # endpoint used to manually pre-stamp item.updated_at before commit.
    __mapper_args__ = {"eager_defaults": True}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    unit_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("units.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    # Every bank item belongs to a homework — the one the teacher was
    # on when they kicked off generation. Cascade-on-delete so deleting
    # a HW cleans up its problems (no orphan bank items). Required
    # since there's no longer a standalone question-bank flow.
    originating_assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Short concept label shown as the primary scan unit in the bank
    # list. AI-generated alongside the question; teacher-editable.
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    solution_steps: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    final_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 3 MCQ wrong-answer options, generated at the same time as the
    # solution. Populated by question_bank_generation; consumed by the
    # school-student practice loop so it can serve MCQs with zero LLM
    # calls per kid.
    distractors: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    # status: pending / approved / rejected / archived
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # True while at least one published assignment references this item.
    # While locked, content edits / status changes / delete are refused.
    locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Provenance: generated (AI), imported (PDF), manual (typed by teacher).
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="generated")
    # Variation tree — set by "generate similar" later.
    parent_question_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="SET NULL"),
        nullable=True,
    )

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
    #
    # IMPORTANT: MutableList only tracks LIST-level mutations (append,
    # pop, __setitem__ of the whole element). It does NOT track mutations
    # of nested dicts. Callers that want to flip a flag on a message
    # must build a fresh dict — e.g. [{**m, "accepted": True} if ...]
    # — so old-vs-new comparison at flush time sees a real difference.
    # In-place `m["accepted"] = True` plus reassignment of a shallow
    # list copy is a no-op (both sides of the comparison share the
    # mutated dict ref). See accept_chat_proposal / discard_chat_proposal
    # in teacher_question_bank.py for the working pattern.
    chat_messages: Mapped[list[Any]] = mapped_column(
        MutableList.as_mutable(JSON), nullable=False, default=list,
    )

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
    # The HW that triggered this generation job. Copied onto each
    # produced item so the item remembers its origin even if teachers
    # reassign units later. Required — there's no bank-global flow.
    originating_assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assignments.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )

    # mode: generate (AI invents questions) / upload (extract from worksheet images)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="generate")
    # status: queued / running / done / failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    requested_count: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="mixed")
    constraint: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_doc_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # Set when this is a "generate similar" job — children inherit this
    # value as their parent_question_id, building the variation tree.
    parent_question_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Transient base64 images for upload-mode jobs. Not stored as Documents
    # because they're one-time extraction inputs, not course materials.
    uploaded_images: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True)
    produced_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BankConsumption(Base):
    """Records each approved variation served to a school student from a
    homework practice/learn loop. One row per (student, look-alike).

    The anchor is the HW primary the kid launched the loop from. Loops
    always key off the anchor — never the current variation id — which
    is what structurally prevents recursion (variations of variations).

    `flagged` lets the in-loop flag button live on the existing row
    rather than a separate table. `completed_at IS NULL` means "served
    but not yet finished," which we use for refresh-safe re-serve so a
    page reload doesn't burn through the variation pool.
    """

    __tablename__ = "bank_consumption"
    __mapper_args__ = {"eager_defaults": True}
    __table_args__ = (
        Index("ix_bank_consumption_student_anchor", "student_id", "anchor_bank_item_id"),
        Index("ix_bank_consumption_student_assignment", "student_id", "assignment_id"),
        Index("ix_bank_consumption_bank_item", "bank_item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    anchor_bank_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("question_bank_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assignments.id", ondelete="SET NULL"),
        nullable=True,
    )
    # context: homework_loop / direct_practice / direct_learn
    # Only homework_loop is written by this PR; the others are reserved
    # for the future direct (non-HW-anchored) practice flows.
    context: Mapped[str] = mapped_column(String(32), nullable=False)
    served_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Answer correctness for practice MCQ attempts. Null for Learn
    # mode (no correctness semantics) and for rows that haven't been
    # completed yet. Set by the /complete endpoint from the client —
    # the client already knows the correct answer (distractors are
    # local). Captured for v2 stats without blocking this PR on views.
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    flagged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
