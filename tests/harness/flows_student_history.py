"""Flow: a student's history opens the right student's work.

Each homework row on a student's history links into the section's review
page. It used to link without naming the student, so the review page opened
on whoever it picked first — a teacher clicking one child's row was shown
another child's work. Also checks the history tells an AI grade waiting for
the teacher ("Awaiting your review") apart from work nobody has graded.

$0 and deterministic: the review seed keeps AI grading and integrity off.
"""

from __future__ import annotations

import os
import re
from collections.abc import Awaitable
from typing import TYPE_CHECKING

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed, seed_review_homework

if TYPE_CHECKING:
    from tests.harness.flows import FlowResult

_TIMEOUT_MS = 30000


async def student_history_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Open the AI-graded student's history (their row reads Awaiting your
    review), then the ungraded student's, click their homework row, and land
    on the review page with that student selected — not the AI-graded one
    the page would open on by itself.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each page."""
    # Imported here, not at module top: flows.py imports this module to
    # register the flow, and FlowResult lives there.
    from tests.harness import flows

    name, title = "student_history", "Teacher opens a student's history and their work"
    issues: list[str] = []
    rs = await seed_review_homework(seed)
    base = f"{web_base.rstrip('/')}/school/teacher/courses/{rs.course_id}/grades/{rs.section_id}/students"
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        async def shot(label: str) -> None:
            if shots:
                os.makedirs(shots, exist_ok=True)
                await page.screenshot(path=os.path.join(shots, f"{label}.png"), full_page=True)

        async def step(what: str, coro: Awaitable[object]) -> bool:
            try:
                await coro
                return True
            except PlaywrightTimeoutError:
                issues.append(what)
                return False

        await page.goto(f"{base}/{rs.graded_student_id}", wait_until="domcontentloaded",
                        timeout=_TIMEOUT_MS)
        await step(f"{rs.graded_student}'s history does not say their AI grade is awaiting review",
                   page.get_by_text("Awaiting your review").first.wait_for(timeout=_TIMEOUT_MS))
        first = rs.graded_student.split(" ")[0]
        await step(f"the practice empty state does not read '{first} hasn't practiced yet.'",
                   page.get_by_text(re.compile(rf"^{re.escape(first)} hasn.t practiced yet\.$"))
                   .wait_for(timeout=_TIMEOUT_MS))
        await shot("history-awaiting-review")
        # On a phone the status pill sits under the title, not beside it,
        # where the long labels left the title a few letters.
        await page.set_viewport_size({"width": 375, "height": 812})
        title_box = await page.locator(f'a[href*="/homework/{rs.assignment_id}/"] .truncate').first.bounding_box()
        if title_box is None or title_box["width"] < 200:
            issues.append("on a phone the awaiting-review row leaves its homework title under 200px wide")
        await shot("history-awaiting-review-phone")
        await page.set_viewport_size({"width": 1280, "height": 900})

        await page.goto(f"{base}/{rs.ungraded_student_id}", wait_until="domcontentloaded",
                        timeout=_TIMEOUT_MS)
        # This seed's homework, by its id: other flows seed "Review HW"s too.
        row = page.locator(f'a[href*="/homework/{rs.assignment_id}/"]')
        await step(f"{rs.ungraded_student}'s history never loaded", row.wait_for(timeout=_TIMEOUT_MS))
        await shot("history-not-graded")
        if not await step(f"{rs.ungraded_student}'s history has no row for the homework",
                          row.click(timeout=_TIMEOUT_MS)):
            return flows.FlowResult(name, title, False, issues)
        # The review page mirrors whoever it has open into ?student=, so
        # once a student's work is showing, the URL names them.
        opened = page.get_by_role("button", name=re.compile(r"Next student"))
        if await step("clicking the history row never opened a student's work on the review page",
                      opened.wait_for(timeout=_TIMEOUT_MS)):
            try:
                await page.wait_for_function(
                    "id => new URLSearchParams(location.search).get('student') === id",
                    arg=rs.ungraded_student_id, timeout=_TIMEOUT_MS,
                )
            except PlaywrightTimeoutError:
                issues.append(
                    f"the review page opened on another student, not {rs.ungraded_student} "
                    "whose history row was clicked",
                )
            await shot("review-opened-from-history")
    return flows.FlowResult(name, title, not issues, issues)
