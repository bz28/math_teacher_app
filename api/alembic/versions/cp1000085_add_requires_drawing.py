"""add question_bank_items.requires_drawing; clean visual_work to match

Revision ID: cp1000085
Revises: cn1000083
Create Date: 2026-09-27 00:00:00.000000

The extractor used to inventory drawings on EVERY problem. Drawings only
matter for grading on problems that require one, and on prod (Sep 2026)
all 11 recorded visual_work entries were false positives: two-column
proof grids logged as "table" drawings, and a "diagram" on an if-then
problem — 9 of them carrying an internal pipeline sentence under a false
"checked ✓". Prod has never recorded a real drawing.

1. `requires_drawing` (bool, NOT NULL, default false) is added and
   backfilled for every existing item with the same deterministic
   classifier new items use (api/core/drawing_requirement.py).

2. `submissions.extraction` (a `json` column) is cleaned, per entry of
   `visual_work`, using the assignment's own position → bank item map
   (problem_ids_in_content + 1-based order, as load_problems_for_
   assignment builds it for the extractor and grader):
     - entry on a problem that is NOT flagged  -> removed;
     - entry with no/unknown position          -> kept only when the
       assignment has at least one flagged problem (it could be that
       drawing, filed under Other work); otherwise removed;
     - a kept entry carrying the leaked sentence -> repaired: verified
       false, description "" (the original was overwritten), and
       unconfirmed true unless it's a table (the zoomed check can't
       read tables, so a table is never "unconfirmed" — just unverified).
   Rows without any change are not rewritten. Idempotent.

Downgrade drops the column and leaves extraction data alone (the removed
entries were false positives; restoring them would restore the bug).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

from api.core.drawing_requirement import requires_drawing

revision: str = "cp1000085"
down_revision: str | None = "cn1000083"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LEAKED = (
    "A zoomed second look at the reported location found no drawing; "
    "the first-pass description could not be confirmed."
)


def problem_uuids(content: Any) -> list[uuid.UUID]:
    """Assignment content → bank item ids in position order, mirroring
    services/bank.problem_ids_in_content + load_problems_for_assignment
    (invalid ids are skipped BEFORE numbering, exactly as there)."""
    if not isinstance(content, dict):
        return []
    if isinstance(content.get("problem_ids"), list):
        raw = [str(i) for i in content["problem_ids"]]
    elif isinstance(content.get("problems"), list):
        raw = [
            str(p.get("bank_item_id")) for p in content["problems"]
            if isinstance(p, dict) and p.get("bank_item_id")
        ]
    else:
        raw = []
    out: list[uuid.UUID] = []
    for s in raw:
        try:
            out.append(uuid.UUID(s))
        except (ValueError, TypeError):
            continue
    return out


def clean_visual_work(visual_work: list[Any], flags: dict[int, bool]) -> list[Any]:
    """Pure per-entry cleanup; see the module docstring. `flags` maps each
    position on the assignment to its bank item's requires_drawing.
    Exposed for tests."""
    any_flagged = any(flags.values())
    out: list[Any] = []
    for v in visual_work:
        if not isinstance(v, dict):
            continue
        pos = v.get("problem_position")
        on_assignment = isinstance(pos, int) and not isinstance(pos, bool) and pos in flags
        keep = flags.get(pos, False) if on_assignment else any_flagged  # type: ignore[arg-type]
        if not keep:
            continue
        if v.get("description") == LEAKED:
            v = {**v, "verified": False, "description": ""}
            if v.get("kind") != "table":
                v["unconfirmed"] = True
        out.append(v)
    return out


def upgrade() -> None:
    op.add_column(
        "question_bank_items",
        sa.Column("requires_drawing", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    conn = op.get_bind()

    items = conn.execute(sa.text("SELECT id, question FROM question_bank_items")).fetchall()
    flagged_ids = {row_id for row_id, question in items if requires_drawing(question)}
    if flagged_ids:
        conn.execute(
            sa.text("UPDATE question_bank_items SET requires_drawing = true WHERE id = ANY(:ids)"),
            {"ids": list(flagged_ids)},
        )

    rows = conn.execute(sa.text(
        "SELECT s.id, s.extraction, a.content FROM submissions s "
        "JOIN assignments a ON a.id = s.assignment_id "
        "WHERE s.extraction IS NOT NULL AND s.extraction::text LIKE '%\"visual_work\"%'"
    )).fetchall()
    for sub_id, extraction, content in rows:
        data = extraction if isinstance(extraction, dict) else json.loads(extraction)
        vw = data.get("visual_work")
        if not isinstance(vw, list) or not vw:
            continue
        content = content if isinstance(content, dict) or content is None else json.loads(content)
        flags = {pos: pid in flagged_ids for pos, pid in enumerate(problem_uuids(content), 1)}
        cleaned = clean_visual_work(vw, flags)
        if cleaned == vw:
            continue
        data["visual_work"] = cleaned
        conn.execute(
            sa.text("UPDATE submissions SET extraction = CAST(:ext AS json) WHERE id = :id"),
            {"ext": json.dumps(data), "id": sub_id},
        )


def downgrade() -> None:
    op.drop_column("question_bank_items", "requires_drawing")
