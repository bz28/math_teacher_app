"""backfill visual_work entries the old verify pass mislabeled as checked

Revision ID: cp1000085
Revises: cn1000083
Create Date: 2026-09-24 00:00:00.000000

When the zoomed second look found no drawing, the old verify pass set
`verified: true` and OVERWROTE the entry's `description` with an internal
status sentence, which the teacher review page then showed beside a
"checked ✓". The code now writes `verified: false, unconfirmed: true` and
leaves the description alone. This repairs rows written the old way.

Keyed on the exact sentence, never on an id, and per entry:

  kind == "table"  -> the entry is removed. "table" is no longer a
                      drawing kind; a two-column proof's grid is text the
                      extraction's steps already carry.
  any other kind   -> verified=false, unconfirmed=true, description "".
                      The first-pass description was overwritten and
                      can't be recovered. "" rather than null because
                      `ExtractionVisualWorkOut.description` is `str`
                      (api/schemas/extraction.py), and "" is the schema's
                      existing "no description" value.

`submissions.extraction` is `json`, not `jsonb`, so rows are matched with a
text cast and rewritten from Python. Idempotent: a repaired row no longer
contains the sentence.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "cp1000085"
down_revision: str | None = "cn1000083"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEAKED = (
    "A zoomed second look at the reported location found no drawing; "
    "the first-pass description could not be confirmed."
)


def repair_visual_work(visual_work: list[Any]) -> list[Any]:
    """Pure per-entry repair; exposed for the regression test."""
    out: list[Any] = []
    for v in visual_work:
        if not isinstance(v, dict) or v.get("description") != LEAKED:
            out.append(v)
            continue
        if v.get("kind") == "table":
            continue
        out.append({**v, "verified": False, "unconfirmed": True, "description": ""})
    return out


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, extraction FROM submissions "
            "WHERE extraction IS NOT NULL AND extraction::text LIKE :needle"
        ),
        {"needle": "%A zoomed second look at the reported location found no drawing%"},
    ).fetchall()
    for sub_id, extraction in rows:
        data = extraction if isinstance(extraction, dict) else json.loads(extraction)
        vw = data.get("visual_work")
        if not isinstance(vw, list):
            continue
        repaired = repair_visual_work(vw)
        if repaired == vw:
            continue
        data["visual_work"] = repaired
        conn.execute(
            sa.text("UPDATE submissions SET extraction = CAST(:ext AS json) WHERE id = :id"),
            {"ext": json.dumps(data), "id": sub_id},
        )


def downgrade() -> None:
    # Deliberately a no-op: the old shape was the bug, and the overwritten
    # descriptions can't be restored.
    pass
