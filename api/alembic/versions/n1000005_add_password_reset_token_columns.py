"""add password reset token columns to users

Revision ID: n1000005
Revises: m1000004
Create Date: 2026-04-02 16:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "n1000005"
down_revision: str | None = "m1000004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_reset_token_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("password_reset_expires", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_users_password_reset_token_hash", "users", ["password_reset_token_hash"])


def downgrade() -> None:
    op.drop_constraint("uq_users_password_reset_token_hash", "users", type_="unique")
    op.drop_column("users", "password_reset_expires")
    op.drop_column("users", "password_reset_token_hash")
