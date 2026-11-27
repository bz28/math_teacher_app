"""Browser flows on the teacher's section review page — split from
flows.py to keep that file under the size limit. Same contract as every
flow there: a definitive Playwright signal fails a step, infra errors
raise and get dropped by `run_flows`, and nothing here publishes."""

from __future__ import annotations

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.flow_result import FLOW_TIMEOUT_MS as _TIMEOUT_MS
from tests.harness.flow_result import FlowResult
from tests.harness.seed import Seed, seed_review_homework


async def review_page_flow(
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
