"""Explicit LLM-call → generation-job cost link.

An LLMCall now carries `generation_job_id`, an EXPLICIT FK to the job it
was made in service of, so admin cost attribution is exact per generation
instead of a time-window heuristic that misattributes when two jobs
overlap.

Covers:
1. A full generation run stamps the job id on the question-gen call AND
   the per-problem `decompose` solution + `practice_eval` distractor calls
   (those dominate cost, so cost/homework is only complete with them).
2. The persistence layer writes the FK onto the row.
3. `_correlate_costs` sums by the exact FK — an overlapping-window call
   linked to job A is NOT stolen by job B — and still falls back to the
   time-window heuristic for unlinked (NULL) calls.
4. The new kwarg is metadata-only: the model request payload is
   byte-identical with vs without it, and the harness cassette key is
   unchanged (so existing recordings still replay).
"""

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import select, text

from api.core.auth import hash_password
from api.core.llm_client import LLMMode, call_claude_json
from api.core.llm_logging import persist_llm_call
from api.core.llm_schemas import DECOMPOSITION_SCHEMA
from api.core.question_bank_generation import _run_generation
from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.course import Course, CourseTeacher
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.models.unit import Unit
from api.models.user import User
from api.routes.admin_generation import _correlate_costs


async def _seed_generatable_job() -> uuid.UUID:
    """A queued generate-mode job (no source docs) ready for _run_generation."""
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_bank_items, question_bank_generation_jobs, "
            "llm_calls, documents, assignments, units, course_teachers, courses, "
            "users CASCADE"
        ))
        await s.commit()
    async with get_session_factory()() as s:
        teacher = User(
            email=f"t_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="T",
        )
        s.add(teacher)
        await s.flush()
        course = Course(name=f"Alg {tag}", subject="math")
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="draft", content={"problems": []},
        )
        s.add(assignment)
        await s.flush()
        job = QuestionBankGenerationJob(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id, created_by_id=teacher.id,
            mode="generate", status="queued", requested_count=1,
        )
        s.add(job)
        await s.commit()
        return job.id


@pytest.mark.asyncio
async def test_generation_run_stamps_job_id_on_every_call() -> None:
    """The question-gen, decompose, and practice_eval calls made while
    producing one generation ALL carry the job id — proving the id threads
    through generate_questions, generate_solutions→decompose_problem, and
    generate_distractors, not just the top-level question call."""
    job_id = await _seed_generatable_job()

    # A unique problem body so decompose_problem's text cache can't short
    # circuit the call (a cache hit would skip the LLM call entirely).
    unique_q = f"What is {uuid.uuid4().hex[:8]} + 1?"
    captured: list[tuple[str, str | None]] = []

    async def fake_json(*args: Any, **kwargs: Any) -> dict[str, Any]:
        mode = kwargs["mode"]
        captured.append((mode, kwargs.get("generation_job_id")))
        if mode == LLMMode.GENERATE_QUESTIONS:
            return {"questions": [
                {"title": "Q1", "text": unique_q, "difficulty": "easy"},
            ]}
        if mode == LLMMode.DECOMPOSE:
            return {
                "steps": [{"title": "Add", "description": "Sum the terms."}],
                "final_answer": "5", "answer_type": "text",
            }
        if mode == LLMMode.PRACTICE_EVAL:
            return {"distractors": ["3", "6", "7"]}
        raise AssertionError(f"unexpected mode {mode}")

    with (
        patch("api.core.assignment_generation.call_claude_json", side_effect=fake_json),
        patch("api.core.step_decomposition.call_claude_json", side_effect=fake_json),
        patch("api.core.practice.call_claude_json", side_effect=fake_json),
    ):
        async with get_session_factory()() as s:
            job = (await s.execute(
                select(QuestionBankGenerationJob).where(
                    QuestionBankGenerationJob.id == job_id,
                )
            )).scalar_one()
            await _run_generation(s, job)

    by_mode = {mode: gid for mode, gid in captured}
    # All three cost-bearing call types fired, each stamped with the job id.
    assert by_mode[LLMMode.GENERATE_QUESTIONS] == str(job_id)
    assert by_mode[LLMMode.DECOMPOSE] == str(job_id), "solution call must be stamped"
    assert by_mode[LLMMode.PRACTICE_EVAL] == str(job_id), "distractor call must be stamped"


@pytest.mark.asyncio
async def test_persist_llm_call_writes_generation_job_id() -> None:
    """The logging layer resolves the string id to the FK column."""
    job_id = await _seed_generatable_job()
    async with get_session_factory()() as s:
        creator = (await s.execute(
            select(QuestionBankGenerationJob.created_by_id).where(
                QuestionBankGenerationJob.id == job_id,
            )
        )).scalar_one()

    await persist_llm_call(
        model="claude-x", function="decompose",
        input_tokens=10, output_tokens=20, latency_ms=1.0, cost_usd=0.01,
        user_id=str(creator), generation_job_id=str(job_id),
    )

    async with get_session_factory()() as s:
        row = (await s.execute(
            select(LLMCall).where(LLMCall.generation_job_id == job_id)
        )).scalar_one()
    assert row.generation_job_id == job_id
    assert row.function == "decompose"


