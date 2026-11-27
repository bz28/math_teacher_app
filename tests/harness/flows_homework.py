"""Homework-creation journeys for the flow harness (see flows.py for the
contract: fail only on a definitive signal; raise on infra errors so
run_flows drops the flow). No LLM: the wizard is saved as a draft, which
creates the homework without generating anything."""

from __future__ import annotations

import re

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed
from tests.harness.types import FlowResult

_TIMEOUT_MS = 30000


async def create_homework_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher opens New homework -> the course's only unit is already picked,
    a due chip sets the date at 11:59 PM -> Continue -> Save as draft lands on
    the new homework's page, due at 11:59 PM."""
    name, title = "create_homework", "Teacher creates a homework with the wizard"
    issues: list[str] = []
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}?tab=homework",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        dialog = page.get_by_role("dialog", name="New homework")
        try:
            await page.get_by_role("button", name="New homework").first.click(timeout=_TIMEOUT_MS)
            await dialog.wait_for(timeout=_TIMEOUT_MS)
            await dialog.get_by_text("The only unit in this course, picked for you.").wait_for(
                timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("New homework did not open with the course's only unit picked")
            return FlowResult(name, title, False, issues)
        await dialog.get_by_role("textbox").first.fill("Harness wizard homework")
        try:
            await dialog.get_by_role("button", name=re.compile(r"^Tomorrow")).click(timeout=_TIMEOUT_MS)
            await dialog.get_by_text(re.compile(r"11:59\s*PM")).first.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the Tomorrow due chip did not set a due date at 11:59 PM")
            return FlowResult(name, title, False, issues)
        try:
            await dialog.get_by_role("button", name="Continue →").click(timeout=_TIMEOUT_MS)
            await dialog.get_by_text("Grading", exact=True).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Continue did not reach the Problems step with its Grading line")
            return FlowResult(name, title, False, issues)
        try:
            await dialog.get_by_role("button", name="Save as draft").click(timeout=_TIMEOUT_MS)
            await page.wait_for_url(re.compile(r"/homework/[0-9a-f-]{36}"), timeout=_TIMEOUT_MS)
            await page.get_by_text("Harness wizard homework").first.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Save as draft did not land on the new homework's page")
            return FlowResult(name, title, False, issues)
        if not await page.get_by_text(re.compile(r"11:59\s*PM")).count():
            issues.append("the saved homework is not due at 11:59 PM")
    return FlowResult(name, title, not issues, issues)
