"""add rubric_suggestions (rules offered to a class's rubric)

Revision ID: cr1000087
Revises: cq1000086
Create Date: 2026-10-25 00:00:00.000000

One row per "add this to your rubric?" offer, so a teacher's answer is
remembered (see api/models/rubric_suggestion.py). New table, no backfill:
no offer was made before it existed.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cr1000087"
down_revision: str | None = "cq1000086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rubric_suggestions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignment_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("assignments.id", ondelete="SET NULL"), nullable=True),
        sa.Column("submission_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("problem_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("teacher_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("points", sa.Integer, nullable=True),
        sa.Column("source_label", sa.String(300), nullable=True),
        sa.Column("teacher_comment", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_rubric_suggestions_course_id", "rubric_suggestions", ["course_id"])


def downgrade() -> None:
    op.drop_index("ix_rubric_suggestions_course_id", table_name="rubric_suggestions")
    op.drop_table("rubric_suggestions")
