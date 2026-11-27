"""GET /v1/admin/unit-economics — the figures the margin simulator seeds
itself from, and the calls whose submission was deleted.

Split from test_admin_unit_economics.py (which is past the file-size
rule); it reuses that file's seed.

- A grading/reading call whose submission is gone is SUBMISSION cost. It
  must raise what one submission costs, and never land in self-study,
  where it would be charged to every active student as a monthly rate.
- Usage rates (homeworks per student per month, students per teacher)
  are measured over the window, so the simulator never defaults to a
  guess six times what schools actually do.
- Each stage's model picker defaults to the model that actually carried
  that stage's spend in the window.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.model_pricing import cost_usd
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.models.section import Section
from api.models.user import User
from tests.test_admin_unit_economics import (
    _OPUS,
    _get,
    _hw_cost,
    _price,
    _seed,
    _unit,
)

_WHEN = datetime.now(UTC) - timedelta(days=2)


def _deleted_call_cost() -> float:
    return cost_usd(_price(_OPUS), 4200, 850, 1000, 0)


async def _add_deleted_submission_calls(w, count: int) -> None:  # type: ignore[no-untyped-def]
    """`count` reads whose submission was deleted (submission_id SET NULL)."""
    async with get_session_factory()() as s:
        for i in range(count):
            s.add(
                LLMCall(
                    function="integrity_extract", model=_OPUS,
                    input_tokens=4200, output_tokens=850,
                    cache_read_tokens=1000, cache_write_tokens=0,
                    latency_ms=10.0, cost_usd=_deleted_call_cost(), success=True,
                    school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]),
                    submission_id=None, created_at=_WHEN,
                ),
            )
        await s.commit()


async def test_deleted_submission_calls_are_never_self_study(
    client: AsyncClient,
) -> None:
    w = await _seed(homework_submissions=6)
    await _add_deleted_submission_calls(w, 3)

    body = await _get(client, w.admin_id, days=30)

    self_study = _unit(body, "residual:student")
    assert self_study["n"] == 0
    assert self_study["cost_total"] == 0.0
    assert "residual:student" not in body["functions_by_unit"]


async def test_deleted_submission_calls_raise_the_per_submission_cost(
    client: AsyncClient,
) -> None:
    """3 deleted reads spread over the window's 6 surviving submissions."""
    w = await _seed(homework_submissions=6, test_submissions=0)
    await _add_deleted_submission_calls(w, 3)

    body = await _get(client, w.admin_id, days=30)

    overhead = 3 * _deleted_call_cost() / 6
    hw = _unit(body, "submission:homework")
    assert hw["n"] == 6
    assert hw["cost_median"] == pytest.approx(_hw_cost() + overhead)
    assert hw["cost_total"] == pytest.approx(6 * _hw_cost() + 3 * _deleted_call_cost())

    # The per-function legs carry it too, so the simulator's sum still
    # reconstructs the headline unit cost.
    fns = body["functions_by_unit"]["submission:homework"]
    assert sum(f["cost_per_unit"] for f in fns) == pytest.approx(hw["cost_mean"])
    read = next(f for f in fns if f["function"] == "integrity_extract")
    assert read["calls_per_unit"] == pytest.approx(1 + 3 / 6)

    assert body["deleted_submissions"] == {
        "calls": 3,
        "cost_usd": pytest.approx(3 * _deleted_call_cost()),
        "per_submission_usd": pytest.approx(overhead),
        "spread_over_submissions": 6,
    }


async def test_deleted_overhead_is_shared_pro_rata_across_kinds(
    client: AsyncClient,
) -> None:
    """Which kind a deleted submission was is unknowable; every surviving
    submission carries the same share, whatever its kind."""
    w = await _seed(homework_submissions=6, test_submissions=2)
    # Every kind costs the same before the overhead, so equal shares show.
    await _add_deleted_submission_calls(w, 4)

    body = await _get(client, w.admin_id, days=30)

    overhead = 4 * _deleted_call_cost() / 8
    hw = _unit(body, "submission:homework")
    test = _unit(body, "submission:test")
    assert hw["cost_median"] == pytest.approx(_hw_cost() + overhead)
    assert test["cost_median"] == pytest.approx(_hw_cost() + overhead)
    total_cost = sum(
        f["cost_per_unit"] * u["n"]
        for u in (hw, test)
        for f in body["functions_by_unit"][u["kind"]]
    )
    assert total_cost == pytest.approx(8 * _hw_cost() + 4 * _deleted_call_cost())


# --------------------------------------------------------------------------
# Measured usage rates — what the simulator defaults to
# --------------------------------------------------------------------------

async def _add_user(role: str, school_id: str | None) -> uuid.UUID:
    async with get_session_factory()() as s:
        u = User(
            email=f"x_{uuid.uuid4().hex[:8]}@t.com", password_hash="x",
            grade_level=10, role=role, name="X",
            school_id=uuid.UUID(school_id) if school_id else None,
        )
        s.add(u)
        await s.commit()
        return u.id


