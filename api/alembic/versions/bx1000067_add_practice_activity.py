"""add practice_activity table

Revision ID: bx1000067
Revises: bw1000066
Create Date: 2026-06-26 00:00:00.000000

Persists what each school student practiced/learned so the student can
see their own history and the teacher gets engagement + struggle
insights. Explicitly NOT a grade store — practice stays ungraded; there
are no scores or raw answers here, only a coarse `outcome` signal.

New table, append-only. All columns are NOT NULL except `outcome`
(nullable so a future mode can record an activity with no outcome) and
`tutor_message_count` defaults to 0. No data backfill — there is no
prior source for these rows.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bx1000067"
down_revision: str | None = "bw1000066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "practice_activity",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "student_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "section_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "practice_assignment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bank_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=True),
        sa.Column(
            "tutor_message_count", sa.Integer(), server_default=sa.text("0"), nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_index(
        "ix_practice_activity_section_created",
        "practice_activity",
        ["section_id", "created_at"],
    )
    op.create_index(
        "ix_practice_activity_student_assignment",
        "practice_activity",
        ["student_id", "practice_assignment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_practice_activity_student_assignment", table_name="practice_activity")
    op.drop_index("ix_practice_activity_section_created", table_name="practice_activity")
    op.drop_table("practice_activity")
