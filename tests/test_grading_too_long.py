"""A homework too long for the AI grader to finish in one call.

Prod (Oct 2026): the grader writes reasoning for every problem in one tool
call (≈270 output tokens a problem). A 12+-problem homework overran the
4096-token cap, `call_claude_json` retried the identical temp-0 request
three times, the grading queue retried the job up to MAX_ATTEMPTS — up to
nine paid, identical failures — and the teacher saw no grade and no reason.

These pin the fix end to end:
1. A truncated response raises `OutputTruncatedError` after ONE call — no
   retry, no circuit-breaker strike — and is still a RuntimeError, so the
   routes that already catch RuntimeError keep working.
2. The grading call has room: 16384 output tokens and a timeout to match.
3. A truncation is stamped `skipped_too_long` (never over a hand grade),
   the queue retires the job as skipped rather than retrying it, the
   review page is told `too_long`, and a forced regrade says so with a 422.
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

# Bound before conftest's autouse fixture swaps the module attribute for a
# no-op AsyncMock; tests that need the real thing patch it back in.
from api.core.grading_ai import (
    GRADING_STATUS_SKIPPED_TOO_LONG,
    grade_submission_with_ai,
)
from api.core.grading_ai import (
    run_ai_grading_for_submission as _real_run_ai_grading,
)
from api.core.grading_queue import drain, enqueue_submission
from api.core.llm_client import (
    LLMMode,
    OutputTruncatedError,
    _circuit,
    call_claude_json,
)
from api.core.llm_schemas import AI_GRADING_SCHEMA
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission, SubmissionGrade
from api.models.grading_job import STATUS_SKIPPED, GradingJob
from tests.conftest import auth_headers as _auth
from tests.test_teacher_review_checkpoint import _seed_hw

pytestmark = pytest.mark.asyncio

_EXTRACTION: dict[str, Any] = {
    "steps": [
        {"step_num": 1, "problem_position": 1,
         "latex": "x^2 - 5x + 6 = 0", "plain_english": ""},
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

_TRUNCATED = OutputTruncatedError("Response truncated at max_tokens=16384")


def _truncated_response() -> SimpleNamespace:
    return SimpleNamespace(
        stop_reason="max_tokens",
        content=[SimpleNamespace(type="tool_use", input={"grades": []})],
        usage=SimpleNamespace(
            input_tokens=3000, output_tokens=4096,
            cache_read_input_tokens=0, cache_creation_input_tokens=0,
        ),
    )


# ── llm_client ───────────────────────────────────────────────────────


async def test_truncation_raises_after_one_call_without_tripping_the_breaker() -> None:
    create = AsyncMock(return_value=_truncated_response())
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    logged: list[dict[str, Any]] = []

    async def fake_log(*args: Any, **kwargs: Any) -> None:
        logged.append({"args": args, **kwargs})

    _circuit.reset()
    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client._log_and_persist", side_effect=fake_log),
        patch("api.core.llm_client.asyncio.sleep", new=AsyncMock()),
    ):
        with pytest.raises(OutputTruncatedError) as exc:
            await call_claude_json(
                "system", "user", LLMMode.AI_GRADING,
                tool_schema=AI_GRADING_SCHEMA, max_tokens=4096, max_retries=3,
                temperature=0.0,
            )

    # Callers that catch RuntimeError from these calls keep working.
    assert isinstance(exc.value, RuntimeError)
    # One paid call, not three identical ones.
    assert create.await_count == 1
    # Logged once, as a failure, with the real (billed) usage.
    assert len(logged) == 1
    assert logged[0]["success"] is False
    assert logged[0]["args"][2:4] == (3000, 4096)
    # Not an API outage.
    assert _circuit._failure_count == 0


async def test_a_sampled_call_keeps_its_retries_on_truncation() -> None:
    """Only temperature 0 truncates identically. A sampled call (tutor chat,
    generation) can come back shorter on a retry, so it keeps them — and
    still raises the typed error once they're spent."""
    create = AsyncMock(return_value=_truncated_response())
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client._log_and_persist", new=AsyncMock()),
        patch("api.core.llm_client.asyncio.sleep", new=AsyncMock()),
        pytest.raises(OutputTruncatedError),
    ):
        await call_claude_json(
            "system", "user", LLMMode.AI_GRADING,
            tool_schema=AI_GRADING_SCHEMA, max_tokens=4096, max_retries=3,
        )
    assert create.await_count == 3


