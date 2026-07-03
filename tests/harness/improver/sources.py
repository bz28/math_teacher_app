"""Extra proposal sources beyond the UI scanner.

The page scanner only sees rendered UI, so on its own the improver proposes only
visual/UX/a11y/perf work. `ideate_proposals` widens the lens to the third thing
Ben asked for: FEATURE gaps.

  * ideate_proposals — product-grounded ideation. Reads the product overview
    (`docs/product/overview.md`) plus the route catalog and proposes a few
    high-value FEATURE-GAP ideas — real capabilities a teacher/student would
    want that don't exist yet — with damped confidence so speculative ideas
    always rank below objective findings and never lead. This is the dev-only,
    API-billed parity path; the cloud loop does the same ideation inside the
    plan-billed judge (see `evidence.py`).

It emits the same Proposal type as the UI proposer, so it flows through the
identical dedupe -> rank -> approve -> execute pipeline.
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

_IDEATE_SYSTEM = (
    "You are a pragmatic product manager for Veradic, an AI math-education app. "
    "You are given the product overview (what exists today, who it's for, and its "
    "current scope) and the map of routes/screens. Propose a FEW (2-4) high-value "
    "FEATURE-GAP ideas: real capabilities a teacher or student would want that "
    "DON'T already exist. Ground them in the overview's feature map so you propose "
    "genuine GAPS, not duplicates of shipped features. Honor the overview's scope "
    "note: stay within the product's AI loop (homework -> grade -> understand -> "
    "reteach) and treat general LMS features (gradebook export, SIS/roster sync, "
    "messaging, attendance) as out of current scope. Hard rules: each must be "
    "small and independently shippable; nothing touching auth, billing, or data "
    "schema; concrete, not vague. Set surface_key to 'product' and category to "
    "'feature'. Be conservative — these are suggestions a human will vet."
)


async def ideate_proposals(
    product_overview: str,
    surfaces: list[Surface],
    *,
    model: str = MODEL_REASON,
    max_size: str = "M",
) -> list[Proposal]:
    """Product-grounded feature-gap ideation over the overview + route catalog.

    Reads `product_overview` (the text of `docs/product/overview.md`) so ideas
    are grounded in what already exists and the product's current scope, rather
    than reasoning from the bare route list. Confidence is damped so feature
    ideas never outrank observed defects. Returns [] when the cassette misses in
    replay. Dev-only path (API-billed); the cloud loop ideates via the
    plan-billed judge in `evidence.py`."""
    catalog = [
        {"key": s.key, "title": s.title, "role": s.role, "app": s.app}
        for s in surfaces
    ]
    blob = json.dumps(catalog, sort_keys=True)
    key = hashlib.sha1((product_overview + "\n" + blob).encode()).hexdigest()[:16]
    user = (
        "Product overview (source of truth for what exists + current scope):\n\n"
        f"{product_overview or '(none provided — propose from the route map alone)'}\n\n"
        f"App surface map (routes):\n\n{blob}\n\n"
        "Propose a few high-value feature-gap ideas per the rules."
    )
    try:
        result = await call_claude_json(
            _IDEATE_SYSTEM, user, LLMMode.JUDGE, tool_schema=_SCHEMA,
            model=model, max_tokens=3072,
            call_metadata={"harness_cassette_key": f"ideate:{key}"},
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
        prop.surface_key = "product"
        prop.category = "feature"
        prop.confidence = round(prop.confidence * _FEATURE_CONFIDENCE_DAMP, 3)
        out.append(prop)
    return rank_filter(out, max_size=max_size)
