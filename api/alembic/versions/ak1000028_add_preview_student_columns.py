"""add is_preview and preview_owner_id to users

Revision ID: ak1000028
Revises: aj1000027
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "ak1000028"
down_revision = "aj1000027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_preview", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "users",
        sa.Column(
            "preview_owner_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_users_preview_owner_id",
        "users",
        ["preview_owner_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_users_preview_owner_id", table_name="users")
    op.drop_column("users", "preview_owner_id")
    op.drop_column("users", "is_preview")
