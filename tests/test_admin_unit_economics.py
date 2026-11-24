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
from api.core.model_pricing import cost_usd, price_for
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

# What the seed's token counts actually cost, derived rather than typed,
# so a rate change moves the expectation with the catalog.
def _hw_cost() -> float:
    return cost_usd(_price(_OPUS), 4200, 850, 1000, 0) + cost_usd(
        _price(_SONNET), 900, 300, 0, 0,
    )


def _gen_job_cost() -> float:
    return cost_usd(_price(_SONNET), 5000, 2000, 0, 0)


def _price(model_id: str):
    p = price_for(model_id)
    assert p is not None
    return p


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
                # cost_usd derived from the tokens on the row, the way
                # llm_client writes it. An arbitrary cost beside unrelated
                # token counts is a shape production cannot produce, and it
                # makes the self_reprice == measured invariant untestable.
                calls.append(
                    LLMCall(
                        function="integrity_extract", model=_OPUS,
                        input_tokens=4200, output_tokens=850,
                        cache_read_tokens=1000, cache_write_tokens=0,
                        latency_ms=10.0,
                        cost_usd=cost_usd(_price(_OPUS), 4200, 850, 1000, 0),
                        success=True,
                        school_id=school.id, user_id=students[i].id,
                        submission_id=sub.id, created_at=_WHEN,
                    ),
                )
                calls.append(
                    LLMCall(
                        function="ai_grading", model=_SONNET,
                        input_tokens=900, output_tokens=300,
                        cache_read_tokens=0, cache_write_tokens=0,
                        latency_ms=10.0,
                        cost_usd=cost_usd(_price(_SONNET), 900, 300, 0, 0),
                        success=True,
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
                        latency_ms=10.0,
                        cost_usd=cost_usd(_price(_SONNET), 5000, 2000, 0, 0),
                        success=True,
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
    assert hw["cost_median"] == pytest.approx(_hw_cost())
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
    # Two jobs per unit, so one unit costs two generations.
    assert gen["cost_median"] == pytest.approx(2 * _gen_job_cost())


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


# --------------------------------------------------------------------------
# Review round 1 — findings pinned so they fail on revert
# --------------------------------------------------------------------------

async def test_reprice_at_measured_model_reproduces_recorded_cost(
    client: AsyncClient,
) -> None:
    """The trust check must converge even on skewed token counts.

    The profile reconstructs a COST, so it has to be the mean: only the
    mean satisfies sum = mean x count. A median profile understates every
    right-skewed distribution, and four INDEPENDENT medians additionally
    drop the cache-read term whenever fewer than half the calls cache.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        await s.execute(
            text(
                "DELETE FROM llm_calls WHERE function <> 'integrity_extract'",
            ),
        )
        subs = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' "
                    "ORDER BY s.id",
                ),
            )
        ).scalars().all()
        # Skewed on purpose: mostly small and uncached, a few huge and cached.
        shapes = [(400, 100, 0)] * 4 + [(40_000, 3_000, 90_000)] * 2
        for sub, (tin, tout, cread) in zip(subs, shapes, strict=False):
            await s.execute(
                text("DELETE FROM llm_calls WHERE submission_id = :s"),
                {"s": sub},
            )
            s.add(
                LLMCall(
                    function="integrity_extract", model=_OPUS,
                    input_tokens=tin, output_tokens=tout,
                    cache_read_tokens=cread, cache_write_tokens=0,
                    latency_ms=1.0,
                    cost_usd=cost_usd(_price(_OPUS), tin, tout, cread, 0),
                    success=True, school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    fn = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "integrity_extract"
    ][0]
    assert fn["reprice"][_OPUS] == pytest.approx(fn["cost_per_unit"], rel=1e-6)


async def test_reprice_profile_keeps_cache_reads_when_a_minority_cache(
    client: AsyncClient,
) -> None:
    """Independent medians zeroed this term; the mean keeps it."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        subs = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 4",
                ),
            )
        ).scalars().all()
        for sub in subs:
            await s.execute(
                text(
                    "UPDATE llm_calls SET cache_read_tokens = 0 "
                    "WHERE submission_id = :s AND function = 'integrity_extract'",
                ),
                {"s": sub},
            )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    fn = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "integrity_extract"
    ][0]
    assert fn["tokens"]["cache_read"] > 0, (
        "4 of 6 calls have no cache traffic, so a median reads 0 and the "
        "repriced figure silently drops a term the recorded cost includes"
    )


