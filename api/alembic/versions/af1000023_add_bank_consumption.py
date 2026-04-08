"""add bank_consumption table

Revision ID: af1000023
Revises: ae1000022
Create Date: 2026-04-08 15:00:00.000000

Tracks which approved variations a school student has been served from
the homework practice/learn loop. One row per (student, served variation).
The anchor is the HW primary the kid launched the loop from — this lets
us answer "what siblings has this student already seen for this anchor?"
in a single index hit, and structurally prevents recursion (variations
of variations) since loops always key off the anchor, never the current
variation id.

`flagged` lives on the consumption row instead of a separate bank_flag
table — there is already exactly one consumption row per (student,
look-alike), so a second table buys nothing.

`completed_at` is nullable: NULL means "served but not yet finished",
which we use for refresh-safe re-serve so a page reload doesn't burn
through the variation pool.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "af1000023"
down_revision: str | None = "ae1000022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bank_consumption",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "student_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "bank_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "anchor_bank_item_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assignment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assignments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("context", sa.String(length=32), nullable=False),
        sa.Column("served_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("flagged", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_bank_consumption_student_anchor",
        "bank_consumption",
        ["student_id", "anchor_bank_item_id"],
    )
    op.create_index(
        "ix_bank_consumption_student_assignment",
        "bank_consumption",
        ["student_id", "assignment_id"],
    )
    op.create_index(
        "ix_bank_consumption_bank_item",
        "bank_consumption",
        ["bank_item_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_bank_consumption_bank_item", table_name="bank_consumption")
    op.drop_index("ix_bank_consumption_student_assignment", table_name="bank_consumption")
    op.drop_index("ix_bank_consumption_student_anchor", table_name="bank_consumption")
    op.drop_table("bank_consumption")
