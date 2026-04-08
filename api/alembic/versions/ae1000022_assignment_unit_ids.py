"""replace assignments.unit_id with unit_ids array

Revision ID: ae1000022
Revises: ad1000021
Create Date: 2026-04-08 12:00:00.000000

Drops the single nullable unit_id column on assignments and replaces
it with a UUID[] array column. A homework can now belong to multiple
units (the common case is one — midterms and review HWs are the
multi-unit cases). All HWs must have at least one unit at create
time; the application layer enforces this.

Destructive: drops existing unit_id data. Safe because there were no
real users when this landed (dummy data wiped before running).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "ae1000022"
down_revision: str | None = "ad1000021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("assignments", "unit_id")
    op.add_column(
        "assignments",
        sa.Column(
            "unit_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
        ),
    )
    # Drop the server default after creation — we want application-
    # layer validation to require ≥1 unit, not silently default to [].
    op.alter_column("assignments", "unit_ids", server_default=None)


def downgrade() -> None:
    op.drop_column("assignments", "unit_ids")
    op.add_column(
        "assignments",
        sa.Column(
            "unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("units.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