async def test_short_window_marks_residual_rates_insufficient(
    client: AsyncClient,
) -> None:
    """A month's rate read off half an hour is arithmetic, not measurement.

    The default window is "since the model changed", so this is exactly
    the state of the page in the hour after a model switch.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        for i in range(6):
            s.add(
                LLMCall(
                    function="step_chat", model=_SONNET,
                    input_tokens=500, output_tokens=200, latency_ms=1.0,
                    cost_usd=0.03, success=True,
                    school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]),
                    created_at=datetime.now(UTC) - timedelta(minutes=30),
                ),
            )
        await s.commit()

    row = _unit(await _get(client, w.admin_id, days=1), "residual:student")
    assert row["n"] >= 5, "sample size alone would call this sufficient"
    assert row["sufficient"] is False, (
        "a per-month rate extrapolated from under a week must not be "
        "presented as measured"
    )
    # Public and typed: the page uses it to say WHY a row is insufficient,
    # since "too few observations" and "window too short to extrapolate"
    # send an operator to look at completely different things.
    assert row["window_too_short"] is True


async def test_residual_median_resists_one_heavy_user(
    client: AsyncClient,
) -> None:
    """The dashboard column is headed Median, so it had better be one."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        for i in range(6):
            s.add(
                LLMCall(
                    function="step_chat", model=_SONNET,
                    input_tokens=500, output_tokens=200, latency_ms=1.0,
                    cost_usd=50.0 if i == 0 else 0.01,
                    success=True, school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]), created_at=_WHEN,
                ),
            )
        await s.commit()

    row = _unit(await _get(client, w.admin_id, days=30), "residual:student")
    assert row["cost_median"] < row["cost_mean"], (
        "one $50 user must drag the mean and leave the median alone"
    )


async def test_opus_5_is_not_labelled_as_running(client: AsyncClient) -> None:
    """Prefix matching marked it configured: opus-5-5 starts with opus-5.

    Different models at different prices ($5/$25 vs $4/$20, and 0.1x vs
    0.05x on cache reads), so the label is a real mispricing cue.
    """
    w = await _seed(homework_submissions=1)
    body = await _get(client, w.admin_id, days=30)
    catalog = {m["id"]: m for m in body["model_catalog"]}
    assert catalog["claude-opus-5-5"]["is_configured"] is True
    assert catalog["claude-opus-5"]["is_configured"] is False


async def test_cache_write_mult_comes_from_the_catalog(
    client: AsyncClient,
) -> None:
    """A second copy of a rate, inside the panel built to detect drift."""
    from api.core.model_pricing import CACHE_WRITE_MULT

    w = await _seed(homework_submissions=1)
    for m in (await _get(client, w.admin_id, days=30))["model_catalog"]:
        assert m["cache_write_mult"] == pytest.approx(CACHE_WRITE_MULT)


