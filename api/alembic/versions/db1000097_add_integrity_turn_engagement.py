"""add integrity_conversation_turns.engagement

Revision ID: db1000097
Revises: cx1000093
Create Date: 2026-10-29 00:00:00.000000

The integrity agent's label for each student reply: answering /
honest_confusion / not_trying (api/core/integrity_pipeline.py,
`label_student_reply`). Nullable, and NULL means "not labelled", which is
true of every existing row: those replies were never classified, and
inferring a label after the fact would be a guess. Readers treat NULL as
"not not_trying", so old chats never trigger the own-words nudge or the
teacher's "didn't engage" note. Nothing to backfill.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "db1000097"
down_revision: str | None = "cx1000093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "integrity_conversation_turns",
        sa.Column("engagement", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("integrity_conversation_turns", "engagement")
