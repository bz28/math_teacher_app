"""add tours_seen column to users

Revision ID: by1000068
Revises: bx1000067
Create Date: 2026-06-26 10:00:00.000000

Persists which first-run onboarding tours a user has already seen,
keyed by persona ("teacher" | "student" | "personal").
A persona's tour auto-mounts only while its key is absent. Stored as a
JSONB array — the set is tiny and read on every /auth/me, so a join
table isn't worth it.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "by1000068"
down_revision: str | None = "bx1000067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "tours_seen",
            postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "tours_seen")
