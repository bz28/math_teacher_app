"""Integration tests for the integrity-checker pipeline + trigger.

Reuses the seeded `world` fixture from test_school_student_practice
(teacher / student / course / section / approved primary / variations
/ published HW / outsider student) so we don't duplicate setup.

Tests cover:
- Pipeline trigger from submit_homework: rows created, statuses
  correct, idempotent on retry
- integrity_check_enabled=False: no rows created
- HW with > MAX_SAMPLE primaries: only the first MAX_SAMPLE sampled
- HW with 0 primaries: no rows, no error
- Quizzes (assignment.type != homework): no rows even if submit
  somehow reaches that path
- Pipeline failure isolation: a forced exception in the pipeline
  must NOT roll back the kid's submission
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from api.database import get_session_factory
from api.models.integrity_check import IntegrityCheckProblem, IntegrityCheckResponse
from api.models.question_bank import QuestionBankItem
from tests.conftest import TINY_PNG
from tests.conftest import auth_headers as _auth

# ── Mock AI helpers ──
# These replicate the old stub behavior so integration tests run
# without real Claude calls. The mocks are applied globally via
# the autouse fixture below.

_MOCK_EXTRACTION = {
    "steps": [
        {"step_num": 1, "latex": "mock", "plain_english": "mocked extraction"},
    ],
    "confidence": 0.9,
}

_MOCK_QUESTIONS = [
    {
        "question_text": "What was the first step you took to solve this?",
        "expected_shape": "Brief description of an actual operation",
        "rubric_hint": "Should reference a concrete operation",
    },
    {
        "question_text": "Walk me through how you got the final answer.",
        "expected_shape": "1-2 sentences connecting work to answer",
        "rubric_hint": "Should mention the last step or transformation",
    },
]


def _mock_score(question: Any, answer: str, **kwargs: Any) -> dict[str, Any]:
    """Length-based scoring matching the old stub behavior."""
    n = len(answer.strip())
    if n < 5:
        verdict = "bad"
    elif n < 30:
        verdict = "weak"
    else:
        verdict = "good"
    return {"verdict": verdict, "reasoning": f"Mock: length {n}", "flags": []}


@pytest.fixture(autouse=True)
def _mock_integrity_ai() -> Any:
    """Mock all integrity AI calls so tests don't hit Claude."""
    with (
        patch(
            "api.core.integrity_pipeline.extract_student_work",
            new_callable=AsyncMock,
            return_value=_MOCK_EXTRACTION,
        ),
        patch(
            "api.core.integrity_pipeline.generate_integrity_questions",
            new_callable=AsyncMock,
            return_value=_MOCK_QUESTIONS,
        ),
        patch(
            "api.core.integrity_ai.score_answer",
            new_callable=AsyncMock,
            side_effect=_mock_score,
        ),
        patch(
            "api.routes.integrity_check.score_answer",
            new_callable=AsyncMock,
            side_effect=_mock_score,
        ),
    ):
        yield


def _submit(client: AsyncClient, world: dict[str, Any]) -> Any:
    return client.post(
        f"/v1/school/student/homework/{world['assignment_id']}/submit",
        headers=_auth(world["student_token"]),
        json={"image_base64": TINY_PNG},
    )


async def test_submit_creates_integrity_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    assert r.status_code == 200, r.text

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
            .order_by(IntegrityCheckProblem.sample_position.asc())
        )).scalars().all()
        # The seeded world has exactly 1 primary problem
        assert len(problems) == 1
        p = problems[0]
        assert str(p.bank_item_id) == str(world["primary_id"])
        assert p.sample_position == 0
        assert p.status == "awaiting_student"
        assert p.student_work_extraction is not None
        assert p.badge is None  # not yet scored
        assert p.teacher_dismissed is False

        responses = (await s.execute(
            select(IntegrityCheckResponse)
            .where(IntegrityCheckResponse.integrity_check_problem_id == p.id)
            .order_by(IntegrityCheckResponse.question_index.asc())
        )).scalars().all()
        # Stub returns 2 questions per problem
        assert len(responses) == 2
        assert responses[0].question_index == 0
        assert responses[1].question_index == 1
        assert responses[0].question_text
        assert responses[0].student_answer is None
        assert responses[0].answer_verdict is None
        assert responses[0].rephrase_used is False


