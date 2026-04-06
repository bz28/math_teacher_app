"""add parent_unit_id to units for two-level folder nesting

Revision ID: w1000014
Revises: v1000013
Create Date: 2026-04-06 19:00:00.000000

Adds an optional self-referential parent_unit_id to the units table so
teachers can organize materials into one level of subfolders inside a
top-level unit (Unit -> Subfolder -> Documents). The application
enforces the 2-level depth limit; the schema is permissive.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "w1000014"
down_revision: str | None = "v1000013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "units",
        sa.Column(
            "parent_unit_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("units.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(op.f("ix_units_parent_unit_id"), "units", ["parent_unit_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_units_parent_unit_id"), table_name="units")
    op.drop_column("units", "parent_unit_id")
