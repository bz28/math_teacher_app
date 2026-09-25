"""A grade resting on an unconfirmed drawing must land in the review page's
Low-confidence filter (`confidence < CONFIDENCE_LOW`, 0.6, strict) whatever
the model returned. Enforced after the call in `grade_submission_with_ai`,
not left to the prompt (the f7 golden case came back at exactly 0.6)."""

from __future__ import annotations

from typing import Any

import pytest

from api.core import grading_ai


def _unconfirmed(pos: int) -> dict[str, Any]:
    return {
        "problem_position": pos, "kind": "graph", "present": True, "description": "",
        "plotted_elements": [], "labeled_points": [], "answer_on_drawing": None,
        "verified": False, "unconfirmed": True,
    }


async def test_caps_only_problems_with_an_unconfirmed_drawing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_call(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"grades": [
            {"problem_position": 1, "score_status": "full", "confidence": 0.6},
            {"problem_position": 2, "score_status": "full", "confidence": 0.95},
            {"problem_position": 3, "score_status": "full", "confidence": 0.3},
            {"problem_position": 4, "score_status": "full", "confidence": None},
        ]}

    monkeypatch.setattr(grading_ai, "call_claude_json", fake_call)
    extraction = {
        "steps": [], "final_answers": [], "confidence": 0.9,
        "visual_work": [_unconfirmed(1), _unconfirmed(3), _unconfirmed(4)],
    }
    problems = [
        {"position": p, "question": "Solve by graphing.", "final_answer": "(2, 3)"}
        for p in (1, 2, 3, 4)
    ]
    result = await grading_ai.grade_submission_with_ai(extraction, problems, None)
    conf = {g["problem_position"]: g["confidence"] for g in result["grades"]}
    assert conf[1] < 0.6  # the web CONFIDENCE_LOW, strict comparison
    assert conf[2] == 0.95  # no unconfirmed drawing: untouched
    assert conf[3] == 0.3  # never raised
    assert conf[4] is not None and conf[4] < 0.6  # missing value still surfaces
