"""cp1000085: backfill `requires_drawing` and clean visual_work to match.

The pure pieces are tested here against the real prod shapes (Sep 2026):
proof-grid "table" entries on proof problems, a "diagram" on an if-then
problem, leaked-sentence entries with a false verified=true. The full
upgrade was also run against a seeded local database (see the PR).
"""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path
from typing import Any

from api.schemas.extraction import ExtractionOut

_PATH = (
    Path(__file__).resolve().parent.parent
    / "api/alembic/versions/cp1000085_add_requires_drawing.py"
)
_spec = importlib.util.spec_from_file_location("cp1000085", _PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def _v(pos: Any, kind: str = "graph", **over: Any) -> dict[str, Any]:
    base = {
        "problem_position": pos, "kind": kind, "present": True,
        "description": "One line.", "plotted_elements": ["line"],
        "labeled_points": [], "answer_on_drawing": None,
        "page_index": 1, "bbox": None, "verified": True,
    }
    return {**base, **over}


def test_drops_drawings_on_unflagged_problems() -> None:
    # prod shape: proof grids on proof problems, a diagram on an if-then
    vw = [_v(3, "table", description=mig.LEAKED), _v(4, "table"), _v(8, "diagram")]
    assert mig.clean_visual_work(vw, {1: False, 3: False, 4: False, 8: False}) == []


def test_repairs_a_leaked_entry_on_a_flagged_problem() -> None:
    ok = _v(1)
    leaked = _v(2, description=mig.LEAKED, plotted_elements=[])
    out = mig.clean_visual_work([ok, leaked], {1: True, 2: True})
    assert out[0] == ok
    assert out[1]["verified"] is False and out[1]["unconfirmed"] is True
    assert out[1]["description"] == ""
    ExtractionOut.model_validate(
        {"steps": [], "final_answers": [], "confidence": 0.9, "visual_work": out}
    )


def test_a_leaked_table_on_a_flagged_problem_is_unverified_not_unconfirmed() -> None:
    out = mig.clean_visual_work([_v(1, "table", description=mig.LEAKED)], {1: True})
    assert out[0]["verified"] is False and "unconfirmed" not in out[0]


def test_unattributed_kept_only_when_the_assignment_has_a_flagged_problem() -> None:
    stray, foreign = _v(None), _v(9)
    assert mig.clean_visual_work([stray, foreign], {1: True, 2: False}) == [stray, foreign]
    assert mig.clean_visual_work([stray, foreign], {1: False, 2: False}) == []


def test_idempotent() -> None:
    flags = {1: True, 2: False}
    once = mig.clean_visual_work([_v(1, description=mig.LEAKED), _v(2)], flags)
    assert mig.clean_visual_work(once, flags) == once


def test_problem_uuids_mirror_the_live_position_order() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    # invalid ids are skipped before numbering, as load_problems_for_assignment does
    assert mig.problem_uuids({"problem_ids": [str(a), "junk", str(b)]}) == [a, b]
    assert mig.problem_uuids({"problems": [{"bank_item_id": str(a)}]}) == [a]
    assert mig.problem_uuids(None) == []
