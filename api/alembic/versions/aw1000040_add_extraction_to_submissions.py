"""persist Vision extraction on submissions

Revision ID: aw1000040
Revises: av1000039
Create Date: 2026-04-23 17:00:00.000000

Adds `submissions.extraction` so the full Vision output (all steps
across all problems, not just the integrity-sampled slice) is
durable and readable from the student UI. Drives the post-submit
"does this match what you wrote?" confirm screen that groups steps
by problem_position.

Nullable: not every submission will have an extraction — the field
stays null when extraction fails, when the HW has both integrity and
AI grading disabled (pipeline skips extraction entirely), or when
confidence is below the unreadable threshold.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aw1000040"
down_revision: str | None = "av1000039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submissions",
        sa.Column("extraction", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submissions", "extraction")
