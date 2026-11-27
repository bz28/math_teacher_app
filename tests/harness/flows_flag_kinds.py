"""Flow: home keeps an understanding check worth a look apart from a
photo or reading problem, and shows neither in alarm red.

Seeds the review homework, then gives one student's work a check that
asked for the teacher's review and another's a reading the student
flagged as wrong. Home's row for that homework must count each under
its own name, and the students' chips must say which is which.

$0 and deterministic: the check and the flag are seeded; no AI runs.
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Submission, SubmissionGrade
from api.models.integrity_check import IntegrityCheckSubmission
from api.models.section_enrollment import SectionEnrollment
from api.models.user import User
from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed, seed_review_homework

if TYPE_CHECKING:
    from tests.harness.flows import FlowResult

_TIMEOUT_MS = 30000
# True when the pill (or anything in it) is drawn in the app's error ink.
_IN_ALARM_RED = """el => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-error)";
    document.body.appendChild(probe);
    const red = getComputedStyle(probe).color;
    probe.remove();
    const pill = el.closest("span") ?? el;
    return [pill, ...pill.querySelectorAll("*")].some(n => getComputedStyle(n).color === red);
}"""


async def flag_kinds_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Home row and course row → "Understanding check: 1 worth a look"
    and "1 photo or reading problem", neither red, no "flagged" anywhere
    on home, and the headline counts the homework too long for the AI;
    expanded, each student says which. The course's Submissions tab says
    it the same way.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of home."""
    from tests.harness import flows

    name, title = "flag_kinds", "Home tells a check worth a look from a photo problem"
    issues: list[str] = []
    rs = await seed_review_homework(seed)
    async with get_session_factory()() as s:
        subs = {
            n: (await s.execute(
                select(Submission).join(User, User.id == Submission.student_id).where(
                    Submission.assignment_id == uuid.UUID(rs.assignment_id), User.name == n,
                )
            )).scalar_one()
            for n in (rs.graded_student, rs.ungraded_student)
        }
        s.add(IntegrityCheckSubmission(submission_id=subs[rs.graded_student].id, status="complete",
                                       disposition="flag_for_review", overall_summary="Worth a look."))
        subs[rs.ungraded_student].extraction_flagged_at = datetime.now(UTC)
        # The third student's homework was too long for the AI grader.
        absent = (await s.execute(
            select(User).join(SectionEnrollment, SectionEnrollment.student_id == User.id).where(
                SectionEnrollment.section_id == uuid.UUID(rs.section_id), User.name == rs.absent_student,
            )
        )).scalar_one()
        long_sub = Submission(assignment_id=uuid.UUID(rs.assignment_id), student_id=absent.id,
                              section_id=uuid.UUID(rs.section_id), status="submitted",
                              submitted_at=datetime.now(UTC))
        s.add(long_sub)
        await s.flush()
        s.add(SubmissionGrade(submission_id=long_sub.id, ai_grading_status="skipped_too_long"))
        await s.commit()

    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.goto(f"{web_base.rstrip('/')}/school/teacher", wait_until="domcontentloaded",
                        timeout=_TIMEOUT_MS)
        skip = page.get_by_role("button", name="Skip for now")
        try:
            await skip.wait_for(timeout=3000)
            await skip.click()
            await skip.wait_for(state="hidden", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            pass
        queue = page.get_by_role("region", name="Needs you today")
        check = queue.get_by_text("Understanding check: 1 worth a look")
        photo = queue.get_by_text("1 photo or reading problem", exact=True)
        for what, loc in (("an understanding check worth a look", check),
                          ("a photo or reading problem", photo)):
            try:
                await loc.first.wait_for(timeout=_TIMEOUT_MS)
            except PlaywrightTimeoutError:
                issues.append(f"home's row doesn't count {what} under its own name")
                continue
            if await loc.first.evaluate(_IN_ALARM_RED):
                issues.append(f"{what} is shown in alarm red")
        # Not in the queue, and not anywhere else on home either: the
        # course row and the headline say the same as the queue.
        main = page.locator("main")
        if await main.get_by_text(re.compile(r"\bflagged\b", re.I)).count():
            issues.append("home still lumps them together as \"flagged\"")
        course_pill = main.get_by_role("link", name=re.compile("Geometry Harness")).get_by_text(
            "Understanding check: 1 worth a look")
        if not await course_pill.count():
            issues.append("the course row doesn't say which kind its flags are")
        elif await course_pill.first.evaluate(_IN_ALARM_RED):
            issues.append("the course row's flag is shown in alarm red")
        students = queue.get_by_role("button", name=re.compile(r"^\d+ students?"))
        try:
            await students.first.click(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the row's students can't be opened")
        else:
            for student, chip in ((rs.graded_student, "Worth a look"), (rs.ungraded_student, "Photo or reading")):
                link = queue.get_by_role("link", name=student)
                try:
                    await link.wait_for(timeout=_TIMEOUT_MS)
                    if chip.lower() not in (await link.inner_text()).lower():
                        issues.append(f"{student}'s chip doesn't say \"{chip}\"")
                except PlaywrightTimeoutError:
                    issues.append(f"{student} isn't listed under the row")
        # The headline counts every kind, too long for the AI included.
        if not await main.get_by_text(re.compile(r"^1 course ·.*1 too long to AI-grade")).count():
            issues.append("home's headline drops the homework too long for the AI")
        if not await main.get_by_text("1 too long to AI-grade", exact=True).count():
            issues.append("the course row drops the homework too long for the AI")
        if shots:
            os.makedirs(shots, exist_ok=True)
            await page.screenshot(path=os.path.join(shots, "flag-kinds-home.png"), full_page=True)

        # The course's Submissions tab says it the same way, not in red.
        await page.goto(f"{web_base.rstrip('/')}/school/teacher/courses/{rs.course_id}?tab=submissions",
                        wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        main = page.locator("main")
        tab_pill = main.get_by_text("Understanding check: 1 worth a look")
        try:
            await main.get_by_text("Review HW").first.wait_for(timeout=_TIMEOUT_MS)
            await tab_pill.first.wait_for(timeout=_TIMEOUT_MS)
            if await tab_pill.first.evaluate(_IN_ALARM_RED):
                issues.append("the Submissions tab shows a check worth a look in alarm red")
        except PlaywrightTimeoutError:
            issues.append("the Submissions tab doesn't say which kind its flags are")
        if await main.get_by_text(re.compile(r"\bflagged\b", re.I)).count():
            issues.append("the Submissions tab still lumps them together as \"flagged\"")
        if shots:
            await page.screenshot(path=os.path.join(shots, "flag-kinds-submissions.png"), full_page=True)
    return flows.FlowResult(name, title, not issues, issues)
