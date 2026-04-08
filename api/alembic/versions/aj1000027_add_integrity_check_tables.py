"""add integrity_check tables and assignments.integrity_check_enabled

Revision ID: aj1000027
Revises: ai1000026
Create Date: 2026-04-08 19:00:00.000000

Foundation for the integrity-checker feature (plan: plans/integrity-
checker-pr1.md). After a student submits a homework, an AI pipeline
asks 2-3 short questions about each of (up to 5) primary problems
to verify the student understood their own work. The verdict is a
per-problem confidence badge for the teacher (advisory only, never
blocks grading, student never sees it).

This PR ships only the data + endpoints + a stubbed AI pipeline so
the full state machine can be exercised at $0 cost. Real Vision +
Sonnet calls land in PR 4 by swapping the stub functions — no
caller changes.

Schema:
- assignments.integrity_check_enabled — per-HW toggle, default true
- integrity_check_problems — one row per (submission × picked problem)
- integrity_check_responses — one row per (problem × question slot)
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aj1000027"
down_revision: str | None = "ai1000026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column(
            "integrity_check_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )

    op.create_table(
        "integrity_check_problems",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "submission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("submissions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bank_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sample_position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("student_work_extraction", postgresql.JSON(), nullable=True),
        sa.Column("badge", sa.String(length=20), nullable=True),
        sa.Column("raw_score", sa.Float(), nullable=True),
        sa.Column("ai_reasoning", sa.Text(), nullable=True),
        sa.Column("teacher_dismissed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("teacher_dismissal_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("submission_id", "bank_item_id", name="uq_icp_submission_bank_item"),
    )
    op.create_index(
        "ix_integrity_check_problems_submission",
        "integrity_check_problems",
        ["submission_id"],
    )

    op.create_table(
        "integrity_check_responses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "integrity_check_problem_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("integrity_check_problems.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("question_index", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("expected_shape", sa.Text(), nullable=True),
        sa.Column("rubric_hint", sa.Text(), nullable=True),
        sa.Column("student_answer", sa.Text(), nullable=True),
        sa.Column("answer_verdict", sa.String(length=20), nullable=True),
        sa.Column("seconds_on_question", sa.Integer(), nullable=True),
        sa.Column("tab_switch_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rephrase_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scored_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "integrity_check_problem_id", "question_index",
            name="uq_icr_problem_question",
        ),
    )


def downgrade() -> None:
    op.drop_table("integrity_check_responses")
    op.drop_index(
        "ix_integrity_check_problems_submission",
        table_name="integrity_check_problems",
    )
    op.drop_table("integrity_check_problems")
    op.drop_column("assignments", "integrity_check_enabled")
