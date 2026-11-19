"""Screenshot the collapsed confident-row answer comparison on the review page.

Seeds a local-only world with one student whose confident AI grades cover
the answer shapes that used to clip in the one-line row: fractions, a long
8-solution list, square roots, a matrix (inline + a huge one that hits the
safety cap), "No answer extracted", degrees, a short answer, plus one
uncertain (expanded) row. Then captures the rows at desktop and phone
width, a focused + a confirmed row, expand/collapse, keyboard confirm +
advance, and "Confirm all".

Standalone (not a durable test) — drives the running worktree stack:

    NEXT_PUBLIC_API_URL=http://localhost:8131/v1 \
    WEB_BASE=http://localhost:3131 LABEL=after \
    ../math_teacher_app/.venv/bin/python -m scripts.capture_answer_rows

Writes docs/design/answer-rows-<LABEL>-*.png.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3131").rstrip("/")
LABEL = os.environ.get("LABEL", "after")
DESKTOP_WIDTH = int(os.environ.get("DESKTOP_WIDTH", "1440"))
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"

EIGHT = ", ".join(rf"\frac{{{n}\pi}}{{16}}" if n > 1 else r"\frac{\pi}{16}"
                  for n in (1, 3, 5, 7, 9, 11, 13, 15))
BIG_MATRIX = (
    r"\begin{bmatrix} "
    + r" \\ ".join(" & ".join(rf"\frac{{{r + c}}}{{{r * c + 1}}}" for c in range(1, 6))
                   for r in range(1, 8))
    + r" \end{bmatrix}"
)

# (question, key, student answer or None, status, confidence)
SPECS: list[tuple[str, str, str | None, str, float]] = [
    ("Solve $\\tan x = \\tan\\frac{\\pi}{8}$ on $[0, \\pi)$.",
     r"$x = \frac{\pi}{8}$", r"$x = \frac{\pi}{8}$", "full", 0.96),
    ("Solve $\\cos 8x = 0$ on $[0, \\pi)$.",
     f"$x = {EIGHT}$", f"$x = {EIGHT}$", "full", 0.95),
    ("Evaluate $\\sin\\frac{\\pi}{4}$.",
     r"$\frac{\sqrt{2}}{2}$", r"$\frac{\sqrt{2}}{2}$", "full", 0.97),
    ("Compute $A + B$.",
     r"$$\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}$$",
     r"\begin{bmatrix} 1 & 2 \\ 3 & 4 \end{bmatrix}", "full", 0.94),
    ("Find the angle of elevation.", r"$4.8^\circ$", None, "zero", 0.93),
    ("Find the angle of depression.", r"$4.8^\circ$", r"$4.8^\circ$", "full", 0.95),
    ("Compute the 7×5 product matrix.", f"$${BIG_MATRIX}$$", BIG_MATRIX, "full", 0.92),
    # Trailing newlines, as the extractor sometimes returns them.
    ("Solve $2x + 3 = 11$.", "$x = 4$", "$x = 4$\n\n", "full", 0.98),
    # Interior line break (a system) must keep its shape; a short root.
    ("Solve the system $x + y = 5$, $x - y = -1$.",
     "$x = 2$<br>$y = 3$", "$x = 2$<br>$y = 3$", "full", 0.96),
    ("Simplify $\\sqrt{8}$.", r"$2\sqrt{2}$", r"$2\sqrt{2}$", "full", 0.97),
    # No break points anywhere: one unbreakable KaTeX run, wider than a cell.
    ("Describe where $f(x) = x^2$ is monotonic.",
     r"$\text{decreasing on }(-\infty,0)\text{ and increasing on }(0,\infty)$",
     r"$\text{increasing on }(0,\infty)\text{ and decreasing on }(-\infty,0)$",
     "full", 0.93),
    ("Solve $\\sin x = \\frac12$ on $[0, 2\\pi)$.",
     r"$x = \frac{\pi}{6}, \frac{5\pi}{6}$", r"$x = \frac{\pi}{6}$", "partial", 0.6),
]


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
                        contact_name="Demo", contact_email=f"rows_{suffix}@t.com")
        s.add(school)
        await s.flush()
        teacher = User(email=f"rows_teacher_{suffix}@t.com", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id)
        s.add(teacher)
        await s.flush()
        course = Course(name="Precalculus", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Trig Equations", position=0)
        s.add(unit)
        await s.flush()
        section = Section(course_id=course.id, name="Period 2")
        s.add(section)
        await s.flush()
        assignment = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                                title="Trig Equations", type="homework", status="published",
                                content={"problem_ids": []})
        s.add(assignment)
        await s.flush()
        items = []
        for i, (q, key, *_rest) in enumerate(SPECS):
            it = QuestionBankItem(course_id=course.id, unit_id=unit.id,
                                  originating_assignment_id=assignment.id, title=f"P{i + 1}",
                                  question=q, final_answer=key, difficulty="medium",
                                  format="frq", status="approved")
            items.append(it)
            s.add(it)
        await s.flush()
        assignment.content = {"problem_ids": [str(it.id) for it in items]}
        s.add(AssignmentSection(assignment_id=assignment.id, section_id=section.id,
                                published_at=datetime.now(UTC)))
        student = User(email=f"rows_student_{suffix}@school.edu", password_hash=hash_password("x"),
                       grade_level=11, role="student", name="Jordan Lee")
        s.add(student)
        await s.flush()
        s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=student.id))
        now = datetime.now(UTC)
        pct = {"full": 100.0, "partial": 50.0, "zero": 0.0}
        bd, ai = [], []
        for i, (it, (_q, _k, sa, st, conf)) in enumerate(zip(items, SPECS, strict=True)):
            bd.append({"problem_id": str(it.id), "score_status": st, "percent": pct[st],
                       "confidence": conf, "feedback": "", "deductions": None,
                       "student_answer": sa})
            ai.append({"problem_position": i + 1, "student_answer": sa, "score_status": st,
                       "percent": pct[st], "confidence": conf,
                       "reasoning": "Matches the key.", "student_feedback": "Nice."})
        sub = Submission(assignment_id=assignment.id, student_id=student.id,
                         section_id=section.id, status="submitted", extraction={"steps": []},
                         extraction_confirmed_at=now - timedelta(hours=1),
                         submitted_at=now - timedelta(hours=2))
        s.add(sub)
        await s.flush()
        score = sum(e["percent"] for e in bd) / len(bd)
        s.add(SubmissionGrade(submission_id=sub.id, ai_score=score, final_score=score,
                              ai_breakdown={"grades": ai}, breakdown=bd,
                              graded_at=now - timedelta(minutes=50)))
        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "url": (f"/school/teacher/courses/{course.id}/homework/{assignment.id}"
                    f"/sections/{section.id}/review?student={student.id}"),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
        }


ROWS_BOX_JS = """() => {
  const rows = [...document.querySelectorAll('[aria-label^="Expand problem "]')]
    .map(b => b.closest('[tabindex="-1"]'));
  const first = rows[0];
  const list = first.parentElement;
  const r = list.getBoundingClientRect();
  return {x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height};
}"""


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    w = await seed()
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            async def shot(name: str, pad: int = 8) -> None:
                await page.wait_for_timeout(500)
                # The phone layout's fixed bottom nav would float over the
                # rows in a full-page clip; it isn't part of this surface.
                await page.evaluate("""() => document.querySelectorAll('*').forEach(el => {
                  const cs = getComputedStyle(el);
                  if (cs.position === 'fixed' && cs.bottom === '0px') el.style.display = 'none';
                })""")
                box = await page.evaluate(ROWS_BOX_JS)
                out = OUT_DIR / f"answer-rows-{LABEL}-{name}.png"
                await page.screenshot(path=str(out), full_page=True, clip={
                    "x": max(0, box["x"] - pad), "y": max(0, box["y"] - pad),
                    "width": box["width"] + 2 * pad, "height": box["height"] + 2 * pad,
                })
                print(f"  -> {out}")

            async def load(width: int) -> None:
                await page.set_viewport_size({"width": width, "height": 1400})
                await page.goto(f"{WEB_BASE}{w['url']}", wait_until="networkidle",
                                timeout=60000)
                await page.locator('[aria-label^="Expand problem 1 "]').wait_for(timeout=30000)
                await page.wait_for_timeout(1200)

            # 1-6: desktop rows (problem 1 is the focused row on load).
            await load(DESKTOP_WIDTH)
            await shot("desktop")
            # 8: a confirmed row — click Confirm on problem 3.
            row3 = page.locator('[aria-label^="Expand problem 3 "]').locator(
                'xpath=ancestor::div[@tabindex="-1"][1]')
            await row3.get_by_role("button", name="Confirm", exact=False).click()
            await shot("confirmed")
            # Blast radius: keyboard confirm + advance on the focused row.
            await page.keyboard.press("1")
            await shot("keyboard-confirm")
            # Blast radius: expand (problem 2) then collapse again.
            await page.locator('[aria-label^="Expand problem 2 "]').click()
            await shot("expanded")
            collapse = page.get_by_role("button", name="Collapse", exact=False).first
            if await collapse.count():
                await collapse.click()
                await shot("recollapsed")
            # Blast radius: Confirm all.
            ca = page.get_by_role("button", name="Confirm all", exact=False).first
            if await ca.count():
                await ca.click()
                await shot("confirm-all")
            # 7: narrow width.
            await load(390)
            await shot("narrow")
            print(f"  page errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
