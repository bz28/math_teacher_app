"""Seed a review section covering every integrity-card state and screenshot
the compact integrity card (right rail on xl, grade column below xl).

Standalone (not a durable test) — drives a LOCAL running stack:
    web on $WEB_BASE (default :3001), API on the web app's NEXT_PUBLIC_API_URL

    .venv/bin/python -m scripts.capture_integrity_card_rail before
    .venv/bin/python -m scripts.capture_integrity_card_rail after

Each run seeds a fresh world (new school/teacher/section) so runs never
collide. Students:
  Maya  — flag_for_review, unresolved, tabbed out once + one paste
  Liam  — pass, telemetry but no tab-outs/pastes ("No tab-outs or pastes")
  Ava   — flag_for_review, already marked reviewed (Cleared)
  Noah  — no integrity check at all (no card; photo starts at the top)
  Preview — the teacher's preview student (is_preview) with a pass check

Writes into docs/design/integrity-card-rail-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import os
import re
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from api.core import photo_store
from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.core.integrity_pipeline import compute_activity_summary
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
PREFIX = "integrity-card-rail"

LINES = [
    ("1)  x² − 5x + 6 = 0", "#243b6b"),
    ("     (x − 2)(x − 3) = 0", "#243b6b"),
    ("     x = 2,  x = 3", "#16794f"),
    ("2)  x² − 9 = 0", "#243b6b"),
    ("     (x − 3)(x + 3) = 0", "#243b6b"),
    ("     x = ±3", "#16794f"),
    ("3)  2x² + 7x + 3 = 0", "#243b6b"),
    ("     (2x + 1)(x + 3) = 0", "#243b6b"),
    ("     x = −1/2,  x = −3", "#16794f"),
    ("4)  x² + 4x = 12", "#243b6b"),
    ("     (x + 6)(x − 2) = 0", "#243b6b"),
    ("     x = −6,  x = 2", "#16794f"),
]


def _work_svg(name: str) -> str:
    rows = "".join(
        f'<line x1="0" x2="640" y1="{y}" y2="{y}" stroke="#c9d8ee" stroke-width="1"/>'
        for y in range(70, 880, 40)
    )
    text = "".join(
        f'<text x="70" y="{100 + i * 60}" font-family="Caveat, cursive" '
        f'font-size="30" fill="{c}">{t}</text>'
        for i, (t, c) in enumerate(LINES)
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="840" '
        'viewBox="0 0 640 840"><rect width="640" height="840" fill="#fdfcf7"/>'
        f'{rows}<line x1="50" x2="50" y1="0" y2="840" stroke="#e7a3a3"/>'
        f'<text x="470" y="40" font-family="Caveat, cursive" font-size="22" '
        f'fill="#555">{name} · Period 3</text>{text}</svg>'
    )


def _file_obj(name: str) -> dict[str, str]:
    return {
        "data": base64.b64encode(_work_svg(name).encode()).decode(),
        "media_type": "image/svg+xml",
    }


SPECS = [
    ("Solve:  $x^2 - 5x + 6 = 0$", "$x = 2, 3$", "x = 2, 3"),
    ("Solve:  $x^2 - 9 = 0$", "$x = \\pm 3$", "x = ±3"),
    ("Solve:  $2x^2 + 7x + 3 = 0$", "$x = -\\tfrac12, -3$", "x = -1/2, -3"),
    ("Solve:  $x^2 + 4x = 12$", "$x = -6, 2$", "x = -6, 2"),
]


def _breakdown(pids):
    return [
        {
            "problem_id": str(pid), "score_status": "full", "percent": 100.0,
            "confidence": 0.96, "feedback": "Correct.", "deductions": None,
            "student_answer": SPECS[i][2],
        }
        for i, pid in enumerate(pids)
    ]


async def seed() -> dict[str, str]:
    async with get_session_factory()() as s:
        suffix = uuid.uuid4().hex[:6]
        now = datetime.now(UTC)
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"rail_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"rail_teacher_{suffix}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id,
        )
        s.add(teacher)
        await s.flush()
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Quadratics", position=0)
        s.add(unit)
        await s.flush()
        section = Section(course_id=course.id, name="Period 3")
        s.add(section)
        await s.flush()
        assignment = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Factoring Quadratics", type="homework", status="published",
            content={"problem_ids": []},
        )
        s.add(assignment)
        await s.flush()
        items = []
        for i, (q, ans, _) in enumerate(SPECS):
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
            assignment_id=assignment.id, section_id=section.id, published_at=now,
        ))

        async def student(name: str, *, preview: bool = False) -> tuple[User, Submission]:
            u = User(
                email=f"{name.split()[0].lower()}_{suffix}@school.edu",
                password_hash=hash_password("x"), grade_level=9, role="student",
                name=name, is_preview=preview,
                preview_owner_id=teacher.id if preview else None,
            )
            s.add(u)
            await s.flush()
            s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=u.id))
            sid = uuid.uuid4()
            sub = Submission(
                id=sid, assignment_id=assignment.id, student_id=u.id,
                section_id=section.id, status="submitted",
                files=await photo_store.store_pages(sid, [_file_obj(name.split()[0])]),
                extraction={"steps": []},
                extraction_confirmed_at=now - timedelta(hours=1),
                submitted_at=now - timedelta(hours=2),
            )
            s.add(sub)
            await s.flush()
            bd = _breakdown(pids)
            s.add(SubmissionGrade(
                submission_id=sub.id, ai_score=100.0, final_score=100.0,
                ai_breakdown={"grades": bd}, breakdown=bd,
                graded_at=now - timedelta(minutes=50),
            ))
            return u, sub

        async def check(
            sub: Submission, *, disposition: str, headline: str, summary: str,
            turns: list[tuple[str, str, dict | None]], resolution: str = "unresolved",
        ) -> None:
            c = IntegrityCheckSubmission(
                submission_id=sub.id, status="complete", disposition=disposition,
                headline=headline, overall_summary=summary, resolution=resolution,
                resolved_by=teacher.id if resolution != "unresolved" else None,
                resolved_at=now - timedelta(minutes=5) if resolution != "unresolved" else None,
            )
            s.add(c)
            await s.flush()
            s.add(IntegrityCheckProblem(
                integrity_check_submission_id=c.id, bank_item_id=pids[0],
                sample_position=0, status="verdict_submitted",
                rubric={"paraphrase_originality": "low", "causal_fluency": "low"},
                ai_reasoning="See the conversation.",
            ))
            rows = []
            for i, (role, content, tel) in enumerate(turns):
                t = IntegrityConversationTurn(
                    integrity_check_submission_id=c.id, ordinal=i, role=role,
                    content=content, telemetry=tel,
                    seconds_on_turn=30 if role == "student" else None,
                )
                rows.append(t)
                s.add(t)
            c.activity_summary = compute_activity_summary(rows)

        opener = (
            "Nice work! Can you walk me through how you knew to factor "
            "$x^2 - 5x + 6$ into $(x-2)(x-3)$?"
        )
        quiet = {"focus_blur_events": [], "paste_events": [],
                 "typing_cadence": {"total_ms": 9000}}

        _, maya_sub = await student("Maya Chen")
        maya_answer = (
            "To factor a quadratic of the form x^2 + bx + c you find two "
            "numbers whose product is c and whose sum is b. Here c = 6 and "
            "b = -5 so the numbers are -2 and -3, which gives (x-2)(x-3)."
        )
        await check(
            maya_sub, disposition="flag_for_review",
            headline="Couldn't explain the factoring step on their page",
            summary=(
                "Maya's written solution was correct, but her first explanation "
                "was pasted in and, asked a follow-up, she couldn't say why the "
                "roots of a sign-flipped variant change — the verbal account "
                "didn't match the page."
            ),
            turns=[
                ("agent", opener, None),
                ("student", maya_answer, {
                    "focus_blur_events": [{"duration_ms": 41000}],
                    "paste_events": [{"byte_count": 182}],
                    "typing_cadence": {"total_ms": 0},
                }),
                ("agent", "What would the roots be for $x^2 + 5x + 6$?", None),
                ("student", "not sure, the same?", quiet),
            ],
        )

        liam, liam_sub = await student("Liam Walsh")
        await check(
            liam_sub, disposition="pass",
            headline="Explained every factoring step in his own words",
            summary="Liam explained each factoring step clearly and predicted the variant's roots.",
            turns=[
                ("agent", opener, None),
                ("student", "I needed two numbers that multiply to 6 and add to -5, so -2 and -3.", quiet),
            ],
        )

        _, ava_sub = await student("Ava Patel")
        await check(
            ava_sub, disposition="flag_for_review",
            headline="Answers matched, but the reasoning was thin",
            summary="Ava gave the right roots but described the method only in general terms.",
            resolution="cleared",
            turns=[
                ("agent", opener, None),
                ("student", "you just find the numbers that work", {
                    "focus_blur_events": [{"duration_ms": 12000}, {"duration_ms": 6000}],
                    "paste_events": [], "typing_cadence": {"total_ms": 5000},
                }),
            ],
        )

        noah, _ = await student("Noah Kim")

        prev, prev_sub = await student("Ms. Rivera (preview)", preview=True)
        await check(
            prev_sub, disposition="pass",
            headline="Student understood their own work",
            summary="Preview run — explained each step.",
            turns=[("agent", opener, None), ("student", "two numbers, product 6 sum -5", quiet)],
        )

        refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        return {
            "base": (
                f"/school/teacher/courses/{course.id}/homework/{assignment.id}"
                f"/sections/{section.id}/review"
            ),
            "maya": str(maya_sub.student_id),
            "liam": str(liam.id),
            "noah": str(noah.id),
            "preview": str(prev.id),
            "access": create_access_token(str(teacher.id), "teacher"),
            "refresh": refresh,
        }


def out(label: str) -> str:
    p = OUT_DIR / f"{PREFIX}-{label}.png"
    print(f"  -> {p.relative_to(OUT_DIR.parent.parent)}")
    return str(p)


async def main(phase: str) -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    w = await seed()
    url = f"{WEB_BASE}{w['base']}?student={w['maya']}"
    print(f"  review url: {url}")
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["access"], w["refresh"]) as page:
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_viewport_size({"width": 1440, "height": 900})
            await page.goto(url, wait_until="networkidle", timeout=60000)
            await page.wait_for_timeout(2500)
            # Hide the Next.js dev-mode indicator so it doesn't sit on the shots.
            await page.add_style_tag(content="nextjs-portal{display:none!important}")

            if phase == "before":
                await page.screenshot(path=out("0-before-wide"))
                return 0

            if phase.startswith("resize-"):
                # Open Conversation from the rail card at xl, then drop
                # below xl (the rail goes display:none). The modal must
                # stay visible and close cleanly, unlocking scroll.
                tag = phase.removeprefix("resize-")
                rail = page.locator("aside.xl\\:block")
                await rail.get_by_role("button", name=re.compile("Conversation")).click()
                await page.wait_for_timeout(800)
                await page.set_viewport_size({"width": 1180, "height": 900})
                await page.wait_for_timeout(800)
                visible = await page.get_by_role("dialog").first.is_visible()
                locked = await page.evaluate("document.body.style.overflow")
                print(f"  body.overflow while open: {locked!r}")
                await page.screenshot(path=out(f"16-resize-modal-{tag}"))
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(600)
                dialogs = await page.get_by_role("dialog").count()
                overflow = await page.evaluate("document.body.style.overflow")
                print(f"  modal visible after resize: {visible}")
                print(f"  after Escape: dialogs={dialogs} body.overflow={overflow!r}")
                # Same check for the rail photo's ⤢ Full lightbox.
                await page.set_viewport_size({"width": 1440, "height": 900})
                await page.wait_for_timeout(800)
                await rail.get_by_role("button", name=re.compile("Full")).click()
                await page.wait_for_timeout(800)
                await page.set_viewport_size({"width": 1180, "height": 900})
                await page.wait_for_timeout(800)
                gvisible = await page.get_by_role("dialog").first.is_visible()
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(600)
                gdialogs = await page.get_by_role("dialog").count()
                goverflow = await page.evaluate("document.body.style.overflow")
                print(f"  gallery visible after resize: {gvisible}; after Escape: "
                      f"dialogs={gdialogs} body.overflow={goverflow!r}")
                print(f"  console errors: {len(errors)}")
                return 0

            async def pick(name: str) -> None:
                await page.get_by_role("button", name=re.compile(name)).first.click()
                await page.wait_for_timeout(1800)

            rail = page.locator("aside.xl\\:block")

            # 15. Narrow (<1280px): no rail — the same collapsed card sits in
            #     the grade column, Mark reviewed included.
            await page.set_viewport_size({"width": 1180, "height": 900})
            await page.wait_for_timeout(800)
            await page.screenshot(path=out("15-narrow"))
            await page.set_viewport_size({"width": 1440, "height": 900})
            await page.wait_for_timeout(800)

            # 1. Wide, flagged + unresolved, collapsed (the default).
            await page.screenshot(path=out("1-wide-flagged-collapsed"))
            # 2. Expanded.
            await rail.get_by_role("button", name=re.compile("Details")).click()
            await page.wait_for_timeout(400)
            await page.screenshot(path=out("2-wide-flagged-expanded"))
            # 2b. Scrolled into the problems: the sticky column (card + photo)
            #     stays in view and fits the viewport.
            await page.mouse.wheel(0, 900)
            await page.wait_for_timeout(600)
            await page.screenshot(path=out("2b-wide-expanded-scrolled"))
            await page.evaluate("window.scrollTo(0, 0)")
            await page.wait_for_timeout(300)
            # 3. Session state persists across students: Liam opens expanded.
            await pick("Liam Walsh")
            await page.screenshot(path=out("3-wide-clean-expanded-persisted"))
            await rail.get_by_role("button", name=re.compile("Hide details")).click()
            await page.wait_for_timeout(400)
            await page.screenshot(path=out("4-wide-clean-collapsed"))
            # 5/6. Resolved check: no Mark reviewed on the card; Change in Details.
            await pick("Ava Patel")
            await page.screenshot(path=out("5-wide-resolved-collapsed"))
            await rail.get_by_role("button", name=re.compile("Details")).click()
            await page.wait_for_timeout(400)
            await page.screenshot(path=out("6-wide-resolved-expanded"))
            await rail.get_by_role("button", name=re.compile("Hide details")).click()
            await page.wait_for_timeout(300)
            # 7. No check → no card, photo at the top of the rail.
            await pick("Noah Kim")
            await page.screenshot(path=out("7-wide-no-check"))
            # 8. Preview submission.
            await pick(r"preview")
            await page.screenshot(path=out("8-wide-preview"))

            # Blast radius on Maya.
            await pick("Maya Chen")
            # 9. Conversation modal + per-turn activity markers.
            await rail.get_by_role("button", name=re.compile("Conversation")).click()
            await page.wait_for_timeout(800)
            await page.screenshot(path=out("9-conversation-modal"))
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(400)
            # 10. Photo Pin toggle + Full lightbox.
            await rail.get_by_role("button", name=re.compile("Pinned")).click()
            await page.wait_for_timeout(300)
            await page.screenshot(path=out("10-photo-unpinned"))
            await rail.get_by_role("button", name=re.compile("Pin$")).click()
            await rail.get_by_role("button", name=re.compile("Full")).click()
            await page.wait_for_timeout(800)
            await page.screenshot(path=out("11-photo-full"))
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(400)
            # 12. Flagged filter before → Mark reviewed (picker) → Cleared → filter after.
            await page.get_by_role("button", name=re.compile("^Flagged")).first.click()
            await page.wait_for_timeout(500)
            await page.screenshot(path=out("12-flagged-filter-before"))
            await rail.get_by_role("button", name="Mark reviewed").click()
            await page.wait_for_timeout(300)
            await page.screenshot(path=out("13-mark-reviewed-picker"))
            await rail.get_by_role("button", name=re.compile("Cleared")).click()
            await page.wait_for_timeout(2000)
            await page.screenshot(path=out("14-flagged-filter-after-resolve"))


            print(f"  console errors: {len(errors)}")
            for e in errors[:10]:
                print(f"    ! {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "after")))
