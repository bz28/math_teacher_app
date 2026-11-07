"""renumber stored deduction `step_ref`s from homework-wide to per-problem

Revision ID: dd1000099
Revises: dc1000098
Create Date: 2026-11-07 00:00:00.000000

A deduction's `step_ref` anchors it to one step of the student's work, and
the teacher review page highlights it as the N-th step it lists under that
problem (1-based within the problem). The grader, though, was shown each
step labelled with the extractor's `step_num`, which counts across the whole
homework, and echoed that back: problem 15's steps read "Step 58..62", so its
deductions carried 58..62. Those were either nulled at grading time as out of
range, or, where they happened to fall inside 1..N, kept and pointed at the
wrong step. The grader now numbers each problem's steps 1..N, the review
page's numbering; this rewrites the refs already stored to match.

On prod every stored ref on a problem whose `step_num`s don't start at 1
equals one of that problem's `step_num`s (254 of 254), so the old value is
read as a `step_num` and becomes its 1-based place among the problem's steps,
counted the way both the grader and the review page count them: the
submission's steps in order, tagged with that problem's position, minus a
step the student cleared on the confirm screen (an empty edit) and a step
with no text at all. A ref that matches no step can't anchor anywhere and is
nulled, as the grader nulls an out-of-range one. On a problem whose steps
are numbered 1..N already (every first problem) the rewrite is the identity.

Rewritten in all three places a ledger is kept: `ai_breakdown.grades[]`
(keyed by `problem_position`), and `breakdown[]` / `published_breakdown[]`
(keyed by `problem_id`, whose position is its place in the homework's
`problem_ids`). The same rewrite on all three keeps a published grade
from reading as edited. `points_off`, reasons and scores are untouched.

Every stored shape is tolerated: SQL NULL, JSON null, a non-object
breakdown, entries without `deductions`, a null ref, a non-int ref.

Not idempotent: a ref is read as a `step_num`, and after the rewrite it is
an index. Alembic runs it once. The grade rows are locked while they are
rewritten, so a save landing mid-migration waits rather than being
overwritten. A grade written by the old container during the deploy overlap,
or saved from a review page opened before the deploy (the save echoes the
refs it loaded), keeps a homework-wide ref; its only cost is a missing or
misplaced highlight.

Downgrade maps each per-problem index back to that step's `step_num`.

Ordering: if another migration also lands on dc1000098, whichever merges
second re-points its `down_revision` at the other.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from typing import Any, TypeGuard

import sqlalchemy as sa
from alembic import op

revision: str = "dd1000099"
down_revision: str | None = "dc1000098"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# position -> that problem's step_nums, in the order the grader numbered them
StepNums = dict[int, list[Any]]
Remap = Callable[[Any, list[Any]], Any]


def _is_int(v: Any) -> TypeGuard[int]:
    return isinstance(v, int) and not isinstance(v, bool)


def step_nums_by_position(extraction: Any, edits: Any) -> StepNums:
    """Each problem's steps as the grader numbered them and the review page
    lists them: in order, minus cleared and empty steps."""
    if not isinstance(extraction, dict) or not isinstance(extraction.get("steps"), list):
        return {}
    edits = edits if isinstance(edits, dict) else {}
    out: StepNums = {}
    for s in extraction["steps"]:
        if not isinstance(s, dict):
            continue
        pos, num = s.get("problem_position"), s.get("step_num")
        if not _is_int(pos):
            continue
        key = f"{pos}:{num}" if _is_int(num) else None
        if key is not None and key in edits:
            if not str(edits.get(key) or "").strip():
                continue  # cleared by the student
        elif not (s.get("latex") or s.get("plain_english")):
            continue
        out.setdefault(pos, []).append(num)
    return out


def to_index(ref: Any, nums: list[Any]) -> Any:
    """Upgrade: a step_num becomes its 1-based place, or None."""
    if not _is_int(ref):
        return ref
    return nums.index(ref) + 1 if ref in nums else None


def to_step_num(ref: Any, nums: list[Any]) -> Any:
    """Downgrade: a 1-based place becomes that step's step_num, or None."""
    if not _is_int(ref):
        return ref
    return nums[ref - 1] if 1 <= ref <= len(nums) and _is_int(nums[ref - 1]) else None


