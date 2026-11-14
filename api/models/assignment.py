"""Assignment, Submission, and Grading models."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
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
    # This homework's own grading additions (AssignmentRubric in
    # api/routes/teacher_assignments.py): common_mistakes, notes (extra
    # rules), skipped_rule_ids. The class's rules and credit guidance live
    # on Course.rubric; class_rubric.effective_rubric merges the two.
    rubric: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # What the homework is worth, and each problem's share of it — see
    # api/core/homework_points.py. `problem_points` is {problem_id: points}
    # once the teacher sets one by hand; null = `total_points` split evenly.
    total_points: Mapped[int] = mapped_column(
        Integer, nullable=False, default=100, server_default="100",
    )
    problem_points: Mapped[dict[str, int] | None] = mapped_column(JSON, nullable=True)

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
    # The student's submitted work — list of {key, media_type, filename?}
    # where `key` names the JPEG/PNG/PDF page in the photo bucket
    # (api/core/photo_store.py; rows not yet moved by
    # scripts/backfill_photo_bucket.py still hold base64 `data`).
    # Multi-file because students often work across pages. Validated
    # server-side via api.core.image_utils.validate_and_decode_upload
    # (magic bytes + per-format size cap) before upload.
    # Deferred and raiseload: a query that needs the
    # photos asks for them (`undefer(Submission.files)` or
    # `select(Submission.files)`), and one that forgot raises instead of
    # quietly reading a whole class's photos to send names and scores.
    files: Mapped[list[Any] | None] = mapped_column(
        JSON, nullable=True, deferred=True, deferred_raiseload=True,
    )
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
    # extraction, captured at confirm time — or at flag time, when the
    # student fixed some lines and then sent it to the teacher anyway
    # (never graded by the AI then; shown to the teacher). Map keyed by
    # "{problem_position}:{step_num}" for steps and
    # "{problem_position}:final" for final answers; value is the
    # student's plain-English replacement text. Empty string = student
    # cleared the row (treated as deletion of that step / answer).
    # Applied as an overlay onto `extraction` at grading + teacher-review
    # render time so the original Vision read stays preserved for audit.
    # Null when the student didn't edit anything.
    extraction_edits: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Stamped at confirm (or flag) time when any edits were saved with
    # it. Null when the student didn't edit anything.
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
    # Stamped when the student picks "The whole reading is wrong" (after
    # "Something looks wrong") on
    # the confirm screen. Mutually exclusive with
    # extraction_confirmed_at — a submission is either confirmed
    # (grading ran) or flagged (teacher grades manually, no AI calls
    # downstream). Null means "neither, still on the confirm screen".
    extraction_flagged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # The student's optional "What did it get wrong?" note, sent with the
    # flag. Shown to the teacher on the flagged-reading callout. Null when
    # they left it blank, and on every flag from before notes existed. Any
    # lines they fixed before flagging land on `extraction_edits` as usual.
    extraction_flag_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A student who flagged the reading may replace their photos once
    # per attempt, before anything is graded, for a fresh reading (POST
    # /submissions/{id}/retake). `retaken_at` is when; null = not on this
    # attempt. The turn-in it replaced is a `SubmissionAttempt`.
    retaken_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # The teacher reopened this homework for this student after they had
    # turned it in: they may turn it in once more, by their personal due
    # date (`StudentDueDate`). Cleared when they do — the turn-in it
    # replaces, with its grade, is kept as a `SubmissionAttempt`.
    reopened_at: Mapped[datetime | None] = mapped_column(
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
    # Points the late policy took off `final_score` — a percent of the
    # score, 10 per started day late, so 8.5 off an 85 (see
    # api/core/late_policy.py): the score before it is final_score +
    # late_penalty. 0 when on time, waived, or the policy takes nothing.
    # `published_late_penalty` is its publish-time snapshot, beside
    # published_final_score.
    late_penalty: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    published_late_penalty: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, server_default="0",
    )
    # The teacher waived the late penalty for this student's turn-in.
    late_penalty_waived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false",
    )
    published_breakdown: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    published_teacher_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Frozen copy of the Assignment.rubric the AI grader actually applied
    # for this submission. Compared to the live rubric to detect drift —
    # mismatch is what lets the teacher decide to regrade with the current
    # rubric. Stored as a dict; null for grades created before rubric
    # versioning or when rubric was null.
    rubric_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Each graph problem's drawing check against its checklist
    # (`graph_grading.ProblemGraphCheck.stored`), keyed by problem id. Null
    # when no drawing was checked.
    graph_checks: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Non-score grading disposition. Null on the normal path (a real grade
    # lives on breakdown/final_score). Set to "skipped_unreadable" when the
    # extraction confidence was below the unreadable threshold and AI
    # grading was deliberately skipped — there was no trustworthy work to
    # grade, so we record the reason instead of fabricating a score. Mirrors
    # the integrity pipeline's skipped_unreadable disposition. The teacher
    # review surfaces it as "couldn't read this — needs manual grading"; the
    # teacher can still grade by hand (breakdown/final_score stay null).
    ai_grading_status: Mapped[str | None] = mapped_column(Text, nullable=True)


class StudentDueDate(Base):
    """A personal due date for one student on one homework — the teacher
    reopened it for them. It replaces the class due date everywhere that
    date counts for this student: closing, `is_late` and the late penalty
    (late_policy.effective_due_at)."""
    __tablename__ = "student_due_dates"
    __table_args__ = (
        UniqueConstraint("assignment_id", "student_id", name="uq_student_due_dates_assignment_student"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    set_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
    )


SUBMISSION_ATTEMPT_RETAKE = "retake"
SUBMISSION_ATTEMPT_REOPEN = "reopen"


class SubmissionAttempt(Base):
    """An earlier turn-in of a submission, kept when a newer one replaced
    it: a retake of flagged photos (`reason` "retake"), or a turn-in after
    the teacher reopened the homework (`reason` "reopen"). Nothing a
    teacher graded or a student wrote is lost — the files, the reading
    and the student's edits and flag, when it was turned in, and, for a
    reopen, the grade it had and the understanding check it ran, as they
    were.

    `number` is the attempt's place in order (1 = the first turn-in). The
    live `Submission` row is always the latest attempt."""
    __tablename__ = "submission_attempts"
    __table_args__ = (
        UniqueConstraint("submission_id", "number", name="uq_submission_attempts_submission_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False)
    # The pages, in the same form as Submission.files. Deferred: only the
    # originals endpoint reads them.
    files: Mapped[list[Any] | None] = mapped_column(JSON, nullable=True, deferred=True)
    extraction: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True, deferred=True)
    extraction_edits: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True, deferred=True)
    extraction_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extraction_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extraction_flagged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    extraction_flag_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_late: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # The attempt's `submission_grades` row as it was (every column), and
    # its understanding check (`integrity_check_submissions` + problems +
    # turns). Null when it had none — always, for a retake.
    grade: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    integrity: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True, deferred=True)
    # When a newer attempt replaced it, and the teacher whose reopen
    # allowed that (null for a retake, which the student starts).
    replaced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reopened_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
