"""Teacher "Report a problem" — a teacher telling us the product let them
down, with the evidence attached.

Reports point at what the teacher was looking at (submission, problem,
student) AND carry a snapshot of the human-readable facts (names,
titles, the AI's grade and reasoning at that moment, the teacher's
grade). The snapshot is deliberate: a grade can be regraded and a
student can be removed after the report, and the report must still
read the same in the admin console a week later. Every pointer is
nullable and detaches on delete for the same reason — losing the row
the report was about must never lose the report.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base

REPORT_STATUS_OPEN = "open"
REPORT_STATUS_RESOLVED = "resolved"
REPORT_STATUSES = (REPORT_STATUS_OPEN, REPORT_STATUS_RESOLVED)

# What the teacher says went wrong. The first three are the ways the AI
# can fail a teacher on the review page; the last three are the sidebar
# fallback's product-level kinds. Labels live in the web dialog.
REPORT_KINDS = (
    "wrong_grade",
    "misread_work",
    "understanding_check",
    "broken",
    "confusing",
    "other",
)


class TeacherReport(Base):
    __tablename__ = "teacher_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Who reported, snapshotted so a departed teacher's report still reads.
    teacher_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    teacher_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    teacher_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    school_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schools.id", ondelete="SET NULL"), nullable=True, index=True,
    )

    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # What it's about — pointers for drill-in, all optional.
    submission_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    assignment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True,
    )
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="SET NULL"), nullable=True,
    )
    section_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sections.id", ondelete="SET NULL"), nullable=True,
    )
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    problem_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("question_bank_items.id", ondelete="SET NULL"), nullable=True,
    )
    problem_position: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Human-readable snapshot, filled server-side at create time.
    assignment_title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    course_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    student_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    problem_question: Mapped[str | None] = mapped_column(Text, nullable=True)
    # {"score_status", "percent", "confidence", "reasoning"} — the AI's call
    # when the teacher reported it.
    ai_grade: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # {"score_status", "percent"} — the teacher's grade at that moment.
    teacher_grade: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=REPORT_STATUS_OPEN, index=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True,
    )
