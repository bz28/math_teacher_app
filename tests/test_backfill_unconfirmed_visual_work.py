"""cp1000085 repairs visual_work rows the old verify pass mislabeled.

Old shape (prod bb8536f1): verified=true + an internal sentence written
over the description. Tables go (no longer a drawing kind); anything else
becomes unconfirmed with an empty description — and the result must still
validate as the API's ExtractionOut.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

from api.schemas.extraction import ExtractionOut

_PATH = (
    Path(__file__).resolve().parent.parent
    / "api/alembic/versions/cp1000085_backfill_unconfirmed_visual_work.py"
)
_spec = importlib.util.spec_from_file_location("cp1000085", _PATH)
assert _spec and _spec.loader
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)


def _v(**over: Any) -> dict[str, Any]:
    base = {
        "problem_position": 1, "kind": "graph", "present": True,
        "description": "One line.", "plotted_elements": ["line"],
        "labeled_points": [], "answer_on_drawing": None,
        "page_index": 1, "bbox": None, "verified": True,
    }
    return {**base, **over}


def test_repairs_old_shape_and_leaves_the_rest() -> None:
    ok = _v()
    vw = [
        ok,
        _v(problem_position=3, kind="table", description=mig.LEAKED, plotted_elements=[]),
        _v(problem_position=5, kind="graph", description=mig.LEAKED, plotted_elements=[]),
    ]
    out = mig.repair_visual_work(vw)
    assert out[0] == ok
    assert len(out) == 2  # the table is gone
    fixed = out[1]
    assert fixed["verified"] is False and fixed["unconfirmed"] is True
    assert fixed["description"] == ""
    # The migrated shape is valid for the API contract.
    ExtractionOut.model_validate(
        {"steps": [], "final_answers": [], "confidence": 0.9, "visual_work": out}
    )
    # Idempotent.
    assert mig.repair_visual_work(out) == out


def test_downgrade_is_a_noop() -> None:
    assert mig.downgrade() is None
