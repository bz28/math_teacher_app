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


def _get_fk_constraint_name(table: str, column: str, referred_table: str) -> str:
    """Look up the actual FK constraint name from the database."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    for fk in insp.get_foreign_keys(table):
        if fk["constrained_columns"] == [column] and fk["referred_table"] == referred_table:
            return fk["name"]
    raise ValueError(f"No FK constraint found on {table}.{column} -> {referred_table}")


def upgrade() -> None:
    # Make sessions.user_id nullable and change FK from CASCADE to SET NULL
    # so deleted users' sessions are preserved for analytics (anonymized)
    fk_name = _get_fk_constraint_name("sessions", "user_id", "users")
    op.drop_constraint(fk_name, "sessions", type_="foreignkey")
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
    fk_name = _get_fk_constraint_name("sessions", "user_id", "users")
    op.drop_constraint(fk_name, "sessions", type_="foreignkey")
    op.alter_column("sessions", "user_id", existing_type=sa.UUID(), nullable=False)
    op.create_foreign_key(
        "sessions_user_id_fkey",
        "sessions",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
