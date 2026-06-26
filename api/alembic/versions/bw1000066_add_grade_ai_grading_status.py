"""add ai_grading_status to submission_grades

Revision ID: bw1000066
Revises: bv1000065
Create Date: 2026-06-22 00:00:00.000000

Records a non-score grading disposition on the submission grade row. The
only value today is "skipped_unreadable": when a submission's extraction
confidence is below the unreadable threshold, AI grading is deliberately
skipped (no trustworthy work to grade) and we stamp this reason instead of
fabricating a score. Mirrors the integrity pipeline's skipped_unreadable
disposition. Null on the normal path. The teacher review surfaces it as
"couldn't read this — needs manual grading"; breakdown/final_score stay null
so the teacher can still grade by hand.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bw1000066"
down_revision: str | None = "bv1000065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submission_grades",
        sa.Column("ai_grading_status", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submission_grades", "ai_grading_status")
