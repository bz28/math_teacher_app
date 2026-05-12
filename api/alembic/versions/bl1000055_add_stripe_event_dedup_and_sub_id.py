"""add stripe_processed_events + users.stripe_subscription_id

Revision ID: bl1000055
Revises: bk1000054
Create Date: 2026-05-12 00:00:00.000000

Two webhook-related additions:

- stripe_processed_events: idempotency log keyed on Stripe event_id.
  Insert-or-skip pattern lets the webhook handler dedup redeliveries
  without changing existing side-effect code shapes.
- users.stripe_subscription_id: lets the webhook ignore events for
  superseded subscriptions, closing the out-of-order re-promotion
  bug where a late subscription.updated(active) after
  subscription.deleted would re-flip a cancelled user to pro.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bl1000055"
down_revision: str | None = "bk1000054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stripe_processed_events",
        sa.Column("event_id", sa.String(length=255), primary_key=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
    )
    op.create_index(
        op.f("ix_users_stripe_subscription_id"),
        "users",
        ["stripe_subscription_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_users_stripe_subscription_id"), table_name="users")
    op.drop_column("users", "stripe_subscription_id")
    op.drop_table("stripe_processed_events")
