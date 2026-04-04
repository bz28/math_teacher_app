"""add document_ids column to assignments

Revision ID: t1000011
Revises: s1000010
Create Date: 2026-04-04 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "t1000011"
down_revision: str | None = "s1000010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("assignments", sa.Column("document_ids", postgresql.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("assignments", "document_ids")
