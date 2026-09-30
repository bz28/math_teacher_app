"""Seed a handful of teacher reports and screenshot every surface the
report deep-links touch: the admin reports list, the report case view,
the submission trace landing on #p{n}, the assignment anchor, the alert
email, and the teacher review page's URL sync.

Standalone (not a durable test) — drives an already-running LOCAL stack:
    dashboard :5173 (DASH_BASE), web :3002 (WEB_BASE), API behind both

    .venv/bin/python -m scripts.capture_report_deep_links seed
    SHOT_PREFIX=before .venv/bin/python -m scripts.capture_report_deep_links admin
    .venv/bin/python -m scripts.capture_report_deep_links all

`seed` writes the ids it made to STATE (a scratch json) so the capture
phases can run against the same world before and after the change.
Writes docs/design/<prefix>-report-*.png.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.engine import make_url

from api.config import settings
from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection, Submission, SubmissionGrade
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INSTITUTIONAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.teacher_report import TeacherReport
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

DASH_BASE = os.environ.get("DASH_BASE", "http://localhost:5173").rstrip("/")
WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3002").rstrip("/")
SHOT_PREFIX = os.environ.get("SHOT_PREFIX", "after")
STATE = Path(os.environ.get("STATE", "/tmp/report_deep_links_state.json"))
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"
ADMIN_KEYS = {"access_key": "admin_access_token", "refresh_key": "admin_refresh_token"}
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db", ""}
NOW = datetime.now(UTC)


def assert_local_database() -> None:
    host = (make_url(settings.database_url).host or "").lower()
    if host not in _LOCAL_HOSTS:
        raise SystemExit(f"Refusing to run: DATABASE_URL points at {host!r}, not a local database.")


def _font(size: int) -> Any:
    for name in ("/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
                 "/System/Library/Fonts/Noteworthy.ttc", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _photo(blocks: list[tuple[str, list[str]]]) -> dict[str, str]:
    """One ruled notebook page of 'handwriting', drawn so the repo has no blob."""
    img = Image.new("RGB", (850, 1100), "#fbfaf6")
    d = ImageDraw.Draw(img)
    for y in range(90, 1100, 46):
        d.line([(40, y), (810, y)], fill="#dfe6ef", width=1)
    d.line([(70, 0), (70, 1100)], fill="#e8b4a8", width=2)
    y = 60
    for head, lines in blocks:
        d.text((90, y), head, fill="#1f2a3a", font=_font(34))
        y += 46
        for ln in lines:
            d.text((130, y), ln, fill="#243b6b", font=_font(32))
            y += 46
        y += 46
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return {"data": base64.b64encode(buf.getvalue()).decode("ascii"), "media_type": "image/jpeg"}


PROBLEMS = [
    ("Solve for $x$: $2x + 3 = 11$", "$x = 4$"),
    ("Simplify: $3(x - 4) + 5$", "$3x - 7$"),
    ("Solve the system by graphing: $y = 2x - 1$ and $y = -x + 5$", "$(2, 3)$"),
    ("Solve for $x$: $5x - 7 = 3x + 2$", "$x = 4.5$"),
]


def _step(pos: int, num: int, latex: str, page: int) -> dict[str, Any]:
    return {"problem_position": pos, "step_num": num, "latex": latex, "plain_english": "", "page_index": page}


EXTRACTION = {
    "steps": [
        _step(1, 1, "2x + 3 = 11", 1), _step(1, 2, "2x = 8", 1),
        _step(2, 1, "3x - 12 + 5", 1),
        _step(3, 1, "2x - 1 = -x + 5", 2), _step(3, 2, "3x = 6", 2), _step(3, 3, "x = 2,\\; y = 3", 2),
        _step(4, 1, "2x = 9", 2),
    ],
    "final_answers": [
        {"problem_position": 1, "answer_latex": "x = 4", "answer_plain": "", "page_index": 1},
        {"problem_position": 2, "answer_latex": "3x - 7", "answer_plain": "", "page_index": 1},
        {"problem_position": 3, "answer_latex": "(2, 3)", "answer_plain": "", "page_index": 2},
        {"problem_position": 4, "answer_latex": "x = 4.5", "answer_plain": "", "page_index": 2},
    ],
    "visual_work": [],
    "confidence": 0.91,
}

LIAM_EDITS = {"4:1": "2x = 90", "4:final": "x = 45"}

P3_REASONING = (
    "The student found the intersection (2, 3), which matches the key. "
    "Work is correct and complete."
)


async def seed() -> dict[str, str]:
    tag = uuid.uuid4().hex[:6]
    async with get_session_factory()() as s:
        school = School(name="Lincoln High", kind=SCHOOL_KIND_INSTITUTIONAL,
                        contact_name="Demo", contact_email=f"rdl_{tag}@s.com")
        admin = User(email=f"rdl_admin_{tag}@t.com", password_hash=hash_password("x"),
                     grade_level=12, role="admin", name="Founder")
        s.add_all([school, admin])
        await s.flush()
        teacher = User(email=f"rivera_{tag}@lincoln.edu", password_hash=hash_password("x"),
                       grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id)
        s.add(teacher)
        await s.flush()
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Systems", position=0)
        section = Section(course_id=course.id, name="Period 3")
        s.add_all([unit, section])
        await s.flush()
        asg = Assignment(course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
                         title="Solving Systems", type="homework", status="published",
                         content={"problem_ids": []},
                         integrity_check_enabled=False, ai_grading_enabled=True)
        s.add(asg)
        await s.flush()
        items = []
        for i, (q, a) in enumerate(PROBLEMS):
            it = QuestionBankItem(course_id=course.id, unit_id=unit.id, created_by_id=teacher.id,
                                  originating_assignment_id=asg.id, title=f"P{i + 1}", question=q,
                                  final_answer=a, solution_steps=[], difficulty="medium",
                                  format="frq", status="approved")
            s.add(it)
            items.append(it)
        await s.flush()
        pids = [str(it.id) for it in items]
        asg.content = {"problem_ids": pids}
        s.add(AssignmentSection(assignment_id=asg.id, section_id=section.id,
                                published_at=NOW - timedelta(days=3)))

        students: list[User] = []
        for name in ("Maya Chen", "Liam Walsh", "Noah Kim"):
            u = User(email=f"{name.split()[0].lower()}_{tag}@lincoln.edu", password_hash=hash_password("x"),
                     grade_level=9, role="student", name=name, school_id=school.id)
            s.add(u)
            students.append(u)
        await s.flush()
        subs: list[Submission] = []
        pages = [
            _photo([("1)", ["2x + 3 = 11", "2x = 8", "x = 4"]), ("2)", ["3x - 12 + 5", "= 3x - 7"])]),
            _photo([("3)", ["2x - 1 = -x + 5", "3x = 6", "x = 2, y = 3", "(2, 3)"]), ("4)", ["2x = 9", "x = 4.5"])]),
        ]
        for u in students:
            s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=u.id))
            sub = Submission(assignment_id=asg.id, student_id=u.id, section_id=section.id,
                             status="submitted", files=pages, extraction=EXTRACTION,
                             extraction_confirmed_at=NOW - timedelta(days=2, hours=1),
                             submitted_at=NOW - timedelta(days=2, hours=2))
            s.add(sub)
            subs.append(sub)
        # Liam corrected the read of Problem 4 on the confirm screen — the
        # case the evidence's "Student said" column exists for.
        subs[1].extraction_edits = LIAM_EDITS
        subs[1].extraction_edited_at = NOW - timedelta(days=2, hours=1)
        await s.flush()

        def ai(pos: int, pct: float, conf: float, why: str) -> dict[str, Any]:
            st = "full" if pct == 100 else "zero" if pct == 0 else "partial"
            return {"problem_position": pos, "student_answer": None, "score_status": st, "percent": pct,
                    "confidence": conf, "reasoning": why, "student_feedback": ""}

        def entry(pid: str, pct: float, conf: float) -> dict[str, Any]:
            st = "full" if pct == 100 else "zero" if pct == 0 else "partial"
            return {"problem_id": pid, "score_status": st, "percent": pct, "confidence": conf,
                    "feedback": "", "deductions": None, "student_answer": None}

        ai_grades = [ai(1, 100, 0.97, "Correct."), ai(2, 100, 0.96, "Correct."),
                     ai(3, 100, 0.93, P3_REASONING), ai(4, 100, 0.95, "Correct.")]
        for i, sub in enumerate(subs):
            teacher_p3 = 40 if i == 0 else 100
            bd = [entry(pids[0], 100, 0.97), entry(pids[1], 100, 0.96),
                  entry(pids[2], teacher_p3, 0.93), entry(pids[3], 100, 0.95)]
            score = sum(e["percent"] for e in bd) / 4
            s.add(SubmissionGrade(submission_id=sub.id, ai_score=100.0, final_score=score,
                                  ai_breakdown={"grades": ai_grades}, breakdown=bd,
                                  graded_at=NOW - timedelta(days=2)))

        review_path = (f"/school/teacher/courses/{course.id}/homework/{asg.id}"
                       f"/sections/{section.id}/review")
        maya, liam = students[0], students[1]
        common = dict(teacher_id=teacher.id, teacher_name=teacher.name, teacher_email=teacher.email,
                      school_id=school.id)
        on_sub = dict(assignment_id=asg.id, assignment_title=asg.title, course_id=course.id,
                      course_name=course.name, section_id=section.id)
        reports = [
            TeacherReport(**common, **on_sub, kind="wrong_grade",
                          note=("The problem says solve by graphing. She solved it with algebra and "
                                "never drew the lines, but the AI still gave full credit."),
                          page_url=f"{WEB_BASE}{review_path}", submission_id=subs[0].id,
                          student_id=maya.id, student_name=maya.name, problem_id=items[2].id,
                          problem_position=3, problem_question=PROBLEMS[2][0],
                          ai_grade={"score_status": "full", "percent": 100, "confidence": 0.93,
                                    "reasoning": P3_REASONING},
                          teacher_grade={"score_status": "partial", "percent": 40},
                          created_at=NOW - timedelta(hours=3)),
            TeacherReport(**common, **on_sub, kind="misread_work",
                          note="Page 2 was read as someone else's handwriting — the 4.5 is a 45.",
                          page_url=f"{WEB_BASE}{review_path}", submission_id=subs[1].id,
                          student_id=liam.id, student_name=liam.name, problem_id=items[3].id,
                          problem_position=4, problem_question=PROBLEMS[3][0],
                          created_at=NOW - timedelta(days=1)),
            TeacherReport(**common, kind="confusing", note="Where do I change a due date after publishing?",
                          page_url=f"{WEB_BASE}/school/teacher/courses/{course.id}?tab=homework",
                          created_at=NOW - timedelta(minutes=40)),
            TeacherReport(**common, kind="broken", note="The roster spinner never stopped on Period 3.",
                          page_url=f"{WEB_BASE}/school/teacher", created_at=NOW - timedelta(days=2)),
            TeacherReport(**common, **on_sub, kind="understanding_check",
                          note="The check asked Noah about a problem he skipped.",
                          submission_id=subs[2].id, student_id=students[2].id, student_name=students[2].name,
                          status="resolved", resolution_note="Fixed in #903 — skipped problems are excluded.",
                          resolved_at=NOW - timedelta(days=1), created_at=NOW - timedelta(days=4)),
        ]
        s.add_all(reports)
        teacher_refresh = await create_refresh_token(s, teacher.id)
        await s.commit()
        state = {
            "admin": create_access_token(str(admin.id), "admin"),
            "teacher": create_access_token(str(teacher.id), "teacher"),
            "teacher_refresh": teacher_refresh,
            "report_id": str(reports[0].id), "correction_report_id": str(reports[1].id),
            "whole_report_id": str(reports[4].id),
            "sidebar_report_id": str(reports[2].id),
            "submission_id": str(subs[0].id), "assignment_id": str(asg.id),
            "review_path": review_path, "maya_id": str(maya.id), "liam_id": str(liam.id),
        }
        STATE.write_text(json.dumps(state))
        return state


async def _shot(page: Any, name: str, *, full: bool = False) -> None:
    out = OUT_DIR / f"{SHOT_PREFIX}-report-{name}.png"
    await page.screenshot(path=str(out), full_page=full)
    print(f"  -> {out.relative_to(OUT_DIR.parents[1])}")


async def capture_admin(hb: HarnessBrowser, w: dict[str, str]) -> None:
    async with hb.authed_page(w["admin"], w["admin"], **ADMIN_KEYS) as page:
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        await page.set_viewport_size({"width": 1440, "height": 1000})
        await page.goto(f"{DASH_BASE}/reports?status=all", wait_until="networkidle")
        await page.wait_for_timeout(800)
        await _shot(page, "list")
        await page.goto(f"{DASH_BASE}/reports/{w['report_id']}", wait_until="networkidle")
        await page.wait_for_timeout(1500)
        await _shot(page, "case-view", full=True)
        await page.goto(f"{DASH_BASE}/reports/{w['sidebar_report_id']}", wait_until="networkidle")
        await page.wait_for_timeout(800)
        await _shot(page, "case-view-sidebar")
        if SHOT_PREFIX != "before":
            await page.goto(f"{DASH_BASE}/reports/{w['whole_report_id']}", wait_until="networkidle")
            await page.wait_for_timeout(1500)
            await _shot(page, "case-view-whole-submission")
            await page.goto(f"{DASH_BASE}/reports/{w['correction_report_id']}", wait_until="networkidle")
            await page.wait_for_timeout(1500)
            await _shot(page, "case-view-correction", full=True)
            # A deep-link target the student also corrected keeps both marks.
            await page.get_by_role("link", name="Open submission at Problem 4").click()
            await page.wait_for_timeout(2500)
            await _shot(page, "trace-arrival-corrected")
            # The primary action, clicked: the trace lands on Problem 3.
            await page.goto(f"{DASH_BASE}/reports/{w['report_id']}", wait_until="networkidle")
            await page.wait_for_timeout(800)
            await page.get_by_role("link", name="Open submission at Problem 3").click()
            await page.wait_for_timeout(2500)
            print(f"  trace url: {page.url}")
            await _shot(page, "trace-arrival")
            await page.goto(f"{DASH_BASE}/assignments/{w['assignment_id']}#p3", wait_until="networkidle")
            await page.wait_for_timeout(1500)
            await _shot(page, "assignment-anchor")
            # Blast radius: both pages without an anchor render as before.
            await page.goto(f"{DASH_BASE}/submissions/{w['submission_id']}/trace", wait_until="networkidle")
            await page.wait_for_timeout(1500)
            await _shot(page, "trace-no-anchor")
            await page.goto(f"{DASH_BASE}/assignments/{w['assignment_id']}", wait_until="networkidle")
            await page.wait_for_timeout(1000)
            await _shot(page, "assignment-no-anchor")
        print(f"  admin console errors: {errors or 'none'}")


async def capture_email(hb: HarnessBrowser, w: dict[str, str]) -> None:
    from sqlalchemy import select

    from api.routes import teacher_reports as mod

    sent: list[str] = []

    async def fake_send(*, to: list[str], subject: str, html: str) -> None:
        sent.append(f"<p style='color:#64748b;font:12px sans-serif'>Subject: {subject}</p>{html}")

    mod.send_email = fake_send  # type: ignore[assignment]
    mod.settings.admin_alert_emails = ["founder@example.com"]
    async with get_session_factory()() as s:
        r = (await s.execute(select(TeacherReport).where(TeacherReport.id == uuid.UUID(w["report_id"])))).scalar_one()
        mod._notify(r)
        await asyncio.sleep(0.05)
    async with hb.plain_page() as page:
        await page.set_viewport_size({"width": 760, "height": 900})
        style = "font-family:-apple-system,sans-serif;padding:24px;max-width:680px"
        await page.set_content(f"<body style='{style}'>{sent[0]}</body>")
        await _shot(page, "email")


async def capture_teacher(hb: HarnessBrowser, w: dict[str, str]) -> None:
    async with hb.authed_page(w["teacher"], w["teacher_refresh"]) as page:
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.set_viewport_size({"width": 1440, "height": 1100})
        base = f"{WEB_BASE}{w['review_path']}"
        await page.goto(base, wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2500)
        print(f"  landed: {page.url}")
        # Landing auto-picks the first unreleased student and writes it back.
        await page.get_by_text("Noah Kim").first.click()
        await page.wait_for_timeout(2000)
        print(f"  after selecting Noah: {page.url}")
        await _shot(page, "review-url-sync")
        await page.goto(f"{base}?student={w['maya_id']}&problem=3", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3000)
        print(f"  deep link: {page.url}")
        await _shot(page, "review-problem-deep-link")
        # A confident, collapsed row opens when a link points at it.
        await page.goto(f"{base}?student={w['maya_id']}&problem=4", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(3000)
        await _shot(page, "review-problem-deep-link-collapsed")
        # File a real per-problem report from the page and read back the
        # page_url it stored — the thing this whole change makes exact.
        await page.get_by_role("button", name="Report").last.click()
        await page.get_by_role("button", name="Send report").click()
        await page.wait_for_timeout(1500)
        from sqlalchemy import select

        async with get_session_factory()() as s:
            latest = (await s.execute(
                select(TeacherReport).order_by(TeacherReport.created_at.desc()).limit(1)
            )).scalar_one()
            print(f"  filed report page_url: {latest.page_url} (position {latest.problem_position})")
        print(f"  teacher page errors: {errors or 'none'}")


async def main() -> None:
    assert_local_database()
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode == "seed":
        await seed()
        print(f"seeded -> {STATE}")
        return
    w = json.loads(STATE.read_text())
    # Access tokens are short-lived; re-mint them from the seeded ids so a
    # capture an hour after `seed` still signs in.
    for key, role in (("admin", "admin"), ("teacher", "teacher")):
        payload = w[key].split(".")[1]
        sub = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]
        w[key] = create_access_token(sub, role)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    async with HarnessBrowser(DASH_BASE) as hb:
        if mode in ("admin", "all"):
            await capture_admin(hb, w)
        if mode in ("email", "all"):
            await capture_email(hb, w)
        if mode in ("teacher", "all"):
            await capture_teacher(hb, w)
        if mode in ("sidebar", "all"):
            await capture_sidebar(hb, w)


async def _latest_report() -> TeacherReport:
    from sqlalchemy import select

    async with get_session_factory()() as s:
        return (await s.execute(
            select(TeacherReport).order_by(TeacherReport.created_at.desc()).limit(1)
        )).scalar_one()


async def capture_sidebar(hb: HarnessBrowser, w: dict[str, str]) -> None:
    """The sidebar "Report a problem" (#914): with a student open it attaches
    them (and a picked problem); on a page with nothing open it attaches
    nothing. File one of each through the real dialog, then open each in
    the admin console."""
    filed: list[tuple[str, str]] = []
    async with hb.authed_page(w["teacher"], w["teacher_refresh"]) as page:
        await page.set_viewport_size({"width": 1440, "height": 1100})
        # 1. Student open, Problem 3 picked in the sidebar dialog.
        await page.goto(f"{WEB_BASE}{w['review_path']}?student={w['maya_id']}",
                        wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(2500)
        await page.get_by_role("button", name="Report a problem").first.click()
        await page.get_by_label("Which problem?").select_option(label=next(
            o for o in await page.locator("select option").all_inner_texts() if o.startswith("Problem 3")
        ))
        await page.get_by_label("It misread the student's handwriting").check()
        await page.get_by_role("textbox").last.fill("Sidebar: the (2, 3) is fine but she never graphed it.")
        await page.get_by_role("button", name="Send report").click()
        await page.wait_for_timeout(1500)
        r = await _latest_report()
        print(f"  sidebar+student: submission={r.submission_id} position={r.problem_position} page_url={r.page_url}")
        filed.append((str(r.id), "sidebar-attached"))
        # 2. Nothing open: the teacher home.
        await page.goto(f"{WEB_BASE}/school/teacher", wait_until="networkidle", timeout=60000)
        await page.wait_for_timeout(1500)
        # A first visit to the home page opens the product tour.
        skip = page.get_by_role("button", name="Skip for now")
        if await skip.count():
            await skip.click()
            await page.wait_for_timeout(500)
        await page.get_by_role("button", name="Report a problem").first.click()
        await page.get_by_label("Something's broken").check()
        await page.get_by_role("textbox").last.fill("The course list flickered on load.")
        await page.get_by_role("button", name="Send report").click()
        await page.wait_for_timeout(1500)
        r = await _latest_report()
        print(f"  sidebar bare: submission={r.submission_id} page_url={r.page_url}")
        filed.append((str(r.id), "sidebar-bare"))
    async with hb.authed_page(w["admin"], w["admin"], **ADMIN_KEYS) as page:
        await page.set_viewport_size({"width": 1440, "height": 1000})
        for rid, name in filed:
            await page.goto(f"{DASH_BASE}/reports/{rid}", wait_until="networkidle")
            await page.wait_for_timeout(1500)
            await _shot(page, f"case-view-{name}", full=name == "sidebar-attached")


if __name__ == "__main__":
    asyncio.run(main())
