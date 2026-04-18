"""snapshot grade at publish time

Revision ID: as1000036
Revises: ar1000035
Create Date: 2026-04-16 22:45:00.000000

Stages grade edits made after publish. `published_*` columns hold
what students see; live `final_score / breakdown / teacher_notes`
are the teacher's draft. Republish copies live → published.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "as1000036"
down_revision: str | None = "ar1000035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "submission_grades",
        sa.Column("published_final_score", sa.Float(), nullable=True),
    )
    op.add_column(
        "submission_grades",
        sa.Column("published_breakdown", postgresql.JSON(), nullable=True),
    )
    op.add_column(
        "submission_grades",
        sa.Column("published_teacher_notes", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("submission_grades", "published_teacher_notes")
    op.drop_column("submission_grades", "published_breakdown")
    op.drop_column("submission_grades", "published_final_score")
