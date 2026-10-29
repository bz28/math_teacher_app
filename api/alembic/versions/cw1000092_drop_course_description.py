"""drop courses.description

Revision ID: cw1000092
Revises: cv1000091
Create Date: 2026-10-29 00:00:00.000000

A course's description was set in Course settings and shown nowhere else:
no teacher or student page reads it and no prompt uses it. In production
1 of 15 courses had one, a test value ("test"), so dropping the column
loses nothing a teacher sees. The downgrade restores the column empty.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "cw1000092"
down_revision: str | None = "cv1000091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("courses", "description")


def downgrade() -> None:
    op.add_column("courses", sa.Column("description", sa.Text(), nullable=True))
