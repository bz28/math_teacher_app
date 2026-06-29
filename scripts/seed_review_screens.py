"""Seed a realistic AI-grading review world and screenshot the redesigned
teacher review screen (3-column split-view · triage roster · collapsed
confident rows · itemized receipt + anchored feedback).

Standalone (not a durable test) — drives the running stack:
    web :3001, API :8000  (NEXT_PUBLIC_API_URL defaults API to :8000)

    .venv/bin/python -m scripts.seed_review_screens

Writes shots to docs/design/shots-grading-redesign-live-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import (
    Assignment,
    AssignmentSection,
    Submission,
    SubmissionGrade,
)
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"


def _maya_work_svg() -> str:
    """A lined-notebook 'handwritten' page for Maya's Q3 work, so the
    pinned photo rail has real-looking content. Caveat-style script via a
    cursive-ish system fallback; the look is the point, not fidelity."""
    lines = [
        "2(x − 3) = 4x + 8",
        "＃3 on the sheet",
        "2x − 6 = 4x + 8",
        "2x − 4x = 8 + 6",
        "−2x = 14",
        "x = −6",
        "x = −6  ✓?",
    ]
    rows = []
    y = 70
    for i, ln in enumerate(lines):
        color = "#6b7280" if i == 1 else ("#16794f" if i == 6 else "#243b6b")
        size = 21 if i == 1 else 27
        rows.append(
            f'<text x="60" y="{y}" font-family="Comic Sans MS, Caveat, cursive" '
            f'font-size="{size}" fill="{color}">{ln}</text>'
        )
        y += 56
    grid = "".join(
        f'<line x1="0" y1="{ly}" x2="640" y2="{ly}" stroke="#cfe0ee" stroke-width="1"/>'
        for ly in range(48, 520, 34)
    )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="520" '
        'viewBox="0 0 640 520">'
        '<rect width="640" height="520" fill="#fdfcf7"/>'
        f"{grid}"
        '<line x1="44" y1="0" x2="44" y2="520" stroke="#e6a89c" stroke-width="2"/>'
        '<text x="560" y="26" font-family="Inter, sans-serif" font-size="12" '
        'fill="#9aa0a6" letter-spacing="1">PG 1 / 2</text>'
        f"{''.join(rows)}"
        "</svg>"
    )
    return svg


def _file_obj() -> dict[str, str]:
    svg = _maya_work_svg()
    return {
        "data": base64.b64encode(svg.encode()).decode(),
        "media_type": "image/svg+xml",
    }


def _grade_entry(pid, status, percent, conf, feedback, deductions=None, answer=None):
    return {
        "problem_id": str(pid),
        "score_status": status,
        "percent": float(percent),
        "confidence": conf,
        "feedback": feedback,
        "deductions": deductions,
        "student_answer": answer,
    }


def _ai_grade(pos, status, percent, conf, reasoning, feedback, answer=None):
    return {
        "problem_position": pos,
        "student_answer": answer,
        "score_status": status,
        "percent": float(percent),
        "confidence": conf,
        "reasoning": reasoning,
        "student_feedback": feedback,
    }


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"demo_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"review_teacher_{suffix}@t.com",
            password_hash=hash_password("x"), grade_level=12, role="teacher",
            name="Ms. Rivera", school_id=school.id,
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

        # Assignment first so the bank items can reference it.
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Linear Equations", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()

        # 4 problems (the answer key sits on final_answer).
        problem_specs = [
            ("Solve for x:  $2x + 3 = 11$", "$x = 4$"),
            ("Simplify:  $3(x - 4) + 5$", "$3x - 7$"),
            ("Solve for x:  $2(x - 3) = 4x + 8$", "$x = -7$"),
            ("Solve for x:  $5x - 7 = 3x + 2$", r"$x = 4.5$"),
        ]
        items = []
        for i, (q, ans) in enumerate(problem_specs):
            it = QuestionBankItem(
                course_id=course.id, unit_id=unit.id,
                originating_assignment_id=assignment.id,
                title=f"P{i + 1}", question=q, final_answer=ans,
                difficulty="medium", format="frq", status="approved",
            )
            items.append(it)
            s.add(it)
        await s.flush()
        pids = [it.id for it in items]
        assignment.content = {"problem_ids": [str(p) for p in pids]}

        s.add(AssignmentSection(
            assignment_id=assignment.id, section_id=section.id,
            published_at=datetime.now(UTC),
        ))

        now = datetime.now(UTC)
        # ── Maya: the uncertain one (low-confidence Q3 + itemized receipt) ──
        maya = User(
            email=f"maya.chen_{suffix}@school.edu", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Maya Chen",
        )
        s.add(maya)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=maya.id,
        ))

        maya_steps = [
            "2(x-3) = 4x + 8",
            "2x - 6 = 4x + 8",
            "2x - 4x = 8 + 6",   # step 3 — sign error
            "-2x = 14",
            "x = -6",            # step 5 — arithmetic
        ]
        extraction = {
            "steps": [
                {
                    "problem_position": 3, "step_num": i + 1,
                    "latex": txt, "plain_english": "",
                }
                for i, txt in enumerate(maya_steps)
            ],
        }
        maya_breakdown = [
            _grade_entry(pids[0], "full", 100, 0.98,
                         "Clean one-step solve.", answer="x = 4"),
            _grade_entry(pids[1], "full", 100, 0.96,
                         "Distributed and combined correctly.", answer="3x - 7"),
            _grade_entry(
                pids[2], "partial", 73, 0.58,
                "Right idea — watch the sign when you move a term across the "
                "equals sign (step 3). +8 should become -8. Re-check 14 / 2 too.",
                deductions=[
                    {"points_off": 0,
                     "reason": "Setup — expanded $2(x-3)=2x-6$ correctly",
                     "step_ref": None},
                    {"points_off": 0,
                     "reason": "Method — collected variable terms on one side",
                     "step_ref": None},
                    {"points_off": 20,
                     "reason": "Sign error — moved $+8$ across $=$ without flipping its sign",
                     "step_ref": 3},
                    {"points_off": 7,
                     "reason": r"Arithmetic — $-14 \div 2 = -7$, wrote $-6$",
                     "step_ref": 5},
                ],
                answer="x = -6"),
            _grade_entry(pids[3], "zero", 0, 0.91,
                         "Left blank — no work shown.", answer=None),
        ]
        maya_ai = {"grades": [
            _ai_grade(1, "full", 100, 0.98, "Correct: x = 4.", "Nice clean solve.",
                      "x = 4"),
            _ai_grade(2, "full", 100, 0.96, "Correct simplification 3x - 7.",
                      "Distributed correctly.", "3x - 7"),
            _ai_grade(3, "partial", 73, 0.58,
                      "Sign error in step 3 and arithmetic slip in step 5; setup "
                      "and method were sound.",
                      "Right idea — watch the sign in step 3, and recheck 14 / 2.",
                      "x = -6"),
            _ai_grade(4, "zero", 0, 0.91, "No attempt — left blank.",
                      "Give this one a try next time.", None),
        ]}
        maya_score = sum(e["percent"] for e in maya_breakdown) / len(maya_breakdown)
        maya_sub = Submission(
            assignment_id=assignment.id, student_id=maya.id, section_id=section.id,
            status="submitted", files=[_file_obj()],
            final_answers={str(pids[2]): "x = -6"},
            extraction=extraction,
            extraction_confirmed_at=now - timedelta(hours=1),
            submitted_at=now - timedelta(hours=2),
        )
        s.add(maya_sub)
        await s.flush()
        s.add(SubmissionGrade(
            submission_id=maya_sub.id, ai_score=maya_score, final_score=maya_score,
            ai_breakdown=maya_ai, breakdown=maya_breakdown,
            graded_at=now - timedelta(minutes=50),
        ))

        # ── The confident cohort (collapsed rows; varied roster scores) ──
        cohort = [
            ("Liam Walsh", [100, 100, 100, 92], False),
            ("Noah Kim", [100, 89, 100, 67], False),
            ("Sofia Reyes", [100, 100, 100, 100], True),   # published
            ("Daniel Brooks", [100, 68, 100, 68], False),
            ("Aisha Patel", [100, 100, 100, 80], False),
        ]
        for name, percents, published in cohort:
            u = User(
                email=f"{name.split()[0].lower()}_{suffix}@school.edu",
                password_hash=hash_password("x"), grade_level=9, role="student",
                name=name,
            )
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(
                section_id=section.id, course_id=course.id, student_id=u.id,
            ))
            bd = []
            ai = []
            for i, pct in enumerate(percents):
                status_ = "full" if pct == 100 else "partial"
                conf = 0.97 if pct == 100 else 0.9
                bd.append(_grade_entry(
                    pids[i], status_, pct, conf, "Looks right.",
                    answer="…"))
                ai.append(_ai_grade(
                    i + 1, status_, pct, conf, "Correct working shown.",
                    "Well done.", "…"))
            score = sum(percents) / len(percents)
            sub = Submission(
                assignment_id=assignment.id, student_id=u.id, section_id=section.id,
                status="submitted", files=[_file_obj()],
                extraction={"steps": []},
                extraction_confirmed_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(hours=2),
            )
            s.add(sub)
            await s.flush()
            grade = SubmissionGrade(
                submission_id=sub.id, ai_score=score, final_score=score,
                ai_breakdown={"grades": ai}, breakdown=bd,
                graded_at=now - timedelta(minutes=50),
            )
            if published:
                grade.grade_published_at = now - timedelta(minutes=30)
                grade.published_final_score = score
                grade.published_breakdown = bd
                grade.reviewed_by = teacher.id
                grade.reviewed_at = now - timedelta(minutes=31)
            s.add(grade)

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()

        return {
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "section_id": str(section.id),
            "maya_id": str(maya.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding review world …")
    w = await seed()
    review = (
        f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
        f"/sections/{w['section_id']}/review?student={w['maya_id']}"
    )
    print(f"  review url: {WEB_BASE}{review}")

    async def clip_around(page, label, top_text, bottom_text, pad=14):
        """Screenshot the band spanning two on-page anchors (whole width)."""
        a = await page.get_by_text(top_text, exact=False).first.bounding_box()
        b = await page.get_by_text(bottom_text, exact=False).first.bounding_box()
        if not a or not b:
            return None
        x = max(0, a["x"] - pad)
        y = max(0, a["y"] - pad)
        bottom = b["y"] + b["height"] + pad
        out = OUT_DIR / f"shots-grading-redesign-live-{label}.png"
        await page.screenshot(
            path=str(out),
            clip={"x": x, "y": y, "width": min(1100, 1440 - x), "height": bottom - y},
        )
        print(f"  -> {out}")

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            # Tall viewport (not full_page) so the whole screen is captured
            # without the full_page + position:sticky artifact that floats
            # the pinned rail to the bottom.
            await page.set_viewport_size({"width": 1440, "height": 2200})
            await page.goto(f"{WEB_BASE}{review}", wait_until="networkidle", timeout=45000)
            await page.wait_for_timeout(1800)

            full = OUT_DIR / "shots-grading-redesign-live-full.png"
            await page.screenshot(path=str(full), full_page=False)
            print(f"  -> {full}")

            # Mockup-style close-ups.
            await clip_around(page, "collapsed-vs-expanded", "Problems", "ANSWER KEY")
            await clip_around(page, "receipt-anchored", "WHY 73%", "FEEDBACK")

            print(f"  console errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
