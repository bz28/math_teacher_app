"""add signup_school_name to users

Revision ID: bk1000054
Revises: bj1000053
Create Date: 2026-05-11 00:00:00.000000

Self-reported school name from teacher self-signup. Free-text, no
normalization — captured as a sales signal so we can see which
schools have teachers organically signing up. Distinct from
`school_id` FK, which requires a real `schools` row.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bk1000054"
down_revision: str | None = "bj1000053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("signup_school_name", sa.String(length=200), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "signup_school_name")
