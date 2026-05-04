"""add headline column to integrity_check_submissions

Revision ID: bj1000053
Revises: bi1000052
Create Date: 2026-05-04 00:00:00.000000

The integrity-check banner today shows a hardcoded per-disposition
label that may not match what actually happened in this chat (e.g.
needs_practice -> "Procedural knowledge — consider revisiting the
concept" asserts procedural strength even when the student was thin on
both procedure and concept). Adding a `headline` column the agent
populates in `finish_check` lets the verdict title be chat-grounded
in the same concise style. Nullable: server-side force-finalize and
unreadable submissions leave it null and the frontend falls back to
the existing hardcoded label.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bj1000053"
down_revision: str | None = "bi1000052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "integrity_check_submissions",
        sa.Column("headline", sa.String(length=80), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("integrity_check_submissions", "headline")