async def _add_homework_submission(w, student_id: str, when: datetime) -> None:  # type: ignore[no-untyped-def]
    async with get_session_factory()() as s:
        first = (await s.execute(
            select(Assignment).where(Assignment.type == "homework").limit(1),
        )).scalar_one()
        # A fresh homework each time: one submission per student per
        # assignment is a constraint.
        hw = Assignment(
            course_id=first.course_id, teacher_id=first.teacher_id,
            title="another", type="homework", total_points=10,
        )
        s.add(hw)
        await s.flush()
        section = (await s.execute(select(Section).limit(1))).scalar_one()
        s.add(Submission(
            assignment_id=hw.id, student_id=uuid.UUID(student_id),
            section_id=section.id, status="submitted", submitted_at=when,
        ))
        await s.commit()


async def test_homeworks_per_student_month_is_measured(client: AsyncClient) -> None:
    """7 homeworks by 6 students over a 30-day window = 7/6 a month —
    the simulator's default, not a typed-in guess."""
    w = await _seed(homework_submissions=6, test_submissions=0)
    await _add_homework_submission(w, w.student_ids[0], _WHEN)

    m = (await _get(client, w.admin_id, days=30))["measured"]

    assert m["active_students"] == 6
    assert m["submissions"]["homework"] == 7
    assert m["submissions_per_student_month"]["homework"] == pytest.approx(7 / 6, rel=1e-3)
    assert m["submissions_per_student_month"]["test"] == 0.0


async def test_rate_is_per_month_whatever_the_window(client: AsyncClient) -> None:
    """The same 6 homeworks read over 15 days is twice the monthly rate."""
    w = await _seed(homework_submissions=6, test_submissions=0)
    m = (await _get(client, w.admin_id, days=15))["measured"]
    assert m["submissions_per_student_month"]["homework"] == pytest.approx(2.0, rel=1e-3)


async def test_rates_leave_out_internal_users_and_old_submissions(
    client: AsyncClient,
) -> None:
    w = await _seed(homework_submissions=6, test_submissions=0)
    internal = await _add_user("student", None)
    await _add_homework_submission(w, str(internal), _WHEN)
    await _add_homework_submission(w, w.student_ids[0], _WHEN - timedelta(days=60))
    await _add_user("teacher", None)

    m = (await _get(client, w.admin_id, days=30))["measured"]

    assert m["active_students"] == 6
    assert m["submissions"]["homework"] == 6
    assert m["teachers"] == 1
    assert m["students"] == 6
    assert m["students_per_teacher"] == pytest.approx(6.0)


async def test_no_submissions_is_null_not_zero(client: AsyncClient) -> None:
    """No one handed anything in: the rate is unknown, not 0 a month."""
    w = await _seed(homework_submissions=6, test_submissions=0)
    m = (await _get(client, w.admin_id, days=1))["measured"]
    assert m["active_students"] == 0
    assert m["submissions_per_student_month"]["homework"] is None


# --------------------------------------------------------------------------
# The model each stage actually ran on — what the pickers default to
# --------------------------------------------------------------------------

async def test_models_in_use_is_what_ran_per_stage(client: AsyncClient) -> None:
    """The seed reads on Opus and grades on Sonnet; the pickers must start
    there, not on whatever the catalog lists first."""
    w = await _seed(homework_submissions=6)
    body = await _get(client, w.admin_id, days=30)

    used = body["models_in_use"]
    assert used["vision"]["catalog_id"] == "claude-opus-5-5"
    assert used["grading"]["catalog_id"] == "claude-sonnet-4-6"
    assert "other" not in used


async def test_models_in_use_follows_spend_not_call_count(
    client: AsyncClient,
) -> None:
    """Twenty tiny Haiku grading calls don't make Haiku the grader when
    Sonnet carried the spend."""
    w = await _seed(homework_submissions=6, test_submissions=0)
    async with get_session_factory()() as s:
        for _ in range(20):
            s.add(LLMCall(
                function="ai_grading", model="claude-haiku-4-5",
                input_tokens=10, output_tokens=5, latency_ms=1.0,
                cost_usd=0.00001, success=True,
                school_id=uuid.UUID(w.school_id),
                user_id=uuid.UUID(w.student_ids[0]), created_at=_WHEN,
            ))
        await s.commit()

    used = (await _get(client, w.admin_id, days=30))["models_in_use"]
    assert used["grading"]["catalog_id"] == "claude-sonnet-4-6"


async def test_each_function_names_its_stage(client: AsyncClient) -> None:
    """decompose writes a generated problem's solution inside a job and
    tutors a student outside one — the stage comes from the server."""
    w = await _seed(homework_submissions=6, generation_units=1)
    async with get_session_factory()() as s:
        job = (await s.execute(select(QuestionBankGenerationJob).limit(1))).scalar_one()
        for in_job in (True, False):
            s.add(LLMCall(
                function="decompose", model="claude-sonnet-4-6",
                input_tokens=100, output_tokens=50, latency_ms=1.0,
                cost_usd=0.001, success=True,
                school_id=uuid.UUID(w.school_id),
                user_id=uuid.UUID(w.student_ids[0] if not in_job else w.teacher_id),
                generation_job_id=job.id if in_job else None, created_at=_WHEN,
            ))
        await s.commit()

    fns = (await _get(client, w.admin_id, days=30))["functions_by_unit"]

    def family(unit: str, fn: str) -> str:
        return next(f["family"] for f in fns[unit] if f["function"] == fn)

    assert family("generation:unit", "decompose") == "generation"
    assert family("residual:student", "decompose") == "tutoring"
    assert family("submission:homework", "integrity_extract") == "vision"
    assert family("submission:homework", "ai_grading") == "grading"
