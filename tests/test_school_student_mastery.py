"""Integration tests for the Mastery Loop endpoints.

  GET  /v1/school/student/practice/{assignment_id}/overview
  GET  /v1/school/student/practice/{assignment_id}/next-problem
  POST /v1/school/student/problems/{bank_item_id}/answer
  POST /v1/school/student/problems/{bank_item_id}/walkthrough-opened
  GET  /v1/school/student/problems/{bank_item_id}/chat
  POST /v1/school/student/problems/{bank_item_id}/chat

The `world` fixture seeds a HW + primary; we layer a published
practice set with three approved variations on top so the four
endpoints can be exercised end-to-end. LLM calls are mocked at the
tutor layer so the chat endpoint runs deterministically without
hitting Claude.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.question_bank import QuestionBankItem
from api.models.student_problem_mastery import StudentProblemMastery
from tests.conftest import auth_headers as _auth


async def _seed_practice(world: dict[str, Any]) -> dict[str, Any]:
    """Publish a practice set cloned from the world HW with three
    approved problems. Returns the ids tests assert on."""
    async with get_session_factory()() as s:
        source_hw = (await s.execute(
            select(Assignment).where(Assignment.id == world["assignment_id"])
        )).scalar_one()

        practice = Assignment(
            course_id=source_hw.course_id,
            unit_ids=list(source_hw.unit_ids or []),
            teacher_id=world["teacher_id"],
            title=f"{source_hw.title} Practice",
            type="practice",
            status="published",
            source_homework_id=source_hw.id,
            content=None,
        )
        s.add(practice)
        await s.flush()

        problems: list[QuestionBankItem] = []
        for i in range(3):
            p = QuestionBankItem(
                course_id=source_hw.course_id,
                unit_id=world["unit_id"],
                originating_assignment_id=practice.id,
                title=f"Practice problem {i + 1}",
                question=f"What is {i + 2} + {i + 3}?",
                solution_steps=[
                    {"title": "Add", "description": f"{i + 2} plus {i + 3}"},
                ],
                final_answer=f"{(i + 2) + (i + 3)}",
                distractors=[f"{(i + 2) + (i + 3) + 1}", "x", "y"],
                status="approved",
                source="practice",
                format="mcq",
            )
            s.add(p)
            problems.append(p)
        await s.flush()

        section_id = (await s.execute(
            text(
                "SELECT section_id FROM assignment_sections "
                "WHERE assignment_id=:aid LIMIT 1"
            ),
            {"aid": world["assignment_id"]},
        )).scalar_one()
        s.add(AssignmentSection(
            assignment_id=practice.id,
            section_id=section_id,
            published_at=datetime.now(UTC),
        ))
        await s.commit()
        return {
            "practice_id": practice.id,
            "problem_ids": [p.id for p in problems],
            "answers": [p.final_answer for p in problems],
        }


# ── overview ──


async def test_overview_returns_problems_with_not_started_default(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    r = await client.get(
        f"/v1/school/student/practice/{p['practice_id']}/overview",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assignment_id"] == str(p["practice_id"])
    assert len(body["problems"]) == 3
    assert body["mastered_count"] == 0
    assert body["in_progress_count"] == 0
    assert body["not_started_count"] == 3
    for prob in body["problems"]:
        assert prob["mastery_state"] == "not_started"
        assert prob["attempts"] == 0
        # Answer-leak regression: overview must never ship the correct
        # answer, distractors, or solution_step bodies pre-attempt. If
        # any of these come back, the dot map becomes a spoiler.
        assert "final_answer" not in prob
        assert "distractors" not in prob
        assert "solution_steps" not in prob
        # MCQ rendering data IS allowed because knowing the four
        # choices (with the correct one mixed in) doesn't reveal which
        # is correct.
        assert len(prob["mcq_choices"]) == 4
        assert prob["step_count"] == 1


async def test_overview_404_for_outsider(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    r = await client.get(
        f"/v1/school/student/practice/{p['practice_id']}/overview",
        headers=_auth(world["outsider_token"]),
    )
    # _load_practice_for_student returns 403 on not-enrolled rather
    # than 404 — the practice exists, the student is just locked out.
    assert r.status_code == 403


async def test_overview_404_when_pointed_at_homework(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The HW assignment id is a published assignment, but the
    Mastery endpoint should refuse it because it's the wrong type."""
    r = await client.get(
        f"/v1/school/student/practice/{world['assignment_id']}/overview",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 404


# ── next-problem ──


async def test_next_problem_returns_first_unmastered(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    r = await client.get(
        f"/v1/school/student/practice/{p['practice_id']}/next-problem",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "served"
    assert body["problem"]["position"] == 1


async def test_next_problem_complete_when_all_mastered(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Pre-stamp all three problems as mastered; resume target should
    be `complete`."""
    p = await _seed_practice(world)
    async with get_session_factory()() as s:
        for pid in p["problem_ids"]:
            s.add(StudentProblemMastery(
                student_id=world["student_id"],
                bank_item_id=pid,
                state="mastered",
                attempts=1,
                first_attempt_at=datetime.now(UTC),
                first_attempt_was_correct=True,
                last_attempt_at=datetime.now(UTC),
                last_correct_at=datetime.now(UTC),
            ))
        await s.commit()

    r = await client.get(
        f"/v1/school/student/practice/{p['practice_id']}/next-problem",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "complete"}


# ── answer ──


async def test_answer_correct_first_try_grants_mastery(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/answer",
        headers=_auth(world["student_token"]),
        json={"selected_choice": p["answers"][0]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_correct"] is True
    assert body["mastery_state_after"] == "mastered"
    assert body["attempts_after"] == 1


async def test_answer_wrong_lands_missed(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/answer",
        headers=_auth(world["student_token"]),
        json={"selected_choice": "totally wrong"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_correct"] is False
    assert body["mastery_state_after"] == "missed"


async def test_answer_then_correct_after_miss_is_attempted_not_mastered(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    # First: wrong.
    r = await client.post(
        f"/v1/school/student/problems/{pid}/answer",
        headers=_auth(world["student_token"]),
        json={"selected_choice": "wrong"},
    )
    assert r.json()["mastery_state_after"] == "missed"
    # Then: correct.
    r = await client.post(
        f"/v1/school/student/problems/{pid}/answer",
        headers=_auth(world["student_token"]),
        json={"selected_choice": p["answers"][0]},
    )
    body = r.json()
    assert body["mastery_state_after"] == "attempted"
    assert body["attempts_after"] == 2


async def test_answer_404_for_outsider(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/answer",
        headers=_auth(world["outsider_token"]),
        json={"selected_choice": p["answers"][0]},
    )
    assert r.status_code == 404


# ── walkthrough-opened ──


async def test_walkthrough_opened_blocks_mastery(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    # Open walkthrough first.
    r = await client.post(
        f"/v1/school/student/problems/{pid}/walkthrough-opened",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["mastery_state_after"] == "walked_through"
    # Then answer correctly.
    r = await client.post(
        f"/v1/school/student/problems/{pid}/answer",
        headers=_auth(world["student_token"]),
        json={"selected_choice": p["answers"][0]},
    )
    assert r.json()["mastery_state_after"] == "attempted"


async def test_walkthrough_returns_solution_steps_and_answer(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """The walkthrough response is the only place solution steps and
    the final answer are exposed to the client — opening the
    walkthrough is the moment the student "earns" them."""
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/walkthrough-opened",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mastery_state_after"] == "walked_through"
    assert len(body["solution_steps"]) == 1
    assert body["final_answer"] == p["answers"][0]


async def test_walkthrough_idempotent(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r1 = await client.post(
        f"/v1/school/student/problems/{pid}/walkthrough-opened",
        headers=_auth(world["student_token"]),
    )
    r2 = await client.post(
        f"/v1/school/student/problems/{pid}/walkthrough-opened",
        headers=_auth(world["student_token"]),
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Row count for this student/bank_item should still be exactly 1.
    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(StudentProblemMastery).where(
                StudentProblemMastery.student_id == world["student_id"],
                StudentProblemMastery.bank_item_id == pid,
            )
        )).scalars().all()
    assert len(rows) == 1
    assert rows[0].state == "walked_through"


# ── chat ──


@pytest.fixture
def _mock_tutor_llm() -> Any:
    with patch(
        "api.routes.school_student_mastery.step_chat",
        new_callable=AsyncMock,
    ) as mock_step, patch(
        "api.routes.school_student_mastery.completed_chat",
        new_callable=AsyncMock,
    ) as mock_completed:
        from api.core.tutor import StepChatResult
        mock_step.return_value = StepChatResult(feedback="step reply")
        mock_completed.return_value = StepChatResult(feedback="problem reply")
        yield {"step": mock_step, "completed": mock_completed}


async def test_chat_step_persists_and_returns_reply(
    client: AsyncClient,
    world: dict[str, Any],
    _mock_tutor_llm: Any,
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["student_token"]),
        json={"question": "why add?", "step_index": 0},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == "step reply"

    # History should contain both turns.
    r = await client.get(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["student_token"]),
    )
    msgs = r.json()["messages"]
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "why add?"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == "step reply"


async def test_chat_problem_uses_completed_chat(
    client: AsyncClient,
    world: dict[str, Any],
    _mock_tutor_llm: Any,
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["student_token"]),
        json={"question": "what's going on here?"},
    )
    assert r.status_code == 200
    assert r.json()["reply"] == "problem reply"
    assert _mock_tutor_llm["completed"].await_count == 1
    assert _mock_tutor_llm["step"].await_count == 0


async def test_chat_thread_survives_across_separate_asks(
    client: AsyncClient,
    world: dict[str, Any],
    _mock_tutor_llm: Any,
) -> None:
    """Two asks days apart should land on the same thread — that's
    the whole point of persisting chat. We verify by asking twice
    and reading back four messages."""
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]

    await client.post(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["student_token"]),
        json={"question": "first ask", "step_index": 0},
    )
    await client.post(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["student_token"]),
        json={"question": "follow up later"},
    )
    r = await client.get(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["student_token"]),
    )
    msgs = r.json()["messages"]
    assert len(msgs) == 4
    assert msgs[0]["content"] == "first ask"
    assert msgs[2]["content"] == "follow up later"


async def test_chat_step_index_out_of_range_400(
    client: AsyncClient,
    world: dict[str, Any],
    _mock_tutor_llm: Any,
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["student_token"]),
        json={"question": "?", "step_index": 99},
    )
    assert r.status_code == 400


async def test_chat_404_for_outsider(
    client: AsyncClient,
    world: dict[str, Any],
    _mock_tutor_llm: Any,
) -> None:
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    r = await client.post(
        f"/v1/school/student/problems/{pid}/chat",
        headers=_auth(world["outsider_token"]),
        json={"question": "hi"},
    )
    assert r.status_code == 404


async def test_chat_scoped_per_problem(
    client: AsyncClient,
    world: dict[str, Any],
    _mock_tutor_llm: Any,
) -> None:
    """Two different problems → two independent threads."""
    p = await _seed_practice(world)
    p1, p2 = p["problem_ids"][0], p["problem_ids"][1]

    await client.post(
        f"/v1/school/student/problems/{p1}/chat",
        headers=_auth(world["student_token"]),
        json={"question": "about p1"},
    )

    r = await client.get(
        f"/v1/school/student/problems/{p2}/chat",
        headers=_auth(world["student_token"]),
    )
    assert r.status_code == 200
    assert r.json()["messages"] == []


# ── unauthorized fallthrough sanity ──

async def test_endpoints_require_auth(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    p = await _seed_practice(world)
    r = await client.get(
        f"/v1/school/student/practice/{p['practice_id']}/overview"
    )
    assert r.status_code in (401, 403)
    r = await client.post(
        f"/v1/school/student/problems/{p['problem_ids'][0]}/answer",
        json={"selected_choice": "x"},
    )
    assert r.status_code in (401, 403)


async def test_sequential_walkthrough_then_correct_consistent_with_lock(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """End-to-end version of the state-machine truth-table check:
    walkthrough then correct lands `attempted`, with both atomic
    fields (walkthrough_opened_at, last_correct_at) set on the same
    row. Pins the read-modify-write path under the row lock end-to-
    end. (Truly concurrent two-tab races are exercised by the unit
    tests in test_mastery_state_machine.py; ASGITransport serializes
    awaited HTTP calls so a gather() test here wouldn't actually race
    transactions.)"""
    p = await _seed_practice(world)
    pid = p["problem_ids"][0]
    correct = p["answers"][0]

    await client.post(
        f"/v1/school/student/problems/{pid}/walkthrough-opened",
        headers=_auth(world["student_token"]),
    )
    await client.post(
        f"/v1/school/student/problems/{pid}/answer",
        headers=_auth(world["student_token"]),
        json={"selected_choice": correct},
    )
    async with get_session_factory()() as s:
        rows = (await s.execute(
            select(StudentProblemMastery).where(
                StudentProblemMastery.student_id == world["student_id"],
                StudentProblemMastery.bank_item_id == pid,
            )
        )).scalars().all()
    assert len(rows) == 1
    row = rows[0]
    assert row.state == "attempted"
    assert row.walkthrough_opened_at is not None
    assert row.last_correct_at is not None
    assert row.attempts == 1


async def test_answer_random_bank_item_404(
    client: AsyncClient, world: dict[str, Any],
) -> None:
    """Random/unknown bank_item_id should 404, not 500."""
    r = await client.post(
        f"/v1/school/student/problems/{uuid.uuid4()}/answer",
        headers=_auth(world["student_token"]),
        json={"selected_choice": "x"},
    )
    assert r.status_code == 404
