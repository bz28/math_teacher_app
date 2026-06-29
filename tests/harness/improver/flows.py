"""Flow tests — drive real multi-step user journeys and report only HARD
failures, so the improver catches "the feature is broken when you do it", not
just "the page looks off" (the load-only scan) or "the AI output is wrong" (the
probes). A broken journey becomes a human ALERT in the scan's GitHub issue —
NOT an auto-fix proposal, because journeys often live on auth/billing/grading
surfaces the agent must never edit (see flow_alert_md).

Two layers, picked per journey by which can be made NON-FLAKY:
  • Browser layer (login, logout) — the journey IS the UI: a form render +
    submit + redirect that no API call captures. Asserts on a definitive
    Playwright signal (a required element/navigation that surfaces as a
    timeout when broken).
  • API layer (join-class, submit-homework, grade+publish) — the journey is a
    deterministic state change (a record exists, a status flips, a count
    increments). The school-student / teacher-grading UIs for these are photo
    upload + a two-pane keyboard review surface that can't be driven reliably,
    so we exercise the SAME endpoints the web app calls and assert on the
    deterministic response. No LLM is in any of these paths (the seeded HW
    keeps integrity/AI-grading off), so they're $0 and reproducible.

Conservative by design. A flow fails ONLY on a definitive, high-confidence
signal: a required element/navigation never happens, or an endpoint returns the
wrong status/body. Subjective quality is never judged here. An UNEXPECTED
harness error (browser crash, the API unreachable) RAISES and is swallowed by
`run_flows`, which DROPS the flow rather than reporting a failure — a
false-positive proposal would poison trust in the whole agent, so the bar for
"failed" is high and the bar for "skip" is low.

Flows run after the surface scan, sharing its browser + seeded world. Browser
flows use the web base URL; API flows use the API base URL (same backend the
web app talks to).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import httpx
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import (
    Seed,
    seed_joinable_section,
    seed_submitted_submission,
)

# Generous, matching the scanner — so slow CI is never mistaken for a failure.
_TIMEOUT_MS = 30000
# API-flow HTTP timeout. Generous so a cold/slow API isn't read as a failure;
# a genuine hang raises httpx.TimeoutException → run_flows DROPS the flow.
_HTTP_TIMEOUT_S = 30.0

# A real 1×1 PNG (valid magic bytes) — the submit endpoint validates uploads by
# magic byte, so this is the smallest payload that passes without shipping a
# fixture file. Typed-only homework submission isn't supported (the work image
# is the source of truth), so we submit this stand-in page.
_TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M8AAAQEAYqDX8gAAAAASUVORK5CYII="
)


@dataclass
class FlowResult:
    """One journey's outcome. `issues` is empty iff the journey completed."""

    name: str
    title: str  # human label for the proposal/report
    passed: bool
    issues: list[str] = field(default_factory=list)


async def _login_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
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


async def _logout_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Authenticated → click Sign Out → land back on /login. Tests session
    teardown end-to-end (auth-class, like login: a break here pages you, it is
    never auto-fixed)."""
    issues: list[str] = []
    async with browser.authed_page(seed.student_token, seed.student_refresh) as page:
        await page.goto(
            # domcontentloaded, not networkidle (which _login_flow already uses):
            # /home is a chatty SPA and networkidle can time out on a still-open
            # connection, which run_flows swallows — silently SKIPPING a real
            # broken logout instead of reporting it. The Sign Out control is in
            # the hydrated layout, so domcontentloaded is enough to find it.
            f"{web_base.rstrip('/')}/home",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        try:
            await page.click("button:has-text('Sign Out')", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("no Sign Out control found while authenticated on /home")
            return FlowResult("logout", "Student logout", False, issues)
        try:
            await page.wait_for_url(lambda url: "/login" in url, timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Sign Out did not return to /login — logout may be broken")

    return FlowResult("logout", "Student logout", not issues, issues)


# ── API-layer journeys (see module docstring for why these aren't browser
# flows). Each hits the same endpoints the web app calls, with seeded tokens,
# and asserts on a deterministic response. A wrong status/body is a real
# failure (append an issue); an unreachable API raises httpx errors that
# run_flows drops. ──


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _join_class_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Student enters a class join code → lands enrolled. Exercises
    `POST /teacher/join` (the call the school-student join modal makes) against
    a fresh joinable section, then re-joins to prove the enrollment actually
    persisted — a second join is rejected 409 'Already in this section'."""
    name, title = "join_class", "Student joins a class by code"
    issues: list[str] = []
    code = await seed_joinable_section(seed)
    base = api_base.rstrip("/")
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        resp = await client.post(
            f"{base}/teacher/join", json={"join_code": code},
            headers=_auth(seed.student_token),
        )
        if resp.status_code != 200:
            issues.append(
                f"join with a valid code returned {resp.status_code}, expected 200 "
                "(student could not enroll via join code)",
            )
            return FlowResult(name, title, False, issues)
        if not resp.json().get("section_id"):
            issues.append("join succeeded but the response carried no section_id")

        again = await client.post(
            f"{base}/teacher/join", json={"join_code": code},
            headers=_auth(seed.student_token),
        )
        if again.status_code != 409:
            issues.append(
                f"re-joining the same section returned {again.status_code}, expected "
                "409 — the first join may not have created an enrollment",
            )
    return FlowResult(name, title, not issues, issues)


