"""Extra proposal sources beyond the UI scanner.

The page scanner only sees rendered UI, so on its own the improver proposes only
visual/UX/a11y/perf work. These widen the lens to the other two things Ben
asked for:

  * content_quality_proposals — folds the harness's own AI-OUTPUT quality signal
    (the explorer's promoted-failure corpus) into fix proposals, so persistent
    generation defects become tracked, shippable work. Reuses the corpus the
    harness already maintains; $0 when there are no recorded failures.
  * feature_proposals — a conservative product-gap pass over the route catalog
    suggesting SMALL new features, with damped confidence so speculative ideas
    always rank below objective findings and never lead.

Both emit the same Proposal type, so they flow through the identical
dedupe -> rank -> approve -> execute pipeline as the UI proposer.
"""

from __future__ import annotations

import hashlib
import json

from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json
from tests.harness.cassette import CassetteMissError
from tests.harness.improver.proposals import _SCHEMA, Proposal, _coerce, rank_filter
from tests.harness.improver.types import Surface

# Feature ideas are inherently softer than observed defects; damp their
# confidence so they sort below anything grounded in real signal.
_FEATURE_CONFIDENCE_DAMP = 0.6

_CONTENT_SYSTEM = (
    "You are a senior engineer improving an AI math-content GENERATOR. You are "
    "given its known failure cases (a regression corpus the test harness "
    "promoted because generation errored, produced the wrong shape, or failed a "
    "deterministic check). Propose concrete, small code/prompt fixes that would "
    "make generation handle these cases correctly. Set surface_key to "
    "'generation:<probe>'. Category should be 'bug' or 'content'. Group related "
    "failures into one proposal. Be specific about the fix."
)

_FEATURE_SYSTEM = (
    "You are a pragmatic product manager for a math-education app. Given its map "
    "of routes/screens, propose a FEW small, high-value feature additions or "
    "flow improvements that fill obvious gaps. Hard rules: each must be small "
    "and independently shippable; nothing touching auth, billing, or data "
    "schema; concrete, not vague. Prefer 2-4 strong ideas. Be conservative — "
    "these are suggestions a human will vet."
)


def _still_failing(results: list, mode: str) -> list:  # type: ignore[type-arg]
    """The scenarios that genuinely still fail. In `replay`, a scenario that
    ERRORED (vs ran and failed a check) is a cassette gap — infra noise, not a
    real defect — so it's dropped; in record/auto an error is a real failure."""
    return [
        r.scenario for r in results
        if not r.passed and not (mode == "replay" and r.error)
    ]


async def corpus_failures(
    *, api_base: str, web_base: str, verify: bool = True, mode: str = "auto",
) -> list[dict[str, object]]:
    """Re-verify the harness's promoted generation-failure corpus against the
    LIVE generator and return the entries that STILL fail — one dict per failure
    (probe, scenario, constraint, expected, rationale, fix_in). Shared by both
    proposal paths: `content_quality_proposals` (API-billed, makes its own
    fix-proposal call) and the plan-billed `gather` step (writes these as
    evidence the headless judge proposes from). `verify=False` returns the whole
    corpus without re-running it. Re-verifying is what stops us proposing fixes
    for defects that have already been fixed.

    In `replay` mode a scenario that ERRORED (rather than ran and failed a check)
    is a cassette gap — infra noise, not a real defect — so it's dropped, lest a
    missing cassette masquerade as a still-failing generation bug. In
    record/auto an error IS a real generation failure worth proposing."""
    from tests.harness.explorer import explore, load_corpus
    from tests.harness.probes import PROBES

    failures: list[dict[str, object]] = []
    for name, factory in PROBES.items():
        scenarios = load_corpus(name)
        if not scenarios:
            continue
        probe = factory(1)
        fix_in = probe.relevant_paths()
        if verify:
            try:
                verified = await explore(probe, scenarios, api_base, web_base)
                scenarios = _still_failing(verified.results, mode)
            except Exception:  # noqa: BLE001 — can't re-verify → skip, never propose stale
                continue
        for sc in scenarios:
            failures.append({
                "probe": name, "scenario": sc.name, "constraint": sc.constraint,
                "expected": sc.expected_shapes, "rationale": sc.rationale,
                "fix_in": fix_in,
            })
    return failures


async def content_quality_proposals(
    *, api_base: str, web_base: str,
    model: str = MODEL_REASON, max_size: str = "M", verify: bool = True,
) -> list[Proposal]:
    """Turn the harness's promoted generation-failure corpus into fix proposals.

    When `verify` (default), each promoted failure is re-run through the LIVE
    generator first and only the ones that STILL fail are proposed — so we never
    propose fixing a defect that's already been fixed (a real gap an execution
    demo caught: the corpus keeps fixed failures, and stale entries led to a
    dead-end proposal). Returns [] when nothing still fails or the cassette
    misses in replay."""
    failures = await corpus_failures(api_base=api_base, web_base=web_base, verify=verify)
    if not failures:
        return []
    blob = json.dumps(failures, sort_keys=True)
    key = hashlib.sha1(blob.encode()).hexdigest()[:16]
    user = (
        "Known AI-generation failures (promoted regression corpus):\n\n"
        f"{blob}\n\nPropose concrete fixes per the rules."
    )
    try:
        result = await call_claude_json(
            _CONTENT_SYSTEM, user, LLMMode.JUDGE, tool_schema=_SCHEMA,
            model=model, max_tokens=3072,
            call_metadata={"harness_cassette_key": f"content_quality:{key}"},
        )
    except CassetteMissError:
        return []
    raw = result.get("proposals", [])
    if not isinstance(raw, list):
        return []
    return rank_filter([_coerce(p) for p in raw if isinstance(p, dict)], max_size=max_size)


async def feature_proposals(
    surfaces: list[Surface], *, model: str = MODEL_REASON, max_size: str = "M",
) -> list[Proposal]:
    """Conservative product-gap pass over the route catalog. Confidence is damped
    so feature ideas never outrank observed defects."""
    catalog = [
        {"key": s.key, "title": s.title, "role": s.role, "app": s.app}
        for s in surfaces
    ]
    blob = json.dumps(catalog, sort_keys=True)
    key = hashlib.sha1(blob.encode()).hexdigest()[:16]
    user = (
        f"App surface map (routes):\n\n{blob}\n\n"
        "Propose a few small, high-value feature additions or flow improvements."
    )
    try:
        result = await call_claude_json(
            _FEATURE_SYSTEM, user, LLMMode.JUDGE, tool_schema=_SCHEMA,
            model=model, max_tokens=3072,
            call_metadata={"harness_cassette_key": f"features:{key}"},
        )
    except CassetteMissError:
        return []
    raw = result.get("proposals", [])
    if not isinstance(raw, list):
        return []
    out: list[Proposal] = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        prop = _coerce(p)
        prop.category = "feature"
        prop.confidence = round(prop.confidence * _FEATURE_CONFIDENCE_DAMP, 3)
        out.append(prop)
    return rank_filter(out, max_size=max_size)
