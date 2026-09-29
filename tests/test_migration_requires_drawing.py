"""cp1000085: backfill `requires_drawing`, repair leaked visual_work — deleting nothing.

Pure pieces tested against the real prod shapes (Sep 2026): proof-grid
"table" entries and an if-then "diagram" carrying the leaked sentence
under a false verified=true. The full upgrade/downgrade was also run on a
seeded local DB, and a read-only dry run of this logic on prod (PR body).
"""

from __future__ import annotations

import importlib.util
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


def test_repairs_leaked_entries_and_deletes_nothing() -> None:
    ok = _v(1)
    vw = [ok, _v(3, "table", description=mig.LEAKED), _v(8, "diagram", description=mig.LEAKED),
          _v(None, "sketch")]
    out = mig.repair_visual_work(vw)
    assert len(out) == len(vw)
    assert out[0] == ok and out[3] == vw[3]
    # a table is never "unconfirmed" — just unverified
    assert out[1]["verified"] is False and out[1]["description"] == "" and "unconfirmed" not in out[1]
    assert out[2]["verified"] is False and out[2]["unconfirmed"] is True and out[2]["description"] == ""
    ExtractionOut.model_validate(
        {"steps": [], "final_answers": [], "confidence": 0.9, "visual_work": out}
    )


def test_idempotent() -> None:
    once = mig.repair_visual_work([_v(1, description=mig.LEAKED)])
    assert mig.repair_visual_work(once) == once


def test_frozen_classifier_backfills_the_prod_shapes() -> None:
    assert mig.requires_drawing(
        "Solve the system by graphing. Identify the solution as an ordered pair."
    ) is True
    assert mig.requires_drawing("Represent $x > 3$ on a number line.") is True
    assert mig.requires_drawing(
        "Complete the two-column proof. Copy and complete the table below."
    ) is False
    assert mig.requires_drawing(
        'Rewrite the following statement in if-then form: "Vertical angles are congruent."'
    ) is False
