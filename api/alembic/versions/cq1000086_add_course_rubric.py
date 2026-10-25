"""add courses.rubric (a class's grading rules)

Revision ID: cq1000086
Revises: cp1000085
Create Date: 2026-10-25 00:00:00.000000

A teacher's standing grading rules for every homework in a class (see
api/core/class_rubric.py). Nullable JSON: NULL means the class has no
rules, which is true of every existing course — no teacher has written a
class rule before this column existed — so there is nothing to backfill.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cq1000086"
down_revision: str | None = "cp1000085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("courses", sa.Column("rubric", postgresql.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("courses", "rubric")
