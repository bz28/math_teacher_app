"""GenerationProbe — tests question-GENERATION quality, not figure rendering.

Where GeometryProbe forces diagrams and verifies they render beautifully, this
probe sends realistic teacher prompts and asks three different questions of the
output:

  1. Realistic path  — the steer is a plain topic ("two-step linear equations,
                       grade 7"), so the AI decides everything, like a teacher's
                       real request.
  2. Figure-appropriateness (deterministic, $0) — a geometry topic should carry
                       a figure; an algebra/arithmetic topic should NOT. A
                       diagram on "solve 3x+5=20" is a real bug, and so is a
                       Pythagorean problem with no triangle.
  3. Math correctness (text judge) — a Haiku judge re-solves each problem and
                       scores whether it's well-posed, the stated answer is
                       right, and the steps are valid.

No browser: there's no figure to screenshot here, so needs_browser is False and
the runner skips Chromium. Correctness comes from judge_items (the text judge).

This is a LIVE probe by design — run it in `--mode record`/`auto` (~$0.23 for the
full 6-topic × 2 sweep). Unlike the geometry probe, $0 replay doesn't apply here:
replay freezes the AI's output, but the AI's output is exactly what this probe
judges (is the problem correct, is a figure appropriate). Replaying would just
re-report the same frozen verdict, so there's nothing to gain by caching it —
run it live whenever you want a fresh read on generation quality.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from api.core.geometry import FigureSpecError, render_figure
from tests.harness.eval import judge_correctness
from tests.harness.probe import Probe
from tests.harness.types import CheckResult, GeneratedItem, HarnessContext, JudgeScore

_JOB_TERMINAL = {"done", "failed"}


class _Scenario:
    """A realistic teacher topic + whether a diagram is expected for it.
    expect_figure=None means 'unknown' (an ad-hoc override topic) → the
    figure-appropriateness check is skipped for it."""

    def __init__(self, name: str, topic: str, *, expect_figure: bool | None) -> None:
        self.name = name
        self.topic = topic  # the constraint sent to generation (a teacher prompt)
        self.expect_figure = expect_figure


# Curated, realistic prompts. Geometry topics where a diagram genuinely helps
# (expect_figure=True) and pure algebra/arithmetic where a diagram would be wrong
# (expect_figure=False). The prompts deliberately say NOTHING about figures — the
# whole point is to test the generator's own decision to attach one or not.
_SCENARIOS = [
    _Scenario(
        "pythagorean",
        "Right-triangle problems using the Pythagorean theorem, with numeric "
        "side lengths to solve for, grade 8.",
        expect_figure=True,
    ),
    _Scenario(
        "circle-measures",
        "Finding the area and circumference of circles from a given radius or "
        "diameter, grade 7.",
        expect_figure=True,
    ),
    _Scenario(
        "polygon-angles",
        "Interior and exterior angle problems for regular polygons such as "
        "pentagons and hexagons, grade 8.",
        expect_figure=True,
    ),
    _Scenario(
        "right-triangle-word",
        "Right-triangle word problems such as a ladder leaning against a wall "
        "or a ramp incline, grade 9.",
        expect_figure=True,
    ),
    _Scenario(
        "linear-equations",
        "Solving two-step linear equations such as 3x + 5 = 20, grade 7.",
        expect_figure=False,
    ),
    _Scenario(
        "fractions",
        "Adding and subtracting fractions with unlike denominators, grade 6.",
        expect_figure=False,
    ),
]

_DEFAULT_CONSTRAINT = "Generation-quality sweep across realistic teacher topics:\n" + "\n".join(
    f"• {s.name}: {s.topic} (expect {'a figure' if s.expect_figure else 'NO figure'})"
    for s in _SCENARIOS
)


class GenerationProbe(Probe):
    name = "generation"
    needs_browser = False
    default_constraint = _DEFAULT_CONSTRAINT

    def __init__(self, count: int = 2) -> None:
        # Problems generated per topic. Small — figure-appropriateness +
        # correctness only need a few examples per topic to be meaningful.
        self.count = count

    def relevant_paths(self) -> list[str]:
        return [
            "api/core/question_bank_generation.py",
            "api/core/assignment_generation.py",
            "api/core/step_decomposition.py",
            "api/core/practice.py",
            "api/core/llm_schemas.py",
        ]

    def capability_spec(self) -> str:
        return (
            "Question generation turns a teacher's topic prompt into practice "
            "problems (question, final answer, worked solution steps), and "
            "OPTIONALLY a geometry figure when the problem benefits from one. "
            "The surface spans: math subjects (geometry, algebra, arithmetic, "
            "word problems), grade levels, and the figure-or-not decision. A "
            "good generation is mathematically correct AND attaches a diagram "
            "exactly when appropriate — never on pure algebra, always when a "
            "shape/measurement must be visualized."
        )

    # ── generation ───────────────────────────────────────────────────

    async def generate(
        self, ctx: HarnessContext, constraint: str | None = None,
    ) -> list[GeneratedItem]:
        """Run every curated topic through the real generation path, tagging
        each produced item with its topic + whether a figure was expected. One
        topic's failure (e.g. the generator returns nothing) is recorded as a
        skipped scenario, not a crashed run."""
        headers = {"Authorization": f"Bearer {ctx.teacher_token}"}
        base = f"{ctx.api_base}/teacher/courses/{ctx.course_id}/question-bank"
        # Normal run: the full curated sweep. An explicit override (e.g. an
        # explorer scenario) → that single topic, figure expectation unknown.
        scenarios = _SCENARIOS
        if constraint and constraint != self.default_constraint:
            scenarios = [_Scenario("custom", constraint, expect_figure=None)]
        out: list[GeneratedItem] = []
        seen: set[str] = set()
        async with httpx.AsyncClient(timeout=180.0) as client:
            for sc in scenarios:
                try:
                    await self._generate_one(client, base, headers, ctx, sc)
                    new = await self._collect_new(client, base, headers, ctx, seen, sc)
                    out.extend(new)
                except (httpx.HTTPError, RuntimeError, TimeoutError):
                    # A topic that fails to generate is itself a signal, but it
                    # shouldn't sink the other topics. It simply contributes no
                    # items; the run's item count reflects the gap.
                    continue
        return out

    async def _generate_one(
        self,
        client: httpx.AsyncClient,
        base: str,
        headers: dict[str, str],
        ctx: HarnessContext,
        sc: _Scenario,
    ) -> None:
        resp = await client.post(
            f"{base}/generate",
            headers=headers,
            json={
                "count": self.count,
                "assignment_id": ctx.assignment_id,
                "unit_id": ctx.unit_id,
                "constraint": sc.topic,
            },
        )
        resp.raise_for_status()
        await self._await_job(client, base, resp.json()["id"], headers)

    async def _collect_new(
        self,
        client: httpx.AsyncClient,
        base: str,
        headers: dict[str, str],
        ctx: HarnessContext,
        seen: set[str],
        sc: _Scenario,
    ) -> list[GeneratedItem]:
        """List pending items and return the ones not seen before — i.e. the
        items this topic's generation just added — tagged with the scenario."""
        listing = await client.get(
            f"{base}",
            headers=headers,
            params={"assignment_id": ctx.assignment_id, "status_filter": "pending"},
        )
        listing.raise_for_status()
        fresh: list[GeneratedItem] = []
        for raw in listing.json()["items"]:
            if raw["id"] in seen:
                continue
            seen.add(raw["id"])
            raw["_topic"] = sc.name
            raw["_expect_figure"] = sc.expect_figure
            fresh.append(
                GeneratedItem(
                    id=raw["id"],
                    label=f"{sc.name}: {(raw.get('title') or raw['id'][:8])}",
                    problem_text=raw.get("question") or "",
                    figure_svg=raw.get("figure_svg"),
                    figure_spec=raw.get("figure_spec"),
                    raw=raw,
                ),
            )
        return fresh

    async def _await_job(
        self,
        client: httpx.AsyncClient,
        base: str,
        job_id: str,
        headers: dict[str, str],
        timeout_s: float = 180.0,
        interval_s: float = 2.0,
    ) -> None:
        waited = 0.0
        while waited < timeout_s:
            r = await client.get(f"{base}/generation-jobs/{job_id}", headers=headers)
            r.raise_for_status()
            job = r.json()
            if job["status"] in _JOB_TERMINAL:
                if job["status"] == "failed":
                    raise RuntimeError(f"generation job failed: {job.get('error_message')}")
                return
            await asyncio.sleep(interval_s)
            waited += interval_s
        raise TimeoutError(f"generation job {job_id} did not finish in {timeout_s}s")

    # ── deterministic checks (free) ──────────────────────────────────

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        checks: list[CheckResult] = []

        # Well-formed: a usable problem has a question and a final answer.
        checks.append(
            CheckResult("question present", bool((item.problem_text or "").strip())),
        )
        checks.append(
            CheckResult(
                "final answer present",
                bool(str(item.raw.get("final_answer") or "").strip()),
            ),
        )

        # Figure-appropriateness — the core of this probe. A topic that needs a
        # diagram must carry one; a pure-algebra topic must NOT.
        has_fig = bool(item.figure_svg)
        expect: Any = item.raw.get("_expect_figure")
        if expect is True:
            checks.append(CheckResult("figure present (expected for topic)", has_fig))
        elif expect is False:
            checks.append(
                CheckResult("no figure (correctly omitted for topic)", not has_fig),
            )

        # If a figure is present, it must still be internally consistent.
        if item.figure_spec is not None:
            try:
                svg = render_figure(item.figure_spec)
                checks.append(
                    CheckResult(
                        "figure re-renders (consistent)",
                        svg.startswith("<svg") and "viewBox" in svg,
                    ),
                )
            except FigureSpecError as e:
                checks.append(CheckResult("figure re-renders (consistent)", False, str(e)))

        return checks

    # ── correctness judging (text judge, no browser) ─────────────────

    async def judge_items(self, items: list[GeneratedItem]) -> list[JudgeScore | None]:
        """Re-solve each problem with the Haiku text judge and score its
        correctness. Sequential so cassette writes stay ordered + deterministic;
        every call is cassette-cached so replay is $0."""
        out: list[JudgeScore | None] = []
        for i, item in enumerate(items):
            out.append(await judge_correctness(item, i, probe_name=self.name))
        return out
