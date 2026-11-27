"""Flow: a new course opens on its setup checklist, and each step's
button does the step.

Create a course on the courses list → it opens (not just a list
refresh) with "Set up <name>", 0 of 3 done → Add sections takes a
pasted column ("Period 1" / "Period 3") as two, previewed before Create → 1 of 3 done, both sections listed →
Show codes opens a section's roster → New homework opens the dialog.

$0 and deterministic: no AI runs (the homework dialog is only opened).
"""

from __future__ import annotations

import os
import re
import uuid
from typing import TYPE_CHECKING

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed

if TYPE_CHECKING:
    from tests.harness.flows import FlowResult

_TIMEOUT_MS = 30000


async def course_setup_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """New course → checklist → two sections at once → codes → New homework.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each step."""
    from tests.harness import flows

    name, title = "course_setup", "A new course opens on its setup checklist"
    issues: list[str] = []
    course_name = f"Setup {uuid.uuid4().hex[:4]}"
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        async def shot(label: str) -> None:
            if shots:
                os.makedirs(shots, exist_ok=True)
                await page.screenshot(path=os.path.join(shots, f"course-setup-{label}.png"), full_page=True)

        async def step(what: str, coro: object) -> bool:
            try:
                await coro  # type: ignore[misc]
                return True
            except PlaywrightTimeoutError:
                issues.append(what)
                return False

        await page.goto(f"{web_base.rstrip('/')}/school/teacher", wait_until="domcontentloaded",
                        timeout=_TIMEOUT_MS)
        new_course = page.locator('[data-tour-id="teacher-new-course"]')
        if not await step("the courses list has no New course button",
                          new_course.wait_for(timeout=_TIMEOUT_MS)):
            return flows.FlowResult(name, title, False, issues)
        # A first-run teacher gets the tour's welcome cover; skipping it is
        # the path to the checklist this flow is about.
        skip = page.get_by_role("button", name="Skip for now")
        try:
            await skip.wait_for(timeout=3000)
            await skip.click()
            await skip.wait_for(state="hidden", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            pass
        await new_course.click()
        await page.get_by_placeholder("e.g. Algebra 1").fill(course_name)
        await page.locator('form button[type="submit"]').click()
        if not await step("creating a course didn't open it",
                          page.wait_for_url(re.compile(r"/school/teacher/courses/[0-9a-f-]{36}"),
                                            timeout=_TIMEOUT_MS)):
            return flows.FlowResult(name, title, False, issues)
        checklist = page.get_by_test_id("setup-checklist")
        if not await step("the new course has no setup checklist",
                          checklist.get_by_text(f"Set up {course_name}").wait_for(timeout=_TIMEOUT_MS)):
            return flows.FlowResult(name, title, False, issues)
        await step("the checklist doesn't start at 0 of 3",
                   checklist.get_by_text("0 of 3 done").wait_for(timeout=_TIMEOUT_MS))
        await shot("new")

        await checklist.get_by_role("button", name="Add sections").click()
        names = page.get_by_label("Section names")
        await step("Add sections didn't open the New section form", names.wait_for(timeout=_TIMEOUT_MS))
        # A column pasted from a roster: each line is its own section.
        await names.evaluate(
            """(el, text) => {
                const dt = new DataTransfer();
                dt.setData("text/plain", text);
                el.dispatchEvent(new ClipboardEvent("paste", {clipboardData: dt, bubbles: true, cancelable: true}));
            }""",
            "Period 1\nPeriod 3",
        )
        preview = page.get_by_role("list", name="Sections to create")
        await step("a pasted column isn't previewed as two sections",
                   preview.get_by_text("Period 3", exact=True).wait_for(timeout=_TIMEOUT_MS))
        create = page.get_by_role("button", name="Create 2 sections")
        if not await step("two names don't offer to create 2 sections",
                          create.wait_for(timeout=_TIMEOUT_MS)):
            return flows.FlowResult(name, title, False, issues)
        await shot("sections-form")
        # A click outside while the sections are being made mustn't close
        # the form: a failure partway has to stay on screen.
        async def slow(route) -> None:  # type: ignore[no-untyped-def]
            await page.wait_for_timeout(800)
            await route.continue_()
        await page.route(re.compile(r"/sections$"), slow)
        await create.click()
        await page.mouse.click(5, 5)
        if not await names.is_visible():
            issues.append("a click outside closed New section while it was creating")
        await page.unroute(re.compile(r"/sections$"))
        await step("the checklist didn't tick sections off (1 of 3)",
                   checklist.get_by_text("1 of 3 done").wait_for(timeout=_TIMEOUT_MS))
        for period in ("Period 1", "Period 3"):
            await step(f"{period} wasn't created",
                       page.get_by_text(period, exact=True).first.wait_for(timeout=_TIMEOUT_MS))

        await checklist.get_by_role("button", name="Show codes").click()
        await step("Show codes didn't open a section's roster",
                   page.locator('[data-tour-id="teacher-invite"]').wait_for(timeout=_TIMEOUT_MS))
        await shot("codes")

        await checklist.get_by_role("button", name="New homework").click()
        await step("New homework didn't open the dialog",
                   page.get_by_role("dialog", name="New homework").wait_for(timeout=_TIMEOUT_MS))
        if "tab=homework" not in page.url:
            issues.append("New homework didn't move to the Homework tab")
        await shot("homework")
    return flows.FlowResult(name, title, not issues, issues)
