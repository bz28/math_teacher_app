"""credit guidance on the class

Revision ID: ct1000089
Revises: cs1000088
Create Date: 2026-10-29 00:00:00.000000

Full and partial credit guidance moves from each homework's rubric to the
class's (`Course.rubric`, api/core/class_rubric.py). No homework in
production ever set either field (0 of 15 rubrics), so there is nothing
to carry over: the keys are dropped from any homework rubric that has
them, and a rubric left empty becomes null, as an empty rubric always is.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision: str = "ct1000089"
down_revision: str | None = "cs1000088"
branch_labels = None
depends_on = None

_MOVED = ("full_credit", "partial_credit")


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, rubric FROM assignments WHERE rubric IS NOT NULL"))
    for row in rows:
        # A JSON null passes IS NOT NULL but arrives as None; it has nothing to move.
        if row.rubric is None:
            continue
        rubric = row.rubric if isinstance(row.rubric, dict) else json.loads(row.rubric)
        if not isinstance(rubric, dict) or not any(k in rubric for k in _MOVED):
            continue
        kept = {k: v for k, v in rubric.items() if k not in _MOVED}
        conn.execute(
            sa.text("UPDATE assignments SET rubric = CAST(:r AS json) WHERE id = :id"),
            {"r": json.dumps(kept) if kept else None, "id": row.id},
        )


def downgrade() -> None:
    # Nothing to restore: production had no values to move.
    pass
