"""add app_stats table for lifetime counters

Revision ID: u1000012
Revises: t1000011
Create Date: 2026-04-04 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "u1000012"
down_revision: str | None = "t1000011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_stats",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.Integer, nullable=False, server_default="0"),
    )
    # Seed the deleted accounts counter (idempotent)
    op.execute("INSERT INTO app_stats (key, value) VALUES ('deleted_accounts', 0) ON CONFLICT DO NOTHING")


def downgrade() -> None:
    op.drop_table("app_stats")
