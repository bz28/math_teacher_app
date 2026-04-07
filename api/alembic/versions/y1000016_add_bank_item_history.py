"""add one-level history columns to question_bank_items for undo

Revision ID: y1000016
Revises: x1000015
Create Date: 2026-04-06 21:00:00.000000

Stores the previous question/solution/answer on every revision so the
teacher gets a one-level undo. Not a full audit log — just the most
recent prior state.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "y1000016"
down_revision: str | None = "x1000015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("question_bank_items", sa.Column("previous_question", sa.Text, nullable=True))
    op.add_column(
        "question_bank_items",
        sa.Column("previous_solution_steps", postgresql.JSON(), nullable=True),
    )
    op.add_column(
        "question_bank_items", sa.Column("previous_final_answer", sa.Text, nullable=True),
    )
    op.add_column(
        "question_bank_items", sa.Column("previous_status", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_bank_items", "previous_status")
    op.drop_column("question_bank_items", "previous_final_answer")
    op.drop_column("question_bank_items", "previous_solution_steps")
    op.drop_column("question_bank_items", "previous_question")
