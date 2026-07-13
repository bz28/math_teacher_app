"""Screenshot the two review-page flow fixes:

  1. End-of-stack publish CTA — grading the last unreleased submitter now
     surfaces an affirmative "Last one — publish N grades →" button in the
     footer strip instead of a dead-end disabled "No more students".
  2. Regrade revokes a stale approval — regrading an already-approved grade
     flips the "Approved ✓" pill back to "Not reviewed" (client mirrors the
     server's force-clear of reviewed_at). The regrade POST is fulfilled with
     a canned success so the real handleRegrade optimistic-clear path runs
     without needing a live Vision extraction of a student photo.

Standalone (not a durable test) — drives the running worktree stack:

    NEXT_PUBLIC_API_URL=http://localhost:8130/v1 \
    WEB_BASE=http://localhost:3130 .venv/bin/python -m scripts.capture_review_flow_screens

Writes docs/design/review-flow-*.png.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from api.core.auth import create_access_token, create_refresh_token, hash_password
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
from api.database import get_session_factory
from tests.harness.browser import HarnessBrowser

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3130").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"

# Current rubric on the assignment; the drift submission is snapshotted
# against an older version so the Regrade CTA surfaces.
CURRENT_RUBRIC = {"full_credit": "Award full credit for a correct final answer."}
OLD_RUBRIC = {"full_credit": "Give credit only for fully-simplified work."}


def _entry(pid, status, percent):
    return {
        "problem_id": str(pid),
        "score_status": status,
        "percent": float(percent),
        "confidence": 0.95 if percent == 100 else 0.6,
        "feedback": "Looks right.",
        "deductions": None,
        "student_answer": "…",
    }


def _ai(pos, status, percent):
    return {
        "problem_position": pos,
        "student_answer": "…",
        "score_status": status,
        "percent": float(percent),
        "confidence": 0.95 if percent == 100 else 0.6,
        "reasoning": "Correct working shown.",
        "student_feedback": "Well done.",
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
            email=f"flow_teacher_{suffix}@t.com",
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
        section_a = Section(course_id=course.id, name="Period 3")
        section_b = Section(course_id=course.id, name="Period 4")
        s.add_all([section_a, section_b])
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Linear Equations", type="homework", status="published",
            content={"problem_ids": []}, rubric=CURRENT_RUBRIC,
        )
        s.add(assignment)
        await s.flush()

        specs = [
            ("Solve for x:  $2x + 3 = 11$", "$x = 4$"),
            ("Simplify:  $3(x - 4) + 5$", "$3x - 7$"),
            ("Solve for x:  $2(x - 3) = 4x + 8$", "$x = -7$"),
            ("Solve for x:  $5x - 7 = 3x + 2$", r"$x = 4.5$"),
        ]
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
        s.add_all([
            AssignmentSection(
                assignment_id=assignment.id, section_id=section_a.id,
                published_at=datetime.now(UTC),
            ),
            AssignmentSection(
                assignment_id=assignment.id, section_id=section_b.id,
                published_at=datetime.now(UTC),
            ),
        ])
        now = datetime.now(UTC)
        ids: dict[str, str] = {}

        # (name, section, reviewed, published, drift)
        # Section A: Jordan is the sole unreleased submitter (open him for
        # the end-of-stack CTA); the rest are approved + published-clean.
        # Section B: Riley is approved + rubric-drifted (the regrade case);
        # Alex/Sam are unpublished so the HW-wide "publish N" count > 1.
        roster = [
            ("Jordan Lee", section_a, False, False, False),
            ("Maya Chen", section_a, True, True, False),
            ("Noah Walsh", section_a, True, True, False),
            ("Sofia Reyes", section_a, True, True, False),
            ("Riley Kim", section_b, True, False, True),
            ("Alex Park", section_b, False, False, False),
            ("Sam Diaz", section_b, False, False, False),
        ]
        for name, section, reviewed, published, drift in roster:
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
            percents = [100, 100, 73, 100]
            bd = [_entry(pids[i], "full" if percents[i] == 100 else "partial",
                         percents[i]) for i in range(4)]
            ai = [_ai(i + 1, "full" if percents[i] == 100 else "partial",
                      percents[i]) for i in range(4)]
            score = sum(percents) / 4
            sub = Submission(
                assignment_id=assignment.id, student_id=u.id, section_id=section.id,
                status="submitted", extraction={"steps": []},
                extraction_confirmed_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(hours=2),
            )
            s.add(sub)
            await s.flush()
            grade = SubmissionGrade(
                submission_id=sub.id, ai_score=score, final_score=score,
                ai_breakdown={"grades": ai}, breakdown=bd,
                graded_at=now - timedelta(minutes=50),
                rubric_snapshot=OLD_RUBRIC if drift else CURRENT_RUBRIC,
            )
            if reviewed:
                grade.reviewed_by = teacher.id
                grade.reviewed_at = now - timedelta(minutes=31)
            if published:
                grade.grade_published_at = now - timedelta(minutes=30)
                grade.published_final_score = score
                grade.published_breakdown = bd
            s.add(grade)
            ids[name.split()[0].lower()] = str(u.id)

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "section_a": str(section_a.id),
            "section_b": str(section_b.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
            "riley_breakdown": [_entry(p, "partial", 60) for p in pids],
            "riley_ai": [_ai(i + 1, "partial", 60) for i in range(4)],
            **ids,
        }


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Seeding review-flow world …")
    w = await seed()

    def review_url(student_id: str, section_id: str) -> str:
        return (
            f"/school/teacher/courses/{w['course_id']}/homework/{w['assignment_id']}"
            f"/sections/{section_id}/review?student={student_id}"
        )

    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 1700})

            async def shot(label: str, height: int = 560) -> None:
                out = OUT_DIR / f"review-flow-{label}.png"
                await page.screenshot(
                    path=str(out),
                    clip={"x": 0, "y": 0, "width": 1440, "height": height},
                )
                print(f"  -> {out}")

            # ── 1) End-of-stack publish CTA (open the last unreleased one) ──
            await page.goto(
                f"{WEB_BASE}{review_url(w['jordan'], w['section_a'])}",
                wait_until="networkidle", timeout=45000,
            )
            await page.wait_for_timeout(1600)
            # The CTA lives in the footer strip; scroll it into view.
            btn = page.get_by_role("button", name="Last one", exact=False).first
            await btn.scroll_into_view_if_needed()
            await page.wait_for_timeout(400)
            await shot("end-of-stack-cta", 620)

            # ── 2a) Regrade case — approved + rubric drift ("before") ──
            await page.goto(
                f"{WEB_BASE}{review_url(w['riley'], w['section_b'])}",
                wait_until="networkidle", timeout=45000,
            )
            await page.wait_for_timeout(1600)
            await shot("regrade-before-approved", 700)

            # ── 2b) Fulfill the regrade POST with a canned success so the
            #        real handleRegrade optimistic-clear runs, then confirm ──
            async def fulfill_regrade(route):
                body = {
                    "status": "ok",
                    "final_score": 60.0,
                    "ai_score": 60.0,
                    "breakdown": w["riley_breakdown"],
                    "ai_breakdown": w["riley_ai"],
                    "rubric_snapshot": CURRENT_RUBRIC,  # matches → drift clears
                    "graded_at": datetime.now(UTC).isoformat(),
                    "grade_published_at": None,
                    "grade_dirty": True,
                }
                await route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(body),
                )

            await page.route("**/regrade", fulfill_regrade)
            await page.get_by_role("button", name="Regrade", exact=True).first.click()
            await page.wait_for_timeout(600)
            # Confirm dialog → confirm the regrade.
            await page.get_by_role("button", name="Regrade", exact=True).last.click()
            await page.wait_for_timeout(1200)
            await shot("regrade-after-not-reviewed", 700)

            print(f"  console errors: {len(errors)}")
            for e in errors[:12]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