def _remap_entry(entry: Any, nums: list[Any], remap: Remap) -> bool:
    """Rewrite one ledger's refs in place; True when anything changed."""
    if not isinstance(entry, dict) or not isinstance(entry.get("deductions"), list):
        return False
    changed = False
    for d in entry["deductions"]:
        if isinstance(d, dict) and d.get("step_ref") is not None:
            new = remap(d["step_ref"], nums)
            if new != d["step_ref"]:
                d["step_ref"] = new
                changed = True
    return changed


def remap_ai_breakdown(ai: Any, steps: StepNums, remap: Remap) -> bool:
    if not isinstance(ai, dict) or not isinstance(ai.get("grades"), list):
        return False
    changed = False
    for g in ai["grades"]:
        if isinstance(g, dict) and _is_int(g.get("problem_position")):
            changed |= _remap_entry(g, steps.get(g["problem_position"], []), remap)
    return changed


def remap_breakdown(rows: Any, steps: StepNums, pid_pos: dict[str, int], remap: Remap) -> bool:
    if not isinstance(rows, list):
        return False
    changed = False
    for e in rows:
        if isinstance(e, dict) and str(e.get("problem_id")) in pid_pos:
            changed |= _remap_entry(e, steps.get(pid_pos[str(e["problem_id"])], []), remap)
    return changed


def _problem_positions(content: Any) -> dict[str, int]:
    """bank item id -> 1-based position (`bank.problem_ids_in_content`)."""
    if not isinstance(content, dict):
        return {}
    if isinstance(content.get("problem_ids"), list):
        ids = [str(i) for i in content["problem_ids"]]
    elif isinstance(content.get("problems"), list):
        ids = [str(p.get("bank_item_id")) for p in content["problems"]
               if isinstance(p, dict) and p.get("bank_item_id")]
    else:
        ids = []
    out: dict[str, int] = {}
    for pos, pid in enumerate(ids, 1):
        out.setdefault(pid, pos)
    return out


def _load(raw: str | None) -> Any:
    return None if raw is None else json.loads(raw)


def _rewrite(remap: Remap) -> None:
    conn = op.get_bind()
    # Read as text and parse here, so a JSON null (or any other odd value)
    # reaches Python as plain data instead of tripping a SQL json operator.
    rows = conn.execute(sa.text(
        "SELECT g.id, g.ai_breakdown::text, g.breakdown::text, g.published_breakdown::text, "
        "s.extraction::text, s.extraction_edits::text, a.content::text "
        "FROM submission_grades g "
        "JOIN submissions s ON s.id = g.submission_id "
        "JOIN assignments a ON a.id = s.assignment_id "
        "WHERE s.extraction IS NOT NULL "
        "FOR UPDATE OF g"
    )).all()
    for gid, ai_raw, b_raw, pb_raw, ex_raw, ed_raw, content_raw in rows:
        steps = step_nums_by_position(_load(ex_raw), _load(ed_raw))
        pid_pos = _problem_positions(_load(content_raw))
        ai, b, pb = _load(ai_raw), _load(b_raw), _load(pb_raw)
        sets: dict[str, Any] = {}
        if remap_ai_breakdown(ai, steps, remap):
            sets["ai_breakdown"] = ai
        if remap_breakdown(b, steps, pid_pos, remap):
            sets["breakdown"] = b
        if remap_breakdown(pb, steps, pid_pos, remap):
            sets["published_breakdown"] = pb
        if sets:
            assignments = ", ".join(f"{col} = CAST(:{col} AS json)" for col in sets)
            conn.execute(
                sa.text(f"UPDATE submission_grades SET {assignments} WHERE id = :id"),
                {**{col: json.dumps(v) for col, v in sets.items()}, "id": gid},
            )


def upgrade() -> None:
    _rewrite(to_index)


def downgrade() -> None:
    _rewrite(to_step_num)
