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
from api.models.assignment import Submission
from api.models.integrity_check import IntegrityCheckSubmission
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
    """Home row → "Understanding check: 1 worth a look" and "1 photo or
    reading problem", neither red; expanded, each student says which.

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
        if await queue.get_by_text("flagged").count():
            issues.append("home still lumps them together as \"flagged\"")
        students = queue.get_by_role("button", name=re.compile(r"^\d+ students?"))
        try:
            await students.first.click(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the row's students can't be opened")
        else:
            for student, chip in ((rs.graded_student, "Worth a look"), (rs.ungraded_student, "Photo problem")):
                link = queue.get_by_role("link", name=student)
                try:
                    await link.wait_for(timeout=_TIMEOUT_MS)
                    if chip.lower() not in (await link.inner_text()).lower():
                        issues.append(f"{student}'s chip doesn't say \"{chip}\"")
                except PlaywrightTimeoutError:
                    issues.append(f"{student} isn't listed under the row")
        if shots:
            os.makedirs(shots, exist_ok=True)
            await page.screenshot(path=os.path.join(shots, "flag-kinds-home.png"), full_page=True)
    return flows.FlowResult(name, title, not issues, issues)
