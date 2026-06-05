"""Objective detectors — the high-confidence, $0 signal.

These run against the LIVE Playwright page (not the screenshot), so they see the
real DOM, network state, and timing. A hit here is a *fact* — a console error,
a horizontally-scrolling layout, an image that 404'd, an axe accessibility
violation, a slow load — not a matter of taste. The UX judge (judge.py) adds
the subjective layer on top, clearly flagged as lower-confidence.

Everything is best-effort: a detector that throws records nothing rather than
breaking the scan.
"""

from __future__ import annotations

from typing import Any

from playwright.async_api import Page

from tests.harness.improver.types import DetectorHit

# axe-core injected from CDN; if the page is offline or CSP blocks it, the a11y
# pass is silently skipped (best-effort, never fatal).
_AXE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
_AXE_IMPACT_SEVERITY = {
    "critical": "high", "serious": "high", "moderate": "medium", "minor": "low",
}

# Load-time thresholds (ms) — generous, so only genuinely sluggish pages flag.
_SLOW_LOAD_MS = 5000.0
_VERY_SLOW_LOAD_MS = 10000.0

_MAX_A11Y_HITS = 8  # cap so one messy page can't flood the proposal queue
_MAX_BROKEN_IMG_HITS = 10


async def _layout_overflow(page: Page) -> list[DetectorHit]:
    """Horizontal page overflow — a near-certain responsive/layout bug."""
    data: dict[str, Any] = await page.evaluate(
        """() => {
            const de = document.documentElement;
            return { overflow: de.scrollWidth - de.clientWidth, vw: window.innerWidth };
        }"""
    )
    if data.get("overflow", 0) > 4:  # tolerate sub-pixel rounding
        return [DetectorHit(
            detector="overflow", severity="medium",
            detail=f"page scrolls horizontally by {data['overflow']}px (viewport {data['vw']}px)",
            evidence="document overflow-x",
        )]
    return []


async def _broken_images(page: Page) -> list[DetectorHit]:
    """<img>s that finished loading with zero natural size = failed to load."""
    broken: list[str] = await page.evaluate(
        """() => Array.from(document.images)
            .filter(i => i.complete && i.naturalWidth === 0)
            .map(i => i.currentSrc || i.src)"""
    )
    return [
        DetectorHit(
            detector="broken_image", severity="medium",
            detail="image failed to load", evidence=src,
        )
        for src in broken[:_MAX_BROKEN_IMG_HITS]
    ]


async def _a11y(page: Page) -> list[DetectorHit]:
    """Run axe-core and surface its violations, capped + sorted by impact."""
    try:
        await page.add_script_tag(url=_AXE_CDN)
        result: dict[str, Any] = await page.evaluate(
            "async () => await axe.run(document, { resultTypes: ['violations'] })"
        )
    except Exception:  # noqa: BLE001 — a11y is best-effort
        return []
    violations = result.get("violations", []) if isinstance(result, dict) else []
    # Sort most-severe first; an unexpected/missing impact ranks last instead of
    # raising (axe data is external input even if the CDN is pinned).
    _rank = {"critical": 0, "serious": 1, "moderate": 2, "minor": 3}
    violations.sort(key=lambda v: _rank.get(v.get("impact"), 99))
    hits: list[DetectorHit] = []
    for v in violations[:_MAX_A11Y_HITS]:
        count = len(v.get("nodes", []))
        hits.append(DetectorHit(
            detector="a11y", severity=_AXE_IMPACT_SEVERITY.get(v.get("impact"), "low"),  # type: ignore[arg-type]
            detail=f"{v.get('help', v.get('id'))} ({count} element{'s' if count != 1 else ''})",
            evidence=v.get("helpUrl", v.get("id", "")),
        ))
    return hits


def _slow_load(load_ms: float | None) -> list[DetectorHit]:
    if load_ms is None or load_ms < _SLOW_LOAD_MS:
        return []
    severity = "high" if load_ms >= _VERY_SLOW_LOAD_MS else "medium"
    return [DetectorHit(
        detector="slow_load", severity=severity,  # type: ignore[arg-type]
        detail=f"page took {load_ms / 1000:.1f}s to reach networkidle",
        evidence="navigation timing",
    )]


async def run_detectors(page: Page, *, load_ms: float | None) -> list[DetectorHit]:
    """Run every objective detector against a live page. Each is isolated so one
    failure never sinks the others or the scan."""
    hits: list[DetectorHit] = list(_slow_load(load_ms))
    for detector in (_layout_overflow, _broken_images, _a11y):
        try:
            hits.extend(await detector(page))
        except Exception:  # noqa: BLE001 — a detector failure is not a scan failure
            continue
    return hits
