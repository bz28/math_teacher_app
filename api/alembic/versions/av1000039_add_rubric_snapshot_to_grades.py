"""snapshot rubric on submission grades

Revision ID: av1000039
Revises: au1000038
Create Date: 2026-04-21 00:00:00.000000

Records the rubric the AI grader actually applied to each submission.
Compared against the live Assignment.rubric to decide when a regrade
is warranted — drift between the two is what the teacher sees on the
review page and what gates the "Regrade with current rubric" button.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "av1000039"
down_revision: str | None = "au1000038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submission_grades",
        sa.Column("rubric_snapshot", postgresql.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submission_grades", "rubric_snapshot")
