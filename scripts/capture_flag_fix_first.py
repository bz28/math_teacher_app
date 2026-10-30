"""Screenshot the confirm screen's fix-first flag step, end to end.

Seeds one homework with a stored reading per student (no AI calls — the
reading is written straight onto the submission), then drives the real
web app as each student and as the teacher:

  step        "Something looks wrong" → "How much did we get wrong?"
  few-lines   "Just a few lines" → pencils highlighted + the fix hint
  note        "Most of it is wrong" → optional note, edits kept
  terminal    after "Send to my teacher"
  teacher     the review page's flagged callout with the note + edit count
  confirm     blast radius: the ordinary edit-then-confirm path

Each student flow runs at desktop and phone width.

    WEB_BASE=http://localhost:3054 .venv/bin/python -m scripts.capture_flag_fix_first
    # --before: capture the pre-change surfaces (run against main's code)

Writes docs/design/flag-fix-first-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3054").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"
DESKTOP = {"width": 1280, "height": 900}
PHONE = {"width": 390, "height": 844}

SPECS = [
    ("Solve for x:  $2x + 3 = 11$", "$x = 4$"),
    ("Simplify:  $3(x - 4) + 5$", "$3x - 7$"),
    ("Solve for x:  $5x - 7 = 18$", "$x = 5$"),
]

# The prod-shaped misread: the student's 7s read as 1s.
EXTRACTION: dict[str, Any] = {
    "confidence": 0.72,
    "steps": [
        {"problem_position": 1, "step_num": 1, "latex": "2x + 3 = 11", "plain_english": ""},
        {"problem_position": 1, "step_num": 2, "latex": "2x = 8", "plain_english": ""},
        {"problem_position": 1, "step_num": 3, "latex": "x = 4", "plain_english": ""},
        {"problem_position": 2, "step_num": 1, "latex": "3x - 12 + 5", "plain_english": ""},
        {"problem_position": 2, "step_num": 2, "latex": "3x - 1", "plain_english": ""},
        {"problem_position": 3, "step_num": 1, "latex": "5x - 1 = 18", "plain_english": ""},
        {"problem_position": 3, "step_num": 2, "latex": "5x = 19", "plain_english": ""},
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "x = 4", "answer_plain": ""},
        {"problem_position": 2, "answer_latex": "3x - 1", "answer_plain": ""},
        {"problem_position": 3, "answer_latex": "x = \\frac{19}{5}", "answer_plain": ""},
    ],
    "visual_work": [],
}

STUDENTS = ["Alex Kim", "Sam Ortiz", "Jordan Lee", "Riley Shah"]


def _page_file() -> dict[str, str]:
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='520'>"
        "<rect width='400' height='520' fill='#fffdf7'/>"
        "<text x='30' y='60' font-size='24' fill='#243b6b'>1) 2x + 3 = 11</text>"
        "<text x='60' y='100' font-size='24' fill='#243b6b'>2x = 8,  x = 4</text>"
        "<text x='30' y='190' font-size='24' fill='#243b6b'>2) 3x - 12 + 5</text>"
        "<text x='60' y='230' font-size='24' fill='#243b6b'>= 3x - 7</text>"
        "<text x='30' y='320' font-size='24' fill='#243b6b'>3) 5x - 7 = 18</text>"
        "<text x='60' y='360' font-size='24' fill='#243b6b'>5x = 25,  x = 5</text>"
        "</svg>"
    )
    return {"data": base64.b64encode(svg.encode()).decode(), "media_type": "image/svg+xml"}


async def seed() -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"flag_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"flag_teacher_{suffix}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Linear Equations", position=0)
        s.add(unit)
        await s.flush()
        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()
        # Integrity off so confirming doesn't open the chat; grading is
        # deferred to the far-off due date, so confirming makes no AI call.
        hw = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Linear Equations Practice", type="homework", status="published",
            content={"problem_ids": []}, due_at=now + timedelta(days=14),
            integrity_check_enabled=False, ai_grading_enabled=True,
        )
        s.add(hw)
        await s.flush()
        items = []
        for i, (q, ans) in enumerate(SPECS):
            it = QuestionBankItem(
                course_id=course.id, unit_id=unit.id, originating_assignment_id=hw.id,
                title=f"P{i + 1}", question=q, final_answer=ans,
                difficulty="medium", format="frq", status="approved",
            )
            s.add(it)
            items.append(it)
        await s.flush()
        hw.content = {"problem_ids": [str(it.id) for it in items]}
        s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id, published_at=now))

        students: dict[str, dict[str, str]] = {}
        for name in STUDENTS:
            u = User(
                email=f"{name.split()[0].lower()}_{suffix}@school.edu",
                password_hash=hash_password("x"), grade_level=9,
                role="student", name=name, school_id=school.id,
            )
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=u.id))
            s.add(Submission(
                assignment_id=hw.id, student_id=u.id, section_id=section.id,
                status="submitted", files=[_page_file()], extraction=EXTRACTION,
                submitted_at=now - timedelta(minutes=3),
            ))
            students[name.split()[0].lower()] = {
                "id": str(u.id),
                "access": create_access_token(str(u.id), "student"),
                "refresh": await create_refresh_token(s, u.id),
            }
        teacher_refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
    return {
        "course_id": str(course.id), "hw_id": str(hw.id), "section_id": str(section.id),
        "teacher_access": create_access_token(str(teacher.id), "teacher"),
        "teacher_refresh": teacher_refresh, "students": students,
    }


async def _shot(page: Any, name: str, *, full: bool = False) -> None:
    out = OUT_DIR / f"flag-fix-first-{name}.png"
    await page.screenshot(path=str(out), full_page=full)
    print(f"  -> {out}")


async def _scroll_bottom(page: Any) -> None:
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await page.wait_for_timeout(400)


async def _open_confirm(page: Any, w: dict[str, Any]) -> None:
    url = f"{WEB_BASE}/school/student/courses/{w['course_id']}/homework/{w['hw_id']}"
    await page.goto(url, wait_until="networkidle", timeout=45000)
    await page.get_by_text("Does this match what you wrote?").wait_for(timeout=20000)
    await page.wait_for_timeout(800)


async def _fix_line(page: Any, label: str, text: str) -> None:
    await page.get_by_role("button", name=f"Edit {label}").click()
    await page.get_by_role("textbox", name=f"Edit {label}").fill(text)
    await page.get_by_role("button", name="Save").click()
    await page.wait_for_timeout(300)


async def flag_flow(browser: HarnessBrowser, w: dict[str, Any], who: str, size: str) -> None:
    st = w["students"][who]
    async with browser.authed_page(st["access"], st["refresh"]) as page:
        await page.set_viewport_size(DESKTOP if size == "desktop" else PHONE)
        await _open_confirm(page, w)

        await page.get_by_role("button", name="Something looks wrong").click()
        await page.get_by_role("dialog").wait_for()
        await page.wait_for_timeout(500)
        await _shot(page, f"step-{size}")

        await page.get_by_role("button", name="Just a few lines").click()
        await page.wait_for_timeout(2600)  # scroll + the two-beat pulse settle
        await _shot(page, f"few-lines-{size}")

        # Fix the misread on problem 2 the way a student would…
        await page.get_by_role("tab", name="Problem 2").click()
        await _fix_line(page, "step 2 of problem 2", "3x - 7")

        # …then decide the rest is too far off and send it anyway.
        await _scroll_bottom(page)
        await page.get_by_role("button", name="Something looks wrong").click()
        await page.get_by_role("button", name="Most of it is wrong").click()
        await page.get_by_role("textbox", name="What did it get wrong? (optional)").fill(
            "It read all my 7s as 1s, so problems 2 and 3 are wrong",
        )
        await page.wait_for_timeout(300)
        await _shot(page, f"note-{size}")

        await page.get_by_role("button", name="Send to my teacher").click()
        await page.get_by_text("Sent to your teacher").wait_for(timeout=20000)
        await page.wait_for_timeout(500)
        await _shot(page, f"terminal-{size}")


async def confirm_flow(browser: HarnessBrowser, w: dict[str, Any], who: str, size: str) -> None:
    """Blast radius: the ordinary fix-a-line-and-confirm path."""
    st = w["students"][who]
    async with browser.authed_page(st["access"], st["refresh"]) as page:
        await page.set_viewport_size(DESKTOP if size == "desktop" else PHONE)
        await _open_confirm(page, w)
        await page.get_by_role("tab", name="Problem 2").click()
        await _fix_line(page, "step 2 of problem 2", "3x - 7")
        await page.get_by_role("tab", name="Problem 3").click()
        await page.wait_for_timeout(300)
        await _scroll_bottom(page)
        await _shot(page, f"confirm-before-submit-{size}")
        async with page.expect_response(lambda r: "confirm-extraction" in r.url
                                        and r.request.method == "POST") as resp:
            await page.get_by_role("button", name="Confirm — this is my work").click()
        assert (await resp.value).status == 200
        # Reload: with integrity off, the page doesn't route itself off the
        # confirm screen after a confirm (pre-existing, page.tsx loadAll).
        await page.reload(wait_until="networkidle")
        await page.get_by_text("That's in your teacher's hands now.").wait_for(timeout=30000)
        await page.wait_for_timeout(800)
        await _shot(page, f"confirm-after-{size}")


async def teacher_review(browser: HarnessBrowser, w: dict[str, Any], who: str, name: str) -> None:
    url = (
        f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/{w['hw_id']}"
        f"/sections/{w['section_id']}/review?student={w['students'][who]['id']}"
    )
    async with browser.authed_page(w["teacher_access"], w["teacher_refresh"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1500})
        await page.goto(url, wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(1800)
        await _shot(page, name)


async def before(browser: HarnessBrowser, w: dict[str, Any]) -> None:
    """Pre-change surfaces: the old one-tap flag button and what followed."""
    for who, size in (("alex", "desktop"), ("sam", "phone")):
        st = w["students"][who]
        async with browser.authed_page(st["access"], st["refresh"]) as page:
            await page.set_viewport_size(DESKTOP if size == "desktop" else PHONE)
            await _open_confirm(page, w)
            await _scroll_bottom(page)
            await _shot(page, f"before-confirm-{size}")
            await page.get_by_role("button", name="This reading is completely wrong").click()
            await page.get_by_text("Sent to your teacher").wait_for(timeout=20000)
            await page.wait_for_timeout(500)
            await _shot(page, f"before-terminal-{size}")
    await teacher_review(browser, w, "alex", "before-teacher")


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding flag-fix-first world …")
    w = await seed()
    async with HarnessBrowser(WEB_BASE) as browser:
        if "--before" in sys.argv:
            await before(browser, w)
            return 0
        await flag_flow(browser, w, "alex", "desktop")
        await flag_flow(browser, w, "sam", "phone")
        await teacher_review(browser, w, "alex", "teacher")
        await confirm_flow(browser, w, "jordan", "desktop")
        await confirm_flow(browser, w, "riley", "phone")
        await teacher_review(browser, w, "jordan", "teacher-confirmed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