async def _submit_homework_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Enrolled student submits work to a published homework → the submission
    is recorded. Exercises `POST /school/student/homework/{id}/submit` with a
    real image page, then confirms persistence by re-submitting (one-shot HW
    rejects the second attempt 409 'Already submitted'). The seeded HW keeps
    integrity + AI-grading OFF, so no extraction/LLM fires."""
    name, title = "submit_homework", "Student submits homework"
    issues: list[str] = []
    base = api_base.rstrip("/")
    url = f"{base}/school/student/homework/{seed.assignment_id}/submit"
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        resp = await client.post(
            url, json={"files": [_TINY_PNG_B64]}, headers=_auth(seed.student_token),
        )
        if resp.status_code != 200:
            issues.append(
                f"submitting homework returned {resp.status_code}, expected 200 "
                "(student could not submit work)",
            )
            return FlowResult(name, title, False, issues)
        if not resp.json().get("submission_id"):
            issues.append("submit succeeded but the response carried no submission_id")

        again = await client.post(
            url, json={"files": [_TINY_PNG_B64]}, headers=_auth(seed.student_token),
        )
        if again.status_code != 409:
            issues.append(
                f"re-submitting returned {again.status_code}, expected 409 — the "
                "first submission may not have been recorded",
            )
    return FlowResult(name, title, not issues, issues)


async def _grade_publish_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher grades a submitted homework and publishes it → the grade
    persists and is released to the student. Seeds one submitted submission,
    then exercises `PATCH /teacher/submissions/{id}/grade` (manual full credit,
    no AI) and `POST /teacher/assignments/{id}/publish-grades`. Asserts the
    score is set and the publish counts the grade."""
    name, title = "grade_publish", "Teacher grades and publishes"
    issues: list[str] = []
    submission_id = await seed_submitted_submission(seed)
    base = api_base.rstrip("/")
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        graded = await client.patch(
            f"{base}/teacher/submissions/{submission_id}/grade",
            json={"breakdown": [
                {"problem_id": "p1", "score_status": "full", "percent": 100},
            ]},
            headers=_auth(seed.teacher_token),
        )
        if graded.status_code != 200:
            issues.append(
                f"grading a submission returned {graded.status_code}, expected 200",
            )
            return FlowResult(name, title, False, issues)
        if graded.json().get("final_score") != 100:
            issues.append(
                f"full-credit grade set final_score={graded.json().get('final_score')!r}, "
                "expected 100",
            )

        published = await client.post(
            f"{base}/teacher/assignments/{seed.assignment_id}/publish-grades",
            json={"reviewed_only": False}, headers=_auth(seed.teacher_token),
        )
        if published.status_code != 200:
            issues.append(
                f"publishing grades returned {published.status_code}, expected 200",
            )
            return FlowResult(name, title, False, issues)
        if (published.json().get("published_count") or 0) < 1:
            issues.append(
                "publish-grades reported published_count=0 — the graded "
                "submission was not released to the student",
            )
    return FlowResult(name, title, not issues, issues)


# Register new journeys here. Each returns a FlowResult; for a real app failure
# append an issue, but RAISE on unexpected infra errors so run_flows drops them.
# (Deferred: the practice/learn journeys need LLM generation + a queue-based
# multi-page entry — a real build + a per-scan cost decision, not a quick add.)
_FLOWS = (
    _login_flow, _logout_flow,
    _join_class_flow, _submit_homework_flow, _grade_publish_flow,
)


def _flow_key(flow: Callable[..., object]) -> str:
    """The stable name a flow reports (matches FlowResult.name), derived from
    its function name so `only=` can select without a second registry."""
    return flow.__name__.strip("_").removesuffix("_flow")


def flow_names() -> tuple[str, ...]:
    """Every registered flow's selector name (for the CLI `--only` help)."""
    return tuple(_flow_key(f) for f in _FLOWS)


async def run_flows(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
    *, only: set[str] | None = None,
) -> list[FlowResult]:
    """Run every journey (or just those named in `only`), sharing the scan's
    browser + seed. An unexpected harness error drops that flow (no proposal)
    rather than reporting a failure — infra noise must never masquerade as an
    app bug."""
    results: list[FlowResult] = []
    for flow in _FLOWS:
        if only is not None and _flow_key(flow) not in only:
            continue
        try:
            results.append(await flow(browser, web_base, api_base, seed))
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
