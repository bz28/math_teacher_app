"""add admin_notification_prefs table

Revision ID: a1b2c3d4e5f8
Revises: f4c1e465e20a
Create Date: 2026-03-30 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f8"
down_revision: str | None = "f4c1e465e20a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_notification_prefs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("enabled", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_admin_notif_prefs_user_id", "admin_notification_prefs", ["user_id"])
    op.create_unique_constraint("uq_admin_notif_user_event", "admin_notification_prefs", ["user_id", "event_type"])


def downgrade() -> None:
    op.drop_table("admin_notification_prefs")
