"""The UX judge — the subjective layer.

Where detectors find facts, the judge looks at a full-page screenshot the way a
senior product designer would and names concrete, *located*, actionable issues:
cramped spacing, weak hierarchy, low contrast, confusing affordances, awkward
copy, empty/broken states. It reuses the harness's vision path
(`call_claude_vision`, cassette-cached → $0 on replay) and, in production, runs
on the separate Console API key (Phase 3 sets that via env on the scan process,
so no client change is needed here).

Output is a list of DetectorHit(source="judge") so the proposer treats judge and
detector signal uniformly — but flagged lower-confidence, since taste is fuzzier
than a console error.
"""

from __future__ import annotations

import base64
import io
from typing import Any

from PIL import Image

from api.core.llm_client import MODEL_HAIKU, LLMMode, call_claude_vision
from api.core.llm_schemas import ToolSchema
from tests.harness.cassette import CassetteMissError
from tests.harness.improver.types import DetectorHit

# Anthropic rejects images whose longest edge exceeds 8000px and downscales
# anything over ~1568px anyway, so we shrink full-page shots (which at 2x device
# scale routinely exceed both) to this long edge — fixing the hard limit and
# roughly halving vision-token cost with no loss of assessable detail.
_MAX_EDGE = 1568


def _downscale(png: bytes, max_edge: int = _MAX_EDGE) -> bytes:
    """Shrink a PNG so its longest edge is <= max_edge. Returns the input
    unchanged if it's already small enough or can't be decoded."""
    try:
        img = Image.open(io.BytesIO(png))
        if max(img.size) <= max_edge:
            return png
        img.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:  # noqa: BLE001 — a bad image just goes un-resized
        return png

_CATEGORIES = ["visual", "hierarchy", "spacing", "affordance", "content", "state"]

_INSTRUCTIONS = (
    "You are a senior product designer reviewing one screen of a math-education "
    "web app. Identify CONCRETE, ACTIONABLE UI/UX problems a designer would flag "
    "in review — cramped or inconsistent spacing, weak visual hierarchy, low "
    "contrast or legibility, confusing or missing affordances, awkward/unclear "
    "copy, broken or empty states, misalignment, cut-off content. For each, say "
    "WHERE on the screen it is and HOW to fix it. Rules: be specific, not "
    "generic; ignore that this is seeded/test data (don't critique placeholder "
    "names or sample numbers); prefer reporting FEWER, real issues over "
    "nitpicks; if the screen looks good, return an empty list. Max 6 issues."
)


def _schema() -> ToolSchema:
    return {
        "name": "report_ux_issues",
        "description": "Report concrete, located, actionable UX issues on this screen.",
        "input_schema": {
            "type": "object",
            "properties": {
                "issues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                            "category": {"type": "string", "enum": _CATEGORIES},
                            "area": {"type": "string", "description": "where on screen (e.g. 'top nav')"},
                            "problem": {"type": "string", "description": "the concrete issue"},
                            "suggestion": {"type": "string", "description": "how to fix it"},
                        },
                        "required": ["severity", "category", "area", "problem", "suggestion"],
                    },
                },
            },
            "required": ["issues"],
        },
    }


async def judge_page(
    png: bytes | None,
    *,
    surface_key: str,
    title: str,
    role: str,
    model: str = MODEL_HAIKU,
) -> list[DetectorHit]:
    """Score one full-page screenshot for UX issues. Returns [] when there's no
    image, the cassette misses in replay, or the screen looks clean."""
    if png is None:
        return []
    b64 = base64.b64encode(_downscale(png)).decode("ascii")
    user_content = [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
        {"type": "text", "text": f"{_INSTRUCTIONS}\n\nScreen: {title} (role: {role})."},
    ]
    try:
        result: dict[str, Any] = await call_claude_vision(
            user_content,
            LLMMode.JUDGE,
            tool_schema=_schema(),
            model=model,
            max_tokens=1024,
            # Stable key on the surface identity, not screenshot bytes, so replay
            # is reproducible across runs (screenshots jitter pixel-to-pixel).
            call_metadata={"harness_cassette_key": f"ux_judge:{surface_key}"},
        )
    except CassetteMissError:
        # Judge cassettes are a local cache; on a fresh replay checkout there's
        # nothing to replay. The judge is advisory — skip, don't fail the scan.
        return []
    except Exception:  # noqa: BLE001 — one page's judge error is data, not a crash
        return []
    hits: list[DetectorHit] = []
    for issue in result.get("issues", []):
        if not isinstance(issue, dict):
            continue
        severity = issue.get("severity", "low")
        if severity not in ("high", "medium", "low"):
            severity = "low"
        category = issue.get("category", "visual")
        area = str(issue.get("area", "")).strip()
        suggestion = str(issue.get("suggestion", "")).strip()
        hits.append(DetectorHit(
            detector=f"ux:{category}",
            severity=severity,
            detail=str(issue.get("problem", "")).strip(),
            evidence=f"{area} — {suggestion}" if area or suggestion else "",
            source="judge",
        ))
    return hits
