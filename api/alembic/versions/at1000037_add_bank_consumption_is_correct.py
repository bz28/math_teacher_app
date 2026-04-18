"""add is_correct column to bank_consumption

Revision ID: at1000037
Revises: as1000036
Create Date: 2026-04-18 04:40:00.000000

Captures whether a practice MCQ attempt was right. Null for Learn
mode and for in-flight rows. Nullable so the column can land without
a backfill and pick up new data as students complete variations.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "at1000037"
down_revision: str | None = "as1000036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "bank_consumption",
        sa.Column("is_correct", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bank_consumption", "is_correct")
