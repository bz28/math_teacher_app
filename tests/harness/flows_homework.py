"""Homework-creation journeys for the flow harness (see flows.py for the
contract: fail only on a definitive signal; raise on infra errors so
run_flows drops the flow). No LLM: the wizard is saved as a draft, which
creates the homework without generating anything."""

from __future__ import annotations

import re
import uuid

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from api.database import get_session_factory
from api.models.assignment import Assignment
from api.models.question_bank import QuestionBankItem
from api.services.bank import problem_ids_in_content
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
            # The hint under the chips, which shows only once a date is
            # picked (the "Due · 11:59 PM" heading is always there).
            await dialog.get_by_text(re.compile(r"11:59\s*PM · AI grading starts then")).wait_for(
                timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the Tomorrow due chip did not set a due date at 11:59 PM")
            return FlowResult(name, title, False, issues)
        try:
            await dialog.get_by_role("button", name="Continue →").click(timeout=_TIMEOUT_MS)
            await dialog.get_by_text("Grading", exact=True).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Continue did not reach the Problems step with its Grading line")
            return FlowResult(name, title, False, issues)
        # Invalid points open the grading panel; it must stay open while the
        # teacher types a valid number, even after a Back/Continue remount.
        points = dialog.locator("#hw-total-points")
        try:
            await dialog.get_by_role("button", name="Edit").click(timeout=_TIMEOUT_MS)
            await points.fill("")
            await dialog.get_by_role("button", name="← Back").click(timeout=_TIMEOUT_MS)
            # Step 1 fully back, so Continue remounts the Problems step.
            await dialog.get_by_text("The only unit in this course, picked for you.").wait_for(
                timeout=_TIMEOUT_MS)
            await points.wait_for(state="detached", timeout=_TIMEOUT_MS)
            await dialog.get_by_role("button", name="Continue →").click(timeout=_TIMEOUT_MS)
            # At a person's pace: the bug closed the panel between the keys.
            await points.press_sequentially("50", delay=200)
            await points.wait_for(timeout=2000)
        except PlaywrightTimeoutError:
            issues.append("the points field closed while the teacher was typing a valid number")
            return FlowResult(name, title, False, issues)
        if await points.input_value() != "50":
            issues.append("typing 50 into the points field did not leave 50 in it")
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


_BANK_TITLES = ("Bank flow: ticket sales", "Bank flow: two lines")
# The homework-page flow seeds its own pair: flows share one world, so
# reusing the titles would list two of each.
_PAGE_BANK_TITLES = ("Page bank flow: ticket sales", "Page bank flow: two lines")


async def _seed_bank(seed: Seed, titles: tuple[str, str] = _BANK_TITLES) -> list[str]:
    """Two approved questions the picker offers, plus a pending one and a
    variation it must not. Returns the approved ids in title order."""
    course, unit = uuid.UUID(seed.course_id), uuid.UUID(seed.unit_id)
    origin = uuid.UUID(seed.assignment_id)

    def item(title: str, question: str, status: str = "approved",
             parent: uuid.UUID | None = None) -> QuestionBankItem:
        return QuestionBankItem(
            course_id=course, unit_id=unit, originating_assignment_id=origin,
            title=title, question=question,
            final_answer="x = 1", status=status, source="generated",
            parent_question_id=parent,
        )

    async with get_session_factory()() as s:
        tickets = item(titles[0], "Adult tickets cost $8, student tickets $5.")
        lines = item(titles[1], "Solve y = 2x + 1 and y = -x + 7.")
        s.add_all([tickets, lines])
        await s.flush()
        s.add_all([
            item("Bank flow: still pending", "Not approved yet.", status="pending"),
            item("Bank flow: a variation", "A version of the ticket problem.", parent=tickets.id),
        ])
        await s.commit()
        return [str(tickets.id), str(lines.id)]


async def add_from_bank_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """New homework -> From bank offers only the course's approved primaries,
    search narrows them, and Create puts the picked ones on the homework in
    pick order, with no generation and no review queue."""
    name, title = "add_from_bank", "Teacher builds a homework from the question bank"
    issues: list[str] = []
    tickets_id, lines_id = await _seed_bank(seed)
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}?tab=homework",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        dialog = page.get_by_role("dialog", name="New homework")
        try:
            await page.get_by_role("button", name="New homework").first.click(timeout=_TIMEOUT_MS)
            await dialog.get_by_text("The only unit in this course, picked for you.").wait_for(
                timeout=_TIMEOUT_MS)
            await dialog.get_by_role("textbox").first.fill("Harness bank homework")
            await dialog.get_by_role("button", name="Continue →").click(timeout=_TIMEOUT_MS)
            await dialog.get_by_role("tab", name="From bank").click(timeout=_TIMEOUT_MS)
            await dialog.get_by_text(_BANK_TITLES[0]).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the From bank tab did not list the course's approved questions")
            return FlowResult(name, title, False, issues)
        for hidden in ("Bank flow: still pending", "Bank flow: a variation"):
            if await dialog.get_by_text(hidden).count():
                issues.append(f"the picker offered a question it can't add: {hidden!r}")
        search = dialog.get_by_role("searchbox")
        await search.fill("tickets adult")
        try:
            await dialog.get_by_text(_BANK_TITLES[1]).wait_for(state="detached", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("search did not narrow the list")
        # Pick the second one first: the homework keeps pick order.
        await search.fill("")
        await dialog.get_by_role("checkbox", name=re.compile(_BANK_TITLES[1])).check()
        await dialog.get_by_role("checkbox", name=re.compile(_BANK_TITLES[0])).check()
        if not await dialog.get_by_text("2 selected · added as approved, no review needed").count():
            issues.append("the footer does not say 2 selected, added as approved")
        try:
            await dialog.get_by_role("button", name="Create with 2 problems").click(timeout=_TIMEOUT_MS)
            await page.wait_for_url(re.compile(r"/homework/[0-9a-f-]{36}"), timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Create with 2 problems did not land on the new homework")
            return FlowResult(name, title, False, issues)
        hw_id = re.search(r"/homework/([0-9a-f-]{36})", page.url).group(1)  # type: ignore[union-attr]
    async with get_session_factory()() as s:
        hw = await s.get(Assignment, uuid.UUID(hw_id))
        got = problem_ids_in_content(hw.content if hw else None)
    if got != [lines_id, tickets_id]:
        issues.append(f"the homework holds {len(got)} problems, not the 2 picked in pick order")
    return FlowResult(name, title, not issues, issues)


async def add_from_bank_on_homework_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """A draft homework holding one bank question -> Add from bank leaves
    that one out, offers the other approved one, and Add 1 problem puts it
    after the first."""
    name, title = "add_from_bank_on_homework", "Teacher adds bank questions to a homework"
    issues: list[str] = []
    tickets_id, lines_id = await _seed_bank(seed, _PAGE_BANK_TITLES)
    async with get_session_factory()() as s:
        hw = await s.get(Assignment, uuid.UUID(seed.assignment_id))
        assert hw is not None
        hw.status = "draft"
        hw.content = {"problem_ids": [tickets_id]}
        hw.problem_points = None
        await s.commit()
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}/homework/{seed.assignment_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        dialog = page.get_by_role("dialog", name="Add from question bank")
        try:
            await page.get_by_role("button", name="Add from bank").click(timeout=_TIMEOUT_MS)
            await dialog.get_by_text(_PAGE_BANK_TITLES[1]).wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Add from bank did not list the course's approved questions")
            return FlowResult(name, title, False, issues)
        if await dialog.get_by_text(_PAGE_BANK_TITLES[0]).count():
            issues.append("the picker offered a question already on the homework")
        try:
            await dialog.get_by_role("checkbox", name=re.compile(_PAGE_BANK_TITLES[1])).check()
            await dialog.get_by_role("button", name="Add 1 problem").click(timeout=_TIMEOUT_MS)
            await dialog.wait_for(state="detached", timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("Add 1 problem did not add it and close")
            return FlowResult(name, title, False, issues)
    async with get_session_factory()() as s:
        after = await s.get(Assignment, uuid.UUID(seed.assignment_id))
        got = problem_ids_in_content(after.content if after else None)
    if got != [tickets_id, lines_id]:
        issues.append(f"the homework holds {len(got)} problems, not the old one then the added one")
    issues += await _practice_has_no_list_edits(browser, web_base, seed)
    return FlowResult(name, title, not issues, issues)


async def _practice_has_no_list_edits(browser: HarnessBrowser, web_base: str, seed: Seed) -> list[str]:
    """A draft practice set opens on the same page, but its problems are its
    own versions, so the page must not offer to add or remove bank
    questions (the API refuses either)."""
    async with get_session_factory()() as s:
        practice = Assignment(
            course_id=uuid.UUID(seed.course_id), teacher_id=uuid.UUID(seed.teacher_id),
            title="Page bank flow: practice", type="practice", status="draft",
            unit_ids=[uuid.UUID(seed.unit_id)],
        )
        s.add(practice)
        await s.flush()
        version = QuestionBankItem(
            course_id=practice.course_id, unit_id=uuid.UUID(seed.unit_id),
            originating_assignment_id=practice.id, title="Page bank flow: practice version",
            question="Solve 2x = 4.", final_answer="x = 2", status="approved", source="generated",
        )
        s.add(version)
        await s.flush()
        practice.content = {"problem_ids": [str(version.id)]}
        await s.commit()
        practice_id = str(practice.id)
    issues: list[str] = []
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}/homework/{practice_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        try:
            await page.get_by_text("Solve 2x = 4.").first.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            return ["the draft practice set's page did not show its problem"]
        for label in ("Add from bank", "Remove problems"):
            if await page.get_by_role("button", name=label).count():
                issues.append(f"a practice set offers {label}, which can't work there")
    return issues
