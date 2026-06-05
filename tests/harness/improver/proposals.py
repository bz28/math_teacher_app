"""Ideation — turn raw page signal into ranked, deduped, size-capped proposals.

The scanner + detectors + judge produce a pile of per-page hits. This layer asks
a reasoning model to synthesize them into a handful of CONCRETE, actionable
proposals: group related hits, write the specific change, estimate its size and
its author's confidence. We then drop anything too big or touching forbidden
surfaces, dedupe against what's already been proposed or declined, and rank by
impact-per-effort. The output is what gets pushed to Ben for approval.

Scope (locked with Ben): visual/UX polish, bugs & a11y, performance, AND small
new features — but every change small (hard size cap), never schema/auth/billing.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field

from api.core.llm_client import MODEL_REASON, LLMMode, call_claude_json
from api.core.llm_schemas import ToolSchema
from tests.harness.cassette import CassetteMissError
from tests.harness.improver.types import PageObservation

CATEGORIES = ["visual", "a11y", "bug", "performance", "content", "feature"]
SIZES = ["S", "M", "L"]
_SIZE_RANK = {"S": 1, "M": 2, "L": 3}
_SEVERITY_WEIGHT = {"high": 3.0, "medium": 2.0, "low": 1.0}

# A proposal touching any of these is dropped pre-approval — too risky for the
# autonomous loop regardless of how small it looks.
_FORBIDDEN = re.compile(r"\b(schema|migration|auth|login|password|billing|payment|stripe|token|secret)\b", re.I)


@dataclass
class Proposal:
    surface_key: str
    title: str
    category: str  # one of CATEGORIES
    severity: str  # high | medium | low
    rationale: str  # why it matters, citing the observed evidence
    change: str  # the concrete proposed change
    est_size: str  # S | M | L
    confidence: float  # 0..1, the model's own confidence it's a real win
    evidence: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        """Stable signature so the same idea dedupes across runs."""
        norm = re.sub(r"\s+", " ", f"{self.surface_key}:{self.title}".lower()).strip()
        return hashlib.sha1(norm.encode()).hexdigest()[:12]

    @property
    def score(self) -> float:
        """Impact-per-effort: confidence × severity / size."""
        sev = _SEVERITY_WEIGHT.get(self.severity, 1.0)
        size = _SIZE_RANK.get(self.est_size, 2)
        return round(self.confidence * sev / size, 4)

    @property
    def forbidden(self) -> bool:
        return bool(_FORBIDDEN.search(f"{self.title} {self.change}"))


def _signal(observations: list[PageObservation]) -> list[dict[str, object]]:
    """Compact, model-ready summary of only the surfaces with something to act
    on — broken loads, console errors, or detector/judge hits."""
    payload: list[dict[str, object]] = []
    for o in observations:
        if not o.high_signal:
            continue
        payload.append({
            "surface": o.surface_key,
            "url": o.url,
            "role": o.role,
            "loaded": o.ok,
            "load_ms": round(o.load_ms) if o.load_ms else None,
            "console_errors": o.console_errors[:5],
            "hits": [
                {"detector": h.detector, "severity": h.severity,
                 "detail": h.detail, "where": h.evidence[:160], "source": h.source}
                for h in o.hits
            ],
        })
    return payload


_SCHEMA: ToolSchema = {
    "name": "propose_improvements",
    "description": "Propose concrete, small, actionable improvements from observed page signal.",
    "input_schema": {
        "type": "object",
        "properties": {
            "proposals": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "surface_key": {"type": "string", "description": "which observed surface this is for"},
                        "title": {"type": "string", "description": "short imperative title"},
                        "category": {"type": "string", "enum": CATEGORIES},
                        "severity": {"type": "string", "enum": ["high", "medium", "low"]},
                        "rationale": {"type": "string", "description": "why it matters, citing the evidence"},
                        "change": {"type": "string", "description": "the specific change to make"},
                        "est_size": {"type": "string", "enum": SIZES, "description": "S=<1h, M=half-day, L=bigger"},
                        "confidence": {"type": "number", "description": "0..1 that this is a real, worthwhile win"},
                    },
                    "required": ["surface_key", "title", "category", "severity",
                                 "rationale", "change", "est_size", "confidence"],
                },
            },
        },
        "required": ["proposals"],
    },
}

_SYSTEM = (
    "You are a senior product engineer triaging automated UI/UX/quality signal "
    "from a math-education app into a SHORT list of high-value improvements. "
    "Group related hits on the same surface into ONE proposal. Each proposal "
    "must be concrete (name the change, not a vague 'improve X'), small, and "
    "independently shippable. You may propose small NEW features where the page "
    "shows an obvious gap, but keep them small. Be conservative with confidence: "
    "objective detector hits (console errors, a11y, overflow) are reliable; "
    "judge (UX) hits are softer. Never propose changes to database schema, auth, "
    "or billing. Prefer 3-6 strong proposals over a long mediocre list."
)


async def generate_proposals(
    observations: list[PageObservation],
    *,
    model: str = MODEL_REASON,
    max_size: str = "M",
) -> list[Proposal]:
    """Synthesize ranked proposals from a scan. Returns [] when there's no signal
    or the cassette misses in replay. Caller dedupes against persisted state."""
    signal = _signal(observations)
    if not signal:
        return []
    blob = json.dumps(signal, sort_keys=True)
    key = hashlib.sha1(blob.encode()).hexdigest()[:16]
    user = (
        "Observed signal across scanned surfaces (JSON):\n\n"
        f"{blob}\n\nPropose improvements per the rules."
    )
    try:
        result = await call_claude_json(
            _SYSTEM, user, LLMMode.JUDGE,
            tool_schema=_SCHEMA, model=model, max_tokens=4096,
            call_metadata={"harness_cassette_key": f"propose:{key}"},
        )
    except CassetteMissError:
        return []
    raw = result.get("proposals", [])
    if not isinstance(raw, list):
        return []
    proposals = [_coerce(p) for p in raw if isinstance(p, dict)]
    return _rank(rank_filter(proposals, max_size=max_size))


def _coerce(p: dict[str, object]) -> Proposal:
    """Build a Proposal from one raw model item, clamping confidence to [0,1] and
    normalizing the enum-ish fields."""
    category = str(p.get("category", "visual"))
    severity = str(p.get("severity", "low"))
    est_size = str(p.get("est_size", "M")).upper()
    try:
        confidence = float(p.get("confidence", 0.5))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        confidence = 0.5
    return Proposal(
        surface_key=str(p.get("surface_key", "")),
        title=str(p.get("title", "")).strip(),
        category=category if category in CATEGORIES else "visual",
        severity=severity if severity in _SEVERITY_WEIGHT else "low",
        rationale=str(p.get("rationale", "")).strip(),
        change=str(p.get("change", "")).strip(),
        est_size=est_size if est_size in SIZES else "M",
        confidence=min(1.0, max(0.0, confidence)),
    )


def rank_filter(proposals: list[Proposal], *, max_size: str = "M") -> list[Proposal]:
    """Drop empties, oversized changes, and forbidden surfaces."""
    cap = _SIZE_RANK.get(max_size, 2)
    return [
        p for p in proposals
        if p.title and not p.forbidden and _SIZE_RANK.get(p.est_size, 2) <= cap
    ]


def _rank(proposals: list[Proposal]) -> list[Proposal]:
    return sorted(proposals, key=lambda p: p.score, reverse=True)


def dedupe(proposals: list[Proposal], seen_ids: set[str]) -> list[Proposal]:
    """Drop proposals already proposed or declined (by stable id), and collapse
    duplicates within this batch."""
    out: list[Proposal] = []
    batch: set[str] = set()
    for p in proposals:
        if p.id in seen_ids or p.id in batch:
            continue
        batch.add(p.id)
        out.append(p)
    return out


def to_dict(p: Proposal) -> dict[str, object]:
    """Serializable form (adds the derived id/score) for the state store + report."""
    d = asdict(p)
    d["id"] = p.id
    d["score"] = p.score
    return d
