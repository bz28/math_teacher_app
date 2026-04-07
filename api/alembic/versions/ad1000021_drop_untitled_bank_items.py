"""drop pre-title bank items + make title NOT NULL

Revision ID: ad1000021
Revises: ac1000020
Create Date: 2026-04-07 19:30:00.000000

We added the title column nullable in ac1000020 to avoid breaking
existing rows. No real users yet, so we wipe the bank instead of
backfilling and tighten the column to NOT NULL — the frontend code
no longer has to thread null cases through every row render.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ad1000021"
down_revision: str | None = "ac1000020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Wipe untitled rows. parent_question_id is ON DELETE SET NULL so
    # any variation pointing at a wiped parent becomes a root — but
    # we're nuking the whole bank anyway.
    op.execute("DELETE FROM question_bank_items")
    op.alter_column("question_bank_items", "title", nullable=False)


def downgrade() -> None:
    op.alter_column("question_bank_items", "title", nullable=True)
