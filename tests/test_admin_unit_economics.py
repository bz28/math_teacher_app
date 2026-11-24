"""GET /v1/admin/unit-economics — what one of each thing costs us.

The figures on this endpoint feed a pricing conversation with a district,
so the tests are about not lying rather than about shape:

- cost is summed PER SUBMISSION before it is aggregated, so the headline
  is "what one homework costs", not "what one call costs"
- the median leads, because one forty-page photo must not set a rate card
- a thin bucket reports `sufficient: false` and never $0.00 — a zero unit
  cost silently produces a 100% margin
- internal/founder traffic and harness `judge` calls are out by default
- generation amortises over a teaching UNIT, not per job and not per
  assignment, because that is the cost that divides by class size
- the recorded-vs-recomputed reconciliation actually catches a mispriced
  model, which is the check that would have caught the flat cache-read
  multiplier a month earlier
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, Submission
from api.models.course import Course
from api.models.llm_call import LLMCall
from api.models.question_bank import QuestionBankGenerationJob
from api.models.school import School
from api.models.section import Section
from api.models.unit import Unit
from api.models.user import User
from tests.conftest import auth_headers

_NOW = datetime.now(UTC)
_WHEN = _NOW - timedelta(days=2)

# Opus 5.5 rates, so recomputation has something real to land on.
_OPUS = "claude-opus-5-5"
_SONNET = "claude-sonnet-4-6"


class _World:
    """Seeded ids the tests assert against."""

    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


async def _seed(
    *,
    homework_submissions: int = 6,
    test_submissions: int = 1,
    generation_units: int = 0,
    jobs_per_unit: int = 1,
) -> _World:
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "TRUNCATE TABLE llm_calls, question_bank_generation_jobs, "
                "submissions, assignments, units, sections, courses, schools, users "
                "RESTART IDENTITY CASCADE",
            ),
        )
        school = School(
            name="Radnor", contact_name="H", contact_email="h@r.com",
        )
        s.add(school)
        await s.flush()

        admin = User(
            email=f"a_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
            grade_level=99, role="admin", name="A",
        )
        teacher = User(
            email=f"t_{uuid.uuid4().hex[:6]}@t.com", password_hash=hash_password("x"),
            grade_level=99, role="teacher", name="T", school_id=school.id,
        )
        n_students = max(homework_submissions, test_submissions, 1)
        students = [
            User(
                email=f"s{i}_{uuid.uuid4().hex[:6]}@t.com",
                password_hash=hash_password("x"), grade_level=10, role="student",
                name=f"S{i}", school_id=school.id,
            )
            for i in range(n_students)
        ]
        s.add_all([admin, teacher, *students])
        await s.flush()

        course = Course(school_id=school.id, name="Geo", subject="math")
        s.add(course)
        await s.flush()
        section = Section(course_id=course.id, name="Period 1")
        s.add(section)
        await s.flush()
        unit_rows = [
            Unit(course_id=course.id, name=f"Unit {i}", position=i)
            for i in range(max(generation_units, 1))
        ]
        s.add_all(unit_rows)
        await s.flush()

        calls: list[LLMCall] = []

        def _assignment(kind: str) -> Assignment:
            a = Assignment(
                course_id=course.id, teacher_id=teacher.id, title=f"{kind} 1",
                type=kind, unit_ids=[unit_rows[0].id], total_points=10,
            )
            s.add(a)
            return a

        async def _submissions(kind: str, count: int, cost_each: float) -> None:
            if count == 0:
                return
            a = _assignment(kind)
            await s.flush()
            for i in range(count):
                sub = Submission(
                    assignment_id=a.id, student_id=students[i].id,
                    section_id=section.id, status="graded", submitted_at=_WHEN,
                )
                s.add(sub)
                await s.flush()
                # Two calls per submission: vision on Opus, grading on Sonnet.
                # Summing them is what makes the unit cost a SUBMISSION cost.
                calls.append(
                    LLMCall(
                        function="integrity_extract", model=_OPUS,
                        input_tokens=4200, output_tokens=850,
                        cache_read_tokens=1000, cache_write_tokens=0,
                        latency_ms=10.0, cost_usd=cost_each * 0.7, success=True,
                        school_id=school.id, user_id=students[i].id,
                        submission_id=sub.id, created_at=_WHEN,
                    ),
                )
                calls.append(
                    LLMCall(
                        function="ai_grading", model=_SONNET,
                        input_tokens=900, output_tokens=300,
                        cache_read_tokens=0, cache_write_tokens=0,
                        latency_ms=10.0, cost_usd=cost_each * 0.3, success=True,
                        school_id=school.id, user_id=students[i].id,
                        submission_id=sub.id, created_at=_WHEN,
                    ),
                )

        await _submissions("homework", homework_submissions, 0.30)
        await _submissions("test", test_submissions, 0.90)

        # Generation: `jobs_per_unit` jobs against each unit, so the test
        # can prove the endpoint groups by UNIT rather than by job.
        origin = _assignment("homework")
        await s.flush()
        for ui in range(generation_units):
            for _ in range(jobs_per_unit):
                job = QuestionBankGenerationJob(
                    course_id=course.id, unit_id=unit_rows[ui].id,
                    originating_assignment_id=origin.id, created_by_id=teacher.id,
                    mode="generate", status="done", requested_count=5,
                )
                s.add(job)
                await s.flush()
                calls.append(
                    LLMCall(
                        function="generate_questions", model=_SONNET,
                        input_tokens=5000, output_tokens=2000,
                        latency_ms=10.0, cost_usd=0.50, success=True,
                        school_id=school.id, user_id=teacher.id,
                        generation_job_id=job.id, created_at=_WHEN,
                    ),
                )

        s.add_all(calls)
        await s.commit()

        return _World(
            admin_id=str(admin.id), school_id=str(school.id),
            teacher_id=str(teacher.id), student_ids=[str(x.id) for x in students],
            unit_ids=[str(u.id) for u in unit_rows],
        )


async def _get(client: AsyncClient, admin_id: str, **params: Any) -> dict[str, Any]:
    token = create_access_token(admin_id, "admin")
    r = await client.get(
        "/v1/admin/unit-economics", params=params, headers=auth_headers(token),
    )
    assert r.status_code == 200, r.text
    return r.json()


def _unit(body: dict[str, Any], kind: str) -> dict[str, Any]:
    found = [u for u in body["units"] if u["kind"] == kind]
    assert found, f"{kind} missing from {[u['kind'] for u in body['units']]}"
    return found[0]


# --------------------------------------------------------------------------
# Unit costs
# --------------------------------------------------------------------------

async def test_homework_cost_is_per_submission_not_per_call(
    client: AsyncClient,
) -> None:
    """Two calls per homework must sum to one $0.30 unit, not read as $0.15."""
    w = await _seed(homework_submissions=6)
    body = await _get(client, w.admin_id, days=30)

    hw = _unit(body, "submission:homework")
    assert hw["n"] == 6
    assert hw["cost_median"] == pytest.approx(0.30)
    assert hw["sufficient"] is True


async def test_thin_bucket_is_flagged_and_never_reports_zero(
    client: AsyncClient,
) -> None:
    """A $0.00 unit cost would produce a 100% margin. It must not happen."""
    w = await _seed(homework_submissions=6, test_submissions=1)
    body = await _get(client, w.admin_id, days=30, min_sample=5)

    t = _unit(body, "submission:test")
    assert t["n"] == 1
    assert t["sufficient"] is False
    assert t["cost_median"] != 0.0


async def test_absent_kind_reports_null_not_zero(client: AsyncClient) -> None:
    w = await _seed(homework_submissions=6, test_submissions=0)
    body = await _get(client, w.admin_id, days=30)

    quiz = _unit(body, "submission:quiz")
    assert quiz["n"] == 0
    assert quiz["cost_median"] is None, "a missing bucket must not read as $0.00"
    assert quiz["sufficient"] is False


async def test_median_resists_one_enormous_submission(client: AsyncClient) -> None:
    """A forty-page photo is one expensive call; it must not set the rate."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        sub = (
            await s.execute(text("SELECT id FROM submissions LIMIT 1"))
        ).scalar_one()
        await s.execute(
            text("UPDATE llm_calls SET cost_usd = 40.0 WHERE submission_id = :s"),
            {"s": sub},
        )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    hw = _unit(body, "submission:homework")
    assert hw["cost_median"] < 1.0, "median must ignore the outlier"
    assert hw["cost_mean"] > hw["cost_median"], "mean is dragged up, and is shown"
    assert hw["cost_p90"] is not None


