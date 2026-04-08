"""add distractors column to question_bank_items

Revision ID: ag1000024
Revises: af1000023
Create Date: 2026-04-08 15:30:00.000000

Stores the 3 MCQ wrong-answer options alongside each generated bank
item. Populated by `generate_distractors()` at the same time as
`generate_solutions()` during the question bank generation pipeline.

Why store them: the school-student practice loop needs MCQ options at
serve time and we promised zero LLM calls on the student side. The
teacher pays for distractor generation once at publish time; school
students get instant string-equality MCQ checking forever after.

No backfill — local dev DB only at this point, no production data.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ag1000024"
down_revision: str | None = "af1000023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_items",
        sa.Column("distractors", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_bank_items", "distractors")
