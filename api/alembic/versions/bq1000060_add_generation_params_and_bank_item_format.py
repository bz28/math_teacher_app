"""add generation_params on jobs + format on bank items

Revision ID: bq1000060
Revises: bp1000059
Create Date: 2026-05-19 00:00:00.000000

Two additive columns supporting the new Customize section on the
generate-problems modal:

- `question_bank_generation_jobs.params` (JSONB, nullable) — the
  teacher's customizations: problem_type / answer_form / difficulty /
  calculator / format. NULL = default 1-click flow.
- `question_bank_items.format` (varchar(10), NOT NULL, default 'frq')
  — frq (free-response, current behaviour) or mcq (multiple choice
  rendered from final_answer + distractors).

No backfill needed — existing items inherit format='frq' via the
column default, which matches the pre-refactor rendering.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "bq1000060"
down_revision: str | None = "bp1000059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_generation_jobs",
        sa.Column("params", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "question_bank_items",
        sa.Column(
            "format", sa.String(length=10),
            nullable=False, server_default="frq",
        ),
    )


def downgrade() -> None:
    op.drop_column("question_bank_items", "format")
    op.drop_column("question_bank_generation_jobs", "params")