async def test_timeout_is_passed_through_to_the_api() -> None:
    ok = SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", input=_GRADER_RESULT)],
        usage=SimpleNamespace(
            input_tokens=1, output_tokens=1,
            cache_read_input_tokens=0, cache_creation_input_tokens=0,
        ),
    )
    create = AsyncMock(return_value=ok)
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    with (
        patch("api.core.llm_client.get_client", return_value=client),
        patch("api.core.llm_client._log_and_persist", new=AsyncMock()),
    ):
        await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
        )
        assert create.call_args.kwargs["timeout"] == 90.0
        await call_claude_json(
            "s", "u", LLMMode.AI_GRADING, tool_schema=AI_GRADING_SCHEMA,
            timeout=300.0,
        )
        assert create.call_args.kwargs["timeout"] == 300.0


async def test_grading_call_has_room_for_a_long_homework() -> None:
    call = AsyncMock(return_value={"grades": []})
    problems = [
        {"position": i, "question": f"Q{i}", "final_answer": "1",
         "bank_item_id": str(uuid.uuid4())}
        for i in range(1, 16)
    ]
    with patch("api.core.grading_ai.call_claude_json", new=call):
        await grade_submission_with_ai(_EXTRACTION, problems, None)
    assert call.call_args.kwargs["max_tokens"] == 16384
    assert call.call_args.kwargs["timeout"] == 300.0
    # No outer retry layer: worst case stays inside the queue's stale window.
    assert call.call_args.kwargs["max_retries"] == 1


# ── run_ai_grading_for_submission ─────────────────────────────────────


async def _ready(world: dict[str, Any]) -> uuid.UUID:
    """AI grading on, a confirmed readable extraction on the submission."""
    sid: uuid.UUID = world["submission_ids"][0]
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.ai_grading_enabled = True
        sub = (await s.execute(
            select(Submission).where(Submission.id == sid)
        )).scalar_one()
        sub.extraction = _EXTRACTION
        sub.extraction_confirmed_at = datetime.now(UTC)
        await s.commit()
    return sid


async def _grade(sid: uuid.UUID) -> SubmissionGrade | None:
    async with get_session_factory()() as s:
        return (await s.execute(
            select(SubmissionGrade).where(SubmissionGrade.submission_id == sid)
        )).scalar_one_or_none()


async def _run(sid: uuid.UUID, grader: AsyncMock, *, force: bool = False) -> str | None:
    async with get_session_factory()() as s:
        with patch("api.core.grading_ai.grade_submission_with_ai", new=grader):
            result = await _real_run_ai_grading(sid, _EXTRACTION, s, force=force)
        await s.commit()
    return result


async def test_truncation_stamps_too_long_and_writes_no_grade() -> None:
    sid = await _ready(await _seed_hw())

    result = await _run(sid, AsyncMock(side_effect=_TRUNCATED))

    assert result == GRADING_STATUS_SKIPPED_TOO_LONG
    grade = await _grade(sid)
    assert grade is not None
    assert grade.ai_grading_status == GRADING_STATUS_SKIPPED_TOO_LONG
    assert grade.final_score is None
    assert grade.breakdown is None


