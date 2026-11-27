"""Generation journeys on the homework page for the flow harness (see
flows.py for the contract). No LLM: the generate call and the job it
returns are answered by the browser itself (page.route), so nothing is
queued server-side and nothing is billed."""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime

import httpx
from playwright.async_api import Route
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed
from tests.harness.types import FlowResult

_TIMEOUT_MS = 30000


def _fake_job(seed: Seed, job_id: str) -> dict[str, object]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": job_id, "course_id": seed.course_id, "unit_id": seed.unit_id,
        "mode": "generate", "status": "running", "requested_count": 5,
        "difficulty": "medium", "constraint": None, "produced_count": 0,
        "error_message": None, "notice": None, "parent_question_id": None,
        "created_at": now, "updated_at": now,
    }


async def generation_survives_leaving_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """A draft homework with no problems -> Generate problems (5) -> the
    banner says what's coming -> leave for the course page -> come back:
    the banner is still there, not the empty 'Let's add some problems'
    hero that invites a second, paid generation."""
    name, title = "generation_survives_leaving", "Teacher leaves while problems generate"
    issues: list[str] = []
    async with httpx.AsyncClient(base_url=api_base, timeout=30) as client:
        r = await client.post(
            f"/teacher/courses/{seed.course_id}/assignments",
            json={"title": "Generation flow HW", "type": "homework", "unit_ids": [seed.unit_id]},
            headers={"Authorization": f"Bearer {seed.teacher_token}"},
        )
        r.raise_for_status()
        hw_id = r.json()["id"]
    job_id = str(uuid.uuid4())
    job = _fake_job(seed, job_id)

    async def answer(route: Route) -> None:
        await route.fulfill(status=200, content_type="application/json", body=json.dumps(job))

    hw_url = f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}/homework/{hw_id}"
    banner = re.compile(r"Generating 5 problems · usually 1–2 minutes")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.route(re.compile(r"/question-bank/generate$"), answer)
        await page.route(re.compile(rf"/question-bank/generation-jobs/{job_id}$"), answer)
        await page.goto(hw_url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        try:
            await page.get_by_role("button", name=re.compile(r"Generate problems")).click(timeout=_TIMEOUT_MS)
            dialog = page.locator("form", has_text="Generate more questions")
            await dialog.get_by_role("button", name="5", exact=True).click(timeout=_TIMEOUT_MS)
            await dialog.get_by_role("button", name="Figures").click(timeout=_TIMEOUT_MS)  # Save to
            await dialog.get_by_role("button", name="Generate ▸").click(timeout=_TIMEOUT_MS)
            await page.get_by_text(banner).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("starting a generation did not show the generating banner")
            return FlowResult(name, title, False, issues)
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}?tab=homework",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        await page.goto(hw_url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        try:
            await page.get_by_text(banner).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("after leaving and coming back, the running generation was forgotten")
        if await page.get_by_text("Let's add some problems").count():
            issues.append("the empty hero offers to generate again while a generation runs")
        # The job fails while she watches: she sees the stalled banner once,
        # and the page forgets the job, so the next visit doesn't repeat it.
        job["status"] = "failed"
        stalled = page.get_by_text(re.compile(r"Generation stalled"))
        try:
            await stalled.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("a failed generation did not show the stalled banner")
            return FlowResult(name, title, False, issues)
        remembered = await page.evaluate("k => sessionStorage.getItem(k)", f"hw-gen-{hw_id}")
        if remembered is not None:
            issues.append("the page still remembers a job that already failed")
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}?tab=homework",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        await page.goto(hw_url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        try:
            await page.get_by_text("Let's add some problems").wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("after the failure, the page did not settle on the empty homework")
        if await stalled.count():
            issues.append("the stalled banner came back on the next visit")
    return FlowResult(name, title, not issues, issues)
