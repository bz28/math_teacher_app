"""add teacher_reports

Revision ID: cn1000083
Revises: cm1000082
Create Date: 2026-09-18 00:30:00.000000

A teacher's "Report a problem" — one row per report, carrying pointers
to what it's about plus a human-readable snapshot (see
api/models/teacher_report.py for why both). New table, no backfill.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cn1000083"
down_revision: str | None = "cm1000082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("teacher_name", sa.String(200), nullable=True),
        sa.Column("teacher_email", sa.String(255), nullable=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("schools.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("note", sa.Text, nullable=True),
        sa.Column("page_url", sa.Text, nullable=True),
        sa.Column("submission_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("section_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("sections.id", ondelete="SET NULL"), nullable=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("problem_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("question_bank_items.id", ondelete="SET NULL"), nullable=True),
        sa.Column("problem_position", sa.Integer, nullable=True),
        sa.Column("assignment_title", sa.String(300), nullable=True),
        sa.Column("course_name", sa.String(200), nullable=True),
        sa.Column("student_name", sa.String(200), nullable=True),
        sa.Column("problem_question", sa.Text, nullable=True),
        sa.Column("ai_grade", postgresql.JSON(), nullable=True),
        sa.Column("teacher_grade", postgresql.JSON(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("resolution_note", sa.Text, nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_teacher_reports_teacher_id", "teacher_reports", ["teacher_id"])
    op.create_index("ix_teacher_reports_school_id", "teacher_reports", ["school_id"])
    op.create_index("ix_teacher_reports_submission_id", "teacher_reports", ["submission_id"])
    op.create_index("ix_teacher_reports_status", "teacher_reports", ["status"])
    op.create_index("ix_teacher_reports_created_at", "teacher_reports", ["created_at"])


def downgrade() -> None:
    op.drop_table("teacher_reports")
