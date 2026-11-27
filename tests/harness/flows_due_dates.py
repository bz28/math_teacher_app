"""Due-date journeys on the homework page for the flow harness (see
flows.py for the contract). No LLM: the grade is seeded."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

from playwright.async_api import Route
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from sqlalchemy import select

from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from tests.harness.browser import HarnessBrowser
from tests.harness.seed import Seed
from tests.harness.types import FlowResult

_TIMEOUT_MS = 30000


async def change_section_due_date_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """A published homework in two sections, with the student's work in on
    time -> Change -> Different per section -> the student's section due
    two days ago -> the dialog says 1 turn-in changes lateness before
    saving -> Save: the header shows the dates by section, the turn-in is
    late, the other section keeps its date."""
    name, title = "change_section_due_date", "Teacher moves one section's due date"
    issues: list[str] = []
    now = datetime.now(UTC)
    due = now + timedelta(days=3)
    async with get_session_factory()() as s:
        student_section = (await s.execute(
            select(SectionEnrollment.section_id).where(
                SectionEnrollment.student_id == uuid.UUID(seed.student_id),
                SectionEnrollment.course_id == uuid.UUID(seed.course_id),
            )
        )).scalar_one()
        student_section_name = (await s.get(Section, student_section)).name  # type: ignore[union-attr]
        other = Section(course_id=uuid.UUID(seed.course_id), name="Due flow: Period 9")
        hw = Assignment(
            course_id=uuid.UUID(seed.course_id), teacher_id=uuid.UUID(seed.teacher_id),
            unit_ids=[uuid.UUID(seed.unit_id)], title="Due flow HW", type="homework",
            status="published", due_at=due, late_policy="none", content={"problem_ids": []},
        )
        s.add_all([other, hw])
        await s.flush()
        for sid in (student_section, other.id):
            s.add(AssignmentSection(assignment_id=hw.id, section_id=sid, published_at=now, due_at=due))
        sub = Submission(
            assignment_id=hw.id, student_id=uuid.UUID(seed.student_id), section_id=student_section,
            status="submitted", submitted_at=now - timedelta(hours=1), is_late=False,
        )
        s.add(sub)
        await s.commit()
        hw_id, sub_id, other_id = hw.id, sub.id, other.id
    earlier = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%dT23:59")
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}/homework/{hw_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        dialog = page.get_by_role("dialog", name="Due date")
        try:
            await page.get_by_role("button", name="Change", exact=True).first.click(timeout=_TIMEOUT_MS)
            await dialog.get_by_role("radio", name="Different per section").click(timeout=_TIMEOUT_MS)
            await dialog.get_by_label(student_section_name).fill(earlier, timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the due-date dialog did not offer a date per section")
            return FlowResult(name, title, False, issues)
        try:
            await dialog.get_by_text("1 turned-in submission changes lateness").wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the dialog did not say the turn-in would become late before saving")
        try:
            await dialog.get_by_role("button", name="Save due date").click(timeout=_TIMEOUT_MS)
            await dialog.wait_for(state="detached", timeout=_TIMEOUT_MS)
            await page.get_by_text("Due by section:").wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("saving did not close the dialog and show the dates by section")
            return FlowResult(name, title, False, issues)
    async with get_session_factory()() as s:
        sub_after = await s.get(Submission, sub_id)
        other_due = (await s.execute(select(AssignmentSection.due_at).where(
            AssignmentSection.assignment_id == hw_id, AssignmentSection.section_id == other_id,
        ))).scalar_one()
    if sub_after is None or not sub_after.is_late:
        issues.append("the turn-in did not become late with its section's earlier date")
    if other_due != due:
        issues.append("the other section's date moved too")
    return FlowResult(name, title, not issues, issues)


async def inline_due_then_dialog_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """A draft in two sections -> Configuration's date picker moves the due
    date -> Change -> Different per section: both sections start from the
    new date, not the one the page loaded with."""
    name, title = "inline_due_then_dialog", "Teacher edits a draft's date, then its sections"
    issues: list[str] = []
    old = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(days=3)
    async with get_session_factory()() as s:
        sections = [Section(course_id=uuid.UUID(seed.course_id), name=f"Inline flow: P{i}") for i in (1, 2)]
        hw = Assignment(
            course_id=uuid.UUID(seed.course_id), teacher_id=uuid.UUID(seed.teacher_id),
            unit_ids=[uuid.UUID(seed.unit_id)], title="Inline due flow HW", type="homework",
            status="draft", due_at=old, late_policy="none", content={"problem_ids": []},
        )
        s.add_all([*sections, hw])
        await s.flush()
        for sec in sections:
            s.add(AssignmentSection(assignment_id=hw.id, section_id=sec.id, due_at=old))
        await s.commit()
        hw_id, names = hw.id, [sec.name for sec in sections]
    new_local = (datetime.now() + timedelta(days=6)).strftime("%Y-%m-%dT23:59")
    first_local = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%dT23:59")
    fail_next_read = {"on": False}

    async def flaky_read(route: Route) -> None:
        # The re-read after a save fails once: the save itself stood.
        if route.request.method == "GET" and fail_next_read["on"]:
            fail_next_read["on"] = False
            await route.fulfill(status=500, body="{}")
        else:
            await route.continue_()

    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        await page.route(re.compile(rf"/teacher/assignments/{hw_id}$"), flaky_read)
        await page.goto(
            f"{web_base.rstrip('/')}/school/teacher/courses/{seed.course_id}/homework/{hw_id}",
            wait_until="domcontentloaded", timeout=_TIMEOUT_MS,
        )
        try:
            config = page.get_by_role("button", name=re.compile(r"Configuration"))
            # Open when the homework has no problems yet; don't close it.
            if await config.get_attribute("aria-expanded", timeout=_TIMEOUT_MS) != "true":
                await config.click(timeout=_TIMEOUT_MS)
            picker = page.locator('input[type="datetime-local"]').first
            fail_next_read["on"] = True
            await picker.fill(first_local, timeout=_TIMEOUT_MS)
            await page.get_by_text("Saved").first.wait_for(timeout=_TIMEOUT_MS)
        except PlaywrightTimeoutError:
            issues.append("the Configuration date picker did not save a new date")
            return FlowResult(name, title, False, issues)
        await page.wait_for_timeout(1500)  # the failing re-read has come back
        if await page.get_by_text("Save failed").count() or await picker.input_value() != first_local:
            issues.append("a failed re-read after the save undid a date the server kept")
        await picker.fill(new_local, timeout=_TIMEOUT_MS)
        await page.wait_for_timeout(1500)
        dialog = page.get_by_role("dialog", name="Due date")
        try:
            await page.get_by_role("button", name="Change", exact=True).first.click(timeout=_TIMEOUT_MS)
            await dialog.get_by_role("radio", name="Different per section").click(timeout=_TIMEOUT_MS)
            values = [await dialog.get_by_label(n).input_value(timeout=_TIMEOUT_MS) for n in names]
            for _ in range(20):  # the re-read lands just after "Saved"
                if values == [new_local, new_local]:
                    break
                await page.wait_for_timeout(250)
                values = [await dialog.get_by_label(n).input_value(timeout=_TIMEOUT_MS) for n in names]
        except PlaywrightTimeoutError:
            issues.append("the due-date dialog did not list both sections")
            return FlowResult(name, title, False, issues)
        if values != [new_local, new_local]:
            issues.append(f"the dialog started the sections at {values}, not the date just saved")
    return FlowResult(name, title, not issues, issues)
