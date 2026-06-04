"""GeometryProbe — the first probe: verifies generated geometry figures.

Flow it owns:
  generate()           POST the real generate endpoint with a geometry-eliciting
                       constraint, poll the job to completion, return the pending
                       items that came back with a figure.
  deterministic_checks() re-render the figure_spec (consistency), and confirm the
                       stored figure_svg is well-formed. Free, no LLM, no browser.
  capture_cards()      drive the teacher review UI (workshop modal) to screenshot
                       each figure as the teacher actually sees it on the page.
  judge_rubric()       the dimensions + rubric the sampled Haiku judge scores.

The teacher-review navigation uses resilient text/role selectors; if the live
DOM differs it degrades to "no capture" rather than crashing the run.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from api.core.geometry import FigureSpecError, render_figure
from tests.harness.browser import HarnessBrowser
from tests.harness.probe import Probe
from tests.harness.types import (
    CardCapture,
    CheckResult,
    GeneratedItem,
    HarnessContext,
    JudgeRubric,
)

# A constraint that steers generation toward varied, figure-bearing geometry —
# the shapes our renderer supports (triangles incl. right/labeled, circles with
# chords/radius, regular + irregular polygons), across a range of scales so the
# scaling fix is exercised.
_GEOMETRY_CONSTRAINT = (
    "Every problem MUST be a geometry problem that requires a diagram: "
    "triangles (include at least one right triangle and one with labeled "
    "side lengths and angles), a circle with a labeled radius or diameter "
    "chord, and a regular polygon. Use a mix of small and large measurements "
    "(e.g. 3-4-5 as well as 30-40-50). Each problem must include a figure."
)

_JOB_TERMINAL = {"done", "failed"}


class GeometryProbe(Probe):
    name = "geometry"

    def __init__(self, count: int = 6) -> None:
        self.count = count

    def relevant_paths(self) -> list[str]:
        # A change under any of these should be geometry-tested.
        return [
            "api/core/geometry/",
            "api/core/question_bank_generation.py",
            "api/core/step_decomposition.py",
            "api/core/assignment_generation.py",
            "web/src/components/shared/figure-display.tsx",
            "web/src/components/shared/step-timeline.tsx",
            "tests/harness/probes/geometry.py",
        ]

    # ── capability surface (for the autonomous explorer) ─────────────

    def capability_spec(self) -> str:
        return (
            "Geometry question generation that attaches a renderable diagram. "
            "The renderer supports exactly these figures:\n"
            "- TRIANGLES: defined by SSS (three sides), SAS (two sides + "
            "included angle), or ASA/AAS (two angles + one side); optional "
            "right-angle mark; optional side labels and angle labels; optional "
            "inscribed circle (with tangent points) or circumscribed circle.\n"
            "- CIRCLES: a radius, named points on the circumference at given "
            "angles, chords between points, a labeled radius/diameter, central "
            "angles.\n"
            "- POLYGONS: regular (n=4..12, e.g. square/pentagon/hexagon/octagon) "
            "or irregular (explicit vertices).\n"
            "Measurements can be any positive magnitude (sub-unit fractions up "
            "to hundreds). Solutions are decomposed into steps that may each "
            "carry their own small diagram.\n"
            "Known sensitive areas worth probing: very large or very small "
            "measurements (text/stroke scaling), near-degenerate/sliver "
            "triangles (label overlap), long labels (clipping), "
            "over-determined or inconsistent specs (sides that contradict "
            "angles, false right-angle marks), and diameter/chord labels."
        )

    # ── generation ───────────────────────────────────────────────────

    async def generate(
        self, ctx: HarnessContext, constraint: str | None = None,
    ) -> list[GeneratedItem]:
        headers = {"Authorization": f"Bearer {ctx.teacher_token}"}
        base = f"{ctx.api_base}/teacher/courses/{ctx.course_id}/question-bank"
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{base}/generate",
                headers=headers,
                json={
                    "count": self.count,
                    "assignment_id": ctx.assignment_id,
                    "unit_id": ctx.unit_id,
                    "constraint": constraint or _GEOMETRY_CONSTRAINT,
                },
            )
            resp.raise_for_status()
            job_id = resp.json()["id"]

            await self._await_job(client, base, job_id, headers)

            listing = await client.get(
                f"{base}",
                headers=headers,
                params={"assignment_id": ctx.assignment_id, "status_filter": "pending"},
            )
            listing.raise_for_status()
            items = listing.json()["items"]

        out: list[GeneratedItem] = []
        for raw in items:
            if not raw.get("figure_svg"):
                continue  # non-geometry item — skip for this probe
            out.append(
                GeneratedItem(
                    id=raw["id"],
                    label=raw.get("title") or raw["id"][:8],
                    problem_text=raw.get("question") or "",
                    figure_svg=raw.get("figure_svg"),
                    figure_spec=raw.get("figure_spec"),
                    raw=raw,
                ),
            )
        return out

    async def _await_job(
        self,
        client: httpx.AsyncClient,
        base: str,
        job_id: str,
        headers: dict[str, str],
        timeout_s: float = 180.0,
        interval_s: float = 2.0,
    ) -> None:
        """Poll the generation job until it reaches a terminal state."""
        waited = 0.0
        while waited < timeout_s:
            r = await client.get(f"{base}/generation-jobs/{job_id}", headers=headers)
            r.raise_for_status()
            job = r.json()
            if job["status"] in _JOB_TERMINAL:
                if job["status"] == "failed":
                    raise RuntimeError(
                        f"generation job failed: {job.get('error_message')}",
                    )
                return
            await asyncio.sleep(interval_s)
            waited += interval_s
        raise TimeoutError(f"generation job {job_id} did not finish in {timeout_s}s")

    # ── deterministic checks (free) ──────────────────────────────────

    def deterministic_checks(self, item: GeneratedItem) -> list[CheckResult]:
        checks: list[CheckResult] = []

        spec_present = item.figure_spec is not None
        checks.append(CheckResult("figure_spec present", spec_present))

        # Re-render the canonical spec: this re-runs the solver + our
        # consistency verification, catching a spec that's inconsistent or
        # un-renderable even though a (possibly stale) svg was stored.
        if spec_present:
            try:
                svg = render_figure(item.figure_spec or {})
                checks.append(CheckResult("figure_spec re-renders (consistent)", True))
                checks.append(
                    CheckResult(
                        "rendered svg well-formed",
                        svg.startswith("<svg") and "viewBox" in svg,
                    ),
                )
            except FigureSpecError as e:
                checks.append(
                    CheckResult("figure_spec re-renders (consistent)", False, str(e)),
                )

        svg = item.figure_svg or ""
        checks.append(
            CheckResult(
                "stored figure_svg well-formed",
                bool(svg) and svg.lstrip().startswith("<svg") and "viewBox" in svg
                and 'role="img"' in svg,
            ),
        )

        # Per-step solution figures (the decomposition can attach a diagram to
        # each step). Verify every one re-renders consistently + is well-formed
        # — the question figure passing tells us nothing about these.
        steps = item.raw.get("solution_steps") or []
        step_figs = [
            s for s in steps
            if isinstance(s, dict) and s.get("figure_spec")
        ]
        if step_figs:
            renders_ok = True
            wellformed_ok = True
            render_detail = ""
            for idx, s in enumerate(step_figs):
                try:
                    render_figure(s["figure_spec"])
                except FigureSpecError as e:
                    renders_ok = False
                    render_detail = f"step fig {idx}: {e}"
                ssvg = s.get("figure_svg") or ""
                if not (ssvg.lstrip().startswith("<svg") and "viewBox" in ssvg):
                    wellformed_ok = False
            checks.append(
                CheckResult(
                    f"{len(step_figs)} step figure(s) re-render (consistent)",
                    renders_ok, render_detail,
                ),
            )
            checks.append(
                CheckResult("step figure svgs well-formed", wellformed_ok),
            )
        return checks

    # ── teacher-review capture ───────────────────────────────────────

    # The teacher reviews freshly-generated items in a full-page review view
    # (NOT a modal): a "Review" button opens it; each item shows its figure in
    # a card; "Skip" advances to the next without approving/rejecting (so we
    # don't mutate the assignment while just screenshotting).
    _FIGURE = ".geometry-figure"
    _CARD_XPATH = "xpath=ancestor::div[contains(@class,'bg-surface')][1]"
    _PANEL_XPATH = "xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]"

    async def capture_cards(
        self,
        ctx: HarnessContext,
        browser: HarnessBrowser,
        items: list[GeneratedItem],
    ) -> list[CardCapture]:
        """Open the teacher review view and step through each pending item,
        screenshotting its figure card as the teacher sees it."""
        captures: list[CardCapture] = []
        hw_url = (
            f"{ctx.web_base}/school/teacher/courses/{ctx.course_id}"
            f"/homework/{ctx.assignment_id}"
        )

        async with browser.authed_page(ctx.teacher_token, ctx.teacher_refresh) as page:
            errors: list[str] = []
            page.on(
                "console",
                lambda m: errors.append(m.text) if m.type == "error" else None,
            )
            page.on("pageerror", lambda e: errors.append(str(e)))

            await page.goto(hw_url, wait_until="networkidle", timeout=30000)
            try:
                await page.get_by_text("Review", exact=False).first.click(timeout=8000)
            except Exception:  # noqa: BLE001 — no review queue to open
                return captures

            for i in range(len(items)):
                try:
                    await page.wait_for_selector(self._FIGURE, timeout=12000)
                except Exception:  # noqa: BLE001 — figure didn't render
                    break
                before = len(errors)
                png = await self._shoot_card(page)
                overflow = await browser.svg_overflows(page, self._FIGURE)
                captures.append(
                    CardCapture(
                        label=f"Question {i + 1}",
                        role="teacher",
                        png=png,
                        item_index=i,
                        kind="question",
                        console_errors=errors[before:],
                        overflow=overflow,
                        problem_text=await self._review_text(page),
                    ),
                )
                # Expand the solution and capture the steps + their per-step
                # figures — what the teacher sees when reviewing the worked
                # solution, which the question card alone doesn't cover.
                sol = await self._capture_solution(page, i + 1)
                if sol is not None:
                    captures.append(sol)

                if i < len(items) - 1 and not await self._skip(page):
                    break

        return captures

    async def _shoot_card(self, page: Any) -> bytes | None:
        """Screenshot the figure's enclosing card (figure + framing), falling
        back to the figure element alone."""
        card = page.locator(self._FIGURE).locator(self._CARD_XPATH)
        try:
            shot: bytes = await card.first.screenshot(timeout=5000)
            return shot
        except Exception:  # noqa: BLE001
            try:
                fallback: bytes = await page.locator(self._FIGURE).first.screenshot(
                    timeout=5000,
                )
                return fallback
            except Exception:  # noqa: BLE001
                return None

    async def _review_text(self, page: Any) -> str:
        """The review panel's text (title + question) for the judge prompt."""
        try:
            panel = page.locator(self._FIGURE).locator(self._PANEL_XPATH)
            text = await panel.first.inner_text(timeout=2000)
            return " ".join(str(text).split())[:600]
        except Exception:  # noqa: BLE001
            return ""

    async def _capture_solution(self, page: Any, n: int) -> CardCapture | None:
        """Reveal the worked solution and screenshot the panel (now including
        the per-step figures). Returns None if the solution couldn't be
        opened or shot."""
        before = await page.locator(self._FIGURE).count()
        opened = False
        try:
            await page.get_by_text("SHOW SOLUTION", exact=False).first.click(timeout=3000)
            await page.wait_for_timeout(800)
            opened = True
        except Exception:  # noqa: BLE001 — fall back to the keyboard toggle
            try:
                await page.keyboard.press("ArrowDown")
                await page.wait_for_timeout(800)
                opened = True
            except Exception:  # noqa: BLE001
                opened = False
        if not opened:
            return None
        try:
            panel = page.locator(self._FIGURE).first.locator(self._PANEL_XPATH)
            png: bytes = await panel.first.screenshot(timeout=6000)
        except Exception:  # noqa: BLE001
            return None
        after = await page.locator(self._FIGURE).count()
        step_figs = max(0, after - before)
        return CardCapture(
            label=f"Solution ({step_figs} step figures)",
            role="teacher",
            png=png,
            item_index=n - 1,
            kind="solution",
            problem_text=(
                "This is the worked SOLUTION view: numbered steps, each with "
                "its own small diagram. Judge whether the step diagrams render "
                "cleanly (legible, not clipped/overlapping) and match their "
                "step text. " + await self._review_text(page)
            ),
        )

    async def _skip(self, page: Any) -> bool:
        """Advance to the next pending item via the Skip control."""
        try:
            await page.get_by_text("Skip", exact=False).first.click(timeout=4000)
            await page.wait_for_timeout(600)
            return True
        except Exception:  # noqa: BLE001
            return False

    # ── judge rubric ─────────────────────────────────────────────────

    def judge_rubric(self) -> JudgeRubric:
        return JudgeRubric(
            dimensions=["accuracy", "labeling", "legibility", "fit", "polish"],
            instructions=(
                "You are grading a geometry figure as rendered on a real teacher "
                "page in a math app. You see a screenshot of the question card "
                "(the diagram and its question text). Score each dimension 1-5 "
                "(5 = excellent):\n"
                "- accuracy: does the diagram correctly match the problem text "
                "(shape, given measurements, right-angle marks, labels)?\n"
                "- labeling: are vertices/sides/angles labeled clearly and "
                "correctly, with no labels overlapping each other or the figure?\n"
                "- legibility: is text + line weight readable — neither too tiny "
                "nor dwarfing the figure?\n"
                "- fit: does the figure sit well in the card — not clipped, not "
                "overflowing, well-proportioned to the space?\n"
                "- polish: overall, does this look like a clean, professional "
                "textbook figure a student would trust?\n"
                "Give a one-sentence rationale citing the biggest issue (or "
                "'no issues')."
            ),
        )
