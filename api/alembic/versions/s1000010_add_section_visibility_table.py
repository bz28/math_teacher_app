"""add section_visibility table

Revision ID: s1000010
Revises: r1000009
Create Date: 2026-04-04 14:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "s1000010"
down_revision: str | None = "r1000009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "section_visibility",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "section_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(10), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("is_hidden", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("section_id", "target_type", "target_id"),
    )
    op.create_index(
        op.f("ix_section_visibility_section_id"),
        "section_visibility",
        ["section_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_section_visibility_section_id"),
        table_name="section_visibility",
    )
    op.drop_table("section_visibility")
