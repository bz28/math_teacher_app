"""add promo_codes and promo_redemptions tables

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-03-31 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "i9d0e1f2g3h4"
down_revision: str | None = "h8c9d0e1f2g3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "promo_codes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("code", sa.String(length=50), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("max_redemptions", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("times_redeemed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_promo_codes_code"), "promo_codes", ["code"], unique=True)

    op.create_table(
        "promo_redemptions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("promo_code_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["promo_code_id"], ["promo_codes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("promo_code_id", "user_id", name="uq_promo_redemption_code_user"),
    )
    op.create_index(op.f("ix_promo_redemptions_promo_code_id"), "promo_redemptions", ["promo_code_id"])
    op.create_index(op.f("ix_promo_redemptions_user_id"), "promo_redemptions", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_promo_redemptions_user_id"), table_name="promo_redemptions")
    op.drop_index(op.f("ix_promo_redemptions_promo_code_id"), table_name="promo_redemptions")
    op.drop_table("promo_redemptions")
    op.drop_index(op.f("ix_promo_codes_code"), table_name="promo_codes")
    op.drop_table("promo_codes")
