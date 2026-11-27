"""Flow tests — drive real multi-step user journeys and report only HARD
failures, so they catch "the feature is broken when you do it" rather than
"the AI output is wrong" (the probes). Run by `python -m tests.harness flows`,
nightly in .github/workflows/harness-flows.yml.

Two layers, picked per journey by which can be made NON-FLAKY:
  • Browser layer (login, logout, student insights, confirm reading) — the
    journey IS the UI: a form render + submit + redirect that no API call
    captures. Asserts on a definitive
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

Flows share one browser and one seeded world per run. Browser
flows use the web base URL; API flows use the API base URL (same backend the
web app talks to).
"""

from __future__ import annotations

import base64
import io
import re
from collections.abc import Callable

import httpx
from PIL import Image
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.flows_due_dates import change_section_due_date_flow
from tests.harness.flows_generation import generation_survives_leaving_flow
from tests.harness.flows_homework import (
    add_from_bank_flow,
    add_from_bank_on_homework_flow,
    create_homework_flow,
    duplicate_homework_flow,
)
from tests.harness.seed import (
    WORKSHOP_FLOW_FIGURE,
    Seed,
    seed_confirmable_submission,
    seed_insights_homework,
    seed_joinable_section,
    seed_review_homework,
    seed_submitted_submission,
    seed_workshop_item,
)
from tests.harness.types import FlowResult

# Generous, so slow CI is never mistaken for a failure.
_TIMEOUT_MS = 30000
# The flagged problem's line on Student Insights, e.g. "5 of 5 got it wrong".
_INSIGHTS_WRONG_RE = re.compile(r"\d+ of \d+ got it wrong")
# API-flow HTTP timeout. Generous so a cold/slow API isn't read as a failure;
# a genuine hang raises httpx.TimeoutException → run_flows DROPS the flow.
_HTTP_TIMEOUT_S = 30.0

# A blank page PNG — the submit endpoint reads the image and refuses a
# page under MIN_PAGE_LONG_EDGE, so this is a real 600×450 page rather than a
# 1×1 stand-in. Typed-only homework submission isn't supported (the work
# image is the source of truth), so we submit this stand-in page.
def _blank_page_b64() -> str:
    buf = io.BytesIO()
    Image.new("L", (600, 450), 255).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


