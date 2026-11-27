"""Flow: a course opens where the teacher's work is.

A course with homework opens on its Homework tab; one without any opens on
Sections, where a new course is set up; an explicit ?tab= always wins.

$0 and deterministic: seeded courses only, no AI.
"""

from __future__ import annotations

import os
import uuid
from typing import TYPE_CHECKING

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from sqlalchemy import select

from api.database import get_session_factory
from api.models.course import Course, CourseTeacher
from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed

if TYPE_CHECKING:
    from tests.harness.flows import FlowResult

_TIMEOUT_MS = 30000


async def _empty_course(seed: Seed) -> str:
    """A course of the seeded teacher's with no homework yet."""
    async with get_session_factory()() as s:
        school_id = (await s.execute(
            select(Course.school_id).where(Course.id == uuid.UUID(seed.course_id)),
        )).scalar_one()
        course = Course(name="Fresh Course", subject="math", school_id=school_id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=uuid.UUID(seed.teacher_id), role="owner"))
        await s.commit()
        return str(course.id)


async def course_landing_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Open the seeded course (it has homework) bare, then with ?tab=sections,
    then a course with no homework, and check which tab is current each time.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each."""
    from tests.harness import flows

    name, title = "course_landing", "A course opens on Homework once it has any"
    issues: list[str] = []
    empty_id = await _empty_course(seed)
    base = f"{web_base.rstrip('/')}/school/teacher/courses"
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    cases = (
        ("with-homework", f"{base}/{seed.course_id}", "Homework"),
        ("explicit-tab", f"{base}/{seed.course_id}?tab=sections", "Sections"),
        ("no-homework", f"{base}/{empty_id}", "Sections"),
    )
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        for label, url, want in cases:
            await page.goto(url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
            current = page.locator('button[aria-current="page"]')
            try:
                await current.first.wait_for(timeout=_TIMEOUT_MS)
            except PlaywrightTimeoutError:
                issues.append(f"{label}: no tab was current")
                continue
            got = (await current.first.inner_text()).strip()
            if not got.startswith(want):
                issues.append(f"{label}: opened on {got!r}, expected {want!r}")
            if shots:
                os.makedirs(shots, exist_ok=True)
                await page.screenshot(path=os.path.join(shots, f"course-landing-{label}.png"))
    return flows.FlowResult(name, title, not issues, issues)