# --------------------------------------------------------------------------
# Generation amortises over the unit
# --------------------------------------------------------------------------

async def test_generation_groups_by_teaching_unit_not_by_job(
    client: AsyncClient,
) -> None:
    """Two jobs building one unit are ONE unit cost, summed — not two."""
    w = await _seed(homework_submissions=6, generation_units=2, jobs_per_unit=2)
    body = await _get(client, w.admin_id, days=30)

    gen = _unit(body, "generation:unit")
    assert gen["n"] == 2, "two units, four jobs"
    # 2 jobs x $0.50 per unit.
    assert gen["cost_median"] == pytest.approx(1.0)


# --------------------------------------------------------------------------
# Scope
# --------------------------------------------------------------------------

async def test_internal_traffic_is_excluded_by_default(client: AsyncClient) -> None:
    """Founder and test usage looks like a school's and inflates per-student."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        s.add(
            LLMCall(
                function="integrity_extract", model=_OPUS,
                input_tokens=1, output_tokens=1, latency_ms=1.0, cost_usd=99.0,
                success=True, school_id=None, created_at=_WHEN,
            ),
        )
        await s.commit()

    default = await _get(client, w.admin_id, days=30)
    assert default["reconciliation"]["recorded_usd"] < 50.0

    included = await _get(client, w.admin_id, days=30, exclude_internal=False)
    assert included["reconciliation"]["recorded_usd"] > 99.0


async def test_harness_judge_calls_are_excluded(client: AsyncClient) -> None:
    """Our own eval runs are not a school's cost."""
    w = await _seed(homework_submissions=6)
    before = (await _get(client, w.admin_id, days=30))["reconciliation"]["recorded_usd"]
    async with get_session_factory()() as s:
        s.add(
            LLMCall(
                function="judge", model=_OPUS, input_tokens=1, output_tokens=1,
                latency_ms=1.0, cost_usd=25.0, success=True,
                school_id=uuid.UUID(w.school_id), created_at=_WHEN,
            ),
        )
        await s.commit()
    after = (await _get(client, w.admin_id, days=30))["reconciliation"]["recorded_usd"]
    assert after == pytest.approx(before)