async def test_submit_with_integrity_disabled_creates_no_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Flip the per-HW toggle off
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET integrity_check_enabled=false WHERE id=:id"),
            {"id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    assert r.status_code == 200

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
        )).scalars().all()
        assert problems == []


async def test_submit_caps_sample_at_max_sample(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Replace the HW content with 7 primary problems (more than the
    # MAX_SAMPLE cap of 5). We seed extra approved primaries by
    # cloning the existing one.
    from api.core.integrity_pipeline import MAX_SAMPLE

    extra_ids: list[str] = []
    async with get_session_factory()() as s:
        original = (await s.execute(
            select(QuestionBankItem).where(QuestionBankItem.id == world["primary_id"])
        )).scalar_one()
        for i in range(6):
            clone = QuestionBankItem(
                course_id=original.course_id,
                title=f"Extra {i}",
                question=f"Extra problem {i}",
                solution_steps=[],
                final_answer="x",
                distractors=["a", "b", "c"],
                status="approved",
                source="generated",
            )
            s.add(clone)
            await s.flush()
            extra_ids.append(str(clone.id))
        # Build the new content array: original + 6 extras = 7 total
        new_problems = [str(world["primary_id"])] + extra_ids
        await s.execute(
            text("UPDATE assignments SET content=:c WHERE id=:id"),
            {
                "c": '{"problems": [' + ", ".join(
                    f'{{"bank_item_id": "{p}", "position": {i + 1}}}'
                    for i, p in enumerate(new_problems)
                ) + ']}',
                "id": world["assignment_id"],
            },
        )
        await s.commit()

    r = await _submit(client, world)
    assert r.status_code == 200

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
            .order_by(IntegrityCheckProblem.sample_position.asc())
        )).scalars().all()
        # Capped at MAX_SAMPLE (5), even though the HW has 7 primaries
        assert len(problems) == MAX_SAMPLE
        # Sample positions are 0..MAX_SAMPLE-1 in order
        assert [p.sample_position for p in problems] == list(range(MAX_SAMPLE))


async def test_submit_with_zero_primaries_no_error(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Empty the assignment's content
    async with get_session_factory()() as s:
        await s.execute(
            text("UPDATE assignments SET content=:c WHERE id=:id"),
            {"c": '{"problems": []}', "id": world["assignment_id"]},
        )
        await s.commit()

    r = await _submit(client, world)
    # Submit must still succeed even though there's nothing to integrity-check
    assert r.status_code == 200

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r.json()["submission_id"])
        )).scalars().all()
        assert problems == []


async def test_pipeline_failure_does_not_roll_back_submission(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Force the stub to throw. The submission must still land.
    with patch(
        "api.core.integrity_pipeline.extract_student_work",
        side_effect=RuntimeError("simulated pipeline failure"),
    ):
        r = await _submit(client, world)

    assert r.status_code == 200
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        # Submission row exists
        sub_rows = (await s.execute(
            text("SELECT id FROM submissions WHERE id=:id"),
            {"id": submission_id},
        )).all()
        assert len(sub_rows) == 1
        # No integrity rows because the pipeline failed
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == submission_id)
        )).scalars().all()
        assert problems == []


async def test_resubmit_does_not_duplicate_integrity_rows(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # First submit creates rows.
    r1 = await _submit(client, world)
    assert r1.status_code == 200

    # Second submit is rejected at the application layer (409),
    # so the pipeline never re-runs anyway. Confirm there's still
    # exactly one set of integrity rows for this student's submission.
    r2 = await _submit(client, world)
    assert r2.status_code == 409

    async with get_session_factory()() as s:
        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == r1.json()["submission_id"])
        )).scalars().all()
        assert len(problems) == 1


