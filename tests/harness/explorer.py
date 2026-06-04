"""Autonomous explorer — the fuzzer half of explore+regress.

Instead of a hand-authored scenario matrix, an LLM reads a probe's
`capability_spec()` and invents diverse + adversarial test scenarios. Each
scenario runs through the real generation path in its own isolated seed; a
scenario "fails" when generation errors, a deterministic check fails, or the
produced figure doesn't match the shape the scenario steered for. Failures
are PROMOTED into a deterministic regression corpus (a JSON file) so they
replay for $0 forever after.

Exploration costs money (it generates new cases); the recorded corpus does
not. Both honor the cassette layer + cost-tracker ceiling.
"""

from __future__ import annotations

import html
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json
from api.core.llm_schemas import ToolSchema
from tests.harness.probe import Probe
from tests.harness.seed import seed_world
from tests.harness.types import HarnessContext

_CORPUS_DIR = Path(__file__).parent / "_corpus"


@dataclass
class Scenario:
    name: str
    constraint: str
    expected_shapes: list[str]
    adversarial: bool = False
    rationale: str = ""


@dataclass
class ScenarioResult:
    scenario: Scenario
    items: int = 0
    det_pass: int = 0
    det_total: int = 0
    shape_match: bool = False
    error: str | None = None

    @property
    def passed(self) -> bool:
        return (
            self.error is None
            and self.items > 0
            and self.det_pass == self.det_total
            and self.shape_match
        )


@dataclass
class ExploreResult:
    probe_name: str
    results: list[ScenarioResult] = field(default_factory=list)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.passed)


_SCENARIO_SCHEMA: ToolSchema = {
    "name": "propose_scenarios",
    "description": "Propose diverse + adversarial test scenarios for the feature.",
    "input_schema": {
        "type": "object",
        "properties": {
            "scenarios": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "constraint": {
                            "type": "string",
                            "description": "natural-language steer passed to real generation",
                        },
                        "expected_shapes": {
                            "type": "array",
                            "items": {"type": "string", "enum": ["triangle", "circle", "polygon"]},
                        },
                        "adversarial": {"type": "boolean"},
                        "rationale": {"type": "string"},
                    },
                    "required": ["name", "constraint", "expected_shapes", "adversarial", "rationale"],
                },
            },
        },
        "required": ["scenarios"],
    },
}


async def generate_scenarios(probe: Probe, n: int) -> list[Scenario]:
    """Ask the model to invent `n` test scenarios from the probe's surface."""
    system = (
        "You are a meticulous QA test designer for an AI generation feature. "
        "Given the feature's capability surface, propose a set of test "
        "scenarios that together cover the BREADTH of the surface AND include "
        "ADVERSARIAL edge cases most likely to break it. Each scenario is a "
        "concise natural-language 'constraint' that steers the real generation "
        "prompt, plus the shape(s) you expect it to produce."
    )
    user = (
        f"Feature: {probe.name}\n\nCapability surface:\n{probe.capability_spec()}\n\n"
        f"Propose exactly {n} scenarios. Make roughly half `adversarial: true` "
        "(extreme scales, near-degenerate slivers, long labels, "
        "over-determined/inconsistent specs). Keep constraints short and "
        "concrete."
    )
    result = await call_claude_json(
        system, user, LLMMode.JUDGE,
        tool_schema=_SCENARIO_SCHEMA, model=MODEL_REASON, max_tokens=2048,
    )
    raw_scenarios = result.get("scenarios", [])
    if not isinstance(raw_scenarios, list):
        return []
    out: list[Scenario] = []
    for s in raw_scenarios:
        if not isinstance(s, dict):
            continue
        out.append(Scenario(
            name=str(s.get("name", "")),
            constraint=str(s.get("constraint", "")),
            expected_shapes=[str(x) for x in s.get("expected_shapes", [])],
            adversarial=bool(s.get("adversarial", False)),
            rationale=str(s.get("rationale", "")),
        ))
    return out


async def explore(
    probe: Probe, scenarios: list[Scenario], api_base: str, web_base: str,
) -> ExploreResult:
    """Run each scenario in its own fresh seed and grade it deterministically.
    Per-scenario seeding isolates each scenario's pending items so they don't
    pool on one assignment."""
    out = ExploreResult(probe_name=probe.name)
    for sc in scenarios:
        res = ScenarioResult(scenario=sc)
        try:
            seed = await seed_world()
            ctx = HarnessContext(
                api_base=api_base, web_base=web_base,
                teacher_token=seed.teacher_token, student_token=seed.student_token,
                teacher_refresh=seed.teacher_refresh, student_refresh=seed.student_refresh,
                teacher_id=seed.teacher_id, student_id=seed.student_id,
                course_id=seed.course_id, unit_id=seed.unit_id,
                assignment_id=seed.assignment_id,
            )
            items = await probe.generate(ctx, constraint=sc.constraint)
            res.items = len(items)
            for it in items:
                checks = probe.deterministic_checks(it)
                res.det_total += len(checks)
                res.det_pass += sum(1 for c in checks if c.passed)
            produced = {
                (it.figure_spec or {}).get("shape") for it in items
            }
            res.shape_match = bool(items) and any(
                s in produced for s in sc.expected_shapes
            )
        except Exception as e:  # noqa: BLE001 — a scenario failure is data, not a crash
            res.error = str(e)[:200]
        out.results.append(res)
    return out