async def test_invalid_school_id_is_a_400(client: AsyncClient) -> None:
    w = await _seed(homework_submissions=1)
    token = create_access_token(w.admin_id, "admin")
    r = await client.get(
        "/v1/admin/unit-economics", params={"school_id": "not-a-uuid"},
        headers=auth_headers(token),
    )
    assert r.status_code == 400


async def test_requires_admin(client: AsyncClient) -> None:
    w = await _seed(homework_submissions=1)
    token = create_access_token(w.student_ids[0], "student")
    r = await client.get("/v1/admin/unit-economics", headers=auth_headers(token))
    assert r.status_code in (401, 403)


# --------------------------------------------------------------------------
# Reconciliation — the check that catches a mispriced model
# --------------------------------------------------------------------------

async def test_reconciliation_flags_a_row_priced_above_published_rates(
    client: AsyncClient,
) -> None:
    """Exactly the shape of the flat cache-read bug, caught automatically."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        await s.execute(text("UPDATE llm_calls SET cost_usd = cost_usd * 2"))
        await s.commit()

    rec = (await _get(client, w.admin_id, days=30))["reconciliation"]
    assert rec["gap_pct"] > 50.0, "doubling recorded cost must show as a gap"
    assert rec["recorded_usd"] > rec["recomputed_usd"]


async def test_unknown_model_is_named_rather_than_invented(
    client: AsyncClient,
) -> None:
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        s.add(
            LLMCall(
                function="ai_grading", model="claude-unreleased-9",
                input_tokens=10, output_tokens=10, latency_ms=1.0, cost_usd=0.01,
                success=True, school_id=uuid.UUID(w.school_id), created_at=_WHEN,
            ),
        )
        await s.commit()

    rec = (await _get(client, w.admin_id, days=30))["reconciliation"]
    assert "claude-unreleased-9" in rec["unpriced_models"]
    entry = [m for m in rec["by_model"] if m["model"] == "claude-unreleased-9"][0]
    assert entry["priced"] is False
    assert entry["recomputed_usd"] is None


# --------------------------------------------------------------------------
# Window, ratio, catalog
# --------------------------------------------------------------------------

async def test_window_defaults_to_the_model_cutover(client: AsyncClient) -> None:
    """Not a hardcoded date — the first real call on the configured model."""
    w = await _seed(homework_submissions=6)
    body = await _get(client, w.admin_id)
    assert body["window"]["basis"] == "model_cutover"
    assert body["window"]["cutover_model"] == _OPUS
    assert datetime.fromisoformat(body["window"]["start"]) <= _WHEN + timedelta(
        seconds=1,
    )


async def test_explicit_days_overrides_the_cutover(client: AsyncClient) -> None:
    w = await _seed(homework_submissions=6)
    body = await _get(client, w.admin_id, days=7)
    assert body["window"]["basis"] == "fixed_days"
    assert body["window"]["days"] == pytest.approx(7.0, rel=1e-3)


async def test_teacher_student_ratio_is_measured(client: AsyncClient) -> None:
    w = await _seed(homework_submissions=6)
    ratio = (await _get(client, w.admin_id, days=30))["teacher_student_ratio"]
    assert ratio["teachers"] == 1
    assert ratio["students"] == len(w.student_ids)
    assert ratio["students_per_teacher"] == pytest.approx(float(len(w.student_ids)))


async def test_token_profile_carries_calls_per_unit_for_repricing(
    client: AsyncClient,
) -> None:
    """Repricing needs per-call tokens AND how many calls a unit makes."""
    w = await _seed(homework_submissions=6)
    fns = (await _get(client, w.admin_id, days=30))["functions_by_unit"]
    hw = fns["submission:homework"]
    vision = [f for f in hw if f["function"] == "integrity_extract"][0]

    assert vision["calls_per_unit"] == pytest.approx(1.0)
    assert vision["tokens"]["input"] == pytest.approx(4200)
    assert vision["tokens"]["output"] == pytest.approx(850)
    assert vision["models"] == [_OPUS]


async def test_catalog_marks_the_models_we_actually_run(client: AsyncClient) -> None:
    w = await _seed(homework_submissions=1)
    catalog = (await _get(client, w.admin_id, days=30))["model_catalog"]
    by_id = {m["id"]: m for m in catalog}

    assert by_id[_OPUS]["is_configured"] is True
    assert by_id[_OPUS]["cache_read_mult"] == 0.05
    assert by_id["claude-fable-5-1"]["is_configured"] is False
    # The tokenizer factor the dashboard needs to compare fairly.
    assert by_id[_SONNET]["tokenizer_factor"] < by_id[_OPUS]["tokenizer_factor"]


async def test_reprice_matrix_is_computed_server_side(client: AsyncClient) -> None:
    """The dashboard must not reimplement tokenizer-aware repricing.

    Pins the matrix to the same function the backend tests cover, so the
    page can look up a number rather than recompute one.
    """
    from api.core.model_pricing import price_for, reprice

    w = await _seed(homework_submissions=6)
    fns = (await _get(client, w.admin_id, days=30))["functions_by_unit"]
    vision = [
        f for f in fns["submission:homework"] if f["function"] == "integrity_extract"
    ][0]

    assert vision["measured_model"] == _OPUS
    src = price_for(_OPUS)
    tgt = price_for(_SONNET)
    assert src is not None and tgt is not None
    expected = vision["calls_per_unit"] * reprice(
        src, tgt, input_tokens=4200, output_tokens=850,
        cache_read_tokens=1000, cache_write_tokens=0,
    )
    assert vision["reprice"][_SONNET] == pytest.approx(expected)


async def test_reprice_onto_the_measured_model_matches_what_we_recorded(
    client: AsyncClient,
) -> None:
    """The trust check the design promises, asserted end to end."""
    from api.core.model_pricing import cost_usd, price_for

    w = await _seed(homework_submissions=6)
    fns = (await _get(client, w.admin_id, days=30))["functions_by_unit"]
    vision = [
        f for f in fns["submission:homework"] if f["function"] == "integrity_extract"
    ][0]

    opus = price_for(_OPUS)
    assert opus is not None
    assert vision["reprice"][_OPUS] == pytest.approx(
        vision["calls_per_unit"] * cost_usd(opus, 4200, 850, 1000, 0),
    )


async def test_cheaper_model_reprices_cheaper_than_opus(client: AsyncClient) -> None:
    """Sanity: the matrix must order models the way their rates do."""
    w = await _seed(homework_submissions=6)
    fns = (await _get(client, w.admin_id, days=30))["functions_by_unit"]
    vision = [
        f for f in fns["submission:homework"] if f["function"] == "integrity_extract"
    ][0]["reprice"]

    assert vision["claude-haiku-5-5"] < vision[_SONNET] < vision[_OPUS]
    assert vision["claude-fable-5-1"] > vision[_OPUS]


async def test_generation_and_tutoring_also_get_token_profiles(
    client: AsyncClient,
) -> None:
    """Every model-picker knob needs a profile, or moving it does nothing.

    The submission legs had one and generation/tutoring did not, so the
    dashboard seeded those two pickers with the wrong model and changing
    them left the margin unmoved.
    """
    w = await _seed(homework_submissions=6, generation_units=2)
    async with get_session_factory()() as s:
        s.add(
            LLMCall(
                function="step_chat", model="claude-haiku-4-5-20251001",
                input_tokens=500, output_tokens=200, latency_ms=1.0,
                cost_usd=0.001, success=True,
                school_id=uuid.UUID(w.school_id),
                user_id=uuid.UUID(w.student_ids[0]), created_at=_WHEN,
            ),
        )
        await s.commit()

    fns = (await _get(client, w.admin_id, days=30))["functions_by_unit"]

    gen = fns.get("generation:unit")
    assert gen, "generation must carry a token profile"
    assert gen[0]["measured_model"] == _SONNET
    assert gen[0]["reprice"][_OPUS] > gen[0]["reprice"]["claude-haiku-5-5"]

    tutor = fns.get("residual:student")
    assert tutor, "self-study must carry a token profile"
    assert tutor[0]["measured_model"] == "claude-haiku-4-5-20251001"


async def test_generation_profile_is_denominated_per_unit(
    client: AsyncClient,
) -> None:
    """Must match the headline generation unit cost, not be per job."""
    w = await _seed(homework_submissions=6, generation_units=2, jobs_per_unit=2)
    body = await _get(client, w.admin_id, days=30)

    # Against the MEAN, not the median: summing per-function totals and
    # dividing by the unit count is an average by construction. They are
    # equal here only because the seeded jobs cost the same, so asserting
    # on the median would pass for the wrong reason and break the first
    # time real data is uneven.
    headline = _unit(body, "generation:unit")["cost_mean"]
    profile = sum(
        f["cost_per_unit"] for f in body["functions_by_unit"]["generation:unit"]
    )
    assert profile == pytest.approx(headline, rel=1e-6)


async def test_date_pinned_model_resolves_to_a_catalog_id(
    client: AsyncClient,
) -> None:
    """settings.llm_model_haiku carries a -YYYYMMDD pin.

    The raw id matches no catalog entry and no <option> value, so a
    dashboard picker seeded from it silently fell back to the first
    model in the list — showing Fable 5.1 where Haiku actually ran.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        s.add(
            LLMCall(
                function="step_chat", model="claude-haiku-4-5-20251001",
                input_tokens=500, output_tokens=200, latency_ms=1.0,
                cost_usd=0.001, success=True,
                school_id=uuid.UUID(w.school_id),
                user_id=uuid.UUID(w.student_ids[0]), created_at=_WHEN,
            ),
        )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    tutor = body["functions_by_unit"]["residual:student"][0]
    catalog_ids = {m["id"] for m in body["model_catalog"]}

    assert tutor["measured_model"] == "claude-haiku-4-5-20251001"
    assert tutor["measured_catalog_id"] == "claude-haiku-4-5"
    assert tutor["measured_catalog_id"] in catalog_ids


