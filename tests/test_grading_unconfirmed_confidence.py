"""A grade resting on a drawing nobody could read must land in the review
page's Low-confidence filter (`confidence < CONFIDENCE_LOW`, 0.6, strict)
whatever the model returned. Enforced after the call in
`grade_submission_with_ai`, not left to the prompt (the f7 golden case
came back at exactly 0.6). Only on problems that require a drawing —
drawings elsewhere aren't used."""

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


def _problems(flagged: set[int], n: int = 5) -> list[dict[str, Any]]:
    return [
        {"position": p, "question": "Solve.", "final_answer": "(2, 3)",
         "requires_drawing": p in flagged}
        for p in range(1, n + 1)
    ]


def _fake(confs: dict[int, Any]) -> Any:
    async def fake_call(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"grades": [
            {"problem_position": p, "score_status": "full", "confidence": c} for p, c in confs.items()
        ]}
    return fake_call


async def test_caps_flagged_problems_with_an_unconfirmed_drawing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(grading_ai, "call_claude_json", _fake({1: 0.6, 2: 0.95, 3: 0.3, 4: None, 5: 0.9}))
    extraction = {
        "steps": [], "final_answers": [], "confidence": 0.9,
        "visual_work": [_unconfirmed(1), _unconfirmed(3), _unconfirmed(4), _unconfirmed(5)],
    }
    result = await grading_ai.grade_submission_with_ai(extraction, _problems({1, 2, 3, 4}), None)
    conf = {g["problem_position"]: g["confidence"] for g in result["grades"]}
    assert conf[1] < 0.6  # the web CONFIDENCE_LOW, strict comparison
    assert conf[2] == 0.95  # no unconfirmed drawing: untouched
    assert conf[3] == 0.3  # never raised
    assert conf[4] is not None and conf[4] < 0.6  # missing value still surfaces
    assert conf[5] == 0.9  # unflagged problem: its drawing isn't used


async def test_legacy_row_without_drawings_caps_flagged_problems(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Extracted before drawings were inventoried: on a problem that
    requires one, what was drawn is unknown — surface it."""
    monkeypatch.setattr(grading_ai, "call_claude_json", _fake({1: 0.95, 2: 0.95}))
    extraction = {"steps": [], "final_answers": [], "confidence": 0.9}
    result = await grading_ai.grade_submission_with_ai(extraction, _problems({1}, n=2), None)
    conf = {g["problem_position"]: g["confidence"] for g in result["grades"]}
    assert conf[1] < 0.6 and conf[2] == 0.95
