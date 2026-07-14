"""Seed the school-student homework surfaces in the states touched by the
student-web-flow-polish PR, then screenshot them for PR evidence.

Standalone (not a durable test) — drives the running stack:
    web :3001, API :8000  (NEXT_PUBLIC_API_URL defaults API to :8000)

    .venv/bin/python -m scripts.seed_student_flow_polish

Covers:
  - a submitted-but-ungraded HW  -> SubmittedView "turned in" hero
  - a submitted-AND-graded HW     -> GradedSummaryCard + collapsed
                                     "What your teacher saw" gallery
  - an in-progress integrity chat -> the "Leave & come back later" exit
  - the course homework list       -> formatDue due-date rendering

Writes shots to docs/design/student-flow-polish-*.png.
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
from api.models.integrity_check import (
    IntegrityCheckProblem,
    IntegrityCheckSubmission,
    IntegrityConversationTurn,
)
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3001").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"
_ANIM_SETTLE_MS = 1100


def _file_obj() -> dict[str, str]:
    """A lined-notebook 'handwritten' page so the gallery has content."""
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'>"
        "<rect width='400' height='300' fill='#fffdf7'/>"
        "<text x='30' y='60' font-size='26' fill='#243b6b'>2x + 3 = 11</text>"
        "<text x='30' y='110' font-size='26' fill='#243b6b'>2x = 8</text>"
        "<text x='30' y='160' font-size='26' fill='#16794f'>x = 4</text>"
        "</svg>"
    )
    return {
        "data": base64.b64encode(svg.encode()).decode(),
        "media_type": "image/svg+xml",
    }


def _grade_entry(pid, status, percent, feedback):
    return {
        "problem_id": str(pid),
        "score_status": status,
        "percent": float(percent),
        "feedback": feedback,
    }


async def _make_problems(s, course, unit, assignment, specs):
    items = []
    for i, (q, ans) in enumerate(specs):
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
    return pids


async def seed():
    suffix = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"demo_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()

        teacher = User(
            email=f"polish_teacher_{suffix}@t.com", password_hash=hash_password("x"),
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

        student = User(
            email=f"polish_student_{suffix}@t.com", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Alex Kim", school_id=school.id,
        )
        s.add(student)
        await s.flush()
        s.add(SectionEnrollment(
            section_id=section.id, course_id=course.id, student_id=student.id,
        ))

        now = datetime.now(UTC)
        # Due dates carry a non-midnight time so formatDue renders the clock
        # (the whole point of item 3 — aligning display with enforced lateness).
        due_soon = (now + timedelta(days=3)).replace(hour=15, minute=30, second=0, microsecond=0)
        due_past = (now - timedelta(days=1)).replace(hour=23, minute=59, second=0, microsecond=0)

        specs = [
            ("Solve for x:  $2x + 3 = 11$", "$x = 4$"),
            ("Simplify:  $3(x - 4) + 5$", "$3x - 7$"),
            ("Solve for x:  $2(x - 3) = 4x + 8$", "$x = -7$"),
        ]

        # ── HW 1: submitted, ungraded (integrity + grading off) ──
        hw_turned_in = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Turn-in Practice", type="homework", status="published",
            content={"problem_ids": []}, due_at=due_soon,
            integrity_check_enabled=False, ai_grading_enabled=False,
        )
        s.add(hw_turned_in)
        await s.flush()
        await _make_problems(s, course, unit, hw_turned_in, specs)
        s.add(AssignmentSection(
            assignment_id=hw_turned_in.id, section_id=section.id, published_at=now,
        ))
        s.add(Submission(
            assignment_id=hw_turned_in.id, student_id=student.id, section_id=section.id,
            status="submitted", files=[_file_obj(), _file_obj()],
            submitted_at=now - timedelta(minutes=5),
        ))

        # ── HW 2: submitted AND graded (published) ──
        hw_graded = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Linear Equations", type="homework", status="published",
            content={"problem_ids": []}, due_at=due_past,
            integrity_check_enabled=False, ai_grading_enabled=False,
        )
        s.add(hw_graded)
        await s.flush()
        gpids = await _make_problems(s, course, unit, hw_graded, specs)
        s.add(AssignmentSection(
            assignment_id=hw_graded.id, section_id=section.id, published_at=now,
        ))
        graded_sub = Submission(
            assignment_id=hw_graded.id, student_id=student.id, section_id=section.id,
            status="submitted", files=[_file_obj()],
            submitted_at=now - timedelta(days=2),
        )
        s.add(graded_sub)
        await s.flush()
        bd = [
            _grade_entry(gpids[0], "full", 100, "Clean one-step solve."),
            _grade_entry(gpids[1], "partial", 70,
                         "Right idea — recheck the constant term when you distribute."),
            _grade_entry(gpids[2], "zero", 0, "Left blank — give this one a try."),
        ]
        score = sum(e["percent"] for e in bd) / len(bd)
        s.add(SubmissionGrade(
            submission_id=graded_sub.id, ai_score=score, final_score=score,
            breakdown=bd, graded_at=now - timedelta(days=1),
            grade_published_at=now - timedelta(hours=6),
            published_final_score=score, published_breakdown=bd,
        ))

        # ── HW 3: mid-check integrity conversation ──
        hw_integrity = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Quadratics Check", type="homework", status="published",
            content={"problem_ids": []}, due_at=due_soon,
            integrity_check_enabled=True, ai_grading_enabled=False,
        )
        s.add(hw_integrity)
        await s.flush()
        ipids = await _make_problems(s, course, unit, hw_integrity, specs)
        s.add(AssignmentSection(
            assignment_id=hw_integrity.id, section_id=section.id, published_at=now,
        ))
        icheck_sub = Submission(
            assignment_id=hw_integrity.id, student_id=student.id, section_id=section.id,
            status="submitted", files=[_file_obj()],
            extraction={"steps": [{"problem_position": 1, "step_num": 1,
                                   "latex": "2x + 3 = 11", "plain_english": ""}]},
            extraction_confirmed_at=now - timedelta(minutes=10),
            submitted_at=now - timedelta(minutes=12),
        )
        s.add(icheck_sub)
        await s.flush()
        check = IntegrityCheckSubmission(
            submission_id=icheck_sub.id, status="awaiting_student",
        )
        s.add(check)
        await s.flush()
        s.add(IntegrityCheckProblem(
            integrity_check_submission_id=check.id, bank_item_id=ipids[0],
            sample_position=0, status="pending",
            student_work_extraction={
                "steps": [
                    {"latex": "2x + 3 = 11", "plain_english": ""},
                    {"latex": "2x = 8", "plain_english": ""},
                    {"latex": "x = 4", "plain_english": ""},
                ],
                "final_answers": ["x = 4"],
            },
        ))
        s.add(IntegrityConversationTurn(
            integrity_check_submission_id=check.id, ordinal=0, role="agent",
            content=("Hi Alex! Nice work here. Can you walk me through how you "
                     "got from $2x + 3 = 11$ to $x = 4$?"),
        ))

        teacher_refresh = await create_refresh_token(s, teacher.id)
        student_refresh = await create_refresh_token(s, student.id)
        await s.commit()

        return {
            "student_token": create_access_token(str(student.id), "student"),
            "student_refresh": student_refresh,
            "course_id": str(course.id),
            "hw_turned_in": str(hw_turned_in.id),
            "hw_graded": str(hw_graded.id),
            "hw_integrity": str(hw_integrity.id),
        }


async def _diagnose(page) -> str:
    try:
        text = (await page.inner_text("body")).strip()
    except Exception as e:  # noqa: BLE001
        return f"no-body ({e})"
    low = text.lower()
    if len(text) < 15:
        return f"near-blank ({len(text)} chars)"
    if "this page could not be found" in low:
        return "Next 404 (is the worktree web app on this port?)"
    if "couldn't load" in low or "something went wrong" in low:
        return "error-state rendered"
    return "ok"


async def main() -> int:
    print("Seeding student-flow-polish world …")
    d = await seed()
    for k, v in d.items():
        if not k.endswith("token") and not k.endswith("refresh"):
            print(f"  {k}={v}")

    base = f"/school/student/courses/{d['course_id']}"
    targets = [
        ("student-flow-polish-course-list", base),
        ("student-flow-polish-submitted-ungraded", f"{base}/homework/{d['hw_turned_in']}"),
        ("student-flow-polish-graded", f"{base}/homework/{d['hw_graded']}"),
        ("student-flow-polish-integrity-leave", f"{base}/homework/{d['hw_integrity']}"),
    ]
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Capturing {len(targets)} route(s) from {WEB_BASE} …")
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(d["student_token"], d["student_refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            for name, path in targets:
                errors.clear()
                out = OUT_DIR / f"{name}.png"
                try:
                    await page.goto(f"{WEB_BASE}{path}", wait_until="networkidle", timeout=30000)
                except Exception as e:  # noqa: BLE001
                    print(f"  [goto failed: {e}] {path}")
                    continue
                await page.wait_for_timeout(_ANIM_SETTLE_MS)
                status = await _diagnose(page)
                await page.screenshot(path=str(out), full_page=True)
                note = status + (f"; {len(errors)} console error(s)" if errors else "")
                print(f"  [{note}] {path}\n      -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
