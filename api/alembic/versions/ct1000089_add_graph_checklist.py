"""add question_bank_items.graph_checklist

Revision ID: ct1000089
Revises: cs1000088
Create Date: 2026-10-28 00:00:00.000000

A graph question's checklist (api/core/graph_checklist.py): the features
a correct graph must show, each worth whole points. Nullable, and NULL
means "not written yet", so no backfill: checklists for existing approved
graph questions are written by scripts/backfill_graph_checklists.py,
which calls the model and so is run by hand, not by a migration.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "ct1000089"
down_revision: str | None = "cs1000088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("question_bank_items", sa.Column("graph_checklist", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("question_bank_items", "graph_checklist")
