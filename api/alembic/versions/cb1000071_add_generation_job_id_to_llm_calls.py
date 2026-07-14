"""add generation_job_id to llm_calls

Explicit FK from an LLM call to the generation job it was made in service
of, so admin cost attribution is exact per generation instead of a
time-window heuristic. Nullable + indexed; SET NULL on job delete so the
cost row survives for aggregate spend.

Revision ID: cb1000071
Revises: ca1000070
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "cb1000071"
down_revision: str | None = "ca1000070"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "llm_calls",
        sa.Column(
            "generation_job_id",
            UUID(as_uuid=True),
            sa.ForeignKey("question_bank_generation_jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_llm_calls_generation_job_id",
        "llm_calls",
        ["generation_job_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_llm_calls_generation_job_id", table_name="llm_calls")
    op.drop_column("llm_calls", "generation_job_id")