async def test_reprice_source_is_chosen_by_spend_not_call_count(
    client: AsyncClient,
) -> None:
    """Many cheap calls must not set the profile for a few expensive ones."""
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        sub = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 1",
                ),
            )
        ).scalar_one()
        # Clear the seeded grading calls so this test measures only the
        # many-cheap vs few-expensive contrast it is about.
        await s.execute(text("DELETE FROM llm_calls WHERE function = 'ai_grading'"))
        for _ in range(20):
            s.add(
                LLMCall(
                    function="ai_grading", model="claude-haiku-4-5-20251001",
                    input_tokens=100, output_tokens=20, latency_ms=1.0,
                    cost_usd=0.0002, success=True,
                    school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        s.add(
            LLMCall(
                function="ai_grading", model=_OPUS,
                input_tokens=50_000, output_tokens=4_000, latency_ms=1.0,
                cost_usd=cost_usd(_price(_OPUS), 50_000, 4_000, 0, 0),
                success=True, school_id=uuid.UUID(w.school_id),
                submission_id=sub, created_at=_WHEN,
            ),
        )
        await s.commit()

    body = await _get(client, w.admin_id, days=30)
    grading = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "ai_grading"
    ][0]
    assert grading["measured_model"] == _OPUS, (
        "21 calls dominated by Opus in SPEND, which is what the repriced "
        "cost is reconstructed from"
    )


# --------------------------------------------------------------------------
# Review round 2 — defects the round-1 fixes introduced or left behind
# --------------------------------------------------------------------------

async def _mixed_model_grading(w: _World) -> None:
    """One function spanning two models with very different per-call costs.

    This is the DEFAULT shape in the week after a model cutover, not a
    contrived case: the window starts at the first call on the new model
    while the old one is still serving.
    """
    async with get_session_factory()() as s:
        await s.execute(text("DELETE FROM llm_calls WHERE function = 'ai_grading'"))
        sub = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 1",
                ),
            )
        ).scalar_one()
        for _ in range(20):
            s.add(
                LLMCall(
                    function="ai_grading", model="claude-haiku-4-5-20251001",
                    input_tokens=100, output_tokens=20, latency_ms=1.0,
                    cost_usd=cost_usd(_price("claude-haiku-4-5"), 100, 20, 0, 0),
                    success=True, school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        s.add(
            LLMCall(
                function="ai_grading", model=_OPUS,
                input_tokens=50_000, output_tokens=4_000, latency_ms=1.0,
                cost_usd=cost_usd(_price(_OPUS), 50_000, 4_000, 0, 0),
                success=True, school_id=uuid.UUID(w.school_id),
                submission_id=sub, created_at=_WHEN,
            ),
        )
        await s.commit()


async def test_mixed_model_group_is_repriced_leg_by_leg(
    client: AsyncClient,
) -> None:
    """Repricing a group's TOTAL calls off one model's profile is wrong.

    `calls_per_unit` spans every model in the group. Multiplying it by a
    single model's token profile overstates a mixed group by the ratio
    between them — measured at 20.7x on this exact shape, in the number
    the margin is built from.
    """
    w = await _seed(homework_submissions=6)
    await _mixed_model_grading(w)

    body = await _get(client, w.admin_id, days=30)
    grading = [
        f for f in body["functions_by_unit"]["submission:homework"]
        if f["function"] == "ai_grading"
    ][0]

    # Priced on the models it really ran on, it must reproduce what we paid.
    assert grading["self_reprice"] == pytest.approx(
        grading["cost_per_unit"], rel=1e-6,
    )
    # And no target may be an order of magnitude off the measured cost
    # purely because one leg is expensive.
    assert grading["reprice"][_OPUS] < grading["cost_per_unit"] * 10


async def test_self_reprice_sums_to_the_unit_cost_across_every_family(
    client: AsyncClient,
) -> None:
    """The invariant the whole simulator rests on, including mixed groups."""
    w = await _seed(homework_submissions=6, generation_units=2)
    await _mixed_model_grading(w)

    body = await _get(client, w.admin_id, days=30)
    for kind, fns in body["functions_by_unit"].items():
        unit = [u for u in body["units"] if u["kind"] == kind]
        if not unit or unit[0]["cost_mean"] is None:
            continue
        total = 0.0
        for f in fns:
            assert f["self_reprice"] is not None, f"{kind}/{f['function']} unpriced"
            total += f["self_reprice"]
        assert total == pytest.approx(unit[0]["cost_mean"], rel=1e-6), (
            f"{kind}: legs repriced on their own models must sum to the "
            "measured unit cost"
        )


async def test_window_too_short_never_leaks_on_the_thin_branch(
    client: AsyncClient,
) -> None:
    """`and` short-circuits, so folding the pop into it left the key behind.

    The untested branch was the common one: every row with fewer than
    min_sample observations, including every row with none at all.
    """
    w = await _seed(homework_submissions=6)
    body = await _get(client, w.admin_id, days=30, min_sample=1000)

    for u in body["units"]:
        assert u["sufficient"] is False, "min_sample=1000 fails every row"
        # Present and typed, never a leaked internal — the page uses it to
        # say WHY a row is insufficient.
        assert isinstance(u["window_too_short"], bool)


async def test_thin_and_short_are_distinguishable(client: AsyncClient) -> None:
    """Sample size and window length are different problems.

    The page's warning copy blamed sample size for both, so an operator
    chasing a short-window artefact was sent to look at the wrong thing.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        for i in range(6):
            s.add(
                LLMCall(
                    function="step_chat", model=_SONNET,
                    input_tokens=500, output_tokens=200, latency_ms=1.0,
                    cost_usd=0.03, success=True,
                    school_id=uuid.UUID(w.school_id),
                    user_id=uuid.UUID(w.student_ids[i]),
                    created_at=datetime.now(UTC) - timedelta(minutes=30),
                ),
            )
        await s.commit()

    short = _unit(await _get(client, w.admin_id, days=1), "residual:student")
    assert short["window_too_short"] is True
    assert short["n"] >= 5, "not thin — the window is the problem"

    wide = _unit(await _get(client, w.admin_id, days=30), "submission:homework")
    assert wide["window_too_short"] is False


async def test_dominant_model_is_stable_across_identical_requests(
    client: AsyncClient,
) -> None:
    """A bare max() returns whichever row Postgres emitted first.

    That flips the seeded picker and the trust check between identical
    requests whenever two models tie on spend.
    """
    w = await _seed(homework_submissions=6)
    async with get_session_factory()() as s:
        await s.execute(text("DELETE FROM llm_calls WHERE function = 'ai_grading'"))
        sub = (
            await s.execute(
                text(
                    "SELECT s.id FROM submissions s JOIN assignments a "
                    "ON a.id = s.assignment_id WHERE a.type='homework' LIMIT 1",
                ),
            )
        ).scalar_one()
        for model in (_OPUS, _SONNET):
            s.add(
                LLMCall(
                    function="ai_grading", model=model,
                    input_tokens=1_000, output_tokens=500, latency_ms=1.0,
                    cost_usd=0.01, success=True,  # deliberately identical
                    school_id=uuid.UUID(w.school_id),
                    submission_id=sub, created_at=_WHEN,
                ),
            )
        await s.commit()

    seen = set()
    for _ in range(4):
        body = await _get(client, w.admin_id, days=30)
        grading = [
            f for f in body["functions_by_unit"]["submission:homework"]
            if f["function"] == "ai_grading"
        ][0]
        seen.add(grading["measured_model"])
    assert len(seen) == 1, f"tie broke differently across requests: {seen}"
