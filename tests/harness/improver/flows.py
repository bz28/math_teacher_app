"""Browser flow tests — drive real multi-step user journeys and report only
HARD failures, so the improver catches "the feature is broken when you click
it", not just "the page looks off" (the load-only scan) or "the AI output is
wrong" (the probes). A broken journey becomes a human ALERT in the scan's
GitHub issue — NOT an auto-fix proposal, because journeys usually live on
auth/billing surfaces the agent must never edit (see flow_alert_md).

Conservative by design. A flow fails ONLY on a definitive, high-confidence
signal: a required element never appears, or a required navigation never
happens (both surface as a Playwright timeout on an explicit wait). Subjective
quality is never judged here. An UNEXPECTED harness error (browser crash, infra
hiccup) is swallowed by `run_flows` and DROPS the flow rather than reporting a
failure — a false-positive proposal would poison trust in the whole agent, so
the bar for "failed" is high and the bar for "skip" is low.

Flows run after the surface scan, sharing its browser + seeded world. The web
app calls the API itself, so a flow only needs the web base URL.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed

# Generous, matching the scanner — so slow CI is never mistaken for a failure.
_TIMEOUT_MS = 30000


@dataclass
class FlowResult:
    """One journey's outcome. `issues` is empty iff the journey completed."""

    name: str
    title: str  # human label for the proposal/report
    passed: bool
    issues: list[str] = field(default_factory=list)


async def _login_flow(browser: HarnessBrowser, web_base: str, seed: Seed) -> FlowResult:
    """Logged-out → fill the real login form → land authenticated. Exercises the
    whole auth path (form render, submit, token exchange, redirect) — none of
    which the load-only scan touches. No token injection: this IS the login."""
    issues: list[str] = []
    async with browser.plain_page() as page:
        await page.goto(
            f"{web_base.rstrip('/')}/login",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        try:
            await page.wait_for_selector("#email", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("login form never rendered (#email not found)")
            return FlowResult("login", "Student login", False, issues)

        await page.fill("#email", seed.student_email)
        await page.fill("#password", "x")  # the seed hashes "x" for every user
        await page.click('button[type="submit"]')

        # Success = we leave /login for an authed route. The seeded student has
        # no school, so the app lands on /home; assert only that we left /login,
        # to stay robust to the exact destination.
        try:
            await page.wait_for_url(lambda url: "/login" not in url, timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append(
                "login never left /login after submitting the seeded student's "
                "credentials (server error, JS exception, or broken auth)",
            )

    return FlowResult("login", "Student login", not issues, issues)


# Register new journeys here. Each returns a FlowResult; for a real app failure
# append an issue, but RAISE on unexpected infra errors so run_flows drops them.
# (Deferred: the practice journey needs an LLM-generated batch + multi-page
# entry — verify it can't flake before adding it.)
_FLOWS = (_login_flow,)


async def run_flows(
    browser: HarnessBrowser, web_base: str, seed: Seed,
) -> list[FlowResult]:
    """Run every journey, sharing the scan's browser + seed. An unexpected
    harness error drops that flow (no proposal) rather than reporting a failure
    — infra noise must never masquerade as an app bug."""
    results: list[FlowResult] = []
    for flow in _FLOWS:
        try:
            results.append(await flow(browser, web_base, seed))
        except Exception:  # noqa: BLE001 — infra hiccup: skip, never false-flag
            continue
    return results


def flow_failures(results: list[FlowResult]) -> list[dict[str, object]]:
    """The failed journeys, recorded in findings.json. NOT proposal evidence —
    a broken journey usually lives on an auth/billing surface the agent must
    never edit, so these are surfaced as a human alert (see flow_alert_md), not
    fed to the fix pipeline."""
    return [
        {"flow": r.name, "title": r.title, "issues": r.issues}
        for r in results if not r.passed
    ]


def flow_alert_md(failures: list[dict[str, object]]) -> str:
    """A human alert for broken journeys — they page YOU rather than entering
    the auto-fix queue, because the agent can't (and must not) edit auth/billing
    code. Empty string when nothing broke (caller skips the alert)."""
    if not failures:
        return ""
    lines = ["### ⚠️ Broken user journeys — needs your attention (not auto-fixable)"]
    for f in failures:
        issues = "; ".join(str(i) for i in (f.get("issues") or []))
        lines.append(f"- **{f.get('title') or f.get('flow')}**: {issues}")
    return "\n".join(lines)
