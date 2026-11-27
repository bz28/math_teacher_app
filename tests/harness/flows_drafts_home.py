"""Flow: a draft homework is one click from home.

Seeds a draft, two days past its due date, with two generated problems
waiting for approval, then checks home lists it (in place when the
course list is, and saying the due date passed) under "Drafts in progress" with that count, and
Continue opens the homework.

$0 and deterministic: the problems are seeded; no AI runs.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.question_bank import QuestionBankItem
from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed

if TYPE_CHECKING:
    from tests.harness.flows import FlowResult

_TIMEOUT_MS = 30000


async def _seed_draft(seed: Seed) -> tuple[str, str]:
    title = f"Draft {uuid.uuid4().hex[:4]}"
    async with get_session_factory()() as s:
        hw = Assignment(course_id=uuid.UUID(seed.course_id), teacher_id=uuid.UUID(seed.teacher_id),
                        title=title, type="homework", status="draft", content={"problem_ids": []},
                        due_at=datetime.now(UTC) - timedelta(days=2))
        s.add(hw)
        await s.flush()
        for i in range(2):
            s.add(QuestionBankItem(course_id=hw.course_id, unit_id=uuid.UUID(seed.unit_id),
                                   originating_assignment_id=hw.id, title=f"q{i}",
                                   question=f"Solve x + {i} = 3", status="pending"))
        await s.commit()
        return str(hw.id), title


async def drafts_home_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Home → Drafts in progress lists the draft → Continue opens it.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of home."""
    from tests.harness import flows

    name, title = "drafts_home", "Teacher finds an unfinished draft on home"
    issues: list[str] = []
    hw_id, hw_title = await _seed_draft(seed)
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        # A slow drafts read is where a late line would push the courses down.
        async def slow(route) -> None:  # type: ignore[no-untyped-def]
            await asyncio.sleep(1.5)
            await route.continue_()
        await page.route("**/v1/teacher/drafts", slow)
        await page.goto(f"{web_base.rstrip('/')}/school/teacher", wait_until="domcontentloaded",
                        timeout=_TIMEOUT_MS)
        skip = page.get_by_role("button", name="Skip for now")
        try:
            await skip.wait_for(timeout=3000)
            await skip.click()
            await skip.wait_for(state="hidden", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            pass
        drafts = page.locator('section[aria-labelledby="drafts-in-progress"]')
        # The line is there when the courses are, not arriving after them
        # and pushing the course list down under the teacher's finger.
        await page.get_by_role("heading", name="Your courses").wait_for(timeout=_TIMEOUT_MS)
        if await drafts.count() == 0:
            issues.append("the drafts line arrived after the course list, pushing it down")
        row = drafts.locator("li", has_text=hw_title)
        try:
            await row.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("home doesn't list the draft under Drafts in progress")
            return flows.FlowResult(name, title, False, issues)
        line = await row.inner_text()
        if "2 problems need your approval" not in line:
            issues.append("the draft's line doesn't say 2 problems need approval")
        if "due date passed" not in line:
            issues.append("a draft whose due date passed reads like one still to come")
        if shots:
            os.makedirs(shots, exist_ok=True)
            await page.screenshot(path=os.path.join(shots, "drafts-home.png"), full_page=True)
        await row.get_by_role("link", name=f"Continue {hw_title}").click()
        try:
            await page.wait_for_url(f"**/homework/{hw_id}", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Continue didn't open the draft")
    return flows.FlowResult(name, title, not issues, issues)
