"""add assignment, submission, and grading tables

Revision ID: r1000009
Revises: q1000008
Create Date: 2026-04-03 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "r1000009"
down_revision: str | None = "q1000008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Assignments
    op.create_table(
        "assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("units.id", ondelete="SET NULL"), nullable=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("late_policy", sa.String(30), nullable=False, server_default="none"),
        sa.Column("content", postgresql.JSON(), nullable=True),
        sa.Column("answer_key", postgresql.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(op.f("ix_assignments_course_id"), "assignments", ["course_id"])

    # Assignment-Section mapping
    op.create_table(
        "assignment_sections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("assignment_id", "section_id"),
    )
    op.create_index(op.f("ix_assignment_sections_assignment_id"), "assignment_sections", ["assignment_id"])
    op.create_index(op.f("ix_assignment_sections_section_id"), "assignment_sections", ["section_id"])

    # Submissions
    op.create_table(
        "submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("section_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sections.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="submitted"),
        sa.Column("image_data", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("is_late", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index(op.f("ix_submissions_assignment_id"), "submissions", ["assignment_id"])
    op.create_index(op.f("ix_submissions_student_id"), "submissions", ["student_id"])

    # Submission grades
    op.create_table(
        "submission_grades",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("submission_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("ai_score", sa.Float(), nullable=True),
        sa.Column("ai_breakdown", postgresql.JSON(), nullable=True),
        sa.Column("teacher_score", sa.Float(), nullable=True),
        sa.Column("teacher_notes", sa.Text(), nullable=True),
        sa.Column("final_score", sa.Float(), nullable=True),
        sa.Column("graded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(op.f("ix_submission_grades_submission_id"), "submission_grades", ["submission_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_submission_grades_submission_id"), table_name="submission_grades")
    op.drop_table("submission_grades")
    op.drop_index(op.f("ix_submissions_student_id"), table_name="submissions")
    op.drop_index(op.f("ix_submissions_assignment_id"), table_name="submissions")
    op.drop_table("submissions")
    op.drop_index(op.f("ix_assignment_sections_section_id"), table_name="assignment_sections")
    op.drop_index(op.f("ix_assignment_sections_assignment_id"), table_name="assignment_sections")
    op.drop_table("assignment_sections")
    op.drop_index(op.f("ix_assignments_course_id"), table_name="assignments")
    op.drop_table("assignments")
