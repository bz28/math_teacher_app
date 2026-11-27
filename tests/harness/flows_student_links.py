"""Flow: one click from a student's name to their history.

A name on a section's roster and on the review page opens that student's
history. The history names the student's other courses with this teacher
(each a link to their history there) and lists the understanding checks
they finished — the summary and a link to read the conversation, never a
verdict.

$0 and deterministic: the check is seeded as finished; no AI runs.
"""

from __future__ import annotations

import os
import re
import uuid
from typing import TYPE_CHECKING

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Submission
from api.models.course import Course, CourseTeacher
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.harness.browser import HarnessBrowser
from tests.harness.seed import ReviewSeed, Seed, seed_review_homework

if TYPE_CHECKING:
    from tests.harness.flows import FlowResult

_TIMEOUT_MS = 30000
SUMMARY = "Walked through each step and explained why the 2 moved across."


async def _seed(seed: Seed, rs: ReviewSeed) -> tuple[str, str]:
    """The graded student's finished check, and a second course of the
    teacher's they're also in. Returns (student id, other course name)."""
    async with get_session_factory()() as s:
        sub = (await s.execute(
            select(Submission).join(User, User.id == Submission.student_id).where(
                Submission.assignment_id == uuid.UUID(rs.assignment_id),
                User.name == rs.graded_student,
            )
        )).scalar_one()
        s.add(IntegrityCheckSubmission(submission_id=sub.id, status="complete",
                                       overall_summary=SUMMARY, disposition="pass"))
        school_id = (await s.get(Course, uuid.UUID(seed.course_id))).school_id  # type: ignore[union-attr]
        other = Course(name=f"Geometry {uuid.uuid4().hex[:4]}", subject="math", school_id=school_id)
        s.add(other)
        await s.flush()
        s.add(CourseTeacher(course_id=other.id, teacher_id=uuid.UUID(seed.teacher_id), role="owner"))
        sec = Section(course_id=other.id, name="Period 4")
        s.add(sec)
        await s.flush()
        s.add(SectionEnrollment(section_id=sec.id, course_id=other.id, student_id=sub.student_id))
        await s.commit()
        return str(sub.student_id), other.name


async def student_links_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Roster name → history (other course + check summary) → Read the
    conversation → review page on that student; review-page name → history.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each."""
    from tests.harness import flows

    name, title = "student_links", "Teacher opens a student's history from their name"
    issues: list[str] = []
    rs = await seed_review_homework(seed)
    student_id, other_course = await _seed(seed, rs)
    course = f"{web_base.rstrip('/')}/school/teacher/courses/{rs.course_id}"
    history = f"/grades/{rs.section_id}/students/{student_id}"
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        async def shot(label: str) -> None:
            if shots:
                os.makedirs(shots, exist_ok=True)
                await page.screenshot(path=os.path.join(shots, f"student-links-{label}.png"), full_page=True)

        async def step(what: str, coro: object) -> bool:
            try:
                await coro  # type: ignore[misc]
                return True
            except PlaywrightTimeoutError:
                issues.append(what)
                return False

        await page.goto(f"{course}?tab=sections", wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        manage = page.get_by_role("button", name="Manage")
        # The review seed's section is the newest; open the one holding the student.
        roster_name = page.locator(f'a[href$="{history}"]')
        for i in range(await manage.count() if await step("the Sections tab never loaded",
                                                          manage.first.wait_for(timeout=_TIMEOUT_MS)) else 0):
            await manage.nth(i).click()
            try:
                await roster_name.wait_for(timeout=3000)
                break
            except PlaywrightTimeoutError:
                await page.get_by_role("button", name="Close").first.click()
        if not await step("the roster's name isn't a link to the student's history",
                          roster_name.wait_for(timeout=_TIMEOUT_MS)):
            return flows.FlowResult(name, title, False, issues)
        await shot("roster")
        await roster_name.click()
        await step("clicking the roster name didn't open the history",
                   page.wait_for_url(f"**{history}", timeout=_TIMEOUT_MS))
        await step(f"the history doesn't name the student's other course ({other_course})",
                   page.get_by_role("link", name=other_course).wait_for(timeout=_TIMEOUT_MS))
        await step("the history doesn't show the understanding check's summary",
                   page.get_by_text(SUMMARY).wait_for(timeout=_TIMEOUT_MS))
        checks = page.locator('section[aria-labelledby="understanding-checks"]')
        text = await checks.inner_text() if await checks.count() else ""
        if re.search(r"\b(pass|flag|verdict|\d+%)", text, re.I):
            issues.append("the understanding check shows a verdict or score, not just its summary")
        await shot("history")

        await checks.get_by_role("link", name="Read the conversation").click()
        await step("Read the conversation didn't open the review page on this student",
                   page.wait_for_function(
                       "id => new URLSearchParams(location.search).get('student') === id",
                       arg=student_id, timeout=_TIMEOUT_MS,
                   ))
        review_name = page.locator(f'a[href$="{history}"]', has_text=rs.graded_student)
        if await step("the review page's student name isn't a link to their history",
                      review_name.first.wait_for(timeout=_TIMEOUT_MS)):
            await shot("review")
            await review_name.first.click()
            await step("the review page's name didn't open the history",
                       page.wait_for_url(f"**{history}", timeout=_TIMEOUT_MS))
    return flows.FlowResult(name, title, not issues, issues)
