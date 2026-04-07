"""add title to question_bank_items

Revision ID: ac1000020
Revises: ab1000019
Create Date: 2026-04-07 19:00:00.000000

Short concept label (3-7 words, plain English) shown as the primary
scan unit in the bank list, replacing the wall-of-LaTeX row content.
Nullable so existing rows aren't broken — frontend falls back to a
truncated question text snippet when title is null.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "ac1000020"
down_revision: str | None = "ab1000019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_items",
        sa.Column("title", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("question_bank_items", "title")
