"""add student_problem_mastery + student_problem_chat tables

Revision ID: br1000061
Revises: bq1000060
Create Date: 2026-05-20 00:00:00.000000

Backs the school-student Mastery Loop:
- `student_problem_mastery`: one row per (student, bank_item) holding
  the persistent mastery state ("not_started" / "walked_through" /
  "missed" / "attempted" / "mastered") plus the atomic timestamps the
  state machine derives from.
- `student_problem_chat`: persisted per-(student, bank_item) tutor
  thread. Distinct from the existing FE-stateful chat endpoints —
  Mastery-Loop chats persist so the student returning days later sees
  their prior questions.

Both tables are additive — no backfill, no existing row touched.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "br1000061"
down_revision: str | None = "bq1000060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "student_problem_mastery",
        sa.Column(
            "student_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "bank_item_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "state", sa.String(20), nullable=False,
            server_default="not_started",
        ),
        # CHECK at the DB level so any direct SQL or buggy code path
        # can't land an unknown state. Pydantic's Literal validation
        # on the read side would otherwise 500 on a bad value.
        sa.CheckConstraint(
            "state IN ('not_started','walked_through','missed','attempted','mastered')",
            name="ck_student_problem_mastery_state_valid",
        ),
        sa.Column(
            "attempts", sa.Integer, nullable=False, server_default="0",
        ),
        sa.Column("walkthrough_opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_attempt_was_correct", sa.Boolean, nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_correct_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index(
        "ix_student_problem_mastery_student_state",
        "student_problem_mastery",
        ["student_id", "state"],
    )
    op.create_index(
        "ix_student_problem_mastery_student_last_attempt",
        "student_problem_mastery",
        ["student_id", "last_attempt_at"],
    )

    op.create_table(
        "student_problem_chat",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "student_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bank_item_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.CheckConstraint(
            "role IN ('user','assistant')",
            name="ck_student_problem_chat_role_valid",
        ),
        sa.Column("content", sa.String(8192), nullable=False),
        sa.Column("step_index", sa.Integer, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index(
        "ix_student_problem_chat_thread",
        "student_problem_chat",
        ["student_id", "bank_item_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_student_problem_chat_thread", table_name="student_problem_chat")
    op.drop_table("student_problem_chat")
    op.drop_index(
        "ix_student_problem_mastery_student_last_attempt",
        table_name="student_problem_mastery",
    )
    op.drop_index(
        "ix_student_problem_mastery_student_state",
        table_name="student_problem_mastery",
    )
    op.drop_table("student_problem_mastery")
