"""Browser flows on the teacher's section review page — split from
flows.py to keep that file under the size limit. Same contract as every
flow there: a definitive Playwright signal fails a step, infra errors
raise and get dropped by `run_flows`, and nothing here publishes."""

from __future__ import annotations

from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from tests.harness.browser import HarnessBrowser
from tests.harness.flow_result import FLOW_TIMEOUT_MS as _TIMEOUT_MS
from tests.harness.flow_result import FlowResult
from tests.harness.seed import Seed, seed_review_homework, seed_review_integrity


async def review_page_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher works the section review page: the roster triages the class,
    the AI-graded student opens by default, the rubric panel opens, a
    confident row is confirmed, a grade click saves, and the page's session
    state (rubric open, confirm ticks) survives switching students and coming
    back. Then the shortcuts (via its button: a "?" keypress from Playwright
    never opens it), verdict-legend and publish dialogs open and close
    without publishing. Guards the page's split into
    components, hooks and a store: every step is a state it must keep.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each state (the
    before/after evidence for a refactor of this page)."""
    import os
    import re

    name, title = "review_page", "Teacher reviews a section's homework"
    issues: list[str] = []
    rs = await seed_review_homework(seed)
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    url = (
        f"{web_base.rstrip('/')}/school/teacher/courses/{rs.course_id}"
        f"/homework/{rs.assignment_id}/sections/{rs.section_id}/review"
    )
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        async def shot(label: str) -> None:
            if shots:
                os.makedirs(shots, exist_ok=True)
                # Let a dialog's fade-in finish so the picture is the settled state.
                await page.wait_for_function(
                    "() => document.getAnimations().every(a => a.playState !== 'running')",
                    timeout=_TIMEOUT_MS,
                )
                await page.screenshot(path=os.path.join(shots, f"{label}.png"))

        async def step(what: str, coro) -> bool:
            try:
                await coro
                return True
            except PlaywrightTimeoutError:
                issues.append(what)
                return False

        # Never let this flow release grades: the Publish button publishes
        # straight through when nothing needs a confirm, so block the call.
        await page.route("**/publish-grades*", lambda route: route.abort())
        roster = page.locator("aside", has_text="submitted").last
        await page.goto(url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        confirm_all = page.get_by_role("button", name=re.compile(r"Confirm all 1 confident"))
        if not await step(
            "the review page never opened the AI-graded student with its confident "
            "row collapsed ('Confirm all 1 confident grade' not shown)",
            confirm_all.wait_for(timeout=_TIMEOUT_MS),
        ):
            return FlowResult(name, title, False, issues)
        for student in (rs.graded_student, rs.ungraded_student, rs.absent_student):
            if not await roster.get_by_role("button", name=re.compile(student)).count():
                issues.append(f"the roster does not list {student}")
        await shot("01-loaded")

        rubric_text = page.get_by_text("Correct answer with work shown.")
        await step("no Rubric panel to open",
                   page.locator("summary", has_text="Rubric").click(timeout=_TIMEOUT_MS))
        await step("opening the Rubric panel did not show the rubric",
                   rubric_text.wait_for(timeout=_TIMEOUT_MS))
        await shot("02-rubric-open")

        await step("no Confirm control on the confident row",
                   page.get_by_role("button", name=re.compile(r"^Confirm\s*1$")).click(timeout=_TIMEOUT_MS))
        confirmed = page.get_by_text(re.compile(r"^\u2713\s*Confirmed$"))
        await step("confirming the confident row did not mark it Confirmed",
                   confirmed.first.wait_for(timeout=_TIMEOUT_MS))
        await shot("03-confirmed")

        # Problem 1 is collapsed, so the first Full button is problem 2's.
        await step("no Full grade button on problem 2",
                   page.get_by_role("button", name="Full", exact=True).first.click(timeout=_TIMEOUT_MS))
        await step("grading problem 2 was not announced in the live region",
                   page.wait_for_function(
                       "() => /Problem 2/.test(document.querySelector("
                       "\"[aria-live='polite'].sr-only\")?.textContent || '')",
                       timeout=_TIMEOUT_MS))
        await step("the roster did not show the student's new score after grading",
                   roster.get_by_role("button", name=re.compile(rs.graded_student + r".*67%"))
                   .wait_for(timeout=_TIMEOUT_MS))
        await shot("04-graded")

        await step(f"the roster has no row for {rs.ungraded_student}",
                   roster.get_by_role("button", name=re.compile(rs.ungraded_student)).click(timeout=_TIMEOUT_MS))
        await step(f"selecting {rs.ungraded_student} did not open their work",
                   page.get_by_text("Not graded yet").first.wait_for(timeout=_TIMEOUT_MS))
        await step("the Rubric panel closed when switching students (it is a session preference)",
                   rubric_text.wait_for(timeout=_TIMEOUT_MS))
        await shot("05-ungraded-student")

        await step(f"the roster has no row for {rs.graded_student}",
                   roster.get_by_role("button", name=re.compile(rs.graded_student)).click(timeout=_TIMEOUT_MS))
        await step("coming back to the graded student lost the confirmed tick",
                   confirmed.first.wait_for(timeout=_TIMEOUT_MS))

        await step(f"the roster has no row for {rs.absent_student}",
                   roster.get_by_role("button", name=re.compile(rs.absent_student)).click(timeout=_TIMEOUT_MS))
        await step(f"selecting {rs.absent_student} did not show the Not submitted card",
                   page.get_by_text("hasn\u2019t turned in this homework yet").or_(
                       page.get_by_text("hasn't turned in this homework yet")).wait_for(timeout=_TIMEOUT_MS))
        await shot("06-not-submitted")

        await step(f"the roster has no row for {rs.graded_student}",
                   roster.get_by_role("button", name=re.compile(rs.graded_student)).click(timeout=_TIMEOUT_MS))
        await step("coming back to the graded student did not reopen their work",
                   confirm_all.or_(confirmed.first).first.wait_for(timeout=_TIMEOUT_MS))
        dialog = page.get_by_role("dialog")
        for label, opener, what in (
            ("07-shortcuts",
             lambda: page.get_by_role("button", name="Show keyboard shortcuts").click(),
             "keyboard shortcuts"),
            ("08-verdict-legend",
             lambda: page.get_by_role("button", name="Show integrity verdict legend").click(),
             "verdict legend"),
            ("09-publish-confirm",
             lambda: page.get_by_role("button", name=re.compile(r"^Publish")).first.click(),
             "publish confirm"),
        ):
            await page.evaluate("document.activeElement && document.activeElement.blur()")
            if not await step(f"no control opens the {what} dialog", opener()):
                continue
            if await step(f"the {what} dialog did not open", dialog.first.wait_for(timeout=_TIMEOUT_MS)):
                await shot(label)
                await page.keyboard.press("Escape")
                await step(f"the {what} dialog did not close on Escape",
                           dialog.first.wait_for(state="detached", timeout=_TIMEOUT_MS))
    return FlowResult(name, title, not issues, issues)


async def review_integrity_flow(
    browser: HarnessBrowser, web_base: str, api_base: str, seed: Seed,
) -> FlowResult:
    """Teacher resolves a flagged understanding check from the review
    page's integrity card in one click: the card quotes the student's
    last answer and shows the three outcome chips; clicking one saves
    that resolution and swaps the chips for the quiet Reviewed chip.
    Then the load-bearing invariant, read from the DB: resolving set
    ONLY the check's resolution — the AI verdict stands and the grade is
    neither approved nor published.

    Set HARNESS_FLOW_SHOTS=<dir> to save a screenshot of each state."""
    import os
    import re
    import uuid

    from sqlalchemy import select

    from api.database import get_session_factory
    from api.models.assignment import SubmissionGrade
    from api.models.integrity_check import IntegrityCheckSubmission

    name, title = "review_integrity", "Teacher resolves an integrity flag from the card"
    issues: list[str] = []
    rs = await seed_review_integrity(seed)
    shots = os.environ.get("HARNESS_FLOW_SHOTS")
    url = (
        f"{web_base.rstrip('/')}/school/teacher/courses/{rs.course_id}"
        f"/homework/{rs.assignment_id}/sections/{rs.section_id}/review"
    )
    async with browser.authed_page(seed.teacher_token, seed.teacher_refresh) as page:
        async def shot(label: str) -> None:
            if shots:
                os.makedirs(shots, exist_ok=True)
                await page.screenshot(path=os.path.join(shots, f"integrity-{label}.png"))

        async def step(what: str, coro) -> bool:
            try:
                await coro
                return True
            except PlaywrightTimeoutError:
                issues.append(what)
                return False

        # Belt and braces: this flow must never release or approve grades.
        await page.route("**/publish-grades*", lambda route: route.abort())
        await page.goto(url, wait_until="domcontentloaded", timeout=_TIMEOUT_MS)
        roster = page.locator("aside", has_text="submitted").last
        if not await step(
            f"the roster has no row for {rs.flagged_student}",
            roster.get_by_role("button", name=re.compile(rs.flagged_student))
            .click(timeout=_TIMEOUT_MS),
        ):
            return FlowResult(name, title, False, issues)
        chips = page.get_by_role("group", name="Mark reviewed as")
        if not await step(
            "the flagged check's card shows no outcome chips to resolve it",
            chips.first.wait_for(timeout=_TIMEOUT_MS),
        ):
            return FlowResult(name, title, False, issues)
        # The card renders in the xl rail AND (hidden) the grade column;
        # act on the visible copy only.
        card_chips = page.locator("[role=group][aria-label='Mark reviewed as']:visible")
        for outcome in ("Cleared — no concern", "Confirmed concern", "Contacted student"):
            if not await card_chips.get_by_role("button", name=outcome).count():
                issues.append(f"the card is missing the '{outcome}' outcome")
        await step("the card does not quote the student's last answer",
                   page.get_by_text(rs.last_answer).locator("visible=true").first
                   .wait_for(timeout=_TIMEOUT_MS))
        # The paste is evidence under the activity flag, collapsed — not
        # the quote, which stays the last answer.
        evidence = page.locator("details:visible", has_text="What they sent on")
        if await step("the card has no collapsed evidence for the pasted turn",
                      evidence.first.wait_for(timeout=_TIMEOUT_MS)):
            if await page.get_by_text(rs.pasted_answer).locator("visible=true").count():
                issues.append("the pasted answer shows before the teacher opens the evidence "
                              "(it replaced the last-answer quote, or the evidence isn't collapsed)")
            if await evidence.first.get_attribute("open") is not None:
                issues.append("the paste evidence is open by default (should be collapsed)")
            await evidence.first.locator("summary").click(timeout=_TIMEOUT_MS)
            await step("opening the evidence did not show the pasted answer",
                       evidence.first.get_by_text(rs.pasted_answer)
                       .wait_for(timeout=_TIMEOUT_MS))
            await shot("01b-evidence-open")
        # The card's live region is the verdict line only — the quote
        # inside it would be read out on every student switch.
        if await page.locator("[role=status]:visible", has_text=rs.last_answer).count():
            issues.append("the quoted answer sits inside the card's live region")
        await shot("01-flagged")

        await step("clicking 'Cleared — no concern' did nothing",
                   card_chips.get_by_role("button", name="Cleared — no concern")
                   .click(timeout=_TIMEOUT_MS))
        await step("resolving did not show the Reviewed chip on the card",
                   page.get_by_text(re.compile(r"Reviewed.*Cleared")).locator("visible=true")
                   .first.wait_for(timeout=_TIMEOUT_MS))
        await step("the outcome chips stayed up after resolving",
                   card_chips.first.wait_for(state="detached", timeout=_TIMEOUT_MS))
        await shot("02-resolved")

    async with get_session_factory()() as s:
        sub_id = uuid.UUID(rs.submission_id)
        check = (await s.execute(select(IntegrityCheckSubmission).where(
            IntegrityCheckSubmission.submission_id == sub_id))).scalar_one()
        grade = (await s.execute(select(SubmissionGrade).where(
            SubmissionGrade.submission_id == sub_id))).scalar_one()
    if check.resolution != "cleared":
        issues.append(f"the check's resolution is {check.resolution!r}, expected 'cleared'")
    if check.disposition != "flag_for_review":
        issues.append(f"resolving changed the AI verdict to {check.disposition!r}")
    if grade.reviewed_at is not None:
        issues.append("resolving the integrity check approved the grade")
    if grade.grade_published_at is not None:
        issues.append("resolving the integrity check published the grade")
    return FlowResult(name, title, not issues, issues)
