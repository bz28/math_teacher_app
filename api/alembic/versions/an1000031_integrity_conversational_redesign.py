"""integrity conversational redesign: drop old tables, add new three-table shape

Revision ID: an1000031
Revises: am1000030
Create Date: 2026-04-14 23:30:00.000000

Pre-scale cutover for the conversational redesign (plan:
plans/integrity-conversational-redesign.md). No real-user data is at
stake, so we drop the two old tables entirely and recreate the new
three-table shape: integrity_check_submissions (parent),
integrity_check_problems (per-problem verdict + extraction snapshot),
integrity_conversation_turns (chat log including tool calls).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "an1000031"
down_revision: str | None = "am1000030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop the old two-table shape (integrity_check_responses FK-depends
    # on integrity_check_problems, so drop responses first).
    op.drop_table("integrity_check_responses")
    op.drop_index(
        "ix_integrity_check_problems_submission",
        table_name="integrity_check_problems",
    )
    op.drop_table("integrity_check_problems")

    # New parent row per submission.
    op.create_table(
        "integrity_check_submissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "submission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("submissions.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("overall_badge", sa.String(length=20), nullable=True),
        sa.Column("overall_confidence", sa.Float(), nullable=True),
        sa.Column("overall_summary", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    # No explicit index on submission_id: `unique=True` above already
    # creates a unique btree index that covers equality lookups.

    # Per-problem verdict + extraction snapshot.
    op.create_table(
        "integrity_check_problems",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "integrity_check_submission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "integrity_check_submissions.id", ondelete="CASCADE",
            ),
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
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("ai_reasoning", sa.Text(), nullable=True),
        sa.Column(
            "teacher_dismissed", sa.Boolean(), nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("teacher_dismissal_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.UniqueConstraint(
            "integrity_check_submission_id", "bank_item_id",
            name="uq_icp_check_submission_bank_item",
        ),
    )
    op.create_index(
        "ix_integrity_check_problems_check_submission",
        "integrity_check_problems",
        ["integrity_check_submission_id"],
    )

    # Conversation transcript, ordinal-ordered within a check.
    op.create_table(
        "integrity_conversation_turns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "integrity_check_submission_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "integrity_check_submissions.id", ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tool_name", sa.String(length=64), nullable=True),
        sa.Column("tool_use_id", sa.String(length=64), nullable=True),
        sa.Column("seconds_on_turn", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.UniqueConstraint(
            "integrity_check_submission_id", "ordinal",
            name="uq_ict_submission_ordinal",
        ),
    )
    op.create_index(
        "ix_integrity_conversation_turns_check_submission",
        "integrity_conversation_turns",
        ["integrity_check_submission_id"],
    )


def downgrade() -> None:
    # Mirror of upgrade — recreate the old two-table shape.
    op.drop_index(
        "ix_integrity_conversation_turns_check_submission",
        table_name="integrity_conversation_turns",
    )
    op.drop_table("integrity_conversation_turns")
    op.drop_index(
        "ix_integrity_check_problems_check_submission",
        table_name="integrity_check_problems",
    )
    op.drop_table("integrity_check_problems")
    op.drop_table("integrity_check_submissions")

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
        sa.Column(
            "teacher_dismissed", sa.Boolean(), nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("teacher_dismissal_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.UniqueConstraint(
            "submission_id", "bank_item_id",
            name="uq_icp_submission_bank_item",
        ),
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
            sa.ForeignKey(
                "integrity_check_problems.id", ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column("question_index", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("expected_shape", sa.Text(), nullable=True),
        sa.Column("rubric_hint", sa.Text(), nullable=True),
        sa.Column("student_answer", sa.Text(), nullable=True),
        sa.Column("answer_verdict", sa.String(length=20), nullable=True),
        sa.Column("seconds_on_question", sa.Integer(), nullable=True),
        sa.Column(
            "tab_switch_count", sa.Integer(), nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "rephrase_used", sa.Boolean(), nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scored_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "integrity_check_problem_id", "question_index",
            name="uq_icr_problem_question",
        ),
    )