@pytest.mark.asyncio
async def test_correlate_costs_uses_fk_exactly_across_overlapping_jobs() -> None:
    """Two jobs whose run windows overlap: a call linked to A stays with A
    even though it also falls inside B's window (exact FK beats the time
    heuristic), while an unlinked (NULL) call falls back to the window."""
    tag = uuid.uuid4().hex[:6]
    t0 = datetime.now(UTC)
    async with get_session_factory()() as s:
        await s.execute(text(
            "TRUNCATE TABLE question_bank_generation_jobs, llm_calls, "
            "assignments, units, courses, users CASCADE"
        ))
        await s.commit()
    async with get_session_factory()() as s:
        teacher = User(
            email=f"ct_{tag}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="T",
        )
        s.add(teacher)
        await s.flush()
        course = Course(name=f"C {tag}", subject="math")
        s.add(course)
        await s.flush()
        unit = Unit(course_id=course.id, name="U", position=0)
        s.add(unit)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="HW", type="homework", status="draft", content={"problems": []},
        )
        s.add(assignment)
        await s.flush()

        # Overlapping windows: A [t0, t0+10s], B [t0+2s, t0+12s].
        job_a = QuestionBankGenerationJob(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id, created_by_id=teacher.id,
            mode="generate", status="done", requested_count=1,
            created_at=t0, updated_at=t0 + timedelta(seconds=10),
        )
        job_b = QuestionBankGenerationJob(
            course_id=course.id, unit_id=unit.id,
            originating_assignment_id=assignment.id, created_by_id=teacher.id,
            mode="generate", status="done", requested_count=1,
            created_at=t0 + timedelta(seconds=2), updated_at=t0 + timedelta(seconds=12),
        )
        s.add_all([job_a, job_b])
        await s.flush()
        a_id, b_id = job_a.id, job_b.id

        mid = t0 + timedelta(seconds=5)  # inside BOTH windows
        # Linked to A, but sitting inside B's window too.
        s.add(LLMCall(
            function="generate_questions", model="m", input_tokens=1, output_tokens=1,
            latency_ms=1.0, cost_usd=0.10, user_id=teacher.id, success=True,
            generation_job_id=a_id, created_at=mid,
        ))
        # Linked to B.
        s.add(LLMCall(
            function="decompose", model="m", input_tokens=1, output_tokens=1,
            latency_ms=1.0, cost_usd=0.20, user_id=teacher.id, success=True,
            generation_job_id=b_id, created_at=mid,
        ))
        # Unlinked (NULL) call in the overlap → time-window fallback lands
        # it in the latest-started job that contains it (B).
        s.add(LLMCall(
            function="practice_eval", model="m", input_tokens=1, output_tokens=1,
            latency_ms=1.0, cost_usd=0.05, user_id=teacher.id, success=True,
            generation_job_id=None, created_at=mid,
        ))
        await s.commit()

    async with get_session_factory()() as s:
        jobs = list((await s.execute(
            select(QuestionBankGenerationJob).where(
                QuestionBankGenerationJob.id.in_([a_id, b_id])
            )
        )).scalars().all())
        cost = await _correlate_costs(s, jobs)

    # A gets ONLY its linked call, despite the call being inside B's window.
    assert cost[a_id] == pytest.approx((0.10, 1))
    # B gets its linked call + the unlinked fallback call.
    assert cost[b_id][1] == 2
    assert cost[b_id][0] == pytest.approx(0.25)


@pytest.mark.asyncio
async def test_generation_job_id_does_not_change_model_payload() -> None:
    """Metadata-only guarantee: the request sent to Anthropic is
    byte-identical with vs without generation_job_id, and the value only
    reaches the logging sidecar."""
    create_calls: list[dict[str, Any]] = []
    logged: list[str | None] = []

    async def fake_create(**kwargs: Any) -> Any:
        create_calls.append(kwargs)
        return SimpleNamespace(
            stop_reason="tool_use",
            content=[SimpleNamespace(type="tool_use", name="x", input={"ok": 1})],
            usage=SimpleNamespace(input_tokens=3, output_tokens=4),
        )

    async def capture_log(*args: Any, **kwargs: Any) -> None:
        logged.append(kwargs.get("generation_job_id"))

    fake_client = SimpleNamespace(messages=SimpleNamespace(create=fake_create))
    common: dict[str, Any] = dict(
        system_prompt="sys", user_message="usr", mode="decompose",
        tool_schema=DECOMPOSITION_SCHEMA, user_id=str(uuid.uuid4()),
    )
    with (
        patch("api.core.llm_client.get_client", return_value=fake_client),
        patch("api.core.llm_client._log_and_persist", side_effect=capture_log),
    ):
        await call_claude_json(**common, generation_job_id=None)
        await call_claude_json(**common, generation_job_id=str(uuid.uuid4()))

    assert len(create_calls) == 2
    # The Anthropic request payload is identical — the id is nowhere in it.
    assert create_calls[0] == create_calls[1]
    assert not any("generation_job_id" in c for c in create_calls)
    # ...yet it did reach the logging layer on the second call.
    assert logged[0] is None
    assert logged[1] is not None


def test_cassette_key_ignores_generation_job_id() -> None:
    """The harness cassette key must exclude generation_job_id so adding it
    doesn't invalidate existing recordings (they'd miss on replay)."""
    from tests.harness.cassette import Cassette, build_identity

    base = {
        "system_prompt": "s", "user_message": "u", "mode": "decompose",
        "model": None,
    }
    ident_without = build_identity(dict(base), "model-x")
    ident_with = build_identity({**base, "generation_job_id": str(uuid.uuid4())}, "model-x")
    cas = Cassette.__new__(Cassette)  # key() needs no state
    assert cas.key("call_claude_json", ident_without) == cas.key(
        "call_claude_json", ident_with
    )
