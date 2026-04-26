"""add description column to assignments

Revision ID: bc1000046
Revises: bb1000045
Create Date: 2026-04-25 22:00:00.000000

Teacher-authored, student-visible instructions for the assignment
(e.g. "Show all work, no calculators, due on paper"). Lives on the
HW detail page below the title; rendered on the student homework
page above the problem list when non-empty. Plain text with optional
LaTeX inline; no markdown/headers — students read this once before
starting and we keep the surface small.

Editable while published (parallels rubric): instructions don't
change which problems students see, so refining the wording mid-
flight doesn't invalidate any work.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bc1000046"
down_revision: str | None = "bb1000045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column("description", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("assignments", "description")
