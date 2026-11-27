"""Flow: the teacher shell names your courses and where you are.

The sidebar lists the teacher's courses under Courses (the one you're in
marked current); a deep page's breadcrumb leads back up; on a phone the
header's course menu opens the same list and closes once a course in it
is tapped — even the one you're already in, where the path doesn't change.

$0 and deterministic: seeded courses only, no AI.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed, seed_review_homework

if TYPE_CHECKING:
    from tests.harness.flows import FlowResult

_TIMEOUT_MS = 30000


async def course_nav_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Desktop: on a section's review page the sidebar marks the course and
    the breadcrumb's homework crumb opens the homework. Phone: the course menu
    opens, and tapping the current course closes it.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each."""
    from tests.harness import flows

    name, title = "course_nav", "Teacher finds their way between courses"
    issues: list[str] = []
    rs = await seed_review_homework(seed)
    course = f"{web_base.rstrip('/')}/school/teacher/courses/{rs.course_id}"
    review = f"{course}/homework/{rs.assignment_id}/sections/{rs.section_id}/review"
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        async def shot(label: str) -> None:
            if shots:
                os.makedirs(shots, exist_ok=True)
                await page.screenshot(path=os.path.join(shots, f"course-nav-{label}.png"))

        await page.set_viewport_size({"width": 1280, "height": 860})
        await page.goto(review, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        current = page.locator(f'ul[aria-label="Your courses"] a[aria-current="page"][href$="/courses/{rs.course_id}"]')
        try:
            await current.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the sidebar doesn't list the course you're in as current")
        crumb = page.locator(f'nav[aria-label="Breadcrumb"] a[href$="/homework/{rs.assignment_id}"]')
        try:
            await crumb.wait_for(timeout=_TIMEOUT_MS)
            await shot("review")
            await crumb.click(timeout=_TIMEOUT_MS)
            await page.wait_for_url(f"**/homework/{rs.assignment_id}", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the review page's breadcrumb doesn't lead back to its homework")

        # The problem-review page keeps a link to its homework even when the
        # homework can't be read (its title never arrives).
        hw_read = f"**/v1/teacher/assignments/{rs.assignment_id}"
        await page.route(hw_read, lambda route: route.abort())
        await page.goto(f"{course}/homework/{rs.assignment_id}/review", wait_until="domcontentloaded",
                        timeout=_TIMEOUT_MS)
        try:
            await page.locator(
                f'nav[aria-label="Breadcrumb"] a[href$="/homework/{rs.assignment_id}"]',
            ).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("problem review lost its link to the homework when the homework couldn't load")
        await page.unroute(hw_read)

        await page.set_viewport_size({"width": 390, "height": 844})
        await page.goto(f"{course}?tab=grades", wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        menu = page.locator('button[aria-controls="mobile-course-menu"]')
        try:
            await menu.click(timeout=_TIMEOUT_MS)
            listed = page.locator(f'#mobile-course-menu a[href$="/courses/{rs.course_id}"]')
            await listed.wait_for(timeout=_TIMEOUT_MS)
            await shot("phone-menu")
            await listed.click(timeout=_TIMEOUT_MS)
            await page.locator("#mobile-course-menu").wait_for(state="detached", timeout=5000)
        except PlaywrightTimeoutError:
            issues.append("the phone course menu didn't open, or stayed open after tapping the current course")
    return flows.FlowResult(name, title, not issues, issues)
