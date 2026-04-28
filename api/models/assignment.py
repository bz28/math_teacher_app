"""Assignment, Submission, and Grading models."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSON, UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    # An assignment belongs to one or more units. Single-unit is the
    # common case (a HW for the Quadratics unit). Multi-unit is for
    # midterms and review HWs that span multiple units. Application
    # layer requires ≥1 unit on create.
    unit_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list,
    )
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    # Free-form instructions the teacher writes for students (e.g.
    # "Show all work, no calculators"). Plain text with optional inline
    # LaTeX. Editable while published — parallels rubric since it
    # doesn't change which problems students see.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)  # homework | quiz | test | practice
    source_type: Mapped[str | None] = mapped_column(
        String(20), nullable=True,
    )  # upload | ai_generated | library | manual
    # When a practice set was cloned from a homework, this is the source
    # HW's id. Null for scratch-built practice and for any non-practice
    # assignment. ON DELETE SET NULL keeps the practice set alive if the
    # source HW is removed — it just loses its "Cloned from" label.
    source_homework_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("assignments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    late_policy: Mapped[str] = mapped_column(String(30), nullable=False, default="none")
    content: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)  # questions list
    answer_key: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)  # solutions
    document_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)  # referenced doc UUIDs
    # Per-HW toggle for the integrity-checker pipeline. Default true;
    # the teacher will be able to flip it off in PR 5 once the UI exists.
    integrity_check_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    # Per-HW toggle for the AI grading pipeline. When enabled, student
    # submissions are auto-graded using the extraction + answer key +
    # rubric. Independent from integrity_check_enabled — teacher can
    # have AI grading without the integrity conversation and vice versa.
    ai_grading_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    # Teacher-authored grading rubric. Structured JSON so the AI grader
    # has typed signals and the review UI can render a clean sidebar.
    # Shape (all optional; UI decides which fields to collect):
    #   {
    #     grading_mode: "answer_only" | "answer_and_work"
    #                 | "method_focused" | "custom",
    #     full_credit: str,      # what earns 100%
    #     partial_credit: str,   # when students get partial
    #     common_mistakes: str,  # optional — help AI catch known errors
    #     notes: str,            # optional — free text fallback
    #   }
    # v1: reference panel for the teacher during manual grading.
    # Future AI PR: fed directly to the grader as typed fields.
    rubric: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AssignmentSection(Base):
    __tablename__ = "assignment_sections"
    __table_args__ = (UniqueConstraint("assignment_id", "section_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sections.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (
        UniqueConstraint("assignment_id", "student_id", name="uq_submissions_assignment_student"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sections.id", ondelete="CASCADE"), nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted")
    image_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # base64, S3 later
    # Per-HW-primary final answers the student typed alongside the
    # whole-HW image upload. Flat {bank_item_id: text} map. Optional
    # per problem; the image is the source of truth, the typed
    # answers are a quick-scan view for the teacher.
    final_answers: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Full Vision extraction output (all steps + final_answers + confidence)
    # persisted after the pipeline's extraction call succeeds. Drives the
    # post-submit "does this match what you wrote?" confirm screen that
    # groups steps by problem_position. Null when extraction hasn't run
    # or failed.
    extraction: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Sparse overlay of student-supplied corrections to the Vision
    # extraction, captured at confirm time. Map keyed by
    # "{problem_position}:{step_num}" for steps and
    # "{problem_position}:final" for final answers; value is the
    # student's plain-English replacement text. Empty string = student
    # cleared the row (treated as deletion of that step / answer).
    # Applied as an overlay onto `extraction` at grading + teacher-review
    # render time so the original Vision read stays preserved for audit.
    # Null when the student didn't edit anything.
    extraction_edits: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Stamped at confirm time when any edits were saved alongside the
    # confirmation. Null when the student confirmed without editing.
    extraction_edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Stamped when the student hits Confirm (or Flag) on the post-submit
    # confirm screen. Integrity sampling + the AI grading call are
    # gated on this — neither fires until the student has explicitly
    # signed off on the Vision extraction. Null means "not yet
    # confirmed"; existing pre-gate rows stay null (their grades were
    # produced under the old auto-grade pipeline).
    extraction_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Stamped when the student hits "Reader got something wrong" on
    # the confirm screen. Mutually exclusive with
    # extraction_confirmed_at — a submission is either confirmed
    # (grading ran) or flagged (teacher grades manually, no AI calls
    # downstream). Null means "neither, still on the confirm screen".
    extraction_flagged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class SubmissionGrade(Base):
    __tablename__ = "submission_grades"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, unique=True, index=True,
    )
    ai_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Raw AI grader output — reference only. Holds the model's
    # per-problem reasoning and confidence before the teacher reviews.
    # The authoritative final grades live on `breakdown` (which the AI
    # seeds and the teacher can then edit). Populated by the future AI
    # grading PR; untouched in v1.
    ai_breakdown: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    teacher_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    teacher_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Authoritative final per-problem grades. Shape: [{problem_id,
    # score_status: "full"|"partial"|"zero", percent, feedback}]. v1:
    # teacher writes directly. Future AI PR: AI seeds this from
    # `ai_breakdown`, teacher edits in place. Whoever wrote it last
    # wins — this is what drives `final_score` and what the student
    # sees once `grade_published_at` is set.
    breakdown: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Null while the teacher is still drafting grades; set when the
    # teacher clicks "Publish grades" on the HW. Drives student
    # visibility of the final_score + breakdown.
    grade_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Snapshot taken at publish time. Students see these fields, not
    # the live `final_score / breakdown / teacher_notes` above — edits
    # after publish stay as drafts until the teacher republishes.
    # `graded_at > grade_published_at` flags the dirty state.
    published_final_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    published_breakdown: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    published_teacher_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Frozen copy of the Assignment.rubric the AI grader actually applied
    # for this submission. Compared to the live rubric to detect drift —
    # mismatch is what lets the teacher decide to regrade with the current
    # rubric. Stored as a dict; null for grades created before rubric
    # versioning or when rubric was null.
    rubric_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
