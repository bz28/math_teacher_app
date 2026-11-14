"""Measure and screenshot homework photos end to end on the real app — run
once against a build that stores photos inline (before) and once against
one that stores them in the photo bucket (after).

Seeds a class with one homework (integrity check and AI grading off: no
model calls), has a student turn in two phone-sized photos through the real
submit endpoint, then:

  * times the teacher's submission detail and the student's submission
    poll (the endpoint the "preparing" screen polls) and records their
    payload sizes, decompressed and on the wire;
  * screenshots the teacher review page with the photos and the student's
    submitted view.

    DATABASE_URL=... API_BASE=http://localhost:8010/v1 WEB_BASE=http://localhost:3010 \\
        SHOT_PREFIX=after .venv/bin/python -m scripts.capture_photo_bucket

Writes docs/design/photo-bucket-<prefix>-*.png and prints the numbers as
JSON (with the submission id, so test objects can be removed afterwards).
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import os
import random
import statistics
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from api.core.auth import create_access_token, create_refresh_token, hash_password
from api.database import get_session_factory
from api.models.assignment import Assignment, AssignmentSection
from api.models.course import Course, CourseTeacher
from api.models.question_bank import QuestionBankItem
from api.models.school import SCHOOL_KIND_INDIVIDUAL, School
from api.models.section import Section
from api.models.section_enrollment import SectionEnrollment
from api.models.unit import Unit
from api.models.user import User
from tests.harness.browser import HarnessBrowser

API_BASE = os.environ.get("API_BASE", "http://localhost:8010/v1").rstrip("/")
WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3010").rstrip("/")
PREFIX = os.environ.get("SHOT_PREFIX", "after")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"
FONT = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"

SPECS = [
    ("Solve for x:  $2x + 3 = 11$", "$x = 4$"),
    ("Simplify:  $3(x - 4) + 5$", "$3x - 7$"),
    ("Solve for x:  $5x - 7 = 18$", "$x = 5$"),
]
PAGES = [
    ["1)  2x + 3 = 11", "     2x = 8", "      x = 4", "", "2)  3(x - 4) + 5", "     = 3x - 12 + 5", "     = 3x - 7"],
    ["3)  5x - 7 = 18", "     5x = 25", "      x = 5", "", "check:  5(5) - 7 = 18  ✓"],
]


def _phone_photo(lines: list[str], seed: int) -> str:
    """A phone-camera-sized page (3024x4032 JPEG, ~3 MB): lined paper,
    handwriting, and sensor noise, so it compresses like a real photo."""
    rng = random.Random(seed)
    w, h = 3024, 4032
    img = Image.new("RGB", (w, h), (246, 243, 236))
    d = ImageDraw.Draw(img)
    for y in range(420, h, 150):
        d.line([(0, y), (w, y)], fill=(170, 195, 225), width=4)
    d.line([(330, 0), (330, h)], fill=(225, 150, 150), width=5)
    try:
        font = ImageFont.truetype(FONT, 150)
    except OSError:
        font = ImageFont.load_default()
    for i, line in enumerate(lines):
        d.text((420 + rng.randint(-10, 10), 300 + i * 300), line, fill=(38, 52, 92), font=font)
    img = img.rotate(rng.uniform(-1.5, 1.5), fillcolor=(90, 80, 70), resample=Image.Resampling.BICUBIC)
    noise = Image.effect_noise((w, h), 28).convert("RGB")
    img = Image.blend(img, noise, 0.16).filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=93)
    return base64.b64encode(buf.getvalue()).decode("ascii")


async def seed() -> dict[str, Any]:
    suffix = uuid.uuid4().hex[:6]
    now = datetime.now(UTC)
    async with get_session_factory()() as s:
        school = School(
            name="Lincoln High", kind=SCHOOL_KIND_INDIVIDUAL,
            contact_name="Demo", contact_email=f"photos_{suffix}@t.com",
        )
        s.add(school)
        await s.flush()
        teacher = User(
            email=f"photos_teacher_{suffix}@t.com", password_hash=hash_password("x"),
            grade_level=12, role="teacher", name="Ms. Rivera", school_id=school.id,
        )
        student = User(
            email=f"maya_{suffix}@school.edu", password_hash=hash_password("x"),
            grade_level=9, role="student", name="Maya Chen", school_id=school.id,
        )
        s.add_all([teacher, student])
        await s.flush()
        course = Course(name="Algebra I", subject="math", school_id=school.id)
        s.add(course)
        await s.flush()
        s.add(CourseTeacher(course_id=course.id, teacher_id=teacher.id, role="owner"))
        unit = Unit(course_id=course.id, name="Linear Equations", position=0)
        section = Section(course_id=course.id, name="Period 3")
        s.add_all([unit, section])
        await s.flush()
        s.add(SectionEnrollment(section_id=section.id, course_id=course.id, student_id=student.id))
        hw = Assignment(
            course_id=course.id, unit_ids=[unit.id], teacher_id=teacher.id,
            title="Linear Equations Practice", type="homework", status="published", late_policy="none",
            content={"problem_ids": []}, due_at=now + timedelta(days=1),
            integrity_check_enabled=False, ai_grading_enabled=False,
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
        s.add(AssignmentSection(assignment_id=hw.id, section_id=section.id, published_at=now - timedelta(days=1)))
        out = {
            "course_id": str(course.id), "section_id": str(section.id), "hw": str(hw.id),
            "student_id": str(student.id),
            "teacher_access": create_access_token(str(teacher.id), "teacher"),
            "teacher_refresh": await create_refresh_token(s, teacher.id),
            "student_access": create_access_token(str(student.id), "student"),
            "student_refresh": await create_refresh_token(s, student.id),
        }
        await s.commit()
    return out


async def _time(client: httpx.AsyncClient, url: str, token: str, n: int = 7) -> dict[str, Any]:
    h = {"Authorization": f"Bearer {token}", "Accept-Encoding": "gzip"}
    await client.get(url, headers=h)  # warm-up
    times, wire, body = [], 0, 0
    for _ in range(n):
        t = time.perf_counter()
        r = await client.get(url, headers=h)
        times.append((time.perf_counter() - t) * 1000)
        r.raise_for_status()
        wire, body = r.num_bytes_downloaded, len(r.content)
    return {
        "p50_ms": round(statistics.median(times), 1), "min_ms": round(min(times), 1),
        "max_ms": round(max(times), 1), "wire_bytes": wire, "json_bytes": body,
    }


async def _shot(page: Any, name: str) -> None:
    out = OUT_DIR / f"photo-bucket-{PREFIX}-{name}.png"
    await page.screenshot(path=str(out))
    print(f"  -> {out}")


async def _photos_loaded(page: Any, minimum: int) -> None:
    await page.wait_for_function(
        """n => [...document.images].filter(i => i.complete && i.naturalWidth > 1000).length >= n""",
        arg=minimum, timeout=60000,
    )


async def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    w = await seed()
    pages = [_phone_photo(lines, i) for i, lines in enumerate(PAGES)]
    print("page sizes (MB):", [round(len(base64.b64decode(p)) / 1e6, 2) for p in pages])
    async with httpx.AsyncClient(timeout=120) as client:
        t = time.perf_counter()
        r = await client.post(
            f"{API_BASE}/school/student/homework/{w['hw']}/submit",
            json={"files": pages}, headers={"Authorization": f"Bearer {w['student_access']}"},
        )
        submit_ms = (time.perf_counter() - t) * 1000
        r.raise_for_status()
        sid = r.json()["submission_id"]
        metrics = {
            "submission_id": sid,
            "submit_ms": round(submit_ms, 1),
            "teacher_detail": await _time(client, f"{API_BASE}/teacher/submissions/{sid}", w["teacher_access"]),
            "student_poll": await _time(
                client, f"{API_BASE}/school/student/homework/{w['hw']}/submission", w["student_access"],
            ),
        }
    async with HarnessBrowser(WEB_BASE) as browser:
        async with browser.authed_page(w["teacher_access"], w["teacher_refresh"]) as page:
            await page.set_viewport_size({"width": 1440, "height": 1000})
            await page.goto(
                f"{WEB_BASE}/school/teacher/courses/{w['course_id']}/homework/{w['hw']}"
                f"/sections/{w['section_id']}/review?student={w['student_id']}",
                wait_until="networkidle", timeout=120000,
            )
            try:
                await page.get_by_text("Maya's work").first.wait_for(timeout=90000)
            except Exception:
                await _shot(page, "debug")
                raise
            await _photos_loaded(page, 2)
            await page.wait_for_timeout(800)
            await _shot(page, "teacher-review")
            await page.get_by_role("button", name="⤢ Full").click()
            await _photos_loaded(page, 3)
            await page.wait_for_timeout(600)
            await _shot(page, "teacher-gallery")
        async with browser.authed_page(w["student_access"], w["student_refresh"]) as page:
            await page.set_viewport_size({"width": 1280, "height": 900})
            await page.goto(
                f"{WEB_BASE}/school/student/courses/{w['course_id']}/homework/{w['hw']}",
                wait_until="networkidle", timeout=120000,
            )
            await page.get_by_text("What your teacher sees").first.scroll_into_view_if_needed()
            await page.get_by_text("What your teacher sees").first.evaluate(
                "el => el.scrollIntoView({block: 'center'})",
            )
            await _photos_loaded(page, 2)
            await page.wait_for_timeout(800)
            await _shot(page, "student-submitted")
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