def promote_failures(result: ExploreResult, corpus_path: Path | None = None) -> Path:
    """Append failing scenarios to the regression corpus (deduped by name), so
    they replay deterministically on future corpus runs."""
    path = corpus_path or (_CORPUS_DIR / f"{result.probe_name}.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, dict[str, object]] = {}
    if path.exists():
        for entry in json.loads(path.read_text()):
            existing[entry["name"]] = entry
    for r in result.results:
        if not r.passed:
            existing[r.scenario.name] = asdict(r.scenario)
    path.write_text(json.dumps(list(existing.values()), indent=2))
    return path


def load_corpus(probe_name: str, corpus_path: Path | None = None) -> list[Scenario]:
    """Load the promoted regression scenarios for a probe."""
    path = corpus_path or (_CORPUS_DIR / f"{probe_name}.json")
    if not path.exists():
        return []
    return [Scenario(**entry) for entry in json.loads(path.read_text())]


def _fail_reason(r: ScenarioResult) -> str:
    if r.error:
        return r.error
    if r.items == 0:
        return "no items generated"
    if not r.shape_match:
        return "produced shape didn't match the steer"
    if r.det_pass < r.det_total:
        return f"{r.det_total - r.det_pass} deterministic check(s) failed"
    return ""


def write_explore_report(result: ExploreResult, out_path: Path) -> str:
    """Render the exploration as an HTML table (scenario → pass/fail + reason)
    and return the HTML. Failures are highlighted."""
    rows = []
    for r in result.results:
        ok = r.passed
        rows.append(
            f'<tr style="background:{"#fff" if ok else "#fdecea"}">'
            f"<td>{html.escape(r.scenario.name)}</td>"
            f'<td>{"adversarial" if r.scenario.adversarial else "coverage"}</td>'
            f"<td>{html.escape(r.scenario.constraint[:90])}</td>"
            f"<td>{r.items}</td><td>{r.det_pass}/{r.det_total}</td>"
            f'<td>{"yes" if r.shape_match else "no"}</td>'
            f'<td><b style="color:{"#1f7a3d" if ok else "#b03a2e"}">'
            f'{"PASS" if ok else "FAIL"}</b></td>'
            f"<td>{html.escape(_fail_reason(r))}</td></tr>"
        )
    passed = result.passed
    total = len(result.results)
    page = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Explore — {html.escape(result.probe_name)}</title>
<style>
 body {{ font-family:system-ui,sans-serif; background:#fbf9f2; color:#1a1a17; padding:24px; }}
 h1 {{ font-size:19px; }}
 table {{ width:100%; border-collapse:collapse; font-size:13px; }}
 th,td {{ text-align:left; padding:7px 9px; border-bottom:1px solid #e2ddcf; vertical-align:top; }}
 th {{ font-size:11px; text-transform:uppercase; color:#7a7768; }}
</style></head><body>
<h1>Autonomous exploration — {html.escape(result.probe_name)}</h1>
<p>{passed}/{total} scenarios passed · {total - passed} failing scenario(s) promoted to the regression corpus.</p>
<table><thead><tr><th>Scenario</th><th>Kind</th><th>Constraint (steer)</th>
<th>Items</th><th>Det. checks</th><th>Shape match</th><th>Result</th><th>Why it failed</th></tr></thead>
<tbody>{''.join(rows) or '<tr><td colspan=8>no scenarios</td></tr>'}</tbody></table>
</body></html>"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(page)
    return page


async def persist_explore_summary(
    result: ExploreResult,
    report_html: str,
    cost_usd: float | None,
    mode: str,
    summary_db_url: str,
) -> bool:
    """Write a run-summary row for an exploration so it shows in the admin
    'Harness Runs' tab (probe suffixed with ·explore). Best-effort."""
    try:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        from api.models.harness_run import HarnessRun

        total = len(result.results)
        passed = result.passed
        engine = create_async_engine(summary_db_url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                s.add(HarnessRun(
                    probe=f"{result.probe_name}·explore",
                    mode=mode,
                    items_generated=sum(r.items for r in result.results),
                    det_pass=sum(r.det_pass for r in result.results),
                    det_total=sum(r.det_total for r in result.results),
                    captures=0,
                    judge_count=0,
                    judge_mean=None,
                    cost_usd=cost_usd,
                    passed=total > 0 and passed == total,
                    note=(
                        f"{passed}/{total} scenarios passed; "
                        f"{total - passed} promoted to corpus"
                    ),
                    report_html=report_html,
                ))
                await s.commit()
        finally:
            await engine.dispose()
        return True
    except Exception:  # noqa: BLE001 — observability, never fatal
        return False
