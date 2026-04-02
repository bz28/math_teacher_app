"""add school_id to contact_leads

Revision ID: o1000006
Revises: n1000005
Create Date: 2026-04-02 17:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "o1000006"
down_revision: str | None = "n1000005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("contact_leads", sa.Column("school_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_contact_leads_school", "contact_leads", "schools",
        ["school_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_contact_leads_school", "contact_leads", type_="foreignkey")
    op.drop_column("contact_leads", "school_id")
