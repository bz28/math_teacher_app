"""add locked + source + parent_question_id to question_bank_items

Revision ID: aa1000018
Revises: z1000017
Create Date: 2026-04-07 12:00:00.000000

Foundation for the bank-as-source-of-truth refactor:
- `locked` — set true when an assignment referencing this item is published.
  While locked, content edits / reject / archive / delete are refused.
- `source` — generated / imported / manual. Reserved for future entry points.
- `parent_question_id` — variation tree, set by future "generate similar".
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aa1000018"
down_revision: str | None = "z1000017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "question_bank_items",
        sa.Column("locked", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "question_bank_items",
        sa.Column("source", sa.String(length=20), nullable=False, server_default="generated"),
    )
    op.add_column(
        "question_bank_items",
        sa.Column(
            "parent_question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("question_bank_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("question_bank_items", "parent_question_id")
    op.drop_column("question_bank_items", "source")
    op.drop_column("question_bank_items", "locked")
