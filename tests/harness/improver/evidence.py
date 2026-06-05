"""Plan-billed scan path: gather evidence cheaply, judge on the Claude plan.

The default scan judges with the metered API (Haiku/Sonnet via the app SDK).
This path instead does only the $0 work in Python — drive the browser, run the
objective detectors, save screenshots — and writes a `findings.json` an agent
(Claude Code, billed to the *plan*, not the API) reads to produce `proposals.json`.
`ingest` then loads those proposals through the same dedupe/rank/queue/dashboard
pipeline as the API path. So the expensive "intelligence" runs on tokens you've
already paid for, while the cheap mechanical part stays free.
"""

from __future__ import annotations

import json
from pathlib import Path

from tests.harness.improver.proposals import CATEGORIES, SIZES, Proposal, _coerce
from tests.harness.improver.types import PageObservation, Surface

# The instructions the judging agent follows over the gathered evidence. Mirrors
# the API path's UX rubric + proposer rules so output quality is comparable.
JUDGE_PROMPT = f"""You are the autonomous improver's judging step, running on the Claude plan.
Read `findings.json` in this directory and the referenced screenshots (under
`shots/`), then write `proposals.json` — a ranked list of concrete, small,
shippable improvements.

For each surface: combine the objective detector hits (console errors, a11y,
overflow, slow loads — high confidence) with what you SEE in its screenshot
(spacing, hierarchy, contrast, affordances, copy, broken/empty states). You may
also propose a few SMALL new features from the `catalog` where there's an
obvious gap (mark those lower-confidence).

Rules: be specific (name the change, not "improve X"); each proposal small and
independently shippable; NEVER touch auth, billing, or database schema; group
related hits on one surface into one proposal; prefer 4-8 strong proposals over
a long mediocre list.

Write `proposals.json` as a JSON array; each item:
  {{ "surface_key": str, "title": str (imperative),
     "category": one of {CATEGORIES}, "severity": "high"|"medium"|"low",
     "rationale": str (cite the evidence), "change": str (the specific change),
     "est_size": one of {SIZES}, "confidence": number 0..1 }}
Then stop — `improve ingest` will rank, dedupe, and queue them."""


def save_evidence(
    observations: list[PageObservation],
    catalog: list[Surface],
    out_dir: Path,
) -> Path:
    """Write screenshots + findings.json for the agent to judge. Returns the dir."""
    shots = out_dir / "shots"
    shots.mkdir(parents=True, exist_ok=True)
    surfaces: list[dict[str, object]] = []
    for o in observations:
        shot_rel = ""
        if o.png is not None:
            shot_rel = f"shots/{o.surface_key}.png"
            (out_dir / shot_rel).write_bytes(o.png)
        surfaces.append({
            "key": o.surface_key, "url": o.url, "role": o.role, "ok": o.ok,
            "load_ms": round(o.load_ms) if o.load_ms else None,
            "console_errors": o.console_errors[:5],
            "hits": [
                {"detector": h.detector, "severity": h.severity,
                 "detail": h.detail, "where": h.evidence[:160], "source": h.source}
                for h in o.hits
            ],
            "shot": shot_rel,
        })
    findings = {
        "surfaces": surfaces,
        "catalog": [
            {"key": s.key, "title": s.title, "role": s.role, "app": s.app}
            for s in catalog
        ],
    }
    (out_dir / "findings.json").write_text(json.dumps(findings, indent=2))
    (out_dir / "JUDGE_PROMPT.txt").write_text(JUDGE_PROMPT)
    return out_dir


def load_proposals(out_dir: Path) -> list[Proposal]:
    """Read the agent-written proposals.json into Proposal objects."""
    path = out_dir / "proposals.json"
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError:
        return []
    return [_coerce(p) for p in raw if isinstance(p, dict)]


def evidence_summary(out_dir: Path) -> str:
    """One-line summary of a gathered evidence dir, for the CLI."""
    try:
        f = json.loads((out_dir / "findings.json").read_text())
    except (OSError, json.JSONDecodeError):
        return "no findings.json"
    surfaces = f.get("surfaces", [])
    hits = sum(len(s.get("hits", [])) for s in surfaces)
    return f"{len(surfaces)} surfaces, {hits} hits"
