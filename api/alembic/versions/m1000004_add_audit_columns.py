"""add audit columns (updated_at, updated_by_id, updated_by_name) to leads, schools, users

Revision ID: m1000004
Revises: l1000003
Create Date: 2026-04-02 15:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "m1000004"
down_revision: str | None = "l1000003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # contact_leads — has no updated_at yet
    op.add_column("contact_leads", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("contact_leads", sa.Column("updated_by_id", sa.Uuid(), nullable=True))
    op.add_column("contact_leads", sa.Column("updated_by_name", sa.String(200), nullable=True))
    op.create_foreign_key("fk_contact_leads_updated_by", "contact_leads", "users", ["updated_by_id"], ["id"], ondelete="SET NULL")

    # schools — already has updated_at, just add updated_by_*
    op.add_column("schools", sa.Column("updated_by_id", sa.Uuid(), nullable=True))
    op.add_column("schools", sa.Column("updated_by_name", sa.String(200), nullable=True))
    op.create_foreign_key("fk_schools_updated_by", "schools", "users", ["updated_by_id"], ["id"], ondelete="SET NULL")

    # users — already has updated_at, just add updated_by_*
    op.add_column("users", sa.Column("updated_by_id", sa.Uuid(), nullable=True))
    op.add_column("users", sa.Column("updated_by_name", sa.String(200), nullable=True))
    op.create_foreign_key("fk_users_updated_by", "users", "users", ["updated_by_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_users_updated_by", "users", type_="foreignkey")
    op.drop_column("users", "updated_by_name")
    op.drop_column("users", "updated_by_id")

    op.drop_constraint("fk_schools_updated_by", "schools", type_="foreignkey")
    op.drop_column("schools", "updated_by_name")
    op.drop_column("schools", "updated_by_id")

    op.drop_constraint("fk_contact_leads_updated_by", "contact_leads", type_="foreignkey")
    op.drop_column("contact_leads", "updated_by_name")
    op.drop_column("contact_leads", "updated_by_id")
    op.drop_column("contact_leads", "updated_at")
