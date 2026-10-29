"""add homework points

Revision ID: cs1000088
Revises: cr1000087
Create Date: 2026-10-28 00:00:00.000000

Homeworks get points (api/core/homework_points.py): `total_points`, split
evenly until the teacher sets `problem_points` by hand.

Backfill, so no stored score moves:
- Every existing assignment is worth 10 points per problem (100 when it
  has none). Equal points give exactly the plain average scores used
  before, and `final_score` / `published_final_score` are not touched.
- Every AI grade gets `ai_breakdown.problem_percents` ({problem_id:
  percent}), the per-problem percents its `ai_score` averaged, worked out
  the way grading did then: full 100, zero 0, partial clamped to 1-99,
  a problem the model skipped 0. A points change re-weights these.
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "cs1000088"
down_revision: str | None = "cr1000087"
branch_labels = None
depends_on = None


def _problem_ids(content: Any) -> list[str]:
    # Mirrors api.services.bank.problem_ids_in_content, frozen here.
    if isinstance(content, str):
        content = json.loads(content)
    if not isinstance(content, dict):
        return []
    if isinstance(content.get("problem_ids"), list):
        return [str(i) for i in content["problem_ids"]]
    if isinstance(content.get("problems"), list):
        return [str(p["bank_item_id"]) for p in content["problems"]
                if isinstance(p, dict) and p.get("bank_item_id")]
    return []


def problem_percents(ai_breakdown: dict[str, Any], problem_ids: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for g in ai_breakdown.get("grades") or []:
        if not isinstance(g, dict):
            continue
        pos = g.get("problem_position")
        if not isinstance(pos, int) or not 1 <= pos <= len(problem_ids):
            continue
        status = g.get("score_status", "zero")
        out[problem_ids[pos - 1]] = (
            100.0 if status == "full" else 0.0 if status == "zero"
            else max(1.0, min(99.0, float(g.get("percent", 0))))
        )
    return {pid: out.get(pid, 0.0) for pid in problem_ids}


def upgrade() -> None:
    op.add_column("assignments", sa.Column(
        "total_points", sa.Integer, nullable=False, server_default="100",
    ))
    op.add_column("assignments", sa.Column("problem_points", sa.JSON, nullable=True))

    conn = op.get_bind()
    contents = {
        row.id: _problem_ids(row.content)
        for row in conn.execute(sa.text("SELECT id, content FROM assignments"))
    }
    for aid, ids in contents.items():
        if ids:
            conn.execute(
                sa.text("UPDATE assignments SET total_points = :t WHERE id = :id"),
                {"t": 10 * len(ids), "id": aid},
            )

    grades = conn.execute(sa.text(
        "SELECT g.id, g.ai_breakdown, s.assignment_id FROM submission_grades g "
        "JOIN submissions s ON s.id = g.submission_id WHERE g.ai_breakdown IS NOT NULL"
    ))
    for row in grades:
        ai = row.ai_breakdown if isinstance(row.ai_breakdown, dict) else json.loads(row.ai_breakdown)
        ai["problem_percents"] = problem_percents(ai, contents.get(row.assignment_id, []))
        conn.execute(
            sa.text("UPDATE submission_grades SET ai_breakdown = CAST(:b AS json) WHERE id = :id"),
            {"b": json.dumps(ai), "id": row.id},
        )


def downgrade() -> None:
    op.drop_column("assignments", "problem_points")
    op.drop_column("assignments", "total_points")