async def test_truncation_never_clobbers_a_hand_grade() -> None:
    """A forced regrade of a hand-graded submission that truncates leaves
    her grade exactly as it was — no stamp over it."""
    sid = await _ready(await _seed_hw())
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(submission_id=sid, final_score=80.0))
        await s.commit()

    result = await _run(sid, AsyncMock(side_effect=_TRUNCATED), force=True)

    assert result == GRADING_STATUS_SKIPPED_TOO_LONG
    grade = await _grade(sid)
    assert grade is not None
    assert grade.final_score == 80.0
    assert grade.ai_grading_status is None


async def test_a_later_successful_regrade_clears_too_long() -> None:
    sid = await _ready(await _seed_hw())
    await _run(sid, AsyncMock(side_effect=_TRUNCATED))

    result = await _run(sid, AsyncMock(return_value=_GRADER_RESULT), force=True)

    assert result is None
    grade = await _grade(sid)
    assert grade is not None
    assert grade.ai_grading_status is None
    assert grade.final_score == 100.0


# ── Queue ────────────────────────────────────────────────────────────


async def test_queue_retires_a_too_long_job_as_skipped_without_retrying() -> None:
    world = await _seed_hw()
    sid = await _ready(world)
    async with get_session_factory()() as s:
        assignment = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()
        assignment.due_at = datetime.now(UTC) - timedelta(minutes=1)
        await enqueue_submission(s, sid, assignment)
        await s.commit()

    grader = AsyncMock(side_effect=_TRUNCATED)
    with (
        patch("api.core.grading_ai.grade_submission_with_ai", new=grader),
        patch(
            "api.core.grading_ai.run_ai_grading_for_submission",
            new=_real_run_ai_grading,
        ),
    ):
        await drain()
        await drain()  # nothing left to retry

    assert grader.await_count == 1
    async with get_session_factory()() as s:
        job = (await s.execute(
            select(GradingJob).where(GradingJob.submission_id == sid)
        )).scalar_one()
    assert job.status == STATUS_SKIPPED
    assert job.attempts == 1
    grade = await _grade(sid)
    assert grade is not None
    assert grade.ai_grading_status == GRADING_STATUS_SKIPPED_TOO_LONG


# ── Teacher routes ───────────────────────────────────────────────────


async def test_review_page_is_told_too_long_and_grade_now_refuses(
    client: AsyncClient,
) -> None:
    world = await _seed_hw()
    sid = await _ready(world)
    async with get_session_factory()() as s:
        s.add(SubmissionGrade(
            submission_id=sid, ai_grading_status=GRADING_STATUS_SKIPPED_TOO_LONG,
        ))
        await s.commit()

    r = await client.get(
        f"/v1/teacher/assignments/{world['assignment_id']}/submissions",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200, r.text
    [row] = r.json()["submissions"]
    assert row["ai_grade_block"] == "too_long"
    assert row["ai_grading_status"] == "skipped_too_long"

    with patch("api.core.grading_queue.drain", new=AsyncMock(return_value={})):
        r = await client.post(
            f"/v1/teacher/submissions/{sid}/grade-now",
            headers=_auth(world["teacher_token"]),
        )
    assert r.status_code == 409, r.text
    assert "too long" in r.json()["detail"]


async def test_regrade_that_truncates_returns_422_with_the_reason(
    client: AsyncClient,
) -> None:
    world = await _seed_hw()
    sid = await _ready(world)

    with (
        patch(
            "api.core.grading_ai.grade_submission_with_ai",
            new=AsyncMock(side_effect=_TRUNCATED),
        ),
        patch(
            "api.core.grading_ai.run_ai_grading_for_submission",
            new=_real_run_ai_grading,
        ),
    ):
        r = await client.post(
            f"/v1/teacher/submissions/{sid}/regrade",
            headers=_auth(world["teacher_token"]),
        )

    assert r.status_code == 422, r.text
    assert r.json()["detail"] == (
        "This submission is too long for the AI to grade in one pass — "
        "please grade it by hand."
    )
    grade = await _grade(sid)
    assert grade is not None
    assert grade.ai_grading_status == GRADING_STATUS_SKIPPED_TOO_LONG