async def test_every_measured_catalog_id_is_selectable(
    client: AsyncClient,
) -> None:
    """Whatever the picker is seeded with must exist as an option."""
    w = await _seed(homework_submissions=6, generation_units=2)
    body = await _get(client, w.admin_id, days=30)
    catalog_ids = {m["id"] for m in body["model_catalog"]}

    for fns in body["functions_by_unit"].values():
        for f in fns:
            assert f["measured_catalog_id"] in catalog_ids, (
                f"{f['function']} seeds the picker with "
                f"{f['measured_catalog_id']!r}, which is not an option"
            )


async def test_function_costs_sum_to_the_headline_unit_cost(
    client: AsyncClient,
) -> None:
    """The parts must add up to the whole, even when a feature is optional.

    `integrity_check_enabled` is per assignment, so the understanding
    check does not fire on every homework. If each function is divided by
    the submissions THAT FUNCTION touched rather than by every submission
    of the kind, the optional leg is inflated and the per-function costs
    no longer sum to the measured unit cost — and the simulator builds
    its margin by summing exactly those per-function figures.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        # Strip grading from half the homeworks, the way an assignment
        # with a feature disabled would look.
        subs = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type = 'homework' LIMIT 3",
                ),
            )
        ).scalars().all()
        for sub in subs:
            await s.execute(
                text(
                    "DELETE FROM llm_calls WHERE submission_id = :s "
                    "AND function = 'ai_grading'",
                ),
                {"s": sub},
            )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    headline_mean = _unit(body, "submission:homework")["cost_mean"]
    parts = sum(
        f["cost_per_unit"] for f in body["functions_by_unit"]["submission:homework"]
    )
    assert parts == pytest.approx(headline_mean, rel=1e-6), (
        f"per-function costs sum to {parts} but the unit costs "
        f"{headline_mean} — a feature that fires on only some submissions "
        "is being divided by the wrong denominator"
    )
