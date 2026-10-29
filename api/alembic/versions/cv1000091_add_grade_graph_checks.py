"""add submission_grades.graph_checks

Revision ID: cv1000091
Revises: cu1000090
Create Date: 2026-10-28 00:00:00.000000

Each graph problem's drawing check on a grade (api/core/graph_grading.py):
{problem_id: {checklist_key, step, in_view, note, items: [{n, verdict,
seen}]}}. Nullable, and NULL means "no drawing was checked", which is true
of every existing grade: they were graded before drawings were checked
against a checklist, so there is nothing to backfill.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "cv1000091"
down_revision: str | None = "cu1000090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("submission_grades", sa.Column("graph_checks", postgresql.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("submission_grades", "graph_checks")
