"""make sessions user_id nullable for account deletion

Revision ID: p1000007
Revises: o1000006
Create Date: 2026-04-03 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p1000007"
down_revision: str | None = "o1000006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Make sessions.user_id nullable and change FK from CASCADE to SET NULL
    # so deleted users' sessions are preserved for analytics (anonymized)
    op.drop_constraint("sessions_user_id_fkey", "sessions", type_="foreignkey")
    op.alter_column("sessions", "user_id", existing_type=sa.UUID(), nullable=True)
    op.create_foreign_key(
        "sessions_user_id_fkey",
        "sessions",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("sessions_user_id_fkey", "sessions", type_="foreignkey")
    op.alter_column("sessions", "user_id", existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(
        "sessions_user_id_fkey",
        "sessions",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
