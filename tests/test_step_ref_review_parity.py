"""A deduction's `step_ref` highlights the step the grader meant.

End to end: a two-problem homework whose extraction numbers `step_num`
across the whole homework (the real extractor's shape), with a step the
student cleared on the confirm screen. The grader's real prompt is built,
the mocked model anchors a deduction to the "Step N" label it was shown,
and the teacher review payload's `student_steps[N - 1]` — the row the
review page tints — must be that same step.
"""

import re
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from api.core.grading_ai import (
    run_ai_grading_for_submission as _real_run_ai_grading,
)
from tests.conftest import auth_headers as _auth
from tests.test_regrade_reuses_extraction import _enable_grading_and_store
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio

_EXTRACTION: dict[str, Any] = {
    "steps": [
        {"step_num": 1, "problem_position": 1, "latex": "x^2-5x+6=0", "plain_english": ""},
        {"step_num": 2, "problem_position": 1, "latex": "(x-2)(x-3)=0", "plain_english": ""},
        {"step_num": 3, "problem_position": None, "latex": "scratch", "plain_english": ""},
        {"step_num": 4, "problem_position": 2, "latex": "misread", "plain_english": ""},
        {"step_num": 5, "problem_position": 2, "latex": "x^2-5x=-6", "plain_english": ""},
        {"step_num": 6, "problem_position": 2, "latex": "x=2,\\ x=4", "plain_english": ""},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "x=2,3", "answer_plain": ""},
        {"problem_position": 2, "answer_latex": "x=2,4", "answer_plain": ""},
    ],
    "confidence": 0.9,
}


async def test_step_ref_points_at_the_step_the_teacher_sees(client: AsyncClient) -> None:
    world = await _seed_hw(n_problems=2)
    sub_id = world["submission_ids"][0]
    # The student deleted the misread step 4, so problem 2 shows two steps.
    await _enable_grading_and_store(
        world["assignment_id"], sub_id, extraction=_EXTRACTION, edits={"2:4": ""},
    )

    async def fake_llm(system: str, user_message: str, *args: Any, **kwargs: Any) -> dict[str, Any]:
        p2 = user_message[user_message.index("## Problem 2"):]
        label = re.search(r"Step (\d+): x=2,\\ x=4", p2)
        assert label, user_message
        return {"grades": [
            {"problem_position": 1, "score_status": "full", "percent": 100, "confidence": 0.9,
             "reasoning": "ok", "student_feedback": "ok", "student_answer": "x=2,3", "deductions": []},
            {"problem_position": 2, "score_status": "partial", "percent": 90, "confidence": 0.9,
             "reasoning": "slip", "student_feedback": "slip", "student_answer": "x=2,4",
             "deductions": [{"points_off": 10, "reason": "slip", "step_ref": int(label.group(1)),
                             "rule_id": None}]},
        ]}

    with (
        patch("api.core.grading_ai.call_claude_json", new=AsyncMock(side_effect=fake_llm)),
        patch("api.core.grading_ai.run_ai_grading_for_submission", new=_real_run_ai_grading),
    ):
        r = await client.post(
            f"/v1/teacher/submissions/{sub_id}/regrade", headers=_auth(world["teacher_token"]),
        )
    assert r.status_code == 200, r.text

    r = await client.get(f"/v1/teacher/submissions/{sub_id}", headers=_auth(world["teacher_token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    p2_id = world["bank_item_ids"][1]
    steps = next(p for p in body["problems"] if p["bank_item_id"] == p2_id)["student_steps"]
    entry = next(e for e in body["breakdown"] if e["problem_id"] == p2_id)
    ref = entry["deductions"][0]["step_ref"]
    assert ref == 2  # not the homework-wide 6, and not 3 (before the deletion)
    assert steps[ref - 1]["latex"] == "x=2,\\ x=4"