async def test_get_state_after_submit_returns_in_progress(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["overall_status"] == "in_progress"
    assert len(body["problems"]) == 1
    p = body["problems"][0]
    assert p["question_count"] == 2
    assert p["answered_count"] == 0
    assert p["status"] == "awaiting_student"


async def test_get_state_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["outsider_token"]),
    )
    assert r.status_code == 404


async def test_get_next_returns_first_unanswered(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}/next",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["done"] is False
    assert body["question_index"] == 0
    assert body["problem_position"] == 1
    assert body["total_problems"] == 1
    assert body["questions_in_problem"] == 2
    assert "question_text" in body
    assert "question_id" in body


async def test_answer_happy_path_advances_and_scores(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    # Get question 1
    nxt = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}/next",
        headers=_auth(world["student_token"]),
    )).json()
    q1_id = nxt["question_id"]

    # Submit a "good" answer (>= 30 chars per the stub)
    long_answer = "I factored the quadratic into two binomials and set each to zero."
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/answer",
        headers=_auth(world["student_token"]),
        json={"question_id": q1_id, "answer": long_answer},
    )
    assert r.status_code == 200
    nxt2 = r.json()
    # Should now be on question 2
    assert nxt2["done"] is False
    assert nxt2["question_index"] == 1
    assert nxt2["question_id"] != q1_id

    # Answer question 2 → done + badge computed
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/answer",
        headers=_auth(world["student_token"]),
        json={"question_id": nxt2["question_id"], "answer": long_answer},
    )
    assert r.status_code == 200
    assert r.json() == {"done": True}

    # Verify problem is now complete + has a badge
    state = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}",
        headers=_auth(world["student_token"]),
    )).json()
    assert state["overall_status"] == "complete"
    p = state["problems"][0]
    assert p["status"] == "complete"
    assert p["answered_count"] == 2

    # And badge is "likely" (both answers were "good")
    async with get_session_factory()() as s:
        problem = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == submission_id)
        )).scalar_one()
        assert problem.badge == "likely"
        assert problem.raw_score == 1.0
        assert problem.ai_reasoning is not None


async def test_answer_rejects_short_answers(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    nxt = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}/next",
        headers=_auth(world["student_token"]),
    )).json()

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/answer",
        headers=_auth(world["student_token"]),
        json={"question_id": nxt["question_id"], "answer": "x"},
    )
    assert r.status_code == 400


async def test_answer_idempotent_overwrites_previous(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    nxt = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}/next",
        headers=_auth(world["student_token"]),
    )).json()
    q_id = nxt["question_id"]

    # First answer: weak (5..29 chars)
    await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/answer",
        headers=_auth(world["student_token"]),
        json={"question_id": q_id, "answer": "short answer"},
    )

    # Re-answer the SAME question id with a "good" answer — overwrites
    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/answer",
        headers=_auth(world["student_token"]),
        json={
            "question_id": q_id,
            "answer": "I factored the quadratic into two binomials and solved each.",
        },
    )
    assert r.status_code == 200

    async with get_session_factory()() as s:
        response = (await s.execute(
            select(IntegrityCheckResponse).where(IntegrityCheckResponse.id == q_id)
        )).scalar_one()
        # Verdict should now be "good", not "weak"
        assert response.answer_verdict == "good"


async def test_answer_404_for_outsider(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    nxt = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}/next",
        headers=_auth(world["student_token"]),
    )).json()

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/answer",
        headers=_auth(world["outsider_token"]),
        json={
            "question_id": nxt["question_id"],
            "answer": "long enough answer here",
        },
    )
    assert r.status_code == 404


async def test_rephrase_endpoint_removed(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """The rephrase endpoint was removed in PR 4."""
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/rephrase",
        headers=_auth(world["student_token"]),
        json={"question_id": "00000000-0000-0000-0000-000000000000"},
    )
    # Expect 404 or 405 — the route no longer exists
    assert r.status_code in (404, 405)


