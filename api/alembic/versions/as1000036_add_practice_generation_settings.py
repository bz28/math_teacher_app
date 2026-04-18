"""add practice-generation settings to users and assignments

Revision ID: as1000036
Revises: ar1000035
Create Date: 2026-04-18 04:27:00.000000

Two teacher-level defaults on `users` (auto-on, count=3) and matching
nullable overrides on `assignments`. Null on the assignment means
"inherit the teacher's default"; a value overrides for that HW.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "as1000036"
down_revision: str | None = "ar1000035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "auto_generate_practice_on_publish",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "default_practice_count",
            sa.Integer(),
            nullable=False,
            server_default="3",
        ),
    )
    op.add_column(
        "assignments",
        sa.Column(
            "auto_generate_practice_on_publish",
            sa.Boolean(),
            nullable=True,
        ),
    )
    op.add_column(
        "assignments",
        sa.Column(
            "default_practice_count",
            sa.Integer(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("assignments", "default_practice_count")
    op.drop_column("assignments", "auto_generate_practice_on_publish")
    op.drop_column("users", "default_practice_count")
    op.drop_column("users", "auto_generate_practice_on_publish")
