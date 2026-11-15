"""figure_facts (and its undo copy) on question_bank_items

Revision ID: dg1000103
Revises: df1000102
Create Date: 2026-11-12 00:00:00.000000

A construction figure (api/core/geometry/) is checked against the facts
its problem states, read by two AI readings that code requires to agree
(api/core/geometry/facts.py). The agreed reading is stored with the figure
so later checks (after solving, step figures, accepting a workshop
proposal) measure against the same facts without reading again.

Backfill: none needed. Only construction figures carry facts, and no
stored item has one (the construction format arrives in the same PR);
the triangle / circle / polygon figures already stored are not checked
against facts, so NULL is their correct value.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "dg1000103"
down_revision: str | None = "df1000102"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("question_bank_items", sa.Column("figure_facts", postgresql.JSONB(), nullable=True))
    # The one-level undo restores the facts with the figure.
    op.add_column("question_bank_items", sa.Column("previous_figure_facts", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("question_bank_items", "previous_figure_facts")
    op.drop_column("question_bank_items", "figure_facts")