async def test_resume_returns_same_question_after_partial(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    """A kid who answers question 0 and then leaves should resume at
    question 1 — not get question 0 again."""
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    nxt = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}/next",
        headers=_auth(world["student_token"]),
    )).json()
    q1_id = nxt["question_id"]

    await client.post(
        f"/v1/school/student/integrity/submissions/{submission_id}/answer",
        headers=_auth(world["student_token"]),
        json={
            "question_id": q1_id,
            "answer": "I solved it step by step over the course of a few minutes.",
        },
    )

    # "Quit" — fetch next again, should be question 1 (not 0)
    nxt2 = (await client.get(
        f"/v1/school/student/integrity/submissions/{submission_id}/next",
        headers=_auth(world["student_token"]),
    )).json()
    assert nxt2["done"] is False
    assert nxt2["question_index"] == 1
    assert nxt2["question_id"] != q1_id


# ── Teacher endpoints ──

async def test_teacher_get_integrity_detail(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    r = await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["overall_status"] == "in_progress"
    assert len(body["problems"]) == 1
    p = body["problems"][0]
    assert p["badge"] is None  # not yet scored
    assert len(p["responses"]) == 2
    assert all(r["student_answer"] is None for r in p["responses"])


async def test_teacher_get_integrity_403_for_other_teacher(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        from api.core.auth import create_access_token, hash_password
        from api.models.user import User
        other = User(
            email=f"other_t_{__import__('uuid').uuid4().hex[:6]}@t.com",
            password_hash=hash_password("x"),
            grade_level=12,
            role="teacher",
            name="OT",
        )
        s.add(other)
        await s.commit()
        other_token = create_access_token(str(other.id), "teacher")

    r = await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(other_token),
    )
    assert r.status_code == 403


async def test_teacher_dismiss_marks_problem(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    detail = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    problem_id = detail["problems"][0]["problem_id"]

    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/dismiss",
        headers=_auth(world["teacher_token"]),
        json={"problem_id": problem_id, "reason": "AI question was bad"},
    )
    assert r.status_code == 204

    detail2 = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    p = detail2["problems"][0]
    assert p["teacher_dismissed"] is True
    assert p["teacher_dismissal_reason"] == "AI question was bad"
    assert p["status"] == "dismissed"

    # Re-dismiss with a different reason updates the reason (the
    # earlier impl silently dropped the new value via an `if not
    # already_dismissed` guard — reverted that to allow updates).
    r = await client.post(
        f"/v1/teacher/integrity/submissions/{submission_id}/dismiss",
        headers=_auth(world["teacher_token"]),
        json={"problem_id": problem_id, "reason": "actually it was a typo in the rubric"},
    )
    assert r.status_code == 204

    detail3 = (await client.get(
        f"/v1/teacher/integrity/submissions/{submission_id}",
        headers=_auth(world["teacher_token"]),
    )).json()
    p = detail3["problems"][0]
    assert p["teacher_dismissed"] is True
    assert p["teacher_dismissal_reason"] == "actually it was a typo in the rubric"


async def test_pipeline_idempotent_on_direct_re_call(
    client: AsyncClient, world: dict[str, Any]
) -> None:
    # Submit once via the API (creates one set of rows), then call
    # start_integrity_check directly with the same submission_id —
    # the idempotency guard should bail and the row count should
    # stay at 1.
    from api.core.integrity_pipeline import start_integrity_check
    from api.models.assignment import Submission

    r = await _submit(client, world)
    submission_id = r.json()["submission_id"]

    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).where(Submission.id == submission_id)
        )).scalar_one()
        # Second call must be a no-op
        await start_integrity_check(sub.id, s)
        await s.commit()

        problems = (await s.execute(
            select(IntegrityCheckProblem)
            .where(IntegrityCheckProblem.submission_id == sub.id)
        )).scalars().all()
        # Still exactly one row (the seeded HW has 1 primary)
        assert len(problems) == 1
