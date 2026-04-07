"""add parent_question_id to question_bank_generation_jobs

Revision ID: ab1000019
Revises: aa1000018
Create Date: 2026-04-07 17:00:00.000000

Lets the worker know it's running a "generate similar" job (the
children inherit parent_question_id from this column on the job row).
Nullable — only set for similar-generation jobs, not the regular
bulk-generate flow.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ab1000019"
down_revision: str | None = "aa1000018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_generation_jobs",
        sa.Column(
            "parent_question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("question_bank_generation_jobs", "parent_question_id")
