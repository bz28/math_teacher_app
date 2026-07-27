"""Teacher-initiated regrade reuses the stored extraction.

`Submission.extraction` is written once by the submit pipeline and the
Vision read is temperature-0, so re-reading the same photo returns the
same transcription at full price. Regrade used to pay for that re-read on
every rubric tweak — roughly half the AI cost of a regrade spent
recomputing a value already on the row.

Re-extracting also silently DISCARDED the student's confirm-time
corrections: the submit pipeline grades `apply_extraction_edits(...)`,
but regrade graded the raw Vision output, so the two paths disagreed
about what the student wrote.

Covers:
1. With an extraction stored, regrade makes no Vision call.
2. The grader receives the student-corrected view, not the raw read.
3. With no extraction stored (failed at submit, or a pre-column row),
   Vision still runs — and the result is persisted so the next regrade
   is free.
"""

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

# Bound at import time — BEFORE conftest's autouse `_mock_integrity_ai`
# fixture replaces `api.core.grading_ai.run_ai_grading_for_submission`
# with a no-op. These tests drive the regrade ENDPOINT, which resolves
# that name off the module at call time, so we re-patch the real
# implementation back in and mock only the grader's LLM call underneath.
from api.core.grading_ai import (
    run_ai_grading_for_submission as _real_run_ai_grading,
)
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio

# One step the student later corrected, plus a final answer.
_STORED_EXTRACTION: dict[str, Any] = {
    "steps": [
        {"step_num": 1, "problem_position": 1,
         "latex": "x^2 - 5x + 6 = 0", "plain_english": "start"},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "x=2,3", "answer_plain": ""},
    ],
    "confidence": 0.9,
}

_GRADER_RESULT: dict[str, Any] = {"grades": [{
    "problem_position": 1,
    "score_status": "full",
    "confidence": 0.9,
    "student_feedback": "Correct — nice work.",
    "reasoning": "matches the key",
    "deductions": [],
}]}


async def _enable_grading_and_store(
    assignment_id: uuid.UUID,
    submission_id: uuid.UUID,
    *,
    extraction: dict[str, Any] | None,
    edits: dict[str, Any] | None = None,
) -> None:
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == assignment_id)
        )).scalar_one()
        assignment.ai_grading_enabled = True
        sub = (await s.execute(
            select(Submission).where(Submission.id == submission_id)
        )).scalar_one()
        sub.extraction = extraction
        sub.extraction_edits = edits
        await s.commit()


async def test_regrade_skips_vision_and_grades_corrected_view(
    client: AsyncClient,
) -> None:
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    await _enable_grading_and_store(
        world["assignment_id"], sub_id,
        extraction=_STORED_EXTRACTION,
        # Student fixed the misread step on the confirm screen.
        edits={"1:1": "x squared minus 5x plus 6 equals 0"},
    )

    vision = AsyncMock()
    grader = AsyncMock(return_value=_GRADER_RESULT)
    with (
        patch("api.core.integrity_ai.extract_student_work", new=vision),
        patch("api.core.grading_ai.grade_submission_with_ai", new=grader),
        patch(
            "api.core.grading_ai.run_ai_grading_for_submission",
            new=_real_run_ai_grading,
        ),
    ):
        r = await client.post(
            f"/v1/teacher/submissions/{sub_id}/regrade",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    vision.assert_not_awaited()

    # The grader saw the student's correction overlaid, not the raw read.
    # The overlay routes an edit into whichever field carried the original
    # work — this step had `latex`, so the correction lands there and
    # `plain_english` is cleared (see apply_extraction_edits).
    graded_extraction = grader.call_args.args[0]
    step = graded_extraction["steps"][0]
    assert step["latex"] == "x squared minus 5x plus 6 equals 0"
    assert step["plain_english"] == ""
    assert _STORED_EXTRACTION["steps"][0]["latex"] == "x^2 - 5x + 6 = 0"


async def test_regrade_falls_back_to_vision_and_persists_it(
    client: AsyncClient,
) -> None:
    """No stored extraction (failed at submit, or a pre-column row):
    Vision still runs, and the result is saved so the NEXT regrade is
    free rather than paying again."""
    world = await _seed_hw()
    sub_id = world["submission_ids"][0]
    await _enable_grading_and_store(
        world["assignment_id"], sub_id, extraction=None,
    )

    vision = AsyncMock(return_value=_STORED_EXTRACTION)
    grader = AsyncMock(return_value=_GRADER_RESULT)
    with (
        patch("api.core.integrity_ai.extract_student_work", new=vision),
        patch("api.core.grading_ai.grade_submission_with_ai", new=grader),
        patch(
            "api.core.grading_ai.run_ai_grading_for_submission",
            new=_real_run_ai_grading,
        ),
    ):
        r = await client.post(
            f"/v1/teacher/submissions/{sub_id}/regrade",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 200, r.text
    vision.assert_awaited_once()

    async with get_session_factory()() as s:
        stored = (await s.execute(
            select(Submission.extraction).where(Submission.id == sub_id)
        )).scalar_one()
    assert stored == _STORED_EXTRACTION
