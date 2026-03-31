"""add subscription and stripe fields to users

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-03-30 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "g7b8c9d0e1f2"
down_revision: str | None = "f6a7b8c9d0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("subscription_tier", sa.String(length=20), nullable=False, server_default="free"))
    op.add_column("users", sa.Column("subscription_status", sa.String(length=20), nullable=False, server_default="none"))
    op.add_column("users", sa.Column("subscription_provider", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("subscription_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("rc_customer_id", sa.String(length=255), nullable=True))
    op.create_index(op.f("ix_users_rc_customer_id"), "users", ["rc_customer_id"], unique=True)
    op.add_column("users", sa.Column("stripe_customer_id", sa.String(length=255), nullable=True))
    op.create_index(op.f("ix_users_stripe_customer_id"), "users", ["stripe_customer_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_stripe_customer_id"), table_name="users")
    op.drop_column("users", "stripe_customer_id")
    op.drop_index(op.f("ix_users_rc_customer_id"), table_name="users")
    op.drop_column("users", "rc_customer_id")
    op.drop_column("users", "subscription_expires_at")
    op.drop_column("users", "subscription_provider")
    op.drop_column("users", "subscription_status")
    op.drop_column("users", "subscription_tier")
