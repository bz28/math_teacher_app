"""add topic column to sessions

Revision ID: as1000036
Revises: ar1000035
Create Date: 2026-04-17 10:00:00.000000

Stores the LLM-classified topic label (e.g. "algebra", "calculus")
for each session. Nullable — old sessions and mock tests have no topic.
Used for history filtering.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "as1000036"
down_revision: str | None = "ar1000035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("topic", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "topic")
