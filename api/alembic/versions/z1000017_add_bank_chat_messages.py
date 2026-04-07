"""add chat_messages column to question_bank_items

Revision ID: z1000017
Revises: y1000016
Create Date: 2026-04-07 10:00:00.000000

Persists the workshop chat thread per bank item. Each entry is one
chat message: { role: "ai" | "teacher", text, proposal?, accepted?,
discarded?, ts }. Stored as JSON for simplicity — a separate table
isn't worth it until we need cross-item querying.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "z1000017"
down_revision: str | None = "y1000016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_items",
        sa.Column(
            "chat_messages",
            postgresql.JSON(),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("question_bank_items", "chat_messages")
