"""add notes column to contact_leads

Revision ID: aa1000018
Revises: z1000017
Create Date: 2026-05-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "aa1000018"
down_revision: str | None = "z1000017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("contact_leads", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("contact_leads", "notes")
