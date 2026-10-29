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
  a problem the model skipped 0, and only problems whose question still
  exists (as `load_problems_for_assignment` counts them). A points change
  re-weights these.
"""

from __future__ import annotations

import json
import uuid
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


def _graded_positions(problem_ids: list[str], existing: set[str]) -> dict[int, str]:
    """Position → id as grading numbered them: valid ids in order, 1-based,
    keeping only questions that still exist."""
    valid = []
    for pid in problem_ids:
        try:
            valid.append(str(uuid.UUID(pid)))
        except ValueError:
            continue
    return {pos: pid for pos, pid in enumerate(valid, 1) if pid in existing}


def problem_percents(ai_breakdown: dict[str, Any], positions: dict[int, str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for g in ai_breakdown.get("grades") or []:
        if not isinstance(g, dict):
            continue
        pid = positions.get(g.get("problem_position"))  # type: ignore[arg-type]
        if pid is None:
            continue
        status = g.get("score_status", "zero")
        out[pid] = (
            100.0 if status == "full" else 0.0 if status == "zero"
            else max(1.0, min(99.0, float(g.get("percent", 0))))
        )
    return {pid: out.get(pid, 0.0) for pid in positions.values()}


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

    existing = {str(r[0]) for r in conn.execute(sa.text("SELECT id FROM question_bank_items"))}
    grades = conn.execute(sa.text(
        "SELECT g.id, g.ai_breakdown, s.assignment_id FROM submission_grades g "
        "JOIN submissions s ON s.id = g.submission_id WHERE g.ai_breakdown IS NOT NULL"
    ))
    for row in grades:
        ai = row.ai_breakdown if isinstance(row.ai_breakdown, dict) else json.loads(row.ai_breakdown)
        positions = _graded_positions(contents.get(row.assignment_id, []), existing)
        ai["problem_percents"] = problem_percents(ai, positions)
        conn.execute(
            sa.text("UPDATE submission_grades SET ai_breakdown = CAST(:b AS json) WHERE id = :id"),
            {"b": json.dumps(ai), "id": row.id},
        )


def downgrade() -> None:
    op.drop_column("assignments", "problem_points")
    op.drop_column("assignments", "total_points")
