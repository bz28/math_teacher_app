"""drop quality_scores table

Revision ID: be1000048
Revises: bd1000047
Create Date: 2026-04-26 00:00:00.000000

The LLM-as-judge admin surface that was going to write to this table
never shipped — its writer (api/core/judge.py) and the QualityScore
model + admin route were deleted as orphan scaffolding. Drop the
empty table to match.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "be1000048"
down_revision: str | None = "bd1000047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_quality_scores_session_id", table_name="quality_scores")
    op.drop_table("quality_scores")


def downgrade() -> None:
    raise NotImplementedError("Forward-only — quality_scores table will not be re-created.")