_PAGE_PNG_B64 = _blank_page_b64()


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

        # Success = we leave /login for an authed route (every student lands
        # on /school/student); assert only that we left /login, to stay
        # robust to the exact destination.
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
            # the portal is a chatty SPA and networkidle can time out on a still-open
            # connection, which run_flows swallows — silently SKIPPING a real
            # broken logout instead of reporting it. The Sign Out control is in
            # the hydrated layout, so domcontentloaded is enough to find it.
            f"{web_base.rstrip('/')}/school/student",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        # A first-run student sees the tour's welcome cover over the page;
        # dismiss it so it can't intercept the click (it isn't the journey).
        skip = page.get_by_role("button", name="Skip for now")
        try:
            await skip.click(timeout=5000)
        except PlaywrightTimeoutError:
            pass
        try:
            # Desktop sidebar's icon button; the phone header's is text.
            await page.click(
                "button[title='Sign out']:visible, button:has-text('Sign Out'):visible",
                timeout=_TIMEOUT_MS,
            )
        except PlaywrightTimeoutError:
            issues.append("no Sign Out control found while authenticated on /school/student")
            return FlowResult("logout", "Student logout", False, issues)
        try:
            await page.wait_for_url(lambda url: "/login" in url, timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Sign Out did not return to /login — logout may be broken")

    return FlowResult("logout", "Student logout", not issues, issues)


async def _student_insights_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher opens Student Insights -> sees the problem most of the class got
    wrong, ready to turn into practice. Seeds enough approved zero-credit
    grades for the tab to flag the problem (it waits for a minimum count),
    then asserts the flagged problem's "N of N got it wrong" line and the
    "Create practice set" control that builds the reteach."""
    name, title = "student_insights", "Teacher reads Student Insights"
    issues: list[str] = []
    await seed_insights_homework(seed)
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        try:
            await page.get_by_role("button", name="Student Insights").first.click(timeout=_TIMEOUT_MS)
            await page.get_by_text(_INSIGHTS_WRONG_RE).first.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append(
                "Student Insights never flagged the problem every graded student got wrong",
            )
            return FlowResult(name, title, False, issues)
        if not await page.get_by_role("button", name="Create practice set").count():
            issues.append("a flagged problem has no 'Create practice set' control to build the reteach")
    return FlowResult(name, title, not issues, issues)


async def _confirm_reading_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Student confirms the AI's reading of their work on an AI-graded homework
    with the understanding check OFF → lands on "Turned in". Confirming is the
    last step there, so the page must leave the confirm screen on its own; it
    used to sit on "Saving…" until a reload. A real browser flow because the
    bug was the page's routing, not the endpoint (which succeeded). The
    confirm spawns grading, which fails harmlessly on the harness's dummy key."""
    name, title = "confirm_reading", "Student confirms the reading of their work"
    issues: list[str] = []
    assignment_id, token, refresh = await seed_confirmable_submission(
        seed, page_b64=_PAGE_PNG_B64, integrity_check_enabled=False,
    )
    async with browser.authed_page(token, refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/student/courses/{seed.course_id}"
            f"/homework/{assignment_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        try:
            await page.get_by_role("button", name="Confirm — this is my work").click(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the confirm screen never offered 'Confirm — this is my work' for a ready reading")
            return FlowResult(name, title, False, issues)
        try:
            await page.get_by_text("Turned in", exact=True).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append(
                "after confirming the reading (check off, AI grading on) the page never "
                "reached 'Turned in' — the student is left on the confirm screen",
            )
    return FlowResult(name, title, not issues, issues)


async def _retake_photos_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Student who flagged a reading retakes their photos. On the flagged
    screen: "Retake photos" opens the upload panel in retake mode, "Keep my
    first photos" backs out to the flagged screen, and a real upload through
    "Send new photos" replaces the turn-in. A browser flow because the bugs
    worth catching are routing ones (no way back out; the offer surviving a
    closed retake). Pass/fail on the end state comes from the API, which is
    deterministic. The seeded homework is AI-graded, so the retake spawns a
    fresh reading; the flow asserts only on the retake itself (flag cleared,
    no second retake offered), never on that reading."""
    import shutil
    import tempfile
    from pathlib import Path

    name, title = "retake_photos", "Student retakes the photos of a flagged reading"
    issues: list[str] = []
    assignment_id, token, refresh = await seed_confirmable_submission(
        seed, page_b64=_PAGE_PNG_B64, integrity_check_enabled=False,
    )
    base = api_base.rstrip("/")
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        sub_url = f"{base}/school/student/homework/{assignment_id}/submission"
        sid = (await client.get(sub_url, headers=_auth(token))).json()["submission_id"]
        flagged = await client.post(
            f"{base}/school/student/submissions/{sid}/flag-extraction",
            json={"note": "My photos are hard to read"}, headers=_auth(token),
        )
        if flagged.status_code != 200:
            issues.append(f"flagging the seeded reading returned {flagged.status_code}")
            return FlowResult(name, title, False, issues)

    tmp_dir = Path(tempfile.mkdtemp(prefix="harness_retake_"))
    page_file = tmp_dir / "page.png"
    page_file.write_bytes(base64.b64decode(_PAGE_PNG_B64))
    try:
        issue = await _drive_retake(browser, web_base, seed.course_id, assignment_id,
                                    token, refresh, str(page_file))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    if issue:
        return FlowResult(name, title, False, [issue])

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        body = (await client.get(sub_url, headers=_auth(token))).json()
    if body.get("extraction_flagged_at") is not None:
        issues.append("after 'Send new photos' the turn-in was still flagged — the retake didn't land")
    if body.get("can_retake"):
        issues.append("a second retake is still offered after the one allowed retake")
    return FlowResult(name, title, not issues, issues)


async def _drive_retake(
    browser: HarnessBrowser, web_base: str, course_id: str, assignment_id: str,
    token: str, refresh: str, page_file: str,
) -> str | None:
    """The browser half of `_retake_photos_flow`: the first broken step, or None."""
    async with browser.authed_page(token, refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/student/courses/{course_id}"
            f"/homework/{assignment_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        retake = page.get_by_role("button", name="Retake photos")
        try:
            await retake.click(timeout=_TIMEOUT_MS)
            await page.get_by_text("Retake your photos").wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            return "a flagged, ungraded reading never offered a working 'Retake photos'"
        try:
            await page.get_by_role("button", name="Keep my first photos").click(timeout=_TIMEOUT_MS)
            await retake.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            return "'Keep my first photos' didn't lead back to the flagged screen"
        try:
            await retake.click(timeout=_TIMEOUT_MS)
            await page.locator("input[type=file]").first.set_input_files(page_file)
            await page.get_by_role("button", name="Review new photos").click(timeout=_TIMEOUT_MS)
            await page.get_by_role("button", name="Send new photos").click(timeout=_TIMEOUT_MS)
            await page.get_by_text("Retake your photos").wait_for(state="detached", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            return "uploading a new page and pressing 'Send new photos' never left the retake panel"
    return None


async def _reopen_resubmit_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher reopens a turned-in homework for one student, who turns it
    in again. The reopen is the API call the review page makes; the
    student half is the browser, because the bugs worth catching are
    routing ones (the page still showing the old turn-in instead of the
    upload panel). The end state comes from the API: the old turn-in kept
    as attempt 1, the reopen used up, and a third turn-in refused."""
    import shutil
    import tempfile
    from datetime import UTC, datetime, timedelta
    from pathlib import Path

    name, title = "reopen_resubmit", "Teacher reopens a homework; the student turns it in again"
    issues: list[str] = []
    assignment_id, token, refresh = await seed_confirmable_submission(
        seed, page_b64=_PAGE_PNG_B64, integrity_check_enabled=False,
    )
    base = api_base.rstrip("/")
    teacher = _auth(seed.teacher_token)
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        sub_url = f"{base}/school/student/homework/{assignment_id}/submission"
        sid = (await client.get(sub_url, headers=_auth(token))).json()["submission_id"]
        student_id = (await client.get(f"{base}/teacher/submissions/{sid}", headers=teacher)).json()["student_id"]
        reopened = await client.post(
            f"{base}/teacher/assignments/{assignment_id}/students/{student_id}/reopen",
            json={"due_at": (datetime.now(UTC) + timedelta(days=2)).isoformat()}, headers=teacher,
        )
        if reopened.status_code != 200 or not reopened.json().get("reopened_at"):
            issues.append(f"reopening for the student returned {reopened.status_code}: {reopened.text[:200]}")
            return FlowResult(name, title, False, issues)

    tmp_dir = Path(tempfile.mkdtemp(prefix="harness_reopen_"))
    page_file = tmp_dir / "page.png"
    page_file.write_bytes(base64.b64decode(_PAGE_PNG_B64))
    try:
        issue = await _drive_resubmit(browser, web_base, seed.course_id, assignment_id,
                                      token, refresh, str(page_file))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    if issue:
        return FlowResult(name, title, False, [issue])

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        detail = (await client.get(f"{base}/teacher/submissions/{sid}", headers=teacher)).json()
        again = await client.post(
            f"{base}/school/student/homework/{assignment_id}/submit",
            json={"files": [_PAGE_PNG_B64]}, headers=_auth(token),
        )
    attempts = detail.get("attempts") or []
    if [a.get("reason") for a in attempts] != ["reopen"]:
        issues.append(f"after turning it in again the earlier turn-in wasn't kept as one attempt: {attempts}")
    if detail.get("reopened_at") is not None:
        issues.append("the reopen was still open after the student turned it in again")
    if again.status_code != 409:
        issues.append(f"a further turn-in returned {again.status_code}, expected 409 — one per reopen")
    return FlowResult(name, title, not issues, issues)


async def _drive_resubmit(
    browser: HarnessBrowser, web_base: str, course_id: str, assignment_id: str,
    token: str, refresh: str, page_file: str,
) -> str | None:
    """The browser half of `_reopen_resubmit_flow`: the first broken step, or None."""
    async with browser.authed_page(token, refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/student/courses/{course_id}"
            f"/homework/{assignment_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        try:
            await page.get_by_role("heading", name="Turn it in again").wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            return "a reopened homework never showed the 'Turn it in again' panel"
        try:
            await page.locator("input[type=file]").first.set_input_files(page_file)
            await page.get_by_role("button", name="Review & turn in").click(timeout=_TIMEOUT_MS)
            await page.get_by_role("button", name="Turn it in", exact=True).click(timeout=_TIMEOUT_MS)
            await page.get_by_role("heading", name="Turn it in again").wait_for(state="detached", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            return "uploading a page and pressing 'Turn it in' never left the reopened panel"
    return None


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
            url, json={"files": [_PAGE_PNG_B64]}, headers=_auth(seed.student_token),
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
            url, json={"files": [_PAGE_PNG_B64]}, headers=_auth(seed.student_token),
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
    persists and is released to the student. Seeds a one-problem homework with
    a submitted submission, then exercises
    `PATCH /teacher/submissions/{id}/grade` (manual full credit on that
    problem's id, no AI) and `POST /teacher/assignments/{id}/publish-grades`. Asserts the
    score is set and the publish counts the grade."""
    name, title = "grade_publish", "Teacher grades and publishes"
    issues: list[str] = []
    assignment_id, submission_id, problem_id = await seed_submitted_submission(seed)
    base = api_base.rstrip("/")
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        graded = await client.patch(
            f"{base}/teacher/submissions/{submission_id}/grade",
            json={"breakdown": [
                {"problem_id": problem_id, "score_status": "full", "percent": 100},
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
            f"{base}/teacher/assignments/{assignment_id}/publish-grades",
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


async def _workshop_steps_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher reorders, deletes and adds solution steps in the Workshop, then
    undoes → the one-level undo restores the previous list. Exercises the
    exact calls the Workshop makes: `PATCH /teacher/question-bank/{id}` with
    the whole `solution_steps` array, and `POST .../revert`. Asserts
    deterministic state only: step order, that a figure stays on its step,
    and that undo is exactly one level (a second revert is refused 400)."""
    name, title = "workshop_steps", "Teacher edits solution steps + undo"
    issues: list[str] = []
    item_id = await seed_workshop_item(seed)
    base = api_base.rstrip("/")
    url = f"{base}/teacher/question-bank/{item_id}"
    hdr = _auth(seed.teacher_token)

    def order(resp: httpx.Response) -> list[str]:
        return [s.get("title") for s in (resp.json().get("solution_steps") or [])]

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S) as client:
        a, b, c = (
            {"title": "A", "description": "a"},
            {"title": "B", "description": "b", "figure_spec": {"kind": "flow"},
             "figure_svg": WORKSHOP_FLOW_FIGURE},
            {"title": "C", "description": "c"},
        )
        moved = await client.patch(url, json={"solution_steps": [b, a, c]}, headers=hdr)
        if moved.status_code != 200:
            issues.append(f"reordering steps returned {moved.status_code}, expected 200")
            return FlowResult(name, title, False, issues)
        if order(moved) != ["B", "A", "C"]:
            issues.append(f"reorder saved {order(moved)}, expected ['B', 'A', 'C']")
        first = (moved.json().get("solution_steps") or [{}])[0]
        if first.get("figure_svg") != WORKSHOP_FLOW_FIGURE:
            issues.append("the moved step lost its figure on reorder")

        added = await client.patch(
            url, json={"solution_steps": [b, c, {"title": "D", "description": "d"}]},
            headers=hdr,
        )
        if added.status_code != 200 or order(added) != ["B", "C", "D"]:
            issues.append(
                f"delete+add saved {added.status_code} {order(added)}, "
                "expected 200 ['B', 'C', 'D']",
            )

        undone = await client.post(f"{url}/revert", headers=hdr)
        if undone.status_code != 200:
            issues.append(f"undo returned {undone.status_code}, expected 200")
            return FlowResult(name, title, False, issues)
        if order(undone) != ["B", "A", "C"]:
            issues.append(
                f"undo restored {order(undone)}, expected the previous list "
                "['B', 'A', 'C']",
            )

        again = await client.post(f"{url}/revert", headers=hdr)
        if again.status_code != 400:
            issues.append(
                f"a second undo returned {again.status_code}, expected 400 — undo "
                "should be exactly one level",
            )
    return FlowResult(name, title, not issues, issues)


async def _review_page_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher works the section review page: the roster triages the class,
    the AI-graded student opens by default, the rubric panel opens, a
    confident row is confirmed, a grade click saves, and the page's session
    state (rubric open, confirm ticks) survives switching students and coming
    back. Then the shortcuts (via its button: a "?" keypress from Playwright
    never opens it), verdict-legend and publish dialogs open and close
    without publishing. Guards the page's split into
    components, hooks and a store: every step is a state it must keep.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each state (the
    before/after evidence for a refactor of this page)."""
    import os
    import re

    name, title = "review_page", "Teacher reviews a section's homework"
    issues: list[str] = []
    rs = await seed_review_homework(seed)
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    url = (
        f"{web_base.rstrip('/')}/school/teacher/courses/{rs.course_id}"
        f"/homework/{rs.assignment_id}/sections/{rs.section_id}/review"
    )
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        async def shot(label: str) -> None:
            if shots:
                os.makedirs(shots, exist_ok=True)
                # Let a dialog's fade-in finish so the picture is the settled state.
                await page.wait_for_function(
                    "() => document.getAnimations().every(a => a.playState !== 'running')",
                    timeout=_TIMEOUT_MS,
                )
                await page.screenshot(path=os.path.join(shots, f"{label}.png"))

        async def step(what: str, coro) -> bool:
            try:
                await coro
                return True
            except PlaywrightTimeoutError:
                issues.append(what)
                return False

        # Never let this flow release grades: the Publish button publishes
        # straight through when nothing needs a confirm, so block the call.
        await page.route("**/publish-grades*", lambda route: route.abort())
        roster = page.locator("aside", has_text="submitted").last
        await page.goto(url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        confirm_all = page.get_by_role("button", name=re.compile(r"Confirm all 1 confident"))
        if not await step(
            "the review page never opened the AI-graded student with its confident "
            "row collapsed ('Confirm all 1 confident grade' not shown)",
            confirm_all.wait_for(timeout=_TIMEOUT_MS),
        ):
            return FlowResult(name, title, False, issues)
        for student in (rs.graded_student, rs.ungraded_student, rs.absent_student):
            if not await roster.get_by_role("button", name=re.compile(student)).count():
                issues.append(f"the roster does not list {student}")
        await shot("01-loaded")

        rubric_text = page.get_by_text("Correct answer with work shown.")
        await step("no Rubric panel to open",
                   page.locator("summary", has_text="Rubric").click(timeout=_TIMEOUT_MS))
        await step("opening the Rubric panel did not show the rubric",
                   rubric_text.wait_for(timeout=_TIMEOUT_MS))
        await shot("02-rubric-open")

        await step("no Confirm control on the confident row",
                   page.get_by_role("button", name=re.compile(r"^Confirm\s*1$")).click(timeout=_TIMEOUT_MS))
        confirmed = page.get_by_text(re.compile(r"^\u2713\s*Confirmed$"))
        await step("confirming the confident row did not mark it Confirmed",
                   confirmed.first.wait_for(timeout=_TIMEOUT_MS))
        await shot("03-confirmed")

        # Problem 1 is collapsed, so the first Full button is problem 2's.
        await step("no Full grade button on problem 2",
                   page.get_by_role("button", name="Full", exact=True).first.click(timeout=_TIMEOUT_MS))
        await step("grading problem 2 was not announced in the live region",
                   page.wait_for_function(
                       "() => /Problem 2/.test(document.querySelector("
                       "\"[aria-live='polite'].sr-only\")?.textContent || '')",
                       timeout=_TIMEOUT_MS))
        await step("the roster did not show the student's new score after grading",
                   roster.get_by_role("button", name=re.compile(rs.graded_student + r".*67%"))
                   .wait_for(timeout=_TIMEOUT_MS))
        await shot("04-graded")

        await step(f"the roster has no row for {rs.ungraded_student}",
                   roster.get_by_role("button", name=re.compile(rs.ungraded_student)).click(timeout=_TIMEOUT_MS))
        await step(f"selecting {rs.ungraded_student} did not open their work",
                   page.get_by_text("Not graded yet").first.wait_for(timeout=_TIMEOUT_MS))
        await step("the Rubric panel closed when switching students (it is a session preference)",
                   rubric_text.wait_for(timeout=_TIMEOUT_MS))
        await shot("05-ungraded-student")

        await step(f"the roster has no row for {rs.graded_student}",
                   roster.get_by_role("button", name=re.compile(rs.graded_student)).click(timeout=_TIMEOUT_MS))
        await step("coming back to the graded student lost the confirmed tick",
                   confirmed.first.wait_for(timeout=_TIMEOUT_MS))

        await step(f"the roster has no row for {rs.absent_student}",
                   roster.get_by_role("button", name=re.compile(rs.absent_student)).click(timeout=_TIMEOUT_MS))
        await step(f"selecting {rs.absent_student} did not show the Not submitted card",
                   page.get_by_text("hasn\u2019t turned in this homework yet").or_(
                       page.get_by_text("hasn't turned in this homework yet")).wait_for(timeout=_TIMEOUT_MS))
        await shot("06-not-submitted")

        await step(f"the roster has no row for {rs.graded_student}",
                   roster.get_by_role("button", name=re.compile(rs.graded_student)).click(timeout=_TIMEOUT_MS))
        await step("coming back to the graded student did not reopen their work",
                   confirm_all.or_(confirmed.first).first.wait_for(timeout=_TIMEOUT_MS))
        dialog = page.get_by_role("dialog")
        for label, opener, what in (
            ("07-shortcuts",
             lambda: page.get_by_role("button", name="Show keyboard shortcuts").click(),
             "keyboard shortcuts"),
            ("08-verdict-legend",
             lambda: page.get_by_role("button", name="Show integrity verdict legend").click(),
             "verdict legend"),
            ("09-publish-confirm",
             lambda: page.get_by_role("button", name=re.compile(r"^Publish")).first.click(),
             "publish confirm"),
        ):
            await page.evaluate("document.activeElement && document.activeElement.blur()")
            if not await step(f"no control opens the {what} dialog", opener()):
                continue
            if await step(f"the {what} dialog did not open", dialog.first.wait_for(timeout=_TIMEOUT_MS)):
                await shot(label)
                await page.keyboard.press("Escape")
                await step(f"the {what} dialog did not close on Escape",
                           dialog.first.wait_for(state="detached", timeout=_TIMEOUT_MS))
    return FlowResult(name, title, not issues, issues)


# Register new journeys here. Each returns a FlowResult; for a real app failure
# append an issue, but RAISE on unexpected infra errors so run_flows drops them.
# (Deferred: the practice/learn journeys need LLM generation + a queue-based
# multi-page entry — a real build + a per-scan cost decision, not a quick add.)
_FLOWS = (
    _login_flow, _logout_flow, _student_insights_flow, _confirm_reading_flow,
    _retake_photos_flow, _reopen_resubmit_flow,
    _join_class_flow, _submit_homework_flow, _grade_publish_flow,
    _workshop_steps_flow, _review_page_flow, create_homework_flow, add_from_bank_flow,
    generation_survives_leaving_flow, add_from_bank_on_homework_flow, duplicate_homework_flow,
    change_section_due_date_flow,
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

