"""add units table and unit_id to documents

Revision ID: q1000008
Revises: p1000007
Create Date: 2026-04-03 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "q1000008"
down_revision: str | None = "p1000007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create units table
    op.create_table(
        "units",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("course_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(op.f("ix_units_course_id"), "units", ["course_id"])

    # Add unit_id to documents
    op.add_column("documents", sa.Column("unit_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_documents_unit_id",
        "documents",
        "units",
        ["unit_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_documents_unit_id"), "documents", ["unit_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_documents_unit_id"), table_name="documents")
    op.drop_constraint("fk_documents_unit_id", "documents", type_="foreignkey")
    op.drop_column("documents", "unit_id")
    op.drop_index(op.f("ix_units_course_id"), table_name="units")
    op.drop_table("units")
